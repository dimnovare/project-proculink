"use client";

// WireDragLayer — the canonical→output wires, made INTERACTIVE and OVERRIDE-AWARE.
// Desktop xl only. This component is the single source of truth for the RIGHT-side
// (canonical → supplier-output) wires; SpineConnectors is told drawOutput={false} so
// it only paints the source→canonical (left) side. That is what makes a drag visibly
// RE-ROUTE a wire (the previous version saved the override but the visible wire — drawn
// by SpineConnectors keyed on node id — never moved, so "it just said connected").
//
// Model (single, clean):
//  • Each OUTPUT line has exactly ONE source canonical field. Default = identity
//    (output "po" ← canonical PoNumber = node "po"). A per-order override re-points it.
//  • existingConnections: outputLineId → canonicalField (from OrderMappingOverride.output).
//  • A persistent wire is drawn for every output line, from its CURRENT source node's
//    right-edge handle to that output line. Override wires are blue+solid; defaults green.
//  • Dragging a canonical handle onto an output line (or keyboard connect) calls
//    onConnect(nodeId, outputLineId) → the parent persists the override + bumps the
//    signature → this re-measures and the wire is redrawn from the new source. It STAYS.
//
// Native pointer events only (no drag library). The decorative SpineConnectors SVG is
// untouched.

import type React from "react";
import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
} from "react";
import type { ConnectorNode } from "./SpineConnectors";
import { useDragAutoScroll } from "./useDragAutoScroll";

// Output lines that can be re-sourced (match the ids in OutputPreview's onLine refs).
export const OUTPUT_LINE_IDS = ["po", "date", "supplier", "buyer", "currency", "totals", "lines"] as const;
export type OutputLineId = typeof OUTPUT_LINE_IDS[number];

// nodeId → canonical field name (what OutputFieldRule.canonicalField stores).
const NODE_TO_CANONICAL: Record<string, string> = {
  po:       "PoNumber",
  date:     "OrderDate",
  buyer:    "BuyerName",
  supplier: "SupplierName",
  currency: "Currency",
  lines:    "LineNumber",
  totals:   "LineTotal",
};
const CANONICAL_TO_NODE: Record<string, string> =
  Object.fromEntries(Object.entries(NODE_TO_CANONICAL).map(([n, c]) => [c, n]));

/**
 * Resolve the canonical SOURCE node that currently feeds an output line.
 * Default is identity (output "totals" ← node "totals"); a per-order override
 * canonicalField re-points it (e.g. "Currency" → node "currency"). Pure + exported
 * so the wire-routing logic is unit-tested independently of the SVG.
 */
export function resolveWireSource(
  lineId: string,
  overrideField: string | undefined | null,
): { sourceNode: string; isOverride: boolean } {
  const sourceNode = overrideField ? (CANONICAL_TO_NODE[overrideField] ?? lineId) : lineId;
  return { sourceNode, isOverride: overrideField != null && sourceNode !== lineId };
}

// Human labels for the SR announcer.
const NODE_LABEL: Record<string, string> = {
  po: "PO number", date: "Order date", buyer: "Buyer", supplier: "Supplier",
  currency: "Currency", totals: "Total", lines: "Line items",
};
const LINE_LABEL: Record<string, string> = {
  po: "po_number", date: "order_date", supplier: "supplier", buyer: "buyer",
  currency: "currency", totals: "grand_total", lines: "line items",
};

interface WireDragLayerProps {
  gridRef: React.RefObject<HTMLElement | null>;
  nodeEls: React.MutableRefObject<Record<string, HTMLElement | null>>;
  outLineEls: React.MutableRefObject<Record<string, HTMLElement | null>>;
  nodes: ConnectorNode[];
  /** Re-point an output line's source: onConnect(canonicalNodeId, outputLineId). */
  onConnect: (nodeId: string, outputLineId: string) => void;
  /** Remove an output override (revert the line to its default source). */
  onDisconnect: (outputLineId: string) => void;
  /** Current per-order overrides: outputLineId → canonicalField. */
  existingConnections: Partial<Record<string, string>>;
  /** Any change re-measures (mirrors SpineConnectors). */
  signature: string;
}

interface Pt { id: string; x: number; y: number; }
interface DragState { sourceId: string; x: number; y: number; }

const HANDLE_R = 6;
const ZONE_W = 22;
const ZONE_H = 16;
const SNAP_PX = 36;

function bezier(x1: number, y1: number, x2: number, y2: number): string {
  const cx = x1 + (x2 - x1) * 0.5;
  return `M ${x1} ${y1} C ${cx} ${y1} ${cx} ${y2} ${x2} ${y2}`;
}

