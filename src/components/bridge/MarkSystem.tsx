// System Identity mark — the brand's shape language in three sizes.
// ProcuLinkMark is the canonical DS implementation (Direction 3 — link-node arc).
// MarkSystem kept for legacy usage; RailPort used by EdgeRails.

// Re-export canonical DS mark so consumers can use either name.
export { ProcuLinkMark } from "@/components/bridge/DSPrimitives";

interface MarkSystemProps {
  size?: 16 | 24 | 64 | number;
  white?: boolean;
  className?: string;
}

export function MarkSystem({ size = 24, white = false, className }: MarkSystemProps) {
  const S = size;
  const strokeW = S * 0.09;
  const endR    = S * 0.115;
  const rx      = S * 0.285;
  const ry      = S * 0.215;
  const cx1     = S * 0.5 - rx + endR * 0.3;
  const cy1     = S * 0.5;
  const cx2     = S * 0.5 + rx - endR * 0.3;
  const cy2     = S * 0.5;

  const blue  = white ? "#FFFFFF" : "#1E66C9";
  const green = white ? "#FFFFFF" : "#2E8E3A";
  const gradId = `mark-g-${size}-${white ? "w" : "c"}`;

  return (
    <svg
      width={S}
      height={S}
      viewBox={`0 0 ${S} ${S}`}
      fill="none"
      className={className}
      aria-label="ProcuLink mark"
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"   stopColor={blue} />
          <stop offset="100%" stopColor={green} />
        </linearGradient>
      </defs>
      {/* Arc */}
      <ellipse
        cx={S / 2}
        cy={S / 2}
        rx={rx}
        ry={ry}
        stroke={`url(#${gradId})`}
        strokeWidth={strokeW}
        fill="none"
      />
      {/* Left endpoint — buyer blue */}
      <circle cx={cx1} cy={cy1} r={endR} fill={blue} />
      {/* Right endpoint — supplier green */}
      <circle cx={cx2} cy={cy2} r={endR} fill={green} />
    </svg>
  );
}

// Rail port marker — same construction, smaller, used at top of EdgeRails
export function RailPort({ color }: { color: "buyer" | "supplier" }) {
  const fill = color === "buyer" ? "#1E66C9" : "#2E8E3A";
  const soft = color === "buyer" ? "#E3EDFB" : "#E2F1E2";
  return (
    <div
      className="flex items-center justify-center rounded-full flex-shrink-0"
      style={{
        width: 28,
        height: 28,
        background: soft,
        border: `2px solid ${fill}`,
      }}
    >
      <div
        className="rounded-full"
        style={{ width: 8, height: 8, background: fill }}
      />
    </div>
  );
}
