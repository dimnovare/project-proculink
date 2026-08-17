"use client";

// build-marker: rAF wire engine v2 (forces a fresh chunk hash so a stale build/edge cache of this
// file can't keep serving the old trigger-based engine).
// MapperWireLayer — the TRUE 2-bank drag/keyboard wire engine for the rebuilt mapper.
//
// REBUILD (2026-06-14): the previous engine drew THREE banks (source → canonical dot → target)
// with the canonical dot far-left, so output wires crossed the canonical LABEL TEXT, and the
// columns were `position:sticky` while the SVG was container-relative — every scroll frame the
// anchors drifted and a `useScrollResync` rAF poll fought to keep up (the "wires not there
// until you scroll / wires jump while scrolling" complaint). This is a clean 2-bank engine:
//
//   INCOMING row (RIGHT-edge port)  ──wire──▶  OUTGOING row (LEFT-edge port)
//
// The canonical join is METADATA on the wire (the incoming row's id IS its canonical key), not
// a third value-less column. Wires flow strictly left→right in the gutter — never over text.
//
// THE MAKE-OR-BREAK FIX — the overlay is GLUED with ZERO per-scroll JS:
//   • Both columns + the SVG live in ONE relatively-positioned CANVAS div. NOTHING is sticky.
//     The page scrolls the canvas as one unit, so the SVG (a child of the canvas) scrolls WITH
//     the columns — anchors never drift, no re-measure needed on scroll.
//   • Coordinates are measured RELATIVE TO THE CANVAS: el.getBoundingClientRect() minus the
//     canvas rect. Stable because nothing is sticky.
//   • Measure runs in useLayoutEffect, SYNCHRONOUSLY, and commits on the FIRST paint — no 80ms
//     timeout, no "wait for a scroll" gate. Wires are visible immediately, correctly placed.
//   • Re-measure ONLY on real layout change: a single ResizeObserver on the canvas + the port
//     elements, debounced with one rAF. There is NO scroll poll (useScrollResync is gone).

import type React from "react";
import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
} from "react";
import { useDragAutoScroll } from "../useDragAutoScroll";
import { bezier, resolveMapperWires, type ResolvedMapperWire } from "./wireMath";
import { wireDrawDelayMs, estimatePathLength, wireOpacity } from "./wireRenderModel";
import { GhostWire } from "./GhostWire";
import type { TargetField, MappingSuggestion } from "./types";

interface Pt { id: string; x: number; y: number; }

interface DragState { sourceId: string; x: number; y: number; }

const SNAP_PX = 40;
const ZONE_W = 26;
const ZONE_H = 20;

const MUTED = "#7C99B4";    // handoff §8 at-rest wire color (default 1:1 pass-through)
const VIOLET = "#6F4FCE";   // user override (a real F-1 signal the spec's static demo lacked)
const GREEN = "#2E8E3A";    // handoff §8 hot/emphasised wire + landed target marker

/** A resolved persistent wire (incoming id → output path) with its canonical metadata. */
export type MapperWire = ResolvedMapperWire;

export interface MapperWireLayerProps {
  /** The single canvas element wires are measured relative to. */
  canvasRef: React.RefObject<HTMLElement | null>;
  /** Incoming-row RIGHT-edge port elements, keyed by incoming id (canonical key or token id). */
  sourceEls: React.MutableRefObject<Record<string, HTMLElement | null>>;
  /** Outgoing-row LEFT-edge port elements, keyed by output path. */
  targetEls: React.MutableRefObject<Record<string, HTMLElement | null>>;
  /** Incoming ids in render order (drives the keyboard target order + measure list). */
  sourceIds: string[];
  /** Output schema rows. */
  targetFields: TargetField[];
  /** outputPath → incoming id (an explicit user wire). */
  outputConnections: Partial<Record<string, string>>;
  /** Incoming ids that exist as rows (a 1:1 default only draws when the source row is present). */
  knownSourceIds: Set<string>;
  /** Dispatch: an incoming row dropped on an output row. */
  onConnect: (sourceId: string, outputPath: string) => void;
  /** Dispatch: remove an output path's explicit wire (revert to default / unmapped). */
  onDisconnect: (outputPath: string) => void;
  /** AI ghost wires (dashed + faint, accept/reject). */
  suggestions?: MappingSuggestion[];
  onAcceptSuggestion?: (s: MappingSuggestion) => void;
  onRejectSuggestion?: (s: MappingSuggestion) => void;
  hoveredId?: string | null;
  readOnly?: boolean;
  hidden?: boolean;
  /** Bumped on every model change → re-measure (covers row add/remove the RO can't see fast). */
  signature: string;
}

