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
  // Scale factor: canonical viewBox is 0 0 40 40; S maps to that space
  const scale = S / 40;

  const blue  = white ? "#FFFFFF" : "#1E66C9";
  const green = white ? "#FFFFFF" : "#2E8E3A";

  // Canonical open-hook path from primitives.jsx Mark (viewBox 0 0 40 40):
  //   M8 10h14a10 10 0 0 1 10 10v0a10 10 0 0 1-10 10H8
  // strokeWidth 3.6, endpoint circles at (8,10) and (8,30) r=2.5
  // We keep the native 40×40 viewBox and scale via SVG width/height.
  const gradId = `mark-g-${size}-${white ? "w" : "c"}`;
  const stroke = white ? "#FFFFFF" : `url(#${gradId})`;

  return (
    <svg
      width={S}
      height={S}
      viewBox="0 0 40 40"
      fill="none"
      className={className}
      aria-label="ProcuLink mark"
    >
      {!white && (
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%"   stopColor={blue} />
            <stop offset="100%" stopColor={green} />
          </linearGradient>
        </defs>
      )}
      {/* Open-hook arc — canonical shape from primitives.jsx */}
      <path
        d="M8 10h14a10 10 0 0 1 10 10v0a10 10 0 0 1-10 10H8"
        stroke={stroke}
        strokeWidth={3.6}
        strokeLinecap="round"
        fill="none"
      />
      {/* Buyer endpoint — blue dot at top-left */}
      <circle cx="8" cy="10" r="2.5" fill={blue} />
      {/* Supplier endpoint — green dot at bottom-left */}
      <circle cx="8" cy="30" r="2.5" fill={green} />
    </svg>
  );
}

// Rail port marker — same construction, smaller, used at top of EdgeRails
export function RailPort({ color }: { color: "buyer" | "supplier" }) {
  const fill = color === "buyer" ? "#1E66C9" : "#2E8E3A";
  const soft = color === "buyer" ? "#EAF0F8" : "#E9F1EA";
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
