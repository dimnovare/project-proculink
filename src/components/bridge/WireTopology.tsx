"use client";

// WireTopology — the signature dashboard canvas.
// Buyer ports down the left, supplier ports down the right,
// Bezier wires arcing between them with animated travelling dots.
//
// Below md: renders WireTopologyLaneList (lane rows, no SVG canvas).
// Above md: renders WireTopologyCanvas (full SVG).

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
  weight: 1 | 2 | 3 | 4 | 5 | 6; // stroke-width bucket
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

/** Non-linear compressed stroke width: weight 1..6 → ~1.4..4.9 px */
export function strokeFromWeight(weight: 1 | 2 | 3 | 4 | 5 | 6): number {
  return +(1.2 + Math.log2(weight) * 1.55).toFixed(2);
}

const HEALTH_COLORS: Record<Wire["health"], [string, string]> = {
  ok:   ["#1E66C9", "#2E8E3A"],
  risk: ["#1E66C9", "#C97A14"],
  down: ["#C53A3A", "#C53A3A"],
};

const PULSE_COLOR: Record<Wire["health"], string> = {
  ok:   "#2E8E3A",
  risk: "#C97A14",
  down: "#C53A3A",
};

function cubicPoint(
  t: number,
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number }
) {
  const mt = 1 - t;
  return {
    x: mt ** 3 * p0.x + 3 * mt ** 2 * t * p1.x + 3 * mt * t ** 2 * p2.x + t ** 3 * p3.x,
    y: mt ** 3 * p0.y + 3 * mt ** 2 * t * p1.y + 3 * mt * t ** 2 * p2.y + t ** 3 * p3.y,
  };
}

// ─── Mobile lane list ──────────────────────────────────────────────────────

