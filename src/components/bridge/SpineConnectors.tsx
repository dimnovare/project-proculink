"use client";

import type React from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useScrollResync } from "./useScrollResync";

// SpineConnectors — the live "send to supplier" routing made visible.
// Draws two bezier wire-sets over the Review grid, anchored to the REAL DOM:
//   Source-document section  →  canonical-order node  →  supplier-output line.
// High-confidence wires are painted blue→green (brand-blue on the source side,
// brand-green on the output side) across their full journey (userSpaceOnUse).
// Exceptions break the run: amber (75–89) / red (<75) dashed.
// Everything flushes solid green once the order is sent.
// A wire-traveller pulse animates along each live wire.
// Hover highlights the hovered wire's pair; all others dim to 0.16 opacity.

export interface ConnectorNode {
  id: string;
  pct: number;
  srcRef: string;
}

interface SpineConnectorsProps {
  gridRef: React.RefObject<HTMLElement | null>;
  sourceColRef: React.RefObject<HTMLElement | null>;
  outputColRef: React.RefObject<HTMLElement | null>;
  nodeEls: React.MutableRefObject<Record<string, HTMLElement | null>>;
  /** Canonical node circle-dot elements, keyed by node id — source wire snaps to the dot. */
  dotEls: React.MutableRefObject<Record<string, HTMLElement | null>>;
  /** Real source-document section elements, keyed by node.srcRef (header/parties/terms/lines/totals). */
  srcSectionEls: React.MutableRefObject<Record<string, HTMLElement | null>>;
  /** Real supplier-output line elements, keyed by node.id. */
  outLineEls: React.MutableRefObject<Record<string, HTMLElement | null>>;
  nodes: ConnectorNode[];
  hoveredId: string | null;
  crossed: boolean;
  /** Any change forces a re-measure (heights shift on edit/accept/reject). */
  signature: string;
  /**
   * When false, the canonical→output (node→output) segment, its output dot and
   * its output-side pulse are NOT drawn — WireDragLayer owns that side so it can
   * render it OVERRIDE-AWARE and re-routable. The source→canonical (left) segment
   * always renders. Defaults to true (full both-sides render).
   */
  drawOutput?: boolean;
  /**
   * When false, the source→canonical (left) segment, the source dot, the node
   * attachment dot and the source-side pulse are NOT drawn. Set false while the
   * reconstructed-document body is collapsed — its section anchors are display:none
   * (zero rect) so the wires would otherwise collapse onto the panel corner.
   * Defaults to true.
   */
  drawSource?: boolean;
}

// Fallback anchor heights (% of the source/output column) used only when a real
// element ref hasn't mounted yet.
const SRC_Y_FALLBACK: Record<string, number> = { header: 9, parties: 22, terms: 28, lines: 56, totals: 88 };
const OUT_Y_FALLBACK: Record<string, number> = { po: 15, date: 20, currency: 26, supplier: 31, buyer: 36, lines: 62, totals: 26 };

interface Wire {
  id: string;
  pct: number;
  sx: number; sy: number;   // source anchor (right edge of the section)
  nlx: number; nrx: number; ny: number; // node left-x, right-x, attach-y
  ox: number; oy: number;   // output anchor (left edge of the line)
}

function curve(x1: number, y1: number, x2: number, y2: number): string {
  // Clamp the horizontal control-point offset so a large VERTICAL gap (tall
  // canonical column, a source cell far from its node) routes as a tidy S-curve
  // instead of one giant horizontal bulge. Offset ∈ [24, 80]px from each end.
  const dx = x2 - x1;
  const off = Math.sign(dx || 1) * Math.max(24, Math.min(Math.abs(dx) * 0.5, 80));
  return `M ${x1} ${y1} C ${x1 + off} ${y1} ${x2 - off} ${y2} ${x2} ${y2}`;
}

