"use client";

import type React from "react";

// SpineConnectors — the "bridge made visible".
// Draws two sets of SVG bezier wires over the Review grid, exactly like the
// supplier-dock auto-map: Source Document → Canonical Spine (buyer-blue) and
// Canonical Spine → Supplier output (supplier-green). Confidence-colored,
// hover-aware, and flushing solid green when the order crosses.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export interface ConnectorNode {
  id: string;
  pct: number;
}

interface SpineConnectorsProps {
  gridRef: React.RefObject<HTMLElement | null>;
  sourceColRef: React.RefObject<HTMLElement | null>;
  outputColRef: React.RefObject<HTMLElement | null>;
  nodeEls: React.MutableRefObject<Record<string, HTMLElement | null>>;
  nodes: ConnectorNode[];
  hoveredId: string | null;
  crossed: boolean;
  /** Any change to this string forces a re-measure (heights shift on edit/accept). */
  signature: string;
}

// Anchor heights as a % of the source/output column height, per node id.
// Source document flows: letterhead → parties → currency → line table → total.
const SRC_Y: Record<string, number> = { po: 7, date: 11, buyer: 20, supplier: 23, currency: 28, lines: 56, totals: 88 };
// cXML output flows: orderID → orderDate → Total → ShipFrom → BillTo → ItemOut[].
const OUT_Y: Record<string, number> = { po: 15, date: 20, currency: 26, supplier: 31, buyer: 36, lines: 62, totals: 26 };

interface Wire {
  id: string;
  pct: number;
  left: { x1: number; y1: number; x2: number; y2: number };
  right: { x1: number; y1: number; x2: number; y2: number };
}

function bez(a: { x1: number; y1: number; x2: number; y2: number }): string {
  const cx = a.x1 + (a.x2 - a.x1) * 0.5;
  return `M ${a.x1} ${a.y1} C ${cx} ${a.y1} ${cx} ${a.y2} ${a.x2} ${a.y2}`;
}

export function SpineConnectors({
  gridRef, sourceColRef, outputColRef, nodeEls, nodes, hoveredId, crossed, signature,
}: SpineConnectorsProps) {
  const [wires, setWires] = useState<Wire[]>([]);
  const [shown, setShown] = useState(false);
  const rafRef = useRef<number | null>(null);

  const measure = useCallback(() => {
    const grid = gridRef.current;
    const src = sourceColRef.current;
    const out = outputColRef.current;
    if (!grid || !src || !out) return;

    const g = grid.getBoundingClientRect();
    if (g.width < 60) { setWires([]); return; } // hidden / mobile

    const s = src.getBoundingClientRect();
    const o = out.getBoundingClientRect();
    const next: Wire[] = [];

    nodes.forEach((node, i) => {
      const el = nodeEls.current[node.id];
      if (!el) return;
      const r = el.getBoundingClientRect();
      const nodeLeftX = r.left - g.left;
      const nodeRightX = r.right - g.left;
      const nodeY = r.top - g.top + 18; // attach near the node dot / label row

      const sx = s.right - g.left;
      const syPct = SRC_Y[node.id] ?? ((i + 0.5) / nodes.length) * 100;
      const sy = s.top - g.top + (s.height * syPct) / 100;

      const ox = o.left - g.left;
      const oyPct = OUT_Y[node.id] ?? ((i + 0.5) / nodes.length) * 100;
      const oy = o.top - g.top + (o.height * oyPct) / 100;

      next.push({
        id: node.id,
        pct: node.pct,
        left: { x1: sx, y1: sy, x2: nodeLeftX, y2: nodeY },
        right: { x1: nodeRightX, y1: nodeY, x2: ox, y2: oy },
      });
    });

    setWires(next);
  }, [gridRef, sourceColRef, outputColRef, nodeEls, nodes]);

  // Re-measure after layout + whenever content shifts.
  useLayoutEffect(() => { measure(); }, [measure, signature]);

  // Re-measure on resize + after fonts/layout settle (rAF), and reveal once.
  useEffect(() => {
    const onResize = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(measure);
    };
    window.addEventListener("resize", onResize);
    const t = setTimeout(() => { measure(); setShown(true); }, 60);
    return () => {
      window.removeEventListener("resize", onResize);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      clearTimeout(t);
    };
  }, [measure]);

  const wireStyle = (pct: number, side: "left" | "right") => {
    const dim = hoveredId != null;
    const base = crossed ? "#2E8E3A" : pct >= 90 ? (side === "left" ? "#1E66C9" : "#2E8E3A") : pct >= 75 ? "#C97A14" : "#C53A3A";
    const dashed = !crossed && pct < 90;
    return { stroke: base, dashed };
  };

  return (
    <svg
      aria-hidden
      style={{
        position: "absolute", inset: 0, width: "100%", height: "100%",
        pointerEvents: "none", zIndex: 2, opacity: shown ? 1 : 0,
        transition: "opacity 300ms ease-out",
      }}
    >
      {wires.map((w) => {
        const emphasized = hoveredId === w.id;
        const dim = hoveredId != null && !emphasized;
        const opacity = dim ? 0.18 : 1;
        const sw = emphasized ? 2.6 : 1.7;
        const L = wireStyle(w.pct, "left");
        const R = wireStyle(w.pct, "right");
        const common = {
          fill: "none",
          strokeWidth: sw,
          opacity,
          style: { transition: "stroke 250ms, stroke-width 140ms, opacity 200ms" } as React.CSSProperties,
        };
        return (
          <g key={w.id}>
            <path d={bez(w.left)} stroke={L.stroke} strokeDasharray={L.dashed ? "5 4" : undefined} {...common} />
            <path d={bez(w.right)} stroke={R.stroke} strokeDasharray={R.dashed ? "5 4" : undefined} {...common} />
            {/* endpoint dots */}
            <circle cx={w.left.x1} cy={w.left.y1} r={emphasized ? 3.4 : 2.6} fill={L.stroke} opacity={opacity} />
            <circle cx={w.right.x2} cy={w.right.y2} r={emphasized ? 3.4 : 2.6} fill={R.stroke} opacity={opacity} />
            <circle cx={w.left.x2} cy={w.left.y2} r={2.4} fill="#FFFFFF" stroke={L.stroke} strokeWidth={1.4} opacity={opacity} />
          </g>
        );
      })}
    </svg>
  );
}