export function WireDragLayer({
  gridRef, nodeEls, outLineEls, nodes, onConnect, onDisconnect, existingConnections, signature,
}: WireDragLayerProps) {
  const sigRef = useRef<{ h: string; z: string }>({ h: "", z: "" });
  const [handles, setHandles]   = useState<Pt[]>([]);   // canonical node right-edge anchors, id = nodeId
  const [zones, setZones]       = useState<Pt[]>([]);   // output line left-edge anchors, id = outputLineId
  const [drag, setDrag]         = useState<DragState | null>(null);
  const [hoverZone, setHoverZone] = useState<string | null>(null);
  const [kbSource, setKbSource] = useState<string | null>(null);
  const [kbTarget, setKbTarget] = useState(0);
  const [shown, setShown]       = useState(false);
  const announcerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);

  const { onDragPointer, stopAutoScroll } = useDragAutoScroll(gridRef);

  const handleById = useMemo(() => new Map(handles.map(h => [h.id, h])), [handles]);

  // Read `nodes` from a ref so measure()'s identity stays STABLE across renders
  // (connectorNodes gets a new identity whenever the order/labels memo recomputes).
  // An unstable measure made the layout effect re-run every render — a contributor
  // to the React #185 update-depth loop. measure now re-runs only on signature
  // change or a real DOM event.
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  const measure = useCallback(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const g = grid.getBoundingClientRect();
    if (g.width < 60) { setHandles([]); setZones([]); return; }

    const h: Pt[] = [];
    nodesRef.current.forEach((node) => {
      const el = nodeEls.current[node.id];
      if (!el) return;
      const r = el.getBoundingClientRect();
      h.push({ id: node.id, x: r.right - g.left, y: r.top - g.top + 18 });
    });
    const z: Pt[] = [];
    OUTPUT_LINE_IDS.forEach((lid) => {
      const el = outLineEls.current[lid];
      if (!el) return;
      const r = el.getBoundingClientRect();
      z.push({ id: lid, x: r.left - g.left, y: r.top - g.top + r.height / 2 });
    });
    // Commit ONLY when positions changed (compared via sigRef, not state) and never
    // blank to empty on a transient null-ref pass — prevents any measure→render→measure loop.
    const sig = (a: Pt[]) => a.map(p => `${p.id}:${Math.round(p.x)}:${Math.round(p.y)}`).join("|");
    const hSig = sig(h), zSig = sig(z);
    if (!(h.length === 0 && sigRef.current.h.length > 0) && hSig !== sigRef.current.h) { sigRef.current.h = hSig; setHandles(h); }
    if (!(z.length === 0 && sigRef.current.z.length > 0) && zSig !== sigRef.current.z) { sigRef.current.z = zSig; setZones(z); }
  }, [gridRef, nodeEls, outLineEls]);

  const scheduleMeasure = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => { rafRef.current = requestAnimationFrame(measure); });
  }, [measure]);

  useLayoutEffect(() => { measure(); }, [measure, signature]);

  useEffect(() => {
    measure();
    const t = setTimeout(() => { measure(); setShown(true); }, 80);
    const ro = new ResizeObserver(scheduleMeasure);
    const seen = new Set<Element>();
    const obs = (el: Element | null | undefined) => { if (el && !seen.has(el)) { seen.add(el); ro.observe(el); } };
    obs(gridRef.current);
    Object.values(nodeEls.current).forEach(obs);
    Object.values(outLineEls.current).forEach(obs);
    // Capture-phase document scroll catches every scroll container (page / review
    // wrapper / any inner pane) so wires track on any scroll.
    document.addEventListener("scroll", scheduleMeasure, { capture: true, passive: true });
    window.addEventListener("resize", scheduleMeasure);
    return () => {
      clearTimeout(t);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      document.removeEventListener("scroll", scheduleMeasure, { capture: true } as EventListenerOptions);
      window.removeEventListener("resize", scheduleMeasure);
    };
  }, [measure, scheduleMeasure, gridRef, nodeEls, outLineEls]);

  // ── Resolve each output line's CURRENT source node (override or identity default) ──
  const wires = useMemo(() => {
    return zones.map((z) => {
      const { sourceNode, isOverride } = resolveWireSource(z.id, existingConnections[z.id]);
      const h = handleById.get(sourceNode);
      return h ? { lineId: z.id, sourceNode, isOverride, hx: h.x, hy: h.y, zx: z.x, zy: z.y } : null;
    }).filter(Boolean) as { lineId: string; sourceNode: string; isOverride: boolean; hx: number; hy: number; zx: number; zy: number; }[];
  }, [zones, existingConnections, handleById]);

  // ── Pointer drag ────────────────────────────────────────────────────────────
  const ptToGrid = useCallback((e: { clientX: number; clientY: number }) => {
    const g = gridRef.current?.getBoundingClientRect();
    return g ? { x: e.clientX - g.left, y: e.clientY - g.top } : null;
  }, [gridRef]);

  const nearestZone = useCallback((x: number, y: number): string | null => {
    let best: string | null = null, bestD = SNAP_PX;
    zones.forEach((z) => { const d = Math.hypot(z.x - x, z.y - y); if (d < bestD) { bestD = d; best = z.id; } });
    return best;
  }, [zones]);

  const onHandleDown = useCallback((e: React.PointerEvent, nodeId: string) => {
    e.preventDefault(); e.stopPropagation();
    (e.currentTarget as SVGElement).setPointerCapture(e.pointerId);
    const p = ptToGrid(e);
    if (p) setDrag({ sourceId: nodeId, x: p.x, y: p.y });
  }, [ptToGrid]);

  const onMove = useCallback((e: React.PointerEvent) => {
    if (!drag) return;
    const p = ptToGrid(e);
    if (!p) return;
    onDragPointer(e.clientY); // edge auto-scroll so bottom drop targets stay reachable
    setDrag(d => d ? { ...d, x: p.x, y: p.y } : null);
    setHoverZone(nearestZone(p.x, p.y));
  }, [drag, ptToGrid, nearestZone, onDragPointer]);

  const onUp = useCallback((e: React.PointerEvent) => {
    if (!drag) return;
    stopAutoScroll();
    const p = ptToGrid(e);
    const target = p ? nearestZone(p.x, p.y) : null;
    if (target) {
      onConnect(drag.sourceId, target);
      announce(`Connected ${NODE_LABEL[drag.sourceId] ?? drag.sourceId} to output ${LINE_LABEL[target] ?? target}`);
    }
    setDrag(null); setHoverZone(null);
  }, [drag, ptToGrid, nearestZone, onConnect, stopAutoScroll]);

  // ── Keyboard connect mode ─────────────────────────────────────────────────────
  const onHandleKey = useCallback((e: React.KeyboardEvent, nodeId: string) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (kbSource === nodeId) {
        const target = OUTPUT_LINE_IDS[kbTarget];
        if (target) { onConnect(nodeId, target); announce(`Connected ${NODE_LABEL[nodeId] ?? nodeId} to output ${LINE_LABEL[target] ?? target}`); }
        setKbSource(null);
      } else {
        setKbSource(nodeId); setKbTarget(0);
        announce(`Connect mode for ${NODE_LABEL[nodeId] ?? nodeId}. Arrow keys choose the output field, Enter confirms, Escape cancels.`);
      }
    } else if (kbSource === nodeId && (e.key === "ArrowDown" || e.key === "ArrowRight")) {
      e.preventDefault(); setKbTarget(p => (p + 1) % OUTPUT_LINE_IDS.length);
    } else if (kbSource === nodeId && (e.key === "ArrowUp" || e.key === "ArrowLeft")) {
      e.preventDefault(); setKbTarget(p => (p - 1 + OUTPUT_LINE_IDS.length) % OUTPUT_LINE_IDS.length);
    } else if (e.key === "Escape") {
      setKbSource(null);
    }
  }, [kbSource, kbTarget, onConnect]);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setKbSource(null); };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, []);

  function announce(msg: string) {
    const el = announcerRef.current;
    if (!el) return;
    el.textContent = "";
    requestAnimationFrame(() => { if (announcerRef.current) announcerRef.current.textContent = msg; });
  }

  const dragHandle = drag ? handleById.get(drag.sourceId) : undefined;
  const kbZone = kbSource ? zones.find(z => z.id === OUTPUT_LINE_IDS[kbTarget]) : undefined;

  return (
    <>
      <div ref={announcerRef} aria-live="polite" aria-atomic="true"
        style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" }} />

      <svg aria-hidden
        style={{
          position: "absolute", inset: 0, width: "100%", height: "100%",
          pointerEvents: drag ? "auto" : "none", zIndex: 3,
          opacity: shown ? 1 : 0, transition: "opacity 320ms ease-out",
        }}
        onPointerMove={drag ? onMove : undefined}
        onPointerUp={drag ? onUp : undefined}
        onPointerCancel={() => { stopAutoScroll(); setDrag(null); setHoverZone(null); }}
      >
        {/* ── Persistent canonical→output wires (override-aware) ──────────────── */}
        {wires.map((w) => {
          const dimmed = drag != null || kbSource != null;
          const stroke = w.isOverride ? "#1E66C9" : "#2E8E3A";
          return (
            <g key={`w-${w.lineId}`} style={{ opacity: dimmed ? 0.45 : 1, transition: "opacity 160ms" }}>
              <path d={bezier(w.hx, w.hy, w.zx, w.zy)} fill="none" stroke={stroke}
                strokeWidth={w.isOverride ? 2.4 : 1.8} style={{ pointerEvents: "none" }} />
              <circle cx={w.zx} cy={w.zy} r={2.6} fill={stroke} style={{ pointerEvents: "none" }} />
              {/* Delete affordance — only on a manual override (revert to default) */}
              {w.isOverride && !dimmed && (
                <g role="button" tabIndex={0}
                  aria-label={`Reset ${LINE_LABEL[w.lineId] ?? w.lineId} to its default source`}
                  style={{ pointerEvents: "auto", cursor: "pointer", outline: "none" }}
                  onClick={() => onDisconnect(w.lineId)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onDisconnect(w.lineId); } }}>
                  <circle cx={w.zx + 12} cy={w.zy} r={6.5} fill="#FFFFFF" stroke="#1E66C9" strokeWidth={1.3} />
                  <text x={w.zx + 12} y={w.zy + 3} textAnchor="middle" fontSize={8.5} fontWeight={700} fill="#1E66C9"
                    style={{ pointerEvents: "none", userSelect: "none" }}>✕</text>
                </g>
              )}
            </g>
          );
        })}

        {/* ── Live drag ghost ─────────────────────────────────────────────────── */}
        {drag && dragHandle && (
          <path d={bezier(dragHandle.x, dragHandle.y, drag.x, drag.y)} fill="none"
            stroke="#1E66C9" strokeWidth={2.4} strokeDasharray="5 3"
            style={{ pointerEvents: "none", opacity: 0.85 }} />
        )}
        {/* ── Keyboard preview ────────────────────────────────────────────────── */}
        {kbSource && kbZone && handleById.get(kbSource) && (
          <path d={bezier(handleById.get(kbSource)!.x, handleById.get(kbSource)!.y, kbZone.x, kbZone.y)}
            fill="none" stroke="#1E66C9" strokeWidth={2.4} strokeDasharray="5 3"
            style={{ pointerEvents: "none", opacity: 0.7 }} />
        )}

        {/* ── Output drop zones (hit targets + snap ring) ─────────────────────── */}
        {zones.map((z) => {
          const active = hoverZone === z.id || (kbSource != null && OUTPUT_LINE_IDS[kbTarget] === z.id);
          return (
            <g key={`z-${z.id}`} style={{ pointerEvents: "auto" }}>
              {active && (
                <circle cx={z.x} cy={z.y} r={9} fill="rgba(30,102,201,0.18)" stroke="#1E66C9" strokeWidth={1.5}
                  style={{ pointerEvents: "none" }} />
              )}
              <rect x={z.x - ZONE_W / 2} y={z.y - ZONE_H / 2} width={ZONE_W} height={ZONE_H}
                fill="transparent" style={{ cursor: drag ? "crosshair" : "default" }} />
            </g>
          );
        })}

        {/* ── Draggable canonical handles ─────────────────────────────────────── */}
        {handles.map((h) => {
          const isSource = drag?.sourceId === h.id || kbSource === h.id;
          const feedsAny = wires.some(w => w.sourceNode === h.id);
          const overrides = wires.some(w => w.sourceNode === h.id && w.isOverride);
          const fill = isSource ? "#1E66C9" : overrides ? "#1E66C9" : feedsAny ? "#2E8E3A" : "#FFFFFF";
          const stroke = isSource || overrides ? "#1E66C9" : feedsAny ? "#2E8E3A" : "#8A93A5";
          return (
            <g key={`h-${h.id}`} tabIndex={0} role="button"
              aria-label={`Drag ${NODE_LABEL[h.id] ?? h.id} onto an output field to wire it${kbSource === h.id ? " — connect mode active, use arrow keys" : ""}`}
              style={{ pointerEvents: "auto", cursor: "grab", outline: "none" }}
              onPointerDown={(e) => onHandleDown(e, h.id)}
              onKeyDown={(e) => onHandleKey(e, h.id)}
            >
              <circle cx={h.x} cy={h.y} r={HANDLE_R + 4}
                fill={isSource ? "rgba(30,102,201,0.15)" : "transparent"} style={{ transition: "fill 150ms" }} />
              <circle cx={h.x} cy={h.y} r={HANDLE_R} fill={fill} stroke={stroke} strokeWidth={1.8}
                style={{ transition: "fill 150ms, stroke 150ms" }} />
              <text x={h.x} y={h.y + 3.2} textAnchor="middle" fontSize={7.5} fontWeight={700}
                fill={fill === "#FFFFFF" ? "#8A93A5" : "#FFFFFF"}
                style={{ pointerEvents: "none", userSelect: "none", fontFamily: "monospace" }}>→</text>
              <title>Drag {NODE_LABEL[h.id] ?? h.id} → an output field</title>
            </g>
          );
        })}
      </svg>
    </>
  );
}
