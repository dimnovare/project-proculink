"use client";

// BridgeIllustration — SVG marketing graphic (sits inside the dark hero panel).
// Left: buyer docks (blue edge). Right: supplier docks (green edge).
// Center: animated Bezier wire curves (blue → green) with travelling dots.

const BUYERS = [
  { label: "Heinrich Industries",  code: "HEI" },
  { label: "Nordmark Logistik",    code: "NRD" },
  { label: "Steelhouse Const.",    code: "SHC" },
  { label: "Centralis Pharma",     code: "CPH" },
];

const SUPPLIERS = [
  { label: "Acme Components",   code: "ACM" },
  { label: "BoltWorks BV",      code: "BWK" },
  { label: "VanDerBerg Metaal", code: "VDB" },
  { label: "MedicaSupply OY",   code: "MDS" },
];

// Brand accent is green.
const BLUE = "#3F86E8";
const GREEN = "#28C55E";
const GREEN_DEEP = "#1DAF50";
const AMBER = "#E7B548";

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

const PULSE_COLOR: Record<string, string> = {
  ok:   GREEN,
  risk: AMBER,
  down: "#C53A3A",
};

export function BridgeIllustration({ className }: { className?: string }) {
  const W = 800;
  const H = 320;
  const padV = 36;
  const rowH = (H - padV * 2) / (BUYERS.length - 1);
  const leftX = 184;
  const rightX = W - 184;
  const cx = W / 2;

  function buyerY(i: number) { return padV + i * rowH; }
  function suppY(i: number)  { return padV + i * rowH; }

  // Deep S-curve topology: control points pull toward centre-X (0.9) so wires
  // funnel through the node area, and each control point's Y is biased toward
  // the vertical midline *in proportion to the wire's vertical span* — same-row
  // wires stay shallow, crossing wires bow hard into a clean X (matches ref).
  const spanFull = (BUYERS.length - 1) * rowH;
  function wirePath(bi: number, si: number) {
    const y0 = buyerY(bi);
    const y1 = suppY(si);
    const midY = H / 2;
    // 0 for a same-row wire → ~1 for a full top↔bottom crossing.
    const pull = Math.min(Math.abs(y1 - y0) / spanFull, 1) * 0.55;
    const cy0 = y0 + (midY - y0) * pull;
    const cy1 = y1 + (midY - y1) * pull;
    const cp1x = leftX  + (cx - leftX)  * 0.9;
    const cp2x = rightX - (rightX - cx) * 0.9;
    return `M ${leftX} ${y0} C ${cp1x} ${cy0}, ${cp2x} ${cy1}, ${rightX} ${y1}`;
  }

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={className}
      style={{ overflow: "hidden", width: "100%", height: "auto" }}
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
            <stop offset="0%"   stopColor={BLUE} />
            <stop offset="55%"  stopColor={BLUE} />
            <stop offset="100%" stopColor={
              w.color === "ok" ? GREEN :
              w.color === "risk" ? AMBER : "#C53A3A"
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
            strokeOpacity={0.16}
          />
          {/* Main wire */}
          <path
            id={`wpath-${i}`}
            d={wirePath(w.buyerIdx, w.suppIdx)}
            fill="none"
            stroke={`url(#wg-${i})`}
            strokeWidth={w.color === "ok" ? 1.8 : 1.4}
            strokeOpacity={w.color === "down" ? 0.32 : 0.85}
            strokeDasharray={w.color === "down" ? "4 4" : undefined}
          />
          {/* Travelling pulse */}
          {w.color !== "down" && (
            <circle
              className="wire-pulse-dot"
              r={2.6}
              fill={PULSE_COLOR[w.color]}
              fillOpacity={0.9}
              opacity={0}
            >
              <animateMotion
                dur={`${w.dur}s`}
                repeatCount="indefinite"
                begin={`${i * 0.7}s`}
              >
                <mpath href={`#wpath-${i}`} />
              </animateMotion>
              <animate
                attributeName="opacity"
                values="0;0;1;1;0;0"
                keyTimes="0;0.08;0.18;0.82;0.92;1"
                dur={`${w.dur}s`}
                begin={`${i * 0.7}s`}
                repeatCount="indefinite"
              />
            </circle>
          )}
        </g>
      ))}

      {/* ── Buyer docks (left) ───────────────────────────────── */}
      {BUYERS.map((b, i) => (
        <g key={b.code} transform={`translate(${leftX}, ${buyerY(i)})`}>
          {/* Outbound port — small chevron just past the card's right edge */}
          <path
            d="M -2 -4 L 4 0 L -2 4"
            fill="none"
            stroke={BLUE}
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.95}
          />

          {/* Card */}
          <rect
            x={-168}
            y={-19}
            width={152}
            height={38}
            rx={7}
            fill="#13294466"
            stroke="rgba(255,255,255,0.10)"
            strokeWidth={1}
          />
          {/* Blue left bar */}
          <rect x={-168} y={-19} width={3} height={38} rx={1.5} fill={BLUE} />

          {/* Code */}
          <text
            x={-150}
            y={-4}
            fontSize={8.5}
            fontFamily="'JetBrains Mono', monospace"
            fontWeight={700}
            letterSpacing="0.08em"
            fill="#6F9BD6"
          >
            {b.code}
          </text>
          {/* Label */}
          <text
            x={-150}
            y={10}
            fontSize={11}
            fontFamily="Inter, system-ui"
            fontWeight={600}
            fill="#FFFFFF"
          >
            {b.label}
          </text>
        </g>
      ))}

      {/* ── Supplier docks (right) ──────────────────────────── */}
      {SUPPLIERS.map((s, i) => (
        <g key={s.code} transform={`translate(${rightX}, ${suppY(i)})`}>
          {/* Inbound port — small chevron just before the card's left edge */}
          <path
            d="M -2 -4 L 4 0 L -2 4"
            fill="none"
            stroke={GREEN}
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.95}
          />

          {/* Card */}
          <rect
            x={16}
            y={-19}
            width={152}
            height={38}
            rx={7}
            fill="#13294466"
            stroke="rgba(255,255,255,0.10)"
            strokeWidth={1}
          />
          {/* Green right bar */}
          <rect x={16 + 149} y={-19} width={3} height={38} rx={1.5} fill={GREEN} />

          <text
            x={28}
            y={-4}
            fontSize={8.5}
            fontFamily="'JetBrains Mono', monospace"
            fontWeight={700}
            letterSpacing="0.08em"
            fill="#5FB585"
          >
            {s.code}
          </text>
          <text
            x={28}
            y={10}
            fontSize={11}
            fontFamily="Inter, system-ui"
            fontWeight={600}
            fill="#FFFFFF"
          >
            {s.label}
          </text>
        </g>
      ))}

      {/* ── Center node ──────────────────────────────────────── */}
      <g transform={`translate(${cx}, ${H / 2})`}>
        <circle r={34} fill="#0B1A2F" stroke="rgba(255,255,255,0.12)" strokeWidth={1} />
        <circle r={34} fill="none" stroke={GREEN} strokeWidth={1} strokeOpacity={0.35} />
        {/* Logo mark — ProcuLink "link" glyph (no forbidden wording) */}
        <path
          d="M -8 -3 a 6 6 0 0 1 8 -1 l 3 2 M 8 3 a 6 6 0 0 1 -8 1 l -3 -2"
          fill="none"
          stroke="#FFFFFF"
          strokeWidth={1.6}
          strokeLinecap="round"
          transform="translate(0,-3) scale(1.05)"
        />
        <circle cx={9} cy={-2} r={2.2} fill={GREEN} />
        <text
          x={0}
          y={15}
          textAnchor="middle"
          fontSize={7.5}
          fontFamily="'JetBrains Mono', monospace"
          fontWeight={700}
          fill="#7C8DA6"
          letterSpacing="0.12em"
        >
          PROCULINK
        </text>
      </g>
    </svg>
  );
}