/** Props the host spreads onto each incoming-row RIGHT-edge port to make it a drag handle. */
export interface MapperSourcePortProps {
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
  /** Spread onto each incoming-row RIGHT-edge port. */
  sourcePortProps: (sourceId: string) => MapperSourcePortProps;
  /** The SVG overlay — render absolutely positioned over the canvas. */
  svg: React.ReactElement;
  /** True while a drag is in flight (host can dim non-targets / set crosshair cursor). */
  dragging: boolean;
  /** The output path currently snap-highlighted under the pointer (host highlights its row). */
  hoverTarget: string | null;
}

export function useMapperWireLayer({
  canvasRef, sourceEls, targetEls, sourceIds, targetFields,
  outputConnections, knownSourceIds, onConnect, onDisconnect,
  suggestions, onAcceptSuggestion, onRejectSuggestion,
  hoveredId, readOnly, hidden, signature,
}: MapperWireLayerProps): MapperWireLayer {
  const [sourcePorts, setSourcePorts] = useState<Pt[]>([]);
  const [targetPorts, setTargetPorts] = useState<Pt[]>([]);

  const [drag, setDrag] = useState<DragState | null>(null);
  const [hoverTarget, setHoverTarget] = useState<string | null>(null);
  // Keyboard connect mode: the source id + the chosen target index.
  const [kbSource, setKbSource] = useState<string | null>(null);
  const [kbTarget, setKbTarget] = useState(0);
  // Output paths that LANDED a new wire since last render — each fires a one-shot pulse.
  const [landed, setLanded] = useState<Set<string>>(() => new Set());
  const prevConnRef = useRef<Set<string> | null>(null);

  const announcerRef = useRef<HTMLDivElement>(null);
  // Last-committed position signatures — commit setState only when an anchor actually MOVED so a
  // repeated measure can never drive setState→render→measure (React #185).
  const sigRef = useRef<{ s: string; t: string }>({ s: "", t: "" });
  // SVG overlay size — the canvas SCROLL-content size, so the overlay covers + scrolls WITH the
  // full content when the canvas is the scroll host (the bounded-height mapper). Falls back to
  // 100% (page-scroll hosts) until measured.
  const [dims, setDims] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const dimsRef = useRef(dims);

  const { onDragPointer, stopAutoScroll } = useDragAutoScroll(canvasRef);

  const sourceById = useMemo(() => new Map(sourcePorts.map((p) => [p.id, p])), [sourcePorts]);
  const targetById = useMemo(() => new Map(targetPorts.map((p) => [p.id, p])), [targetPorts]);

  const targetIds = useMemo(() => targetFields.map((f) => f.outputPath), [targetFields]);

  // Read id lists from refs so measure() identity stays STABLE across renders (a fresh array
  // identity every render re-ran the layout/observer effects — a React #185 contributor).
  const sourceIdsRef = useRef<string[]>([]);
  sourceIdsRef.current = sourceIds;
  const targetFieldsRef = useRef(targetFields);
  targetFieldsRef.current = targetFields;

  // ── Measure: port centres RELATIVE TO THE CANVAS (no sticky → stable) ─────────
  const measure = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const c = canvas.getBoundingClientRect();
    if (c.width < 60) return; // not laid out yet — keep last good anchors
    // CANVAS-VIEWPORT-relative coords. Each pane scrolls INSIDE the canvas (app.jsx parity); the
    // canvas itself does not scroll. getBoundingClientRect is live, so a port scrolled within its
    // own column reports its new viewport position here, and the scroll listener below re-measures
    // — the wire tracks whichever column moved.
    const s: Pt[] = [];
    sourceIdsRef.current.forEach((id) => {
      const el = sourceEls.current[id];
      if (!el) return;
      const r = el.getBoundingClientRect();
      // RIGHT edge of the incoming port, vertically centred.
      s.push({ id, x: r.right - c.left, y: r.top - c.top + r.height / 2 });
    });
    const t: Pt[] = [];
    targetFieldsRef.current.forEach((field) => {
      const el = targetEls.current[field.outputPath];
      if (!el) return;
      const r = el.getBoundingClientRect();
      // LEFT edge of the outgoing port, vertically centred.
      t.push({ id: field.outputPath, x: r.left - c.left, y: r.top - c.top + r.height / 2 });
    });

    // Size the overlay to the canvas CLIENT box; the SVG (overflow:hidden) clips wires whose ports
    // have scrolled out of their column at the canvas edges.
    const sw = Math.round(c.width);
    const sh = Math.round(c.height);
    if (sw !== dimsRef.current.w || sh !== dimsRef.current.h) { dimsRef.current = { w: sw, h: sh }; setDims({ w: sw, h: sh }); }

    const sig = (a: Pt[]) => a.map((p) => `${p.id}:${Math.round(p.x)}:${Math.round(p.y)}`).join("|");
    const sSig = sig(s), tSig = sig(t);
    // SOURCE: a filtered-out received row unmounts → its port leaves the list; commit that so the
    // wire stops drawing. Do NOT keep stale source ports when the received column is filtered to
    // fewer/zero rows (that left wires dangling to hidden fields). The MutationObserver below
    // re-measures on the filter change.
    if (sSig !== sigRef.current.s) { sigRef.current.s = sSig; setSourcePorts(s); }
    // TARGET (output) rows are never filtered → keep the transient-blank guard.
    if (!(t.length === 0 && sigRef.current.t.length > 0) && tSig !== sigRef.current.t) { sigRef.current.t = tSig; setTargetPorts(t); }
  }, [canvasRef, sourceEls, targetEls]);

  // ── UNIVERSAL re-measure — ONE requestAnimationFrame loop ─────────────────────
  // Every frame, measure() reads the LIVE port positions and commits to state ONLY when an anchor
  // actually moved (the sigRef key-diff above) — so it's cheap when static and can never loop into
  // setState→render→measure. This SINGLE mechanism is robust to EVERY layout change: scroll, filter,
  // collapse, resize, font load, row add/remove, sidebar/grid resize, tab switch — with no per-case
  // observers or listeners that can drift out of sync. (This is app.jsx's Wires approach. It is also
  // WHY each prior layout change kept breaking the wires — every change broke a different ad-hoc
  // trigger; a continuous re-measure has none to break.)
  useLayoutEffect(() => { measure(); }, [measure, signature]); // first paint, synchronous (no flash)
  useEffect(() => {
    let raf = 0;
    const tick = () => { measure(); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [measure]);

  // ── Persistent wires (incoming → output) ──────────────────────────────────────
  // Precedence per output path:
  //   1. explicit user wire   → outputConnections[path] is the incoming canonical id (override).
  //   2. implicit 1:1 default → an incoming row whose id === the output path (canonical match).
  // A raw-token fixed value carries no incoming anchor → no wire (the row shows a fixed badge).
  const wires = useMemo<MapperWire[]>(
    () => resolveMapperWires(targetIds, outputConnections, knownSourceIds),
    [targetIds, outputConnections, knownSourceIds],
  );

  const drawableWires = useMemo(
    () => wires
      .map((w) => ({ w, h: sourceById.get(w.sourceId), z: targetById.get(w.outputPath) }))
      .filter((x): x is { w: MapperWire; h: Pt; z: Pt } => !!x.h && !!x.z),
    [wires, sourceById, targetById],
  );

  // ── Land-pulse: pulse an output that GAINED an explicit wire since last render ──
  const explicitKeys = useMemo(() => {
    const s = new Set<string>();
    for (const [path, src] of Object.entries(outputConnections)) if (src) s.add(path);
    return s;
  }, [outputConnections]);

  useEffect(() => {
    const prev = prevConnRef.current;
    prevConnRef.current = explicitKeys;
    if (prev === null) return; // first render — wires draw-in, don't pulse
    const fresh = new Set<string>();
    explicitKeys.forEach((k) => { if (!prev.has(k)) fresh.add(k); });
    if (fresh.size === 0) return;
    setLanded(fresh);
    const t = setTimeout(() => setLanded(new Set()), 700);
    return () => clearTimeout(t);
  }, [explicitKeys]);

  // ── Pointer helpers (canvas-relative) ─────────────────────────────────────────
  const ptToCanvas = useCallback((e: { clientX: number; clientY: number }) => {
    const c = canvasRef.current?.getBoundingClientRect();
    return c ? { x: e.clientX - c.left, y: e.clientY - c.top } : null;
  }, [canvasRef]);

  const nearestTarget = useCallback((x: number, y: number): string | null => {
    let best: string | null = null, bestD = SNAP_PX;
    for (const z of targetPorts) { const d = Math.hypot(z.x - x, z.y - y); if (d < bestD) { bestD = d; best = z.id; } }
    return best;
  }, [targetPorts]);

  function announce(msg: string) {
    const el = announcerRef.current;
    if (!el) return;
    el.textContent = "";
    requestAnimationFrame(() => { if (announcerRef.current) announcerRef.current.textContent = msg; });
  }

  const fireConnect = useCallback((sourceId: string, outputPath: string) => {
    onConnect(sourceId, outputPath);
    announce(`Mapped ${sourceId} to ${outputPath}`);
  }, [onConnect]);

  // ── Pointer drag ───────────────────────────────────────────────────────────────
  const onHandleDown = useCallback((e: React.PointerEvent, id: string) => {
    if (readOnly) return;
    e.preventDefault(); e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    const p = ptToCanvas(e);
    if (p) setDrag({ sourceId: id, x: p.x, y: p.y });
  }, [ptToCanvas, readOnly]);

  const onMove = useCallback((e: React.PointerEvent) => {
    if (!drag) return;
    const p = ptToCanvas(e);
    if (!p) return;
    onDragPointer(e.clientY);
    setDrag((d) => d ? { ...d, x: p.x, y: p.y } : null);
    setHoverTarget(nearestTarget(p.x, p.y));
  }, [drag, ptToCanvas, nearestTarget, onDragPointer]);

  const onUp = useCallback((e: React.PointerEvent) => {
    if (!drag) return;
    stopAutoScroll();
    const p = ptToCanvas(e);
    const target = p ? nearestTarget(p.x, p.y) : null;
    if (target) fireConnect(drag.sourceId, target);
    setDrag(null); setHoverTarget(null);
  }, [drag, ptToCanvas, nearestTarget, stopAutoScroll, fireConnect]);

  // The current keyboard target, spoken. Arrow-key cycling moved `kbTarget`, and the ONLY
  // thing that drew the new selection was a dashed path inside an `aria-hidden` <svg> — so a
  // screen-reader operator heard "Connect mode…", then silence through every press, then
  // "Mapped X to Y" for a field they were never told they had landed on. The live region has
  // to say which output is selected on every move, or the whole keyboard path is blind.
  // Returns the sentence rather than speaking it: `announce` replaces the live region's whole
  // text on the next frame, so two calls in one keypress would leave only the second. Callers
  // compose one message.
  const targetSentence = useCallback((index: number): string | null => {
    const target = targetIds[index];
    if (!target) return null;
    return `${target}, output ${index + 1} of ${targetIds.length}. Enter maps to this field.`;
  }, [targetIds]);

  // ── Keyboard connect ─────────────────────────────────────────────────────────
  const onHandleKey = useCallback((e: React.KeyboardEvent, id: string) => {
    if (readOnly) return;
    const len = Math.max(1, targetIds.length);
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (kbSource === id) {
        const target = targetIds[kbTarget];
        if (target) fireConnect(id, target);
        setKbSource(null);
      } else {
        setKbSource(id); setKbTarget(0);
        // Entering connect mode already selects index 0; naming it is part of the same beat.
        const first = targetSentence(0);
        announce(
          "Connect mode. Arrow keys choose the output field, Enter confirms, Escape cancels."
          + (first ? ` ${first}` : ""),
        );
      }
    } else if (kbSource === id && (e.key === "ArrowDown" || e.key === "ArrowRight")) {
      e.preventDefault();
      const next = (kbTarget + 1) % len;
      setKbTarget(next);
      const sentence = targetSentence(next);
      if (sentence) announce(sentence);
    } else if (kbSource === id && (e.key === "ArrowUp" || e.key === "ArrowLeft")) {
      e.preventDefault();
      const next = (kbTarget - 1 + len) % len;
      setKbTarget(next);
      const sentence = targetSentence(next);
      if (sentence) announce(sentence);
    } else if (e.key === "Escape") {
      setKbSource(null);
    }
  }, [kbSource, kbTarget, targetIds, fireConnect, readOnly, targetSentence]);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setKbSource(null); };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, []);

  // incoming id → the output paths it currently feeds (for chip aria-label / "wired" styling).
  const sourceWiredCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const w of wires) if (w.isOverride) m.set(w.sourceId, (m.get(w.sourceId) ?? 0) + 1);
    return m;
  }, [wires]);

  const sourcePortProps = useCallback((sourceId: string): MapperSourcePortProps => {
    const wiredCount = sourceWiredCount.get(sourceId) ?? 0;
    const connecting = kbSource === sourceId || (drag?.sourceId === sourceId);
    return {
      ref: (el: HTMLElement | null) => { sourceEls.current[sourceId] = el; },
      onPointerDown: (e) => onHandleDown(e, sourceId),
      onPointerMove: onMove,
      onPointerUp: onUp,
      onPointerCancel: () => { stopAutoScroll(); setDrag(null); setHoverTarget(null); },
      onKeyDown: (e) => onHandleKey(e, sourceId),
      tabIndex: 0,
      role: "button",
      "aria-label": `Map this field. Drag onto an output field to map it${wiredCount ? `; currently feeding ${wiredCount} output${wiredCount === 1 ? "" : "s"}` : ""}${connecting ? " — connect mode active, use arrow keys then Enter" : ""}`,
      "data-wired": wiredCount > 0,
      "data-connecting": connecting,
    };
  }, [sourceWiredCount, kbSource, drag, sourceEls, onHandleDown, onMove, onUp, onHandleKey, stopAutoScroll]);

  // ── Ghost wires (AI suggestions) — only canonical→output ones have both anchors here ──
  const ghostWires = useMemo(() => {
    if (!suggestions?.length) return [];
    const out: { s: MappingSuggestion; hx: number; hy: number; zx: number; zy: number }[] = [];
    for (const s of suggestions) {
      // canonical→output suggestion: sourceId = incoming canonical id, targetKey = output path.
      const h = sourceById.get(s.sourceId);
      const z = targetById.get(s.targetKey);
      if (h && z) out.push({ s, hx: h.x, hy: h.y, zx: z.x, zy: z.y });
    }
    return out;
  }, [suggestions, sourceById, targetById]);

  const dragHandle = drag ? sourceById.get(drag.sourceId) : undefined;
  const kbHandle = kbSource ? sourceById.get(kbSource) : undefined;
  const kbZone = kbSource ? targetById.get(targetIds[kbTarget]) : undefined;

  const isDragging = drag != null || kbSource != null;
  const hov = hoveredId != null;

  // Draw-in one-shot on first reveal; off afterward so a re-measure never re-animates.
  const [drawIn, setDrawIn] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setDrawIn(false), 900);
    return () => clearTimeout(t);
  }, []);

  // Emphasis: a wire lights when the hovered id is its source id OR its output path.
  const isEmph = useCallback(
    (w: MapperWire) => hoveredId != null && (w.sourceId === hoveredId || w.outputPath === hoveredId),
    [hoveredId],
  );

  const svg = (
    <>
      <div ref={announcerRef} aria-live="polite" aria-atomic="true"
        style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" }} />

      <svg aria-hidden
        width={dims.w || undefined} height={dims.h || undefined}
        style={{
          position: "absolute", top: 0, left: 0, overflow: "hidden",
          width: dims.w ? dims.w : "100%", height: dims.h ? dims.h : "100%",
          pointerEvents: hidden ? "none" : (drag ? "auto" : "none"), zIndex: 2,
          opacity: hidden ? 0 : 1,
        }}
        onPointerMove={drag ? onMove : undefined}
        onPointerUp={drag ? onUp : undefined}
        onPointerCancel={() => { stopAutoScroll(); setDrag(null); setHoverTarget(null); }}
      >
        {/* ── Persistent wires (hovered painted last so it sits on top) ──────────── */}
        {[...drawableWires]
          .map((x, i) => ({ ...x, i }))
          .sort((a, b) => (isEmph(a.w) ? 1 : 0) - (isEmph(b.w) ? 1 : 0))
          .map(({ w, h, z, i }) => {
            const emph = isEmph(w);
            const opacity = wireOpacity({ dragging: isDragging, hovering: hov, emphasised: emph });
            // Handoff §8: hot/emphasised wire = green/3; at rest = #7C99B4/2 (override keeps violet).
            const stroke = emph ? GREEN : (w.isOverride ? VIOLET : MUTED);
            const baseW = w.isOverride ? 2.4 : 2;
            const len = estimatePathLength(h.x, h.y, z.x, z.y);
            const landing = landed.has(w.outputPath);
            return (
              <g key={`w-${w.outputPath}`} style={{ opacity, transition: "opacity 160ms" }}>
                <path
                  d={bezier(h.x, h.y, z.x, z.y)} fill="none" stroke={stroke}
                  strokeWidth={emph ? 3 : baseW}
                  strokeLinecap="round"
                  className={drawIn ? "mapper-wire-draw" : undefined}
                  style={{ pointerEvents: "none", ["--wire-len" as string]: len, animationDelay: `${wireDrawDelayMs(i)}ms`, transition: "stroke-width 140ms" }}
                />
                {/* No wire-end dots — the wire runs straight into the big blue/green PORT circles
                    the row renders (app.jsx: just a wire connecting the two circles). */}
                {landing && (
                  <circle cx={z.x} cy={z.y} r={3} fill="none" stroke={VIOLET} strokeWidth={2} className="mapper-land-pulse" style={{ pointerEvents: "none" }} />
                )}
                {/* Remove button on an EXPLICIT wire (a 1:1 default has nothing to remove). */}
                {w.isOverride && !isDragging && !readOnly && (
                  <g role="button" tabIndex={0}
                    aria-label={`Remove the mapping feeding ${w.outputPath}`}
                    style={{ pointerEvents: "auto", cursor: "pointer" }}
                    onClick={() => onDisconnect(w.outputPath)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onDisconnect(w.outputPath); } }}>
                    <circle cx={(h.x + z.x) / 2} cy={(h.y + z.y) / 2} r={7} fill="#FFFFFF" stroke={VIOLET} strokeWidth={1.3} />
                    <text x={(h.x + z.x) / 2} y={(h.y + z.y) / 2 + 3} textAnchor="middle" fontSize={9} fontWeight={700} fill={VIOLET} style={{ pointerEvents: "none", userSelect: "none" }}>✕</text>
                  </g>
                )}
              </g>
            );
          })}

        {/* ── AI ghost wires ─────────────────────────────────────────────────── */}
        {!isDragging && ghostWires.map((g, i) => (
          <GhostWire
            key={`gw-${g.s.targetKey}-${g.s.sourceId}-${i}`}
            suggestion={g.s} hx={g.hx} hy={g.hy} zx={g.zx} zy={g.zy}
            onAccept={(s) => onAcceptSuggestion?.(s)}
            onReject={(s) => onRejectSuggestion?.(s)}
          />
        ))}

        {/* ── Live drag ghost ────────────────────────────────────────────────── */}
        {drag && dragHandle && (
          <path d={bezier(dragHandle.x, dragHandle.y, drag.x, drag.y)} fill="none"
            stroke="#1E66C9" strokeWidth={2.5} strokeDasharray="5 4" strokeLinecap="round" style={{ pointerEvents: "none", opacity: 0.9 }} />
        )}
        {/* ── Keyboard preview ───────────────────────────────────────────────── */}
        {kbSource && kbHandle && kbZone && (
          <path d={bezier(kbHandle.x, kbHandle.y, kbZone.x, kbZone.y)} fill="none"
            stroke="#1E66C9" strokeWidth={2.5} strokeDasharray="5 4" strokeLinecap="round" style={{ pointerEvents: "none", opacity: 0.7 }} />
        )}

        {/* ── Target snap rings + hit zones (only while dragging) ─────────────── */}
        {isDragging && targetPorts.map((z) => {
          const active = hoverTarget === z.id || (kbSource && targetIds[kbTarget] === z.id);
          return (
            <g key={`tz-${z.id}`} style={{ pointerEvents: "auto" }}>
              {active && (
                <circle cx={z.x} cy={z.y} r={10} fill="rgba(111,79,206,0.18)" stroke={VIOLET} strokeWidth={1.6} style={{ pointerEvents: "none" }} />
              )}
              <rect x={z.x - ZONE_W / 2} y={z.y - ZONE_H / 2} width={ZONE_W} height={ZONE_H}
                fill="transparent" style={{ cursor: "crosshair" }} />
            </g>
          );
        })}
      </svg>
    </>
  );

  return { sourcePortProps, svg, dragging: drag != null, hoverTarget };
}