function WireTopologyLaneList({ buyers, suppliers, wires, onWireClick }: WireTopologyProps) {
  return (
    <div className="flex flex-col gap-2 p-2 bg-[#F6F7FA] rounded-card">
      {wires.map((wire, i) => {
        const buyer = buyers.find((b) => b.id === wire.buyerId);
        const supplier = suppliers.find((s) => s.id === wire.supplierId);
        if (!buyer || !supplier) return null;

        const sw = strokeFromWeight(wire.weight);
        const isWarn = wire.health === "risk" || wire.health === "down";
        const supplierColor =
          supplier.health >= 95 ? "#2E8E3A" : supplier.health >= 85 ? "#C97A14" : "#C53A3A";
        const gradId = `m-wire-${i}`;

        return (
          <div
            key={i}
            className="bg-white border border-[#E2E6EE] rounded-[10px] flex items-center gap-[10px] p-[10px_12px]"
            style={{ cursor: onWireClick ? "pointer" : undefined }}
            onClick={() => onWireClick?.(wire, buyer, supplier)}
          >
            {/* Buyer */}
            <div className="flex-[0_1_32%] min-w-0">
              <div className="text-[9px] font-bold tracking-[0.08em] text-[#1E66C9] font-mono">
                {buyer.code}
              </div>
              <div className="text-[11.5px] font-semibold text-[#0B1A2F] truncate">
                {buyer.name}
              </div>
              <div className="text-[9.5px] text-[#8A93A5]">{buyer.volume}</div>
            </div>

            {/* Mini arc */}
            <div className="flex-[0_0_76px] relative">
              <svg width={76} height={38} viewBox="0 0 76 38" aria-hidden>
                <defs>
                  <linearGradient id={gradId} x1="0" x2="1" y1="0" y2="0">
                    <stop offset="0%" stopColor="#1E66C9" />
                    {isWarn ? (
                      <>
                        <stop offset="60%" stopColor="#C97A14" />
                        <stop offset="100%" stopColor="#C97A14" />
                      </>
                    ) : (
                      <stop offset="100%" stopColor="#2E8E3A" />
                    )}
                  </linearGradient>
                </defs>
                <circle cx={3} cy={19} r={3} fill="#1E66C9" />
                <path
                  d="M 4 19 C 26 19, 50 19, 72 19"
                  stroke={`url(#${gradId})`}
                  strokeWidth={sw}
                  strokeLinecap="round"
                  fill="none"
                />
                <circle
                  cx={73}
                  cy={19}
                  r={3}
                  fill="#FFFFFF"
                  stroke={isWarn ? "#C97A14" : "#2E8E3A"}
                  strokeWidth={1.5}
                />
              </svg>
              {wire.alert && wire.alert > 0 && (
                <div
                  className="absolute top-[3px] left-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-white flex items-center justify-center text-[9px] font-bold"
                  style={{ border: "1.5px solid #C97A14", color: "#C97A14" }}
                >
                  {wire.alert}
                </div>
              )}
            </div>

            {/* Supplier */}
            <div className="flex-[1_1_38%] min-w-0 text-right">
              <div
                className="text-[9px] font-bold tracking-[0.08em] font-mono"
                style={{ color: isWarn ? "#C97A14" : "#1E6D29" }}
              >
                {supplier.code}
              </div>
              <div className="text-[11.5px] font-semibold text-[#0B1A2F] truncate">
                {supplier.name}
              </div>
              <div className="text-[9.5px]" style={{ color: supplierColor }}>
                {supplier.health}% acc
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Desktop SVG canvas ────────────────────────────────────────────────────

function WireTopologyCanvas({
  buyers,
  suppliers,
  wires,
  height = 560,
  onWireClick,
}: WireTopologyProps) {
  const W = 900;
  const H = height;
  const PORT_W = 140;
  const LEFT_X  = PORT_W;       // 140 — buyer port right edge / wire start
  const RIGHT_X = W - PORT_W;   // 760 — supplier port left edge / wire end
  const PAD_V   = 64;

  function portY(index: number, total: number) {
    const usable = H - PAD_V * 2;
    return PAD_V + (usable / (total - 1 || 1)) * index;
  }

  const buyerY    = (i: number) => portY(i, buyers.length);
  const supplierY = (i: number) => portY(i, suppliers.length);

  // Count arrivals per supplier port to stagger control points (prevents wire bunching)
  const sCount: Record<string, number> = {};

  return (
    <div
      className="relative w-full overflow-x-auto overflow-y-hidden rounded-card"
      style={{
        background: "#FFFFFF",
        border: "1px solid #E2E6EE",
        boxShadow: "0 1px 2px rgba(11,26,47,0.04)",
      }}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        className="min-w-[760px] w-full"
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
                gradientUnits="userSpaceOnUse"
                x1={LEFT_X}
                y1={0}
                x2={RIGHT_X}
                y2={0}
              >
                <stop offset="0%"   stopColor={c1} />
                <stop offset="100%" stopColor={c2} />
              </linearGradient>
            );
          })}
        </defs>

        {/* ── Wires — drawn before ports so ports stack on top ──── */}
        {wires.map((w, wi) => {
          const bi = buyers.findIndex((b) => b.id === w.buyerId);
          const si = suppliers.findIndex((s) => s.id === w.supplierId);
          if (bi === -1 || si === -1) return null;

          // ix = how many wires have already arrived at this supplier (for CP stagger)
          const ix = (sCount[w.supplierId] = (sCount[w.supplierId] || 0) + 1) - 1;

          const x1 = LEFT_X;
          const y1 = buyerY(bi);
          const x2 = RIGHT_X;
          const y2 = supplierY(si);

          // Staggered Bezier control points — spreads co-landing wires visually
          const cx1x = 370 + (wi % 3) * 20;  // 370 / 390 / 410
          const cx2x = 530 + (ix % 3) * 18;  // 530 / 548 / 566
          const p0 = { x: x1,   y: y1 };
          const p1 = { x: cx1x, y: y1 };
          const p2 = { x: cx2x, y: y2 };
          const p3 = { x: x2,   y: y2 };

          const pathD = `M ${p0.x},${p0.y} C ${p1.x},${p1.y} ${p2.x},${p2.y} ${p3.x},${p3.y}`;
          const sw = strokeFromWeight(w.weight);
          const opacity = w.health === "risk" ? 0.92 : 0.78;

          const pulseDur   = `${6 + (wi % 3) * 0.6}s`;
          const pulseBegin = `-${wi * 0.55}s`;

          // Alert badge at 58% along the curve
          const alertAnchor =
            w.alert && w.alert > 0
              ? cubicPoint(0.58, p0, p1, p2, p3)
              : null;

          return (
            <g
              key={wi}
              opacity={opacity}
              style={{ cursor: onWireClick ? "pointer" : undefined }}
              onClick={() => onWireClick?.(w, buyers[bi], suppliers[si])}
            >
              {/* Invisible hit target */}
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
              />

              {/* Travelling pulse — r=2.2, no opacity fade */}
              <circle
                r={2.2}
                fill="#FFFFFF"
                stroke={PULSE_COLOR[w.health]}
                strokeWidth={1.2}
                aria-hidden="true"
              >
                <animateMotion
                  dur={pulseDur}
                  begin={pulseBegin}
                  repeatCount="indefinite"
                  path={pathD}
                />
              </circle>

              {/* Alert badge — white fill, amber stroke, amber numeral, no stem */}
              {alertAnchor && w.alert && (
                <g
                  transform={`translate(${alertAnchor.x}, ${alertAnchor.y - 14})`}
                  aria-label={`${w.alert} exceptions on this wire`}
                >
                  <circle r={9} fill="#FFFFFF" stroke="#C97A14" strokeWidth={1.5} />
                  <text
                    textAnchor="middle"
                    y={3}
                    fill="#C97A14"
                    fontSize={10}
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
                strokeWidth={1.25}
              />
              {/* Accent stripe */}
              <rect x={4} y={-18} width={3} height={36} fill="#1E66C9" />
              {/* Labels */}
              <text
                x={12}
                y={-5}
                fill="#0B1A2F"
                fontSize={11}
                fontWeight={600}
                fontFamily="Inter, sans-serif"
              >
                {b.name.length > 14 ? b.name.slice(0, 13) + "…" : b.name}
              </text>
              <text
                x={12}
                y={9}
                fill="#56627A"
                fontSize={9.5}
                fontFamily="JetBrains Mono, monospace"
              >
                {b.code} · {b.volume}
              </text>
              {/* Connector dot — blue filled + white core */}
              <circle cx={LEFT_X} cy={0} r={4} fill="#1E66C9" />
              <circle cx={LEFT_X} cy={0} r={2} fill="#FFFFFF" />
            </g>
          );
        })}

        {/* ── Supplier ports (right) ───────────────────────────── */}
        {suppliers.map((s, i) => {
          const y = supplierY(i);
          const isHealthy = s.health >= 85;
          const borderColor = isHealthy ? "#2E8E3A" : "#C97A14";
          const bgColor     = isHealthy ? "#E2F1E2"  : "#FAEFD6";
          const healthColor =
            s.health >= 95 ? "#1E6D29" : s.health >= 85 ? "#C97A14" : "#C53A3A";
          return (
            <g key={s.id} transform={`translate(0, ${y})`}>
              <rect
                x={RIGHT_X + 4}
                y={-18}
                width={W - RIGHT_X - 8}
                height={36}
                rx={6}
                fill={bgColor}
                stroke={borderColor}
                strokeWidth={1.25}
              />
              {/* Accent stripe (right side) */}
              <rect x={W - 7} y={-18} width={3} height={36} fill={borderColor} />
              {/* Labels */}
              <text
                x={RIGHT_X + 14}
                y={-5}
                fill="#0B1A2F"
                fontSize={11}
                fontWeight={600}
                fontFamily="Inter, sans-serif"
              >
                {s.name.length > 13 ? s.name.slice(0, 12) + "…" : s.name}
              </text>
              <text
                x={RIGHT_X + 14}
                y={9}
                fill="#56627A"
                fontSize={9.5}
                fontFamily="JetBrains Mono, monospace"
              >
                {s.code} ·{" "}
                <tspan fill={healthColor}>{s.health}% acc</tspan>
              </text>
              {/* Connector dot — hollow with colored stroke */}
              <circle cx={RIGHT_X} cy={0} r={4} fill="#FFFFFF" stroke={borderColor} strokeWidth={2} />
            </g>
          );
        })}

        {/* ── Legend (top-right) ───────────────────────────────── */}
        <g transform={`translate(${W - 232}, 8)`}>
          <rect x={0} y={0} width={192} height={22} rx={4} fill="#F6F7FA" stroke="#E2E6EE" />
          {([1, 2, 4, 6] as const).map((w, i) => (
            <g key={w} transform={`translate(${6 + i * 46}, 11)`}>
              <line
                x1={0} y1={0} x2={18} y2={0}
                stroke="#0B1A2F"
                strokeWidth={strokeFromWeight(w)}
                strokeLinecap="round"
                opacity={0.7}
              />
              <text x={22} y={4} fill="#8A93A5" fontSize={8} fontFamily="Inter, sans-serif">
                {["low", "med", "high", "max"][i]}
              </text>
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
}

// ─── Responsive wrapper ────────────────────────────────────────────────────

export function WireTopology(props: WireTopologyProps) {
  return (
    <>
      <div className="hidden md:block">
        <WireTopologyCanvas {...props} />
      </div>
      <div className="md:hidden">
        <WireTopologyLaneList {...props} />
      </div>
    </>
  );
}