export function SpineConnectors({
  gridRef, sourceColRef, outputColRef, nodeEls, dotEls, srcSectionEls, outLineEls,
  nodes, hoveredId, crossed, signature, drawOutput = true, drawSource = true,
}: SpineConnectorsProps) {
  const [wires, setWires] = useState<Wire[]>([]);
  const [shown, setShown] = useState(false);
  const rafRef = useRef<number | null>(null);
  // Last-good wires, read inside measure() WITHOUT putting `wires` in its deps
  // (that would rebuild measure on every frame). Used to survive transient
  // ref-null windows during the order's 3s refetch re-render.
  const wiresRef = useRef<Wire[]>([]);
  useEffect(() => { wiresRef.current = wires; }, [wires]);
  // `nodes` (connectorNodes) gets a NEW identity whenever the order/labels memo
  // recomputes. Reading it from a ref keeps measure()'s identity STABLE so the
  // layout/observer effects run only on signature change or a real DOM event —
  // NOT on every render. An unstable measure was the engine of the React #185
  // "Maximum update depth exceeded" loop (every render → effect → setWires → …).
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  // Last-committed position signature — measure() commits state ONLY when the
  // rendered geometry actually changed, so a redundant measure can never drive a
  // setState→render→measure loop (defence-in-depth alongside the stable identity).
  const sigRef = useRef<string>("");

  const measure = useCallback(() => {
    const grid = gridRef.current;
    const src = sourceColRef.current;
    const out = outputColRef.current;
    if (!grid || !src || !out) return;

    const g = grid.getBoundingClientRect();
    if (g.width < 60) { if (sigRef.current !== "") { sigRef.current = ""; setWires([]); } return; } // hidden / mobile

    const s = src.getBoundingClientRect();
    const o = out.getBoundingClientRect();
    const prev = wiresRef.current;
    const next: Wire[] = [];
    const nodes = nodesRef.current;

    nodes.forEach((node, i) => {
      const el = nodeEls.current[node.id];
      if (!el) {
        // Ref transiently absent (the 3s refetch re-render swaps node elements,
        // briefly nulling refs). Keep the last-good wire for this node instead of
        // dropping it, so wires don't flicker/vanish mid-refresh.
        const last = prev.find((w) => w.id === node.id);
        if (last) next.push(last);
        return;
      }
      const r = el.getBoundingClientRect();
      // Snap the canonical (node-left) anchor to the circle-dot centre when present
      // so the source→canonical wire terminates ON the dot, not beside the card.
      const dot = dotEls.current[node.id];
      const dotR = dot ? dot.getBoundingClientRect() : null;
      const nlx = dotR ? (dotR.left - g.left + dotR.width / 2) : (r.left - g.left);
      const ny = dotR ? (dotR.top - g.top + dotR.height / 2) : (r.top - g.top + 18); // dot centre / label row

      // Source anchor — real section element if mounted, else a sensible %.
      const secEl = srcSectionEls.current[node.srcRef];
      let sx: number, sy: number;
      if (secEl) {
        const sr = secEl.getBoundingClientRect();
        sx = sr.right - g.left;
        sy = sr.top - g.top + sr.height / 2;
      } else {
        sx = s.right - g.left;
        sy = s.top - g.top + (s.height * (SRC_Y_FALLBACK[node.srcRef] ?? ((i + 0.5) / nodes.length) * 100)) / 100;
      }

      // Output anchor — real output line if mounted, else a sensible %.
      const lineEl = outLineEls.current[node.id];
      let ox: number, oy: number;
      if (lineEl) {
        const lr = lineEl.getBoundingClientRect();
        ox = lr.left - g.left;
        oy = lr.top - g.top + lr.height / 2;
      } else {
        ox = o.left - g.left;
        oy = o.top - g.top + (o.height * (OUT_Y_FALLBACK[node.id] ?? ((i + 0.5) / nodes.length) * 100)) / 100;
      }

      next.push({ id: node.id, pct: node.pct, sx, sy, nlx, nrx: r.right - g.left, ny, ox, oy });
    });

    // Never blank the whole wire-set on a transient empty measure while nodes
    // still exist (e.g. mid-refetch when every ref is briefly null). Keep the
    // last-good render; the next scheduled measure will refresh it.
    if (next.length === 0 && nodes.length > 0 && prev.length > 0) return;

    // Commit ONLY when the geometry actually changed. Without this, a redundant
    // measure (driven by an unstable parent re-render or a scrollbar reflow) kept
    // calling setWires with a fresh-but-equal array → render → measure → … until
    // React's 50-update limit threw #185. Rounding absorbs sub-pixel jitter.
    const sig = next.map(w => `${w.id}:${Math.round(w.sx)},${Math.round(w.sy)},${Math.round(w.nlx)},${Math.round(w.ny)},${Math.round(w.ox)},${Math.round(w.oy)}`).join("|");
    if (sig === sigRef.current) return;
    sigRef.current = sig;
    setWires(next);
  }, [gridRef, sourceColRef, outputColRef, nodeEls, dotEls, srcSectionEls, outLineEls]);

  // Double-rAF: measure AFTER the browser has committed the latest layout. A
  // single rAF can still race a same-frame height change (e.g. the 3s refetch
  // swapping content), which left wires missing/misplaced.
  const scheduleMeasure = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = requestAnimationFrame(measure);
    });
  }, [measure]);

  // Event-independent scroll tracking (see useScrollResync) — the decorative
  // source→canonical wires now follow the sticky source column on scroll.
  useScrollResync(gridRef, scheduleMeasure);

  useLayoutEffect(() => { measure(); }, [measure, signature]);

  useEffect(() => {
    const grid = gridRef.current;
    measure();
    // Reveal after fonts/layout settle.
    const t = setTimeout(() => { measure(); setShown(true); }, 70);

    // Re-measure on ANY layout-affecting change — not just window resize. This
    // replaces the old measure-once-at-70ms approach that left wires stale when
    // the order's 3s refetch changed node heights after the snapshot, or when
    // the user scrolled the overflow container.
    //  • ResizeObserver on the grid, both columns, and every anchor element
    //    (heights shift on edit / accept / reject / enrich / async load).
    //  • scroll on the nearest scrollable ancestor (overlay is positioned to the
    //    grid, which lives inside an overflow-y-auto container).
    //  • window resize / zoom.
    const ro = new ResizeObserver(scheduleMeasure);
    const seen = new Set<Element>();
    const observe = (el: Element | null | undefined) => { if (el && !seen.has(el)) { seen.add(el); ro.observe(el); } };
    observe(grid);
    observe(sourceColRef.current);
    observe(outputColRef.current);
    Object.values(nodeEls.current).forEach(observe);
    Object.values(srcSectionEls.current).forEach(observe);
    Object.values(outLineEls.current).forEach(observe);

    let scroller: HTMLElement | null = grid?.parentElement ?? null;
    while (scroller && scroller !== document.body) {
      const oy = getComputedStyle(scroller).overflowY;
      if (oy === "auto" || oy === "scroll") break;
      scroller = scroller.parentElement;
    }
    scroller?.addEventListener("scroll", scheduleMeasure, { passive: true });
    window.addEventListener("resize", scheduleMeasure);

    return () => {
      clearTimeout(t);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      scroller?.removeEventListener("scroll", scheduleMeasure);
      window.removeEventListener("resize", scheduleMeasure);
    };
  }, [measure, scheduleMeasure, gridRef, sourceColRef, outputColRef, nodeEls, srcSectionEls, outLineEls]);

  // Confidence classes for colours:
  //  confident (>=90) → brand-blue (#1E66C9) → brand-green (#2E8E3A), solid
  //  amber    (75-89) → amber (#C97A14), dashed 5 4
  //  red      (<75)   → danger (#C53A3A), dashed 4 3
  //  crossed (all)    → green flush, solid

  return (
    <svg
      aria-hidden
      style={{
        position: "absolute", inset: 0, width: "100%", height: "100%",
        pointerEvents: "none", zIndex: 2, opacity: shown ? 1 : 0,
        transition: "opacity 320ms ease-out",
      }}
    >
      <defs>
        {/* brand blue→green gradient for confident source-to-node segment */}
        {wires.map((w) => (
          <linearGradient key={`scg-src-${w.id}`} id={`scg-src-${w.id}`} gradientUnits="userSpaceOnUse" x1={w.sx} y1={w.sy} x2={w.nlx} y2={w.ny}>
            <stop offset="0%" stopColor="#1E66C9" />
            <stop offset="100%" stopColor="#2E8E3A" />
          </linearGradient>
        ))}
        {/* green gradient for confident node-to-output segment */}
        {wires.map((w) => (
          <linearGradient key={`scg-out-${w.id}`} id={`scg-out-${w.id}`} gradientUnits="userSpaceOnUse" x1={w.nrx} y1={w.ny} x2={w.ox} y2={w.oy}>
            <stop offset="0%" stopColor="#2E8E3A" />
            <stop offset="100%" stopColor="#2E8E3A" />
          </linearGradient>
        ))}
        {/* full-journey crossed gradient */}
        {wires.map((w) => (
          <linearGradient key={`scg-cross-${w.id}`} id={`scg-cross-${w.id}`} gradientUnits="userSpaceOnUse" x1={w.sx} y1={w.sy} x2={w.ox} y2={w.oy}>
            <stop offset="0%" stopColor="#2E8E3A" />
            <stop offset="100%" stopColor="#2E8E3A" />
          </linearGradient>
        ))}
        {/* CSS keyframe for wire-traveller pulse */}
        <style>{`
          @keyframes _wire-pulse {
            0%   { offset-distance: 0%;   opacity: 0; }
            8%,88%{ opacity: 1; }
            100% { offset-distance: 100%; opacity: 0; }
          }
        `}</style>
      </defs>
      {wires.map((w, i) => {
        const emphasized = hoveredId === w.id;
        const dim = hoveredId != null && !emphasized;
        const opacity = dim ? 0.14 : 1;
        const sw = emphasized ? 2.8 : 1.8;

        const confident  = !crossed && w.pct >= 90;
        const amberConf  = !crossed && w.pct >= 75 && w.pct < 90;
        const redConf    = !crossed && w.pct < 75;
        const dashed     = amberConf || redConf;

        // per-segment strokes
        const srcStroke  = crossed ? "#2E8E3A" : confident ? `url(#scg-src-${w.id})`  : amberConf ? "#C97A14" : "#C53A3A";
        const outStroke  = crossed ? "#2E8E3A" : confident ? `url(#scg-out-${w.id})`  : amberConf ? "#C97A14" : "#C53A3A";

        const srcDot = crossed ? "#2E8E3A" : confident ? "#1E66C9" : amberConf ? "#C97A14" : "#C53A3A";
        const outDot = crossed ? "#2E8E3A" : confident ? "#2E8E3A" : amberConf ? "#C97A14" : "#C53A3A";

        const common: React.SVGProps<SVGPathElement> = {
          fill: "none",
          strokeWidth: sw,
          strokeDasharray: dashed ? (redConf ? "4 3" : "5 4") : undefined,
          style: { transition: "stroke-width 140ms ease, opacity 200ms ease" },
        };

        // Paths used for travelling pulses
        const pathSrc = curve(w.sx, w.sy, w.nlx, w.ny);
        const pathOut = curve(w.nrx, w.ny, w.ox, w.oy);

        const animDelay = `${-(i * 0.65).toFixed(2)}s`;
        const animDur   = `${5 + (i % 3)}s`;

        return (
          <g key={w.id} style={{ opacity, transition: "opacity 200ms ease" }}>
            {/* Source → node segment — hidden when the source panel is collapsed */}
            {drawSource && <path d={pathSrc} stroke={srcStroke} {...common} />}
            {/* Node → output segment — owned by WireDragLayer when drawOutput=false */}
            {drawOutput && <path d={pathOut} stroke={outStroke} {...common} />}

            {/* Terminal dots */}
            {drawSource && <circle cx={w.sx}  cy={w.sy}  r={emphasized ? 3.6 : 2.6} fill={srcDot} />}
            {drawOutput && <circle cx={w.ox} cy={w.oy} r={emphasized ? 3.6 : 2.6} fill={outDot} />}
            {/* Node attachment dot (hollow) — only meaningful with the source segment */}
            {drawSource && <circle cx={w.nlx} cy={w.ny}  r={2.4} fill="#FFFFFF" stroke={srcDot} strokeWidth={1.4} />}

            {/* Travelling pulse on source segment — only for confident/crossed wires */}
            {drawSource && (confident || crossed) && (
              <circle r="2.2" fill="#fff" stroke={crossed ? "#2E8E3A" : "#1E66C9"} strokeWidth="1.2"
                style={{
                  offsetPath: `path('${pathSrc}')`,
                  offsetRotate: "0deg",
                  animation: `_wire-pulse ${animDur} linear infinite`,
                  animationDelay: animDelay,
                } as React.CSSProperties} />
            )}
            {/* Travelling pulse on output segment */}
            {drawOutput && (confident || crossed) && (
              <circle r="2.2" fill="#fff" stroke="#2E8E3A" strokeWidth="1.2"
                style={{
                  offsetPath: `path('${pathOut}')`,
                  offsetRotate: "0deg",
                  animation: `_wire-pulse ${animDur} linear infinite`,
                  animationDelay: `calc(${animDelay} - 0.4s)`,
                } as React.CSSProperties} />
            )}
          </g>
        );
      })}
    </svg>
  );
}
