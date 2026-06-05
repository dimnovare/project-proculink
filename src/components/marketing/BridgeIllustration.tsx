"use client";

// BridgeIllustration — SVG marketing graphic (sits inside the dark hero panel).
// Left: buyer cards (blue edge). Right: supplier cards (green edge).
// Center: a clean, symmetric set of curved wires that cross through the hub —
// each buyer routes to its mirror supplier, so the bundle necks down to a tidy
// hourglass at the centre node (blue on the left half → green on the right half).

// Generic industry/category labels — illustrative, not invented company names.
const BUYERS = [
  { label: "Manufacturing", code: "MFG" },
  { label: "Distribution",  code: "DST" },
  { label: "Construction",  code: "CON" },
  { label: "Pharma",        code: "PHA" },
];

const SUPPLIERS = [
  { label: "Components", code: "CMP" },
  { label: "Fasteners",  code: "FAS" },
  { label: "Metals",     code: "MTL" },
  { label: "Medical",    code: "MED" },
];

// Topology wire colours — exact design source values (mkt-components.jsx).
// Buyer side = blue, supplier side = forest green, mid-blend = steel.
const BLUE = "#2D7AE0";
const GREEN = "#3FA84C";
const MID = "#3f7fb8";
// Card chrome (.mkt-node) + mono code text.
const NODE_FILL = "#0E2138";
const NODE_STROKE = "#21385A";
const CODE_FILL = "#6F87A8";

// Each buyer routes to its mirror supplier (0↔3, 1↔2, 2↔1, 3↔0). This produces
// the clean, symmetric crossing in the reference: the four wires fan wide at the
// cards and pinch to a tidy bundle as they pass the hub.
const WIRES: Array<{ buyerIdx: number; suppIdx: number; dur: number; begin: number }> = [
  { buyerIdx: 0, suppIdx: 3, dur: 5.6, begin: 0.0 },
  { buyerIdx: 1, suppIdx: 2, dur: 4.8, begin: 1.4 },
  { buyerIdx: 2, suppIdx: 1, dur: 5.2, begin: 0.7 },
  { buyerIdx: 3, suppIdx: 0, dur: 6.0, begin: 2.1 },
];

