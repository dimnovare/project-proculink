"use client";

// SourceWireDragLayer — the source-document → canonical-order wires, made
// INTERACTIVE and OVERRIDE-AWARE. Desktop xl only. Mirror image of WireDragLayer
// (which owns the canonical → output side): here the user drags a SOURCE TOKEN chip
// (a discrete addressable value from the uploaded file) onto a CANONICAL node to
// re-point which raw field feeds that canonical value.
//
// Model (single, clean — mirrors WireDragLayer):
//  • The draggable HANDLES are the source-token chips (real DOM elements in the
//    source column). A native pointer-drag (setPointerCapture on the chip) drives
//    the drag; a keyboard connect-mode fallback works without a pointer.
//  • The DROP ZONES are the canonical nodes (centre column), hit-tested in the SVG.
//  • A persistent wire is drawn for every sourceMap entry whose token still exists,
//    from the token chip's right-edge handle to the canonical node it now feeds.
//    These are ALWAYS overrides (an explicit re-wire) → violet→blue. SpineConnectors
//    still paints the decorative parsed-as-is source→canonical run beneath; this
//    overlay shows the user's explicit re-wires and re-routes them on drop. The wire
//    MUST visibly appear / re-route on drop (the bug we are avoiding: "said connected
//    but the wire never moved").
//  • Dropping a chip on a node (or keyboard connect) calls onConnect(tokenId,
//    canonicalField) → the parent persists the SourceMap entry + bumps the signature
//    → this re-measures and the wire redraws from the new token. It STAYS.
//
// This module exports a HOOK (useSourceWireDrag) that owns drag/keyboard/measure
// state, plus an SVG renderer. The chips render in the source column via the hook's
// chipProps(); the SVG overlay renders inside the grid (zIndex:4, above SpineConnectors
// z2 and WireDragLayer z3). SpineConnectors' decorative SVG (pointerEvents:none) is
// untouched.

import type React from "react";
import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
} from "react";
import type { ConnectorNode } from "./SpineConnectors";
import { useDragAutoScroll } from "./useDragAutoScroll";

// nodeId → canonical field name (the SourceMap dictionary key the backend reads).
// Mirrors WireDragLayer.NODE_TO_CANONICAL exactly so both sides agree on field names.
export const NODE_TO_CANONICAL_FIELD: Record<string, string> = {
  po:       "PoNumber",
  date:     "OrderDate",
  buyer:    "BuyerName",
  supplier: "SupplierName",
  currency: "Currency",
  lines:    "LineNumber",
  totals:   "LineTotal",
};

// canonicalField → nodeId (inverse of NODE_TO_CANONICAL_FIELD) for label lookup.
const CANONICAL_TO_NODE: Record<string, string> =
  Object.fromEntries(Object.entries(NODE_TO_CANONICAL_FIELD).map(([n, c]) => [c, n]));

/**
 * Build the persistent source→canonical wires from the current SourceMap.
 *
 * For each canonical node, look up its field name; if the SourceMap has an entry
 * whose `sourceToken` matches a known token id, that node is fed by that token and a
 * wire is drawn. Pure + exported so the routing logic is unit-tested independently of
 * the SVG / DOM measurement (this is the logic that makes a dragged wire actually
 * RE-ROUTE rather than just claim "connected").
 *
 * @param nodeIds        canonical node ids present on screen (e.g. ["po","date",...])
 * @param sourceMap      OrderMappingOverride.sourceMap (canonicalField → {sourceToken,...})
 * @param knownTokenIds  set of token ids actually present in the source file
 * @returns one entry per node that has a resolvable source-token wire
 */
export function resolveSourceWires(
  nodeIds: string[],
  sourceMap: Record<string, { sourceToken?: string | null } | undefined> | undefined | null,
  knownTokenIds: ReadonlySet<string>,
): { nodeId: string; canonicalField: string; tokenId: string }[] {
  if (!sourceMap) return [];
  const out: { nodeId: string; canonicalField: string; tokenId: string }[] = [];
  for (const nodeId of nodeIds) {
    const canonicalField = NODE_TO_CANONICAL_FIELD[nodeId];
    if (!canonicalField) continue;
    const rule = sourceMap[canonicalField];
    const tokenId = rule?.sourceToken;
    // A wire is shown only when the rule points at a token that still exists in the
    // current file — a stale token id (file re-parsed to a different shape) draws no
    // wire rather than a dangling one.
    if (tokenId && knownTokenIds.has(tokenId)) {
      out.push({ nodeId, canonicalField, tokenId });
    }
  }
  return out;
}

