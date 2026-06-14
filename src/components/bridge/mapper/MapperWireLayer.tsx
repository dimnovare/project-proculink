"use client";

// MapperWireLayer — the GENERALIZED, prop-driven drag/keyboard wire engine for the
// unified three-pane mapper. It is `WireDragLayer` + `SourceWireDragLayer` folded into
// ONE component that draws BOTH sides:
//
//   • SOURCE → CANONICAL (left)  — drag a source-token chip onto a canonical node.
//       violet wires. onSourceConnect(tokenId, canonicalField).
//   • CANONICAL → TARGET (right) — drag a canonical node handle onto an output field.
//       blue (override) / green (default) wires. onTargetConnect(canonicalField, outputPath).
//
// The whole measure/scroll/pointer/keyboard machinery is LIFTED VERBATIM from the two
// shipped layers (sigRef/nodesRef-stable measure(); double-rAF scheduleMeasure;
// useScrollResync; useDragAutoScroll; ResizeObserver; capture-phase document scroll;
// the "never blank to empty on a transient null-ref pass" guard; the SR announcer; the
// halo/focus handling). Only the SOURCES of the id lists change: node list, target list,
// and the node↔canonical map are PROPS instead of module constants. Because the unified
// mapper's canonical nodes ARE the canonical field keys, the node↔canonical map is the
// identity { [n.id]: n.id } — which is exactly why `resolveWireSource`'s param was
// generalized in wireMath.
//
// The source-token chips live in the SourceUniverse pane (left lane); this layer hands the
// host a `sourceChipProps(tokenId)` to spread onto each chip (drag handle + keyboard
// connect). The canonical node handles + target drop-zones are drawn by this layer's SVG.

import type React from "react";
import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
} from "react";
import { useDragAutoScroll } from "../useDragAutoScroll";
import { useScrollResync } from "../useScrollResync";
import { bezier } from "./wireMath";
import { GhostWire } from "./GhostWire";
import type { CanonicalNode, TargetField, MappingSuggestion } from "./types";

interface Pt { id: string; x: number; y: number; }

/** Which lane a pointer/keyboard drag started in. */
type Bank = "source" | "canonical";
interface DragState { bank: Bank; sourceId: string; x: number; y: number; }

const HANDLE_R = 6;
const ZONE_W = 24;
const ZONE_H = 18;
const SNAP_PX = 36;

const VIOLET = "#6F4FCE";   // source→canonical (explicit re-wire)
const BLUE = "#1E66C9";     // canonical→target override
const GREEN = "#2E8E3A";    // canonical→target default

export interface MapperWireLayerProps {
  gridRef: React.RefObject<HTMLElement | null>;
  /** Source-token chip elements, keyed by token id (registered by sourceChipProps.ref). */
  sourceEls: React.MutableRefObject<Record<string, HTMLElement | null>>;
  /** Canonical node circle-dot elements, keyed by canonical field key. */
  canonicalEls: React.MutableRefObject<Record<string, HTMLElement | null>>;
  /** Target/output row drop-zone anchors, keyed by output path. */
  targetEls: React.MutableRefObject<Record<string, HTMLElement | null>>;
  canonicalNodes: CanonicalNode[];
  targetFields: TargetField[];
  /** outputPath → canonicalField (OrderMappingOverride.output rule). */
  outputConnections: Partial<Record<string, string>>;
  /** canonicalField → sourceToken id (OrderMappingOverride.sourceMap). */
  sourceConnections: Partial<Record<string, string>>;
  knownSourceTokenIds: Set<string>;
  /** Dispatch: a source token dropped on a canonical node. */
  onSourceConnect: (tokenId: string, canonicalField: string) => void;
  /** Dispatch: a canonical node dropped on a target field. */
  onTargetConnect: (canonicalField: string, outputPath: string) => void;
  onSourceDisconnect: (canonicalField: string) => void;
  onTargetDisconnect: (outputPath: string) => void;
  /** AI ghost wires to overlay (Task 8). Rendered dashed + faint with accept/reject. */
  suggestions?: MappingSuggestion[];
  onAcceptSuggestion?: (s: MappingSuggestion) => void;
  onRejectSuggestion?: (s: MappingSuggestion) => void;
  hoveredId?: string | null;
  hidden?: boolean;
  signature: string;
}

