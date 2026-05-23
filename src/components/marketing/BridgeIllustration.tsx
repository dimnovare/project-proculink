"use client";

// BridgeIllustration — SVG marketing graphic.
// Left: buyer docks (blue). Right: supplier docks (green).
// Center: animated Bezier wire curves with travelling pulses.

const BUYERS = [
  { label: "Heinrich Industries",  code: "HEI" },
  { label: "Nordmark Logistics",   code: "NRD" },
  { label: "Steelhouse Const.",    code: "SHC" },
  { label: "Centralis Pharma",     code: "CPH" },
];

const SUPPLIERS = [
  { label: "Acme Components",   code: "ACM" },
  { label: "BoltWorks BV",      code: "BWK" },
  { label: "VanDerBerg Metaal", code: "VDB" },
  { label: "MedicaSupply OY",   code: "MDS" },
];

const WIRES: Array<{
  buyerIdx: number;
  suppIdx: number;
  color: "ok" | "risk" | "down";
  dur: number;
}> = [
  { buyerIdx: 0, suppIdx: 0, color: "ok",   dur: 3.2 },
  { buyerIdx: 0, suppIdx: 1, color: "ok",   dur: 4.8 },
  { buyerIdx: 1, suppIdx: 2, color: "risk", dur: 3.8 },
  { buyerIdx: 1, suppIdx: 1, color: "ok",   dur: 5.1 },
  { buyerIdx: 2, suppIdx: 2, color: "ok",   dur: 4.0 },
  { buyerIdx: 2, suppIdx: 1, color: "ok",   dur: 6.2 },
  { buyerIdx: 3, suppIdx: 3, color: "ok",   dur: 3.5 },
  { buyerIdx: 3, suppIdx: 0, color: "down", dur: 7.0 },
];

const WIRE_COLOR: Record<string, string> = {
  ok:   "#1E66C9",
  risk: "#C97A14",
  down: "#C53A3A",
};

