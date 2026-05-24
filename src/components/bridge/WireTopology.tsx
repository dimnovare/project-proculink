"use client";

// WireTopology — the signature dashboard canvas.
// Buyer ports down the left, supplier ports down the right,
// Bezier wires arcing between them with animated travelling pulses.

import { useEffect, useRef } from "react";

export interface WireBuyer {
  id: string;
  name: string;
  code: string;
  volume: string; // e.g. "412/wk"
}

export interface WireSupplier {
  id: string;
  name: string;
  code: string;
  volume: string;
  health: number; // 0–100 acceptance %
}

export interface Wire {
  buyerId: string;
  supplierId: string;
  weight: 1 | 2 | 3 | 4; // stroke-width bucket
  health: "ok" | "risk" | "down";
  alert?: number; // exception count
}

interface WireTopologyProps {
  buyers: WireBuyer[];
  suppliers: WireSupplier[];
  wires: Wire[];
  height?: number;
  onWireClick?: (wire: Wire, buyer: WireBuyer, supplier: WireSupplier) => void;
}

const STROKE_W: Record<number, number> = { 1: 1.5, 2: 3, 3: 5, 4: 8 };

const HEALTH_COLORS: Record<Wire["health"], [string, string]> = {
  ok:   ["#1E66C9", "#2E8E3A"],
  risk: ["#1E66C9", "#C97A14"],
  down: ["#C53A3A", "#C53A3A"],
};