// Human labels for the SR announcer.
const NODE_LABEL: Record<string, string> = {
  po: "PO number", date: "Order date", buyer: "Buyer", supplier: "Supplier",
  currency: "Currency", totals: "Total", lines: "Line items",
};

interface Pt { id: string; x: number; y: number; }
interface DragState { tokenId: string; x: number; y: number; }

const ZONE_W = 26;
const ZONE_H = 18;
const SNAP_PX = 40;

function bezier(x1: number, y1: number, x2: number, y2: number): string {
  const cx = x1 + (x2 - x1) * 0.5;
  return `M ${x1} ${y1} C ${cx} ${y1} ${cx} ${y2} ${x2} ${y2}`;
}

export interface UseSourceWireDragArgs {
  gridRef: React.RefObject<HTMLElement | null>;
  /** Canonical node card elements, keyed by node id (shared with SpineReview). */
  nodeEls: React.MutableRefObject<Record<string, HTMLElement | null>>;
  /** Source-token chip elements, keyed by token id. */
  tokenEls: React.MutableRefObject<Record<string, HTMLElement | null>>;
  /** Canonical nodes on screen (for drop-zone anchors + ordering). */
  nodes: ConnectorNode[];
  /** All source tokens (id + label) — drives wires + keyboard target order. */
  tokens: { id: string; label: string }[];
  /** Re-point a canonical field's source: onConnect(tokenId, canonicalField). */
  onConnect: (tokenId: string, canonicalField: string) => void;
  /** Remove a source→canonical wire (clears sourceMap[canonicalField]). */
  onDisconnect: (canonicalField: string) => void;
  /** Current per-order SourceMap: canonicalField → rule (only sourceToken is read here). */
  sourceMap: Record<string, { sourceToken?: string | null } | undefined> | undefined | null;
  /** Any change re-measures (mirrors WireDragLayer / SpineConnectors). */
  signature: string;
}