export function BridgeIllustration({ className }: { className?: string }) {
  const W = 800;
  const H = 320;
  const padV = 36;
  const rowH = (H - padV * 2) / (BUYERS.length - 1);
  const leftX = 180;
  const rightX = W - 180;
  const cx = W / 2;

  function buyerY(i: number) { return padV + i * rowH; }
  function suppY(i: number)  { return padV + i * rowH; }

  function wirePath(bi: number, si: number) {
    const y0 = buyerY(bi);
    const y1 = suppY(si);
    const cp1x = leftX  + (cx - leftX)  * 0.55;
    const cp2x = rightX - (rightX - cx) * 0.55;
    return `M ${leftX} ${y0} C ${cp1x} ${y0}, ${cp2x} ${y1}, ${rightX} ${y1}`;
  }

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={className}
      style={{ overflow: "visible" }}
      aria-hidden
    >
      <defs>
        {WIRES.map((w, i) => (
          <linearGradient
            key={i}
            id={`wg-${i}`}
            gradientUnits="userSpaceOnUse"
            x1={leftX}
            y1={buyerY(w.buyerIdx)}
            x2={rightX}
            y2={suppY(w.suppIdx)}
          >
            <stop offset="0%"   stopColor="#1E66C9" />
            <stop offset="100%" stopColor={
              w.color === "ok" ? "#2E8E3A" :
              w.color === "risk" ? "#C97A14" : "#C53A3A"
            } />
          </linearGradient>
        ))}
      </defs>

      {/* ── Wire curves ─────────────────────────────────────── */}
      {WIRES.map((w, i) => (
        <g key={i}>
          {/* Shadow wire */}
          <path
            d={wirePath(w.buyerIdx, w.suppIdx)}
            fill="none"
            stroke={`url(#wg-${i})`}
            strokeWidth={1.5}
            strokeOpacity={0.18}
          />
          {/* Main wire */}
          <path
            id={`wpath-${i}`}
            d={wirePath(w.buyerIdx, w.suppIdx)}
            fill="none"
            stroke={`url(#wg-${i})`}
            strokeWidth={w.color === "ok" ? 1.8 : 1.4}
            strokeOpacity={w.color === "down" ? 0.35 : 0.7}
            strokeDasharray={w.color === "down" ? "4 4" : undefined}
          />
          {/* Travelling pulse */}
          {w.color !== "down" && (
            <circle r={3.5} fill={WIRE_COLOR[w.color]} fillOpacity={0.9}>
              <animateMotion
                dur={`${w.dur}s`}
                repeatCount="indefinite"
                begin={`${i * 0.7}s`}
              >
                <mpath href={`#wpath-${i}`} />
              </animateMotion>
            </circle>
          )}
        </g>
      ))}

      {/* ── Buyer docks (left) ───────────────────────────────── */}
      {BUYERS.map((b, i) => (
        <g key={b.code} transform={`translate(${leftX}, ${buyerY(i)})`}>
          {/* Connection dot */}
          <circle
            cx={0}
            cy={0}
            r={5}
            fill="#1E66C9"
            opacity={0.9}
          />
          <circle cx={0} cy={0} r={9} fill="#1E66C9" opacity={0.12} />

          {/* Card */}
          <rect
            x={-160}
            y={-18}
            width={144}
            height={36}
            rx={6}
            fill="#FFFFFF"
            stroke="#E2E6EE"
            strokeWidth={1}
          />
          {/* Blue left bar */}
          <rect x={-160} y={-18} width={3} height={36} rx={1} fill="#1E66C9" />

          {/* Code */}
          <text
            x={-143}
            y={-4}
            fontSize={9}
            fontFamily="'JetBrains Mono', monospace"
            fontWeight={700}
            fill="#1E66C9"
          >
            {b.code}
          </text>
          {/* Label */}
          <text
            x={-143}
            y={9}
            fontSize={10}
            fontFamily="Inter, system-ui"
            fontWeight={500}
            fill="#0B1A2F"
          >
            {b.label}
          </text>
        </g>
      ))}

      {/* ── Supplier docks (right) ──────────────────────────── */}
      {SUPPLIERS.map((s, i) => (
        <g key={s.code} transform={`translate(${rightX}, ${suppY(i)})`}>
          {/* Connection dot */}
          <circle cx={0} cy={0} r={5} fill="#2E8E3A" opacity={0.9} />
          <circle cx={0} cy={0} r={9} fill="#2E8E3A" opacity={0.12} />

          {/* Card */}
          <rect
            x={16}
            y={-18}
            width={144}
            height={36}
            rx={6}
            fill="#FFFFFF"
            stroke="#E2E6EE"
            strokeWidth={1}
          />
          {/* Green right bar */}
          <rect
            x={16 + 141}
            y={-18}
            width={3}
            height={36}
            rx={1}
            fill="#2E8E3A"
          />

          <text
            x={28}
            y={-4}
            fontSize={9}
            fontFamily="'JetBrains Mono', monospace"
            fontWeight={700}
            fill="#2E8E3A"
          >
            {s.code}
          </text>
          <text
            x={28}
            y={9}
            fontSize={10}
            fontFamily="Inter, system-ui"
            fontWeight={500}
            fill="#0B1A2F"
          >
            {s.label}
          </text>
        </g>
      ))}

      {/* ── Bridge label ─────────────────────────────────────── */}
      <g transform={`translate(${cx}, ${H / 2})`}>
        <rect
          x={-40}
          y={-13}
          width={80}
          height={26}
          rx={6}
          fill="#0B1A2F"
          opacity={0.92}
        />
        <text
          x={0}
          y={4}
          textAnchor="middle"
          fontSize={9.5}
          fontFamily="'JetBrains Mono', monospace"
          fontWeight={700}
          fill="#FFFFFF"
          letterSpacing="0.06em"
        >
          BRIDGE
        </text>
      </g>
    </svg>
  );
}