export function WireTopology({
  buyers,
  suppliers,
  wires,
  height = 560,
  onWireClick,
}: WireTopologyProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  // Derive port positions
  const W = 900; // internal SVG width
  const H = height;
  const PORT_W = 140;
  const LEFT_X  = PORT_W;
  const RIGHT_X = W - PORT_W;
  const PAD_V = 40;

  function portY(index: number, total: number) {
    const usable = H - PAD_V * 2;
    return PAD_V + (usable / (total - 1 || 1)) * index;
  }

  const buyerY  = (i: number) => portY(i, buyers.length);
  const supplierY = (i: number) => portY(i, suppliers.length);

  return (
    <div
      className="relative w-full rounded-card overflow-hidden"
      style={{
        background: "#FFFFFF",
        border: "1px solid #E2E6EE",
        boxShadow: "0 1px 2px rgba(11,26,47,0.04)",
      }}
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        className="w-full"
        style={{ height }}
        aria-label="Order wire topology"
      >
        <defs>
          {wires.map((w, wi) => {
            const [c1, c2] = HEALTH_COLORS[w.health];
            return (
              <linearGradient
                key={wi}
                id={`wg-${wi}`}
                x1="0" y1="0" x2="1" y2="0"
              >
                <stop offset="0%"   stopColor={c1} />
                <stop offset="100%" stopColor={c2} />
              </linearGradient>
            );
          })}
        </defs>

        {/* ── Wires ─────────────────────────────────────────────── */}
        {wires.map((w, wi) => {
          const bi = buyers.findIndex((b) => b.id === w.buyerId);
          const si = suppliers.findIndex((s) => s.id === w.supplierId);
          if (bi === -1 || si === -1) return null;

          const x1 = LEFT_X;
          const y1 = buyerY(bi);
          const x2 = RIGHT_X;
          const y2 = supplierY(si);
          const mx = (x1 + x2) / 2;

          const pathD = `M ${x1},${y1} C ${mx},${y1} ${mx},${y2} ${x2},${y2}`;
          const sw    = STROKE_W[w.weight] ?? 2;
          const mid   = { x: mx, y: (y1 + y2) / 2 };

          return (
            <g
              key={wi}
              style={{ cursor: onWireClick ? "pointer" : undefined }}
              onClick={() => onWireClick?.(w, buyers[bi], suppliers[si])}
            >
              {/* Invisible hit target (wider than the wire) */}
              {onWireClick && (
                <path
                  d={pathD}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={Math.max(sw + 12, 18)}
                />
              )}
              {/* Wire path */}
              <path
                d={pathD}
                fill="none"
                stroke={`url(#wg-${wi})`}
                strokeWidth={sw}
                strokeLinecap="round"
                opacity={0.82}
              />

              {/* Travelling pulse — fades in/out near endpoints so it never "floats" */}
              <circle r={4} fill="white" stroke="#2E8E3A" strokeWidth={1.5} opacity={0}>
                <animateMotion
                  dur={`${5 + wi * 1.4}s`}
                  repeatCount="indefinite"
                  path={pathD}
                />
                {/* Fade: invisible at start/end, visible through the middle 80% */}
                <animate
                  attributeName="opacity"
                  values="0;0;1;1;0;0"
                  keyTimes="0;0.08;0.18;0.82;0.92;1"
                  dur={`${5 + wi * 1.4}s`}
                  repeatCount="indefinite"
                />
              </circle>

              {/* Alert badge */}
              {w.alert && w.alert > 0 && (
                <g transform={`translate(${mid.x}, ${mid.y})`}>
                  <circle r={10} fill="#C53A3A" />
                  <text
                    textAnchor="middle"
                    dy="0.35em"
                    fill="white"
                    fontSize={9}
                    fontWeight={700}
                    fontFamily="Inter, sans-serif"
                  >
                    {w.alert}
                  </text>
                </g>
              )}
            </g>
          );
        })}

        {/* ── Buyer ports (left) ───────────────────────────────── */}
        {buyers.map((b, i) => {
          const y = buyerY(i);
          return (
            <g key={b.id} transform={`translate(0, ${y})`}>
              <rect
                x={4}
                y={-18}
                width={LEFT_X - 8}
                height={36}
                rx={6}
                fill="#E3EDFB"
                stroke="#1E66C9"
                strokeWidth={1.5}
              />
              {/* Port dot */}
              <circle cx={LEFT_X} cy={0} r={5} fill="#1E66C9" />
              {/* Labels */}
              <text
                x={8}
                y={-5}
                fill="#0F4FA8"
                fontSize={11}
                fontWeight={700}
                fontFamily="Inter, sans-serif"
              >
                {b.name.length > 14 ? b.name.slice(0, 13) + "…" : b.name}
              </text>
              <text
                x={8}
                y={9}
                fill="#56627A"
                fontSize={9.5}
                fontFamily="JetBrains Mono, monospace"
              >
                {b.volume}
              </text>
            </g>
          );
        })}

        {/* ── Supplier ports (right) ───────────────────────────── */}
        {suppliers.map((s, i) => {
          const y = supplierY(i);
          const healthColor =
            s.health >= 95
              ? "#2E8E3A"
              : s.health >= 85
              ? "#C97A14"
              : "#C53A3A";
          return (
            <g key={s.id} transform={`translate(0, ${y})`}>
              <rect
                x={RIGHT_X + 4}
                y={-18}
                width={W - RIGHT_X - 8}
                height={36}
                rx={6}
                fill="#E2F1E2"
                stroke="#2E8E3A"
                strokeWidth={1.5}
              />
              {/* Port dot */}
              <circle cx={RIGHT_X} cy={0} r={5} fill="#2E8E3A" />
              {/* Labels */}
              <text
                x={RIGHT_X + 10}
                y={-5}
                fill="#1E6D29"
                fontSize={11}
                fontWeight={700}
                fontFamily="Inter, sans-serif"
              >
                {s.name.length > 13 ? s.name.slice(0, 12) + "…" : s.name}
              </text>
              <text
                x={RIGHT_X + 10}
                y={9}
                fill={healthColor}
                fontSize={9.5}
                fontWeight={600}
                fontFamily="JetBrains Mono, monospace"
              >
                {s.health}% accepted
              </text>
            </g>
          );
        })}

        {/* ── Legend (top-right) ───────────────────────────────── */}
        <g transform={`translate(${W / 2 - 90}, 8)`}>
          <rect x={0} y={0} width={180} height={22} rx={4} fill="#F6F7FA" stroke="#E2E6EE" />
          {[1, 2, 3, 4].map((w, i) => (
            <g key={w} transform={`translate(${6 + i * 44}, 11)`}>
              <line
                x1={0} y1={0} x2={16} y2={0}
                stroke="#1E66C9"
                strokeWidth={STROKE_W[w]}
                strokeLinecap="round"
                opacity={0.7}
              />
              <text x={20} y={4} fill="#8A93A5" fontSize={8} fontFamily="Inter, sans-serif">
                {["Low", "Med", "High", "Max"][i]}
              </text>
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
}