export function BridgeIllustration({ className }: { className?: string }) {
  const W = 800;
  const H = 340;
  const padV = 44;
  const rowH = (H - padV * 2) / (BUYERS.length - 1);
  const leftX = 188;
  const rightX = W - 188;
  const cx = W / 2;
  const midY = H / 2;

  function buyerY(i: number) { return padV + i * rowH; }
  function suppY(i: number)  { return padV + i * rowH; }

  // Control points sit ~0.62 of the way toward centre-X so each wire leaves its
  // card almost horizontally, then bows toward the midline. Mirror-paired wires
  // therefore cross in a clean, open X centred on the hub — four distinct strands
  // (blue on the left half, green on the right), matching the reference.
  function wirePath(bi: number, si: number) {
    const y0 = buyerY(bi);
    const y1 = suppY(si);
    const cy0 = y0 + (midY - y0) * 0.38;
    const cy1 = y1 + (midY - y1) * 0.38;
    const cp1x = leftX  + (cx - leftX)  * 0.62;
    const cp2x = rightX - (rightX - cx) * 0.62;
    return `M ${leftX} ${y0} C ${cp1x} ${cy0}, ${cp2x} ${cy1}, ${rightX} ${y1}`;
  }

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={className}
      style={{ overflow: "hidden", width: "100%", height: "auto", display: "block" }}
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
            <stop offset="50%"  stopColor={MID} />
            <stop offset="100%" stopColor={GREEN} />
          </linearGradient>
        ))}
        {/* Soft hub glow */}
        <radialGradient id="hub-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%"  stopColor={BLUE} stopOpacity={0.30} />
          <stop offset="70%" stopColor={BLUE} stopOpacity={0.06} />
          <stop offset="100%" stopColor={BLUE} stopOpacity={0} />
        </radialGradient>
        {/* Hub core gradient (design: #163052 → #0e2138) */}
        <radialGradient id="hub-core" cx="50%" cy="50%" r="50%">
          <stop offset="0%"   stopColor="#163052" />
          <stop offset="100%" stopColor="#0E2138" />
        </radialGradient>
      </defs>

      {/* ── Wire curves ─────────────────────────────────────── */}
      {WIRES.map((w, i) => (
        <g key={i}>
          {/* Soft shadow underlay for depth */}
          <path
            d={wirePath(w.buyerIdx, w.suppIdx)}
            fill="none"
            stroke={`url(#wg-${i})`}
            strokeWidth={3.5}
            strokeOpacity={0.10}
            strokeLinecap="round"
          />
          {/* Main wire */}
          <path
            id={`wpath-${i}`}
            d={wirePath(w.buyerIdx, w.suppIdx)}
            fill="none"
            stroke={`url(#wg-${i})`}
            strokeWidth={1.6}
            strokeOpacity={0.9}
            strokeLinecap="round"
          />
          {/* Travelling pulse — gentle, uniform (white, per design) */}
          <circle r={3} fill="#FFFFFF" fillOpacity={0.95} opacity={0}>
            <animateMotion dur={`${w.dur}s`} begin={`${w.begin}s`} repeatCount="indefinite">
              <mpath href={`#wpath-${i}`} />
            </animateMotion>
            <animate
              attributeName="opacity"
              values="0;0;1;1;0;0"
              keyTimes="0;0.08;0.2;0.8;0.92;1"
              dur={`${w.dur}s`}
              begin={`${w.begin}s`}
              repeatCount="indefinite"
            />
          </circle>
        </g>
      ))}

      {/* ── Buyer cards (left) ───────────────────────────────── */}
      {BUYERS.map((b, i) => (
        <g key={b.code} transform={`translate(${leftX}, ${buyerY(i)})`}>
          {/* Card */}
          <rect
            x={-172}
            y={-20}
            width={156}
            height={40}
            rx={8}
            fill={NODE_FILL}
            stroke={NODE_STROKE}
            strokeWidth={1}
          />
          {/* Blue left bar */}
          <rect x={-172} y={-20} width={3} height={40} rx={1.5} fill={BLUE} />
          {/* Outbound port dot at the card's right edge */}
          <circle cx={-14} cy={0} r={2.4} fill={BLUE} fillOpacity={0.9} />

          {/* Code */}
          <text
            x={-153}
            y={-4.5}
            fontSize={8.5}
            fontFamily="'JetBrains Mono', monospace"
            fontWeight={700}
            letterSpacing="0.08em"
            fill={CODE_FILL}
          >
            {b.code}
          </text>
          {/* Label */}
          <text
            x={-153}
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

      {/* ── Supplier cards (right) ──────────────────────────── */}
      {SUPPLIERS.map((s, i) => (
        <g key={s.code} transform={`translate(${rightX}, ${suppY(i)})`}>
          {/* Inbound port dot at the card's left edge */}
          <circle cx={14} cy={0} r={2.4} fill={GREEN} fillOpacity={0.9} />
          {/* Card */}
          <rect
            x={16}
            y={-20}
            width={156}
            height={40}
            rx={8}
            fill={NODE_FILL}
            stroke={NODE_STROKE}
            strokeWidth={1}
          />
          {/* Green right bar */}
          <rect x={16 + 153} y={-20} width={3} height={40} rx={1.5} fill={GREEN} />

          <text
            x={28}
            y={-4.5}
            fontSize={8.5}
            fontFamily="'JetBrains Mono', monospace"
            fontWeight={700}
            letterSpacing="0.08em"
            fill={CODE_FILL}
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

      {/* ── Center hub ───────────────────────────────────────── */}
      <g transform={`translate(${cx}, ${midY})`}>
        <circle r={40} fill="url(#hub-glow)" />
        <circle r={30} fill="url(#hub-core)" stroke="#2A4565" strokeWidth={1} />
        {/* Buyer→supplier link glyph: blue node, green node, arc connector */}
        <circle cx={-9} cy={-4} r={3} fill={BLUE} />
        <circle cx={9} cy={-4} r={3} fill={GREEN} />
        <path
          d="M -9 -4 Q 0 -13 9 -4"
          fill="none"
          stroke={MID}
          strokeWidth={2}
          strokeLinecap="round"
        />
        <text
          x={0}
          y={15}
          textAnchor="middle"
          fontSize={7}
          fontFamily="'JetBrains Mono', monospace"
          fontWeight={700}
          fill={CODE_FILL}
          letterSpacing="0.14em"
        >
          PROCULINK
        </text>
      </g>
    </svg>
  );
}