export interface SourceWireDragChipProps {
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

export interface UseSourceWireDrag {
  /** Spread onto each token chip element to make it a drag handle + keyboard connector. */
  chipProps: (tokenId: string) => SourceWireDragChipProps;
  /** Whether the given canonical field currently has a source-token wire. */
  isFieldWired: (canonicalField: string) => boolean;
  /** The SVG overlay element — render inside the grid (positioned absolute, zIndex:4). */
  svg: React.ReactElement;
}

export function useSourceWireDrag({
  gridRef, nodeEls, tokenEls, nodes, tokens, onConnect, onDisconnect, sourceMap, signature,
}: UseSourceWireDragArgs): UseSourceWireDrag {
  // Source-token RIGHT-edge anchors, id = tokenId.
  const [handles, setHandles] = useState<Pt[]>([]);
  // Canonical node LEFT-edge anchors, id = nodeId.
  const [zones, setZones]     = useState<Pt[]>([]);
  const [drag, setDrag]       = useState<DragState | null>(null);
  const [hoverZone, setHoverZone] = useState<string | null>(null);
  // Keyboard connect mode: the token id whose connect mode is active + target index.
  const [kbSource, setKbSource] = useState<string | null>(null);
  const [kbTarget, setKbTarget] = useState(0);
  const [shown, setShown]       = useState(false);
  const announcerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  // Last-applied position signatures — measure only commits state when anchors
  // ACTUALLY moved, so a repeated measure (e.g. identity churn) can never drive a
  // setState→render→measure loop (defence-in-depth for React #185).
  const sigRef = useRef<{ h: string; z: string }>({ h: "", z: "" });

  const { onDragPointer, stopAutoScroll } = useDragAutoScroll(gridRef);

  const handleById = useMemo(() => new Map(handles.map(h => [h.id, h])), [handles]);
  const zoneById   = useMemo(() => new Map(zones.map(z => [z.id, z])), [zones]);
  const knownTokenIds = useMemo(() => new Set(tokens.map(t => t.id)), [tokens]);
  const nodeIds    = useMemo(() => nodes.map(n => n.id), [nodes]);

  // Read `tokens`/`nodes` from refs so measure()'s identity stays STABLE across
  // renders (both get new identities when the order/source-tokens memos recompute).
  // An unstable measure re-ran the layout/observer effects every render — a driver
  // of the React #185 update-depth loop. measure now re-runs only on signature
  // change or a real DOM event.
  const tokensRef = useRef(tokens);
  tokensRef.current = tokens;
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  const measure = useCallback(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const g = grid.getBoundingClientRect();
    if (g.width < 60) { setHandles([]); setZones([]); return; }

    const h: Pt[] = [];
    tokensRef.current.forEach((t) => {
      const el = tokenEls.current[t.id];
      if (!el) return;
      const r = el.getBoundingClientRect();
      h.push({ id: t.id, x: r.right - g.left, y: r.top - g.top + r.height / 2 });
    });
    const z: Pt[] = [];
    nodesRef.current.forEach((node) => {
      const el = nodeEls.current[node.id];
      if (!el) return;
      const r = el.getBoundingClientRect();
      z.push({ id: node.id, x: r.left - g.left, y: r.top - g.top + 18 });
    });
    // Commit ONLY when positions changed (and never blank to empty on a transient
    // null-ref pass while items still exist). Compared via sigRef (NOT state) so
    // measure's deps stay stable — prevents any measure→setState→render→measure loop.
    const sig = (a: Pt[]) => a.map(p => `${p.id}:${Math.round(p.x)}:${Math.round(p.y)}`).join("|");
    const hSig = sig(h), zSig = sig(z);
    if (!(h.length === 0 && sigRef.current.h.length > 0) && hSig !== sigRef.current.h) { sigRef.current.h = hSig; setHandles(h); }
    if (!(z.length === 0 && sigRef.current.z.length > 0) && zSig !== sigRef.current.z) { sigRef.current.z = zSig; setZones(z); }
  }, [gridRef, nodeEls, tokenEls]);

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
    Object.values(tokenEls.current).forEach(obs);
    // Capture-phase scroll on the document catches EVERY scroll container — the page,
    // the review's overflow wrapper, AND the source-token panel's own inner scroll — so
    // the wires track the chips no matter which pane scrolls (fixes "wires stay static
    // when I scroll the source fields").
    document.addEventListener("scroll", scheduleMeasure, { capture: true, passive: true });
    window.addEventListener("resize", scheduleMeasure);
    return () => {
      clearTimeout(t);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      document.removeEventListener("scroll", scheduleMeasure, { capture: true } as EventListenerOptions);
      window.removeEventListener("resize", scheduleMeasure);
    };
  }, [measure, scheduleMeasure, gridRef, nodeEls, tokenEls]);

  // ── Resolve persistent wires from the SourceMap (token → canonical node) ──────
  const wires = useMemo(() => {
    return resolveSourceWires(nodeIds, sourceMap, knownTokenIds)
      .map((w) => {
        const h = handleById.get(w.tokenId);
        const z = zoneById.get(w.nodeId);
        return h && z ? { ...w, hx: h.x, hy: h.y, zx: z.x, zy: z.y } : null;
      })
      .filter(Boolean) as { nodeId: string; canonicalField: string; tokenId: string; hx: number; hy: number; zx: number; zy: number; }[];
  }, [nodeIds, sourceMap, knownTokenIds, handleById, zoneById]);

  const wiredFields = useMemo(() => new Set(wires.map(w => w.canonicalField)), [wires]);
  const isFieldWired = useCallback((f: string) => wiredFields.has(f), [wiredFields]);

  // ── Pointer drag (driven by the chip handlers) ───────────────────────────────
  const ptToGrid = useCallback((e: { clientX: number; clientY: number }) => {
    const g = gridRef.current?.getBoundingClientRect();
    return g ? { x: e.clientX - g.left, y: e.clientY - g.top } : null;
  }, [gridRef]);

  const nearestZone = useCallback((x: number, y: number): string | null => {
    let best: string | null = null, bestD = SNAP_PX;
    zones.forEach((z) => { const d = Math.hypot(z.x - x, z.y - y); if (d < bestD) { bestD = d; best = z.id; } });
    return best;
  }, [zones]);

  function announce(msg: string) {
    const el = announcerRef.current;
    if (!el) return;
    el.textContent = "";
    requestAnimationFrame(() => { if (announcerRef.current) announcerRef.current.textContent = msg; });
  }

  const onChipDown = useCallback((e: React.PointerEvent, tokenId: string) => {
    e.preventDefault(); e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const p = ptToGrid(e);
    if (p) setDrag({ tokenId, x: p.x, y: p.y });
  }, [ptToGrid]);

  const onChipMove = useCallback((e: React.PointerEvent) => {
    if (!drag) return;
    const p = ptToGrid(e);
    if (!p) return;
    onDragPointer(e.clientY); // edge auto-scroll so the canonical nodes stay reachable
    setDrag(d => d ? { ...d, x: p.x, y: p.y } : null);
    setHoverZone(nearestZone(p.x, p.y));
  }, [drag, ptToGrid, nearestZone, onDragPointer]);

  const onChipUp = useCallback((e: React.PointerEvent) => {
    if (!drag) return;
    stopAutoScroll();
    const p = ptToGrid(e);
    const targetNode = p ? nearestZone(p.x, p.y) : null;
    const canonicalField = targetNode ? NODE_TO_CANONICAL_FIELD[targetNode] : null;
    if (canonicalField) {
      onConnect(drag.tokenId, canonicalField);
      announce(`Wired source field to ${NODE_LABEL[targetNode!] ?? targetNode}`);
    }
    setDrag(null); setHoverZone(null);
  }, [drag, ptToGrid, nearestZone, onConnect, stopAutoScroll]);

  // ── Keyboard connect mode ─────────────────────────────────────────────────────
  const onChipKey = useCallback((e: React.KeyboardEvent, tokenId: string) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (kbSource === tokenId) {
        const targetNode = nodeIds[kbTarget];
        const canonicalField = targetNode ? NODE_TO_CANONICAL_FIELD[targetNode] : null;
        if (canonicalField) {
          onConnect(tokenId, canonicalField);
          announce(`Wired source field to ${NODE_LABEL[targetNode] ?? targetNode}`);
        }
        setKbSource(null);
      } else {
        setKbSource(tokenId); setKbTarget(0);
        announce("Connect mode. Arrow keys choose the canonical field, Enter confirms, Escape cancels.");
      }
    } else if (kbSource === tokenId && (e.key === "ArrowDown" || e.key === "ArrowRight")) {
      e.preventDefault(); setKbTarget(p => (p + 1) % Math.max(1, nodeIds.length));
    } else if (kbSource === tokenId && (e.key === "ArrowUp" || e.key === "ArrowLeft")) {
      e.preventDefault(); setKbTarget(p => (p - 1 + nodeIds.length) % Math.max(1, nodeIds.length));
    } else if (e.key === "Escape") {
      setKbSource(null);
    }
  }, [kbSource, kbTarget, nodeIds, onConnect]);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setKbSource(null); };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, []);

  // tokenId → the canonical field it currently feeds (for chip aria-label / styling).
  const tokenWiredField = useMemo(() => {
    const m = new Map<string, string>();
    wires.forEach(w => m.set(w.tokenId, w.canonicalField));
    return m;
  }, [wires]);

  const chipProps = useCallback((tokenId: string): SourceWireDragChipProps => {
    const wiredTo = tokenWiredField.get(tokenId);
    const connecting = kbSource === tokenId || drag?.tokenId === tokenId;
    return {
      ref: (el: HTMLElement | null) => { tokenEls.current[tokenId] = el; },
      onPointerDown: (e) => onChipDown(e, tokenId),
      onPointerMove: onChipMove,
      onPointerUp: onChipUp,
      onPointerCancel: () => { stopAutoScroll(); setDrag(null); setHoverZone(null); },
      onKeyDown: (e) => onChipKey(e, tokenId),
      tabIndex: 0,
      role: "button",
      "aria-label": `Source field. Drag onto a canonical field to wire it${
        wiredTo ? `; currently wired to ${NODE_LABEL[CANONICAL_TO_NODE[wiredTo] ?? ""] ?? wiredTo}` : ""
      }${connecting ? " — connect mode active, use arrow keys then Enter" : ""}`,
      "data-wired": !!wiredTo,
      "data-connecting": connecting,
    };
  }, [tokenWiredField, kbSource, drag, tokenEls, onChipDown, onChipMove, onChipUp, onChipKey, stopAutoScroll]);

  const dragHandle = drag ? handleById.get(drag.tokenId) : undefined;
  const kbZone = kbSource ? zoneById.get(nodeIds[kbTarget]) : undefined;
  const kbHandle = kbSource ? handleById.get(kbSource) : undefined;

  const svg = (
    <>
      <div ref={announcerRef} aria-live="polite" aria-atomic="true"
        style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" }} />

      <svg aria-hidden
        style={{
          position: "absolute", inset: 0, width: "100%", height: "100%",
          pointerEvents: "none", zIndex: 4,
          opacity: shown ? 1 : 0, transition: "opacity 320ms ease-out",
        }}
      >
        {/* ── Persistent source→canonical override wires (re-route on drop) ────── */}
        {wires.map((w) => {
          const dimmed = drag != null || kbSource != null;
          const stroke = "#6F4FCE"; // explicit re-wire → violet→blue
          return (
            <g key={`sw-${w.canonicalField}`} style={{ opacity: dimmed ? 0.45 : 1, transition: "opacity 160ms" }}>
              <path d={bezier(w.hx, w.hy, w.zx, w.zy)} fill="none" stroke={stroke} strokeWidth={2.4} />
              <circle cx={w.hx} cy={w.hy} r={2.6} fill={stroke} />
              <circle cx={w.zx} cy={w.zy} r={2.6} fill="#1E66C9" />
              {/* Delete affordance — clickable ✕ on the wire near the canonical end */}
              {!dimmed && (
                <g role="button" tabIndex={0}
                  aria-label={`Remove the wire feeding ${NODE_LABEL[w.nodeId] ?? w.nodeId}`}
                  style={{ pointerEvents: "auto", cursor: "pointer", outline: "none" }}
                  onClick={() => onDisconnect(w.canonicalField)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onDisconnect(w.canonicalField); } }}>
                  <circle cx={w.zx - 12} cy={w.zy} r={6.5} fill="#FFFFFF" stroke="#6F4FCE" strokeWidth={1.3} />
                  <text x={w.zx - 12} y={w.zy + 3} textAnchor="middle" fontSize={8.5} fontWeight={700} fill="#6F4FCE"
                    style={{ pointerEvents: "none", userSelect: "none" }}>✕</text>
                </g>
              )}
            </g>
          );
        })}

        {/* ── Live drag ghost ─────────────────────────────────────────────────── */}
        {drag && dragHandle && (
          <path d={bezier(dragHandle.x, dragHandle.y, drag.x, drag.y)} fill="none"
            stroke="#6F4FCE" strokeWidth={2.4} strokeDasharray="5 3" style={{ opacity: 0.85 }} />
        )}
        {/* ── Keyboard preview ────────────────────────────────────────────────── */}
        {kbSource && kbZone && kbHandle && (
          <path d={bezier(kbHandle.x, kbHandle.y, kbZone.x, kbZone.y)}
            fill="none" stroke="#6F4FCE" strokeWidth={2.4} strokeDasharray="5 3" style={{ opacity: 0.7 }} />
        )}

        {/* ── Canonical drop-zone snap rings (visual only; hit-test is in JS) ──── */}
        {zones.map((z) => {
          const active = hoverZone === z.id || (kbSource != null && nodeIds[kbTarget] === z.id);
          return active ? (
            <circle key={`sz-${z.id}`} cx={z.x} cy={z.y} r={9}
              fill="rgba(111,79,206,0.18)" stroke="#6F4FCE" strokeWidth={1.5} />
          ) : null;
        })}
      </svg>
    </>
  );

  return { chipProps, isFieldWired, svg };
}