/** Props the host spreads onto each source-token chip to make it a drag handle. */
export interface MapperSourceChipProps {
  ref: (el: HTMLElement | null) => void;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerCancel: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  tabIndex: 0;
  role: "button";
  "aria-label": string;
  "data-wired": boolean;
  "data-connecting": boolean;
}

export interface MapperWireLayer {
  /** Spread onto each source-token chip in SourceUniverse. */
  sourceChipProps: (tokenId: string) => MapperSourceChipProps;
  /** The SVG overlay — render absolutely positioned over the grid. */
  svg: React.ReactElement;
}

export function useMapperWireLayer({
  gridRef, sourceEls, canonicalEls, targetEls,
  canonicalNodes, targetFields, outputConnections, sourceConnections, knownSourceTokenIds,
  onSourceConnect, onTargetConnect, onSourceDisconnect, onTargetDisconnect,
  suggestions, onAcceptSuggestion, onRejectSuggestion,
  signature, hoveredId, hidden,
}: MapperWireLayerProps): MapperWireLayer {
  // Anchors. sourceHandles = token chip right-edges; canonDots = canonical node dots
  // (BOTH a drop zone for source wires AND a drag handle for target wires); targetZones
  // = output row left-edges.
  const [sourceHandles, setSourceHandles] = useState<Pt[]>([]);
  const [canonDots, setCanonDots] = useState<Pt[]>([]);
  const [targetZones, setTargetZones] = useState<Pt[]>([]);

  const [drag, setDrag] = useState<DragState | null>(null);
  const [hoverZone, setHoverZone] = useState<string | null>(null);
  // Keyboard connect mode (works in either bank): the handle id + the target index.
  const [kbBank, setKbBank] = useState<Bank | null>(null);
  const [kbSource, setKbSource] = useState<string | null>(null);
  const [kbTarget, setKbTarget] = useState(0);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const announcerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  // Last-committed position signatures — measure commits state only when an anchor set
  // ACTUALLY moved, so a repeated measure can never drive setState→render→measure (React #185).
  const sigRef = useRef<{ s: string; c: string; t: string }>({ s: "", c: "", t: "" });

  const { onDragPointer, stopAutoScroll } = useDragAutoScroll(gridRef);

  const sourceById = useMemo(() => new Map(sourceHandles.map((h) => [h.id, h])), [sourceHandles]);
  const canonById = useMemo(() => new Map(canonDots.map((d) => [d.id, d])), [canonDots]);
  const targetById = useMemo(() => new Map(targetZones.map((z) => [z.id, z])), [targetZones]);

  // Stable id lists for the keyboard target order.
  const canonIds = useMemo(() => canonicalNodes.map((n) => n.id), [canonicalNodes]);
  const targetIds = useMemo(() => targetFields.map((f) => f.outputPath), [targetFields]);

  // Read tokens/nodes/targets from refs so measure() identity stays STABLE across renders
  // (each gets a new identity when the order/source memo recomputes — an unstable measure
  // re-ran the layout/observer effects every render, a React #185 contributor).
  const tokenIdsRef = useRef<string[]>([]);
  tokenIdsRef.current = Array.from(knownSourceTokenIds);
  const canonNodesRef = useRef(canonicalNodes);
  canonNodesRef.current = canonicalNodes;
  const targetFieldsRef = useRef(targetFields);
  targetFieldsRef.current = targetFields;

  const measure = useCallback(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const g = grid.getBoundingClientRect();
    if (g.width < 60) { setSourceHandles([]); setCanonDots([]); setTargetZones([]); return; }

    // Source token chip RIGHT edges.
    const s: Pt[] = [];
    tokenIdsRef.current.forEach((id) => {
      const el = sourceEls.current[id];
      if (!el) return;
      const r = el.getBoundingClientRect();
      s.push({ id, x: r.right - g.left, y: r.top - g.top + r.height / 2 });
    });
    // Canonical node dot CENTRES.
    const c: Pt[] = [];
    canonNodesRef.current.forEach((node) => {
      const el = canonicalEls.current[node.id];
      if (!el) return;
      const r = el.getBoundingClientRect();
      c.push({ id: node.id, x: r.left - g.left + r.width / 2, y: r.top - g.top + r.height / 2 });
    });
    // Target row LEFT edges.
    const t: Pt[] = [];
    targetFieldsRef.current.forEach((field) => {
      const el = targetEls.current[field.outputPath];
      if (!el) return;
      const r = el.getBoundingClientRect();
      t.push({ id: field.outputPath, x: r.left - g.left + r.width / 2, y: r.top - g.top + r.height / 2 });
    });

    const sig = (a: Pt[]) => a.map((p) => `${p.id}:${Math.round(p.x)}:${Math.round(p.y)}`).join("|");
    const sSig = sig(s), cSig = sig(c), tSig = sig(t);
    // Never blank to empty on a transient null-ref pass while items still exist.
    if (!(s.length === 0 && sigRef.current.s.length > 0) && sSig !== sigRef.current.s) { sigRef.current.s = sSig; setSourceHandles(s); }
    if (!(c.length === 0 && sigRef.current.c.length > 0) && cSig !== sigRef.current.c) { sigRef.current.c = cSig; setCanonDots(c); }
    if (!(t.length === 0 && sigRef.current.t.length > 0) && tSig !== sigRef.current.t) { sigRef.current.t = tSig; setTargetZones(t); }
  }, [gridRef, sourceEls, canonicalEls, targetEls]);

  const scheduleMeasure = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => { rafRef.current = requestAnimationFrame(measure); });
  }, [measure]);

  // Event-independent scroll tracking — DIRECT measure (not scheduleMeasure) so wires
  // track the sticky columns every frame instead of snapping when scroll stops.
  useScrollResync(gridRef, measure);

  useLayoutEffect(() => { measure(); }, [measure, signature]);

  useEffect(() => {
    measure();
    const t = setTimeout(() => { measure(); setShown(true); }, 80);
    const ro = new ResizeObserver(scheduleMeasure);
    const seen = new Set<Element>();
    const obs = (el: Element | null | undefined) => { if (el && !seen.has(el)) { seen.add(el); ro.observe(el); } };
    obs(gridRef.current);
    Object.values(sourceEls.current).forEach(obs);
    Object.values(canonicalEls.current).forEach(obs);
    Object.values(targetEls.current).forEach(obs);
    // Capture-phase document scroll catches every scroll container (page / review wrapper
    // / source panel inner scroll) so wires track on any scroll.
    document.addEventListener("scroll", scheduleMeasure, { capture: true, passive: true });
    window.addEventListener("resize", scheduleMeasure);
    return () => {
      clearTimeout(t);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      document.removeEventListener("scroll", scheduleMeasure, { capture: true } as EventListenerOptions);
      window.removeEventListener("resize", scheduleMeasure);
    };
  }, [measure, scheduleMeasure, gridRef, sourceEls, canonicalEls, targetEls]);

  // ── Persistent SOURCE → CANONICAL wires (violet) ──────────────────────────────
  const sourceWires = useMemo(() => {
    const out: { canonicalField: string; tokenId: string; hx: number; hy: number; zx: number; zy: number }[] = [];
    for (const node of canonIds) {
      const tokenId = sourceConnections[node];
      if (!tokenId || !knownSourceTokenIds.has(tokenId)) continue;
      const h = sourceById.get(tokenId);
      const z = canonById.get(node);
      if (h && z) out.push({ canonicalField: node, tokenId, hx: h.x, hy: h.y, zx: z.x, zy: z.y });
    }
    return out;
  }, [canonIds, sourceConnections, knownSourceTokenIds, sourceById, canonById]);

  // ── Persistent CANONICAL → TARGET wires (blue override / green default) ───────
  // Default is identity: output path "X" ← canonical "X" when a node of that key exists.
  const targetWires = useMemo(() => {
    const out: { outputPath: string; canonicalField: string; isOverride: boolean; hx: number; hy: number; zx: number; zy: number }[] = [];
    for (const z of targetZones) {
      const override = outputConnections[z.id];
      const canonicalField = override ?? (canonById.has(z.id) ? z.id : undefined);
      if (!canonicalField) continue;
      const h = canonById.get(canonicalField);
      if (!h) continue;
      const isOverride = override != null && override !== z.id;
      out.push({ outputPath: z.id, canonicalField, isOverride, hx: h.x, hy: h.y, zx: z.x, zy: z.y });
    }
    return out;
  }, [targetZones, outputConnections, canonById]);

  // ── Pointer helpers ───────────────────────────────────────────────────────────
  const ptToGrid = useCallback((e: { clientX: number; clientY: number }) => {
    const g = gridRef.current?.getBoundingClientRect();
    return g ? { x: e.clientX - g.left, y: e.clientY - g.top } : null;
  }, [gridRef]);

  // Snap against the OTHER bank's zones only (source→canonical, canonical→target).
  const nearestForBank = useCallback((bank: Bank, x: number, y: number): string | null => {
    const zones = bank === "source" ? canonDots : targetZones;
    let best: string | null = null, bestD = SNAP_PX;
    zones.forEach((z) => { const d = Math.hypot(z.x - x, z.y - y); if (d < bestD) { bestD = d; best = z.id; } });
    return best;
  }, [canonDots, targetZones]);

  function announce(msg: string) {
    const el = announcerRef.current;
    if (!el) return;
    el.textContent = "";
    requestAnimationFrame(() => { if (announcerRef.current) announcerRef.current.textContent = msg; });
  }

  const fireConnect = useCallback((bank: Bank, fromId: string, zoneId: string) => {
    if (bank === "source") {
      onSourceConnect(fromId, zoneId);
      announce(`Wired source field to canonical ${zoneId}`);
    } else {
      onTargetConnect(fromId, zoneId);
      announce(`Wired canonical ${fromId} to output ${zoneId}`);
    }
  }, [onSourceConnect, onTargetConnect]);

  // ── Pointer drag (shared by both banks) ───────────────────────────────────────
  const onHandleDown = useCallback((e: React.PointerEvent, bank: Bank, id: string) => {
    e.preventDefault(); e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    const p = ptToGrid(e);
    if (p) setDrag({ bank, sourceId: id, x: p.x, y: p.y });
  }, [ptToGrid]);

  const onMove = useCallback((e: React.PointerEvent) => {
    if (!drag) return;
    const p = ptToGrid(e);
    if (!p) return;
    onDragPointer(e.clientY); // edge auto-scroll so bottom drop targets stay reachable
    setDrag((d) => d ? { ...d, x: p.x, y: p.y } : null);
    setHoverZone(nearestForBank(drag.bank, p.x, p.y));
  }, [drag, ptToGrid, nearestForBank, onDragPointer]);

  const onUp = useCallback((e: React.PointerEvent) => {
    if (!drag) return;
    stopAutoScroll();
    const p = ptToGrid(e);
    const target = p ? nearestForBank(drag.bank, p.x, p.y) : null;
    if (target) fireConnect(drag.bank, drag.sourceId, target);
    setDrag(null); setHoverZone(null);
  }, [drag, ptToGrid, nearestForBank, stopAutoScroll, fireConnect]);

  // ── Keyboard connect mode (both banks) ────────────────────────────────────────
  const onHandleKey = useCallback((e: React.KeyboardEvent, bank: Bank, id: string) => {
    const targets = bank === "source" ? canonIds : targetIds;
    const len = Math.max(1, targets.length);
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (kbSource === id && kbBank === bank) {
        const target = targets[kbTarget];
        if (target) fireConnect(bank, id, target);
        setKbSource(null); setKbBank(null);
      } else {
        setKbSource(id); setKbBank(bank); setKbTarget(0);
        announce("Connect mode. Arrow keys choose the destination, Enter confirms, Escape cancels.");
      }
    } else if (kbSource === id && kbBank === bank && (e.key === "ArrowDown" || e.key === "ArrowRight")) {
      e.preventDefault(); setKbTarget((p) => (p + 1) % len);
    } else if (kbSource === id && kbBank === bank && (e.key === "ArrowUp" || e.key === "ArrowLeft")) {
      e.preventDefault(); setKbTarget((p) => (p - 1 + len) % len);
    } else if (e.key === "Escape") {
      setKbSource(null); setKbBank(null);
    }
  }, [kbSource, kbBank, kbTarget, canonIds, targetIds, fireConnect]);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") { setKbSource(null); setKbBank(null); } };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, []);

  // tokenId → canonical field it currently feeds (for chip aria-label / styling).
  const tokenWiredField = useMemo(() => {
    const m = new Map<string, string>();
    sourceWires.forEach((w) => m.set(w.tokenId, w.canonicalField));
    return m;
  }, [sourceWires]);

  const sourceChipProps = useCallback((tokenId: string): MapperSourceChipProps => {
    const wiredTo = tokenWiredField.get(tokenId);
    const connecting = (kbSource === tokenId && kbBank === "source") || (drag?.bank === "source" && drag.sourceId === tokenId);
    return {
      ref: (el: HTMLElement | null) => { sourceEls.current[tokenId] = el; },
      onPointerDown: (e) => onHandleDown(e, "source", tokenId),
      onPointerMove: onMove,
      onPointerUp: onUp,
      onPointerCancel: () => { stopAutoScroll(); setDrag(null); setHoverZone(null); },
      onKeyDown: (e) => onHandleKey(e, "source", tokenId),
      tabIndex: 0,
      role: "button",
      "aria-label": `Source field. Drag onto a canonical field to wire it${wiredTo ? `; currently wired to ${wiredTo}` : ""}${connecting ? " — connect mode active, use arrow keys then Enter" : ""}`,
      "data-wired": !!wiredTo,
      "data-connecting": connecting,
    };
  }, [tokenWiredField, kbSource, kbBank, drag, sourceEls, onHandleDown, onMove, onUp, onHandleKey, stopAutoScroll]);

  // ── Ghost wires (AI suggestions) — resolve endpoints for the SVG ──────────────
  const ghostWires = useMemo(() => {
    if (!suggestions?.length) return [];
    const out: { s: MappingSuggestion; hx: number; hy: number; zx: number; zy: number }[] = [];
    for (const s of suggestions) {
      // A suggestion either proposes a source for a canonical key (sourceKind raw/custom →
      // source handle → canonical dot) or a canonical for an output path (canonical dot →
      // target zone). We infer the side from which anchors resolve.
      const srcHandle = sourceById.get(s.sourceId);
      const canonDotSrc = canonById.get(s.sourceId);
      const canonDotTgt = canonById.get(s.targetKey);
      const targetZone = targetById.get(s.targetKey);
      if (srcHandle && canonDotTgt) {
        out.push({ s, hx: srcHandle.x, hy: srcHandle.y, zx: canonDotTgt.x, zy: canonDotTgt.y });
      } else if (canonDotSrc && targetZone) {
        out.push({ s, hx: canonDotSrc.x, hy: canonDotSrc.y, zx: targetZone.x, zy: targetZone.y });
      }
    }
    return out;
  }, [suggestions, sourceById, canonById, targetById]);

  // ── Live drag / keyboard ghosts ───────────────────────────────────────────────
  const dragHandle = drag
    ? (drag.bank === "source" ? sourceById.get(drag.sourceId) : canonById.get(drag.sourceId))
    : undefined;
  const dragStroke = drag?.bank === "source" ? VIOLET : BLUE;
  const kbHandle = kbSource
    ? (kbBank === "source" ? sourceById.get(kbSource) : canonById.get(kbSource))
    : undefined;
  const kbZone = kbSource
    ? (kbBank === "source" ? canonById.get(canonIds[kbTarget]) : targetById.get(targetIds[kbTarget]))
    : undefined;
  const kbStroke = kbBank === "source" ? VIOLET : BLUE;

  const dimmed = drag != null || kbSource != null;
  const hov = hoveredId != null;

  const svg = (
    <>
      <div ref={announcerRef} aria-live="polite" aria-atomic="true"
        style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" }} />

      <svg aria-hidden
        style={{
          position: "absolute", inset: 0, width: "100%", height: "100%",
          pointerEvents: hidden ? "none" : (drag ? "auto" : "none"), zIndex: 4,
          opacity: hidden ? 0 : (shown ? 1 : 0), transition: "opacity 200ms ease-out",
        }}
        onPointerMove={drag ? onMove : undefined}
        onPointerUp={drag ? onUp : undefined}
        onPointerCancel={() => { stopAutoScroll(); setDrag(null); setHoverZone(null); }}
      >
        {/* ── SOURCE → CANONICAL wires (violet) ──────────────────────────────── */}
        {sourceWires.map((w) => {
          const isHovered = hov && w.canonicalField === hoveredId;
          const opacity = dimmed ? 0.45 : hov ? (isHovered ? 1 : 0.14) : 1;
          return (
            <g key={`sw-${w.canonicalField}`} style={{ opacity, transition: "opacity 160ms" }}>
              <path d={bezier(w.hx, w.hy, w.zx, w.zy)} fill="none" stroke={VIOLET} strokeWidth={2.4} style={{ pointerEvents: "none" }} />
              <circle cx={w.hx} cy={w.hy} r={2.6} fill={VIOLET} style={{ pointerEvents: "none" }} />
              <circle cx={w.zx} cy={w.zy} r={2.6} fill={BLUE} style={{ pointerEvents: "none" }} />
              {!dimmed && (
                <g role="button" tabIndex={0}
                  aria-label={`Remove the wire feeding ${w.canonicalField}`}
                  style={{ pointerEvents: "auto", cursor: "pointer" }}
                  onClick={() => onSourceDisconnect(w.canonicalField)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSourceDisconnect(w.canonicalField); } }}>
                  <circle cx={w.zx - 12} cy={w.zy} r={6.5} fill="#FFFFFF" stroke={VIOLET} strokeWidth={1.3} />
                  <text x={w.zx - 12} y={w.zy + 3} textAnchor="middle" fontSize={8.5} fontWeight={700} fill={VIOLET} style={{ pointerEvents: "none", userSelect: "none" }}>✕</text>
                </g>
              )}
            </g>
          );
        })}

        {/* ── CANONICAL → TARGET wires (blue override / green default) ────────── */}
        {[...targetWires]
          .sort((a, b) => {
            const ah = hov && (a.canonicalField === hoveredId || a.outputPath === hoveredId);
            const bh = hov && (b.canonicalField === hoveredId || b.outputPath === hoveredId);
            return (ah ? 1 : 0) - (bh ? 1 : 0); // hovered painted last
          })
          .map((w) => {
            const isHovered = hov && (w.canonicalField === hoveredId || w.outputPath === hoveredId);
            const opacity = dimmed ? 0.45 : hov ? (isHovered ? 1 : 0.14) : 1;
            const stroke = w.isOverride ? BLUE : GREEN;
            return (
              <g key={`tw-${w.outputPath}`} style={{ opacity, transition: "opacity 160ms" }}>
                <path d={bezier(w.hx, w.hy, w.zx, w.zy)} fill="none" stroke={stroke} strokeWidth={w.isOverride ? 2.4 : 1.8} style={{ pointerEvents: "none" }} />
                <circle cx={w.zx} cy={w.zy} r={2.6} fill={stroke} style={{ pointerEvents: "none" }} />
                {w.isOverride && !dimmed && (
                  <g role="button" tabIndex={0}
                    aria-label={`Reset ${w.outputPath} to its default source`}
                    style={{ pointerEvents: "auto", cursor: "pointer" }}
                    onClick={() => onTargetDisconnect(w.outputPath)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onTargetDisconnect(w.outputPath); } }}>
                    <circle cx={w.zx + 12} cy={w.zy} r={6.5} fill="#FFFFFF" stroke={BLUE} strokeWidth={1.3} />
                    <text x={w.zx + 12} y={w.zy + 3} textAnchor="middle" fontSize={8.5} fontWeight={700} fill={BLUE} style={{ pointerEvents: "none", userSelect: "none" }}>✕</text>
                  </g>
                )}
              </g>
            );
          })}

        {/* ── AI ghost wires (dashed + faint, confidence ring, accept/reject) ── */}
        {!dimmed && ghostWires.map((g, i) => (
          <GhostWire
            key={`gw-${g.s.targetKey}-${g.s.sourceId}-${i}`}
            suggestion={g.s}
            hx={g.hx}
            hy={g.hy}
            zx={g.zx}
            zy={g.zy}
            onAccept={(s) => onAcceptSuggestion?.(s)}
            onReject={(s) => onRejectSuggestion?.(s)}
          />
        ))}

        {/* ── Live drag ghost ────────────────────────────────────────────────── */}
        {drag && dragHandle && (
          <path d={bezier(dragHandle.x, dragHandle.y, drag.x, drag.y)} fill="none"
            stroke={dragStroke} strokeWidth={2.4} strokeDasharray="5 3" style={{ pointerEvents: "none", opacity: 0.85 }} />
        )}
        {/* ── Keyboard preview ───────────────────────────────────────────────── */}
        {kbSource && kbHandle && kbZone && (
          <path d={bezier(kbHandle.x, kbHandle.y, kbZone.x, kbZone.y)} fill="none"
            stroke={kbStroke} strokeWidth={2.4} strokeDasharray="5 3" style={{ pointerEvents: "none", opacity: 0.7 }} />
        )}

        {/* ── Canonical dots: drop zone (source bank) + drag handle (target bank) ── */}
        {canonDots.map((d) => {
          const active = (drag?.bank === "source" && hoverZone === d.id) || (kbBank === "source" && canonIds[kbTarget] === d.id);
          const isDragSrc = drag?.bank === "canonical" && drag.sourceId === d.id;
          const isKbSrc = kbBank === "canonical" && kbSource === d.id;
          const feedsTarget = targetWires.some((w) => w.canonicalField === d.id);
          const overrides = targetWires.some((w) => w.canonicalField === d.id && w.isOverride);
          const fill = isDragSrc || isKbSrc || overrides ? BLUE : feedsTarget ? GREEN : "#FFFFFF";
          const stroke = isDragSrc || isKbSrc || overrides ? BLUE : feedsTarget ? GREEN : "#8A93A5";
          return (
            <g key={`cd-${d.id}`}>
              {/* Snap ring when a source-bank drag/keyboard is hovering this dot. */}
              {active && (
                <circle cx={d.x} cy={d.y} r={9} fill="rgba(111,79,206,0.18)" stroke={VIOLET} strokeWidth={1.5} style={{ pointerEvents: "none" }} />
              )}
              {/* The dot doubles as a CANONICAL→TARGET drag handle (right-side gesture). */}
              <g tabIndex={0} role="button"
                aria-label={`Drag canonical ${d.id} onto an output field to wire it${isKbSrc ? " — connect mode active, use arrow keys" : ""}`}
                style={{ pointerEvents: "auto", cursor: "grab" }}
                onPointerDown={(e) => onHandleDown(e, "canonical", d.id)}
                onKeyDown={(e) => onHandleKey(e, "canonical", d.id)}
                onFocus={() => setFocusedId(d.id)}
                onBlur={() => setFocusedId(null)}>
                <circle cx={d.x} cy={d.y} r={HANDLE_R + 4}
                  fill={isDragSrc || isKbSrc || focusedId === d.id ? "rgba(30,102,201,0.15)" : "transparent"}
                  stroke={focusedId === d.id ? BLUE : "none"} strokeWidth={1.5} style={{ transition: "fill 150ms" }} />
                <circle cx={d.x} cy={d.y} r={HANDLE_R} fill={fill} stroke={stroke} strokeWidth={1.8} style={{ transition: "fill 150ms, stroke 150ms" }} />
                <text x={d.x} y={d.y + 3.2} textAnchor="middle" fontSize={7.5} fontWeight={700}
                  fill={fill === "#FFFFFF" ? "#8A93A5" : "#FFFFFF"}
                  style={{ pointerEvents: "none", userSelect: "none", fontFamily: "monospace" }}>→</text>
              </g>
            </g>
          );
        })}

        {/* ── Target drop zones (hit targets + snap ring for canonical-bank drag) ── */}
        {targetZones.map((z) => {
          const active = (drag?.bank === "canonical" && hoverZone === z.id) || (kbBank === "canonical" && targetIds[kbTarget] === z.id);
          return (
            <g key={`tz-${z.id}`} style={{ pointerEvents: "auto" }}>
              {active && (
                <circle cx={z.x} cy={z.y} r={9} fill="rgba(30,102,201,0.18)" stroke={BLUE} strokeWidth={1.5} style={{ pointerEvents: "none" }} />
              )}
              <rect x={z.x - ZONE_W / 2} y={z.y - ZONE_H / 2} width={ZONE_W} height={ZONE_H}
                fill="transparent" style={{ cursor: drag ? "crosshair" : "default" }} />
            </g>
          );
        })}
      </svg>
    </>
  );

  return { sourceChipProps, svg };
}
