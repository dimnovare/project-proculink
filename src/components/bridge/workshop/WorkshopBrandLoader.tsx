"use client";

// WorkshopBrandLoader — the loading state for the Order Workshop (v3 redesign).
// The ProcuLink "wire" mark (the link/bridge between buyer and supplier) draws itself:
// a blue→green gradient dash runs continuously along a curved path joining two pulsing
// nodes (top blue = buyer, bottom green = supplier). Replaces the generic skeleton.
// Keyframes are scoped + frozen under prefers-reduced-motion. Tokens per handoff §13.

const PATH = "M14 16h28a20 20 0 0 1 20 20v0a20 20 0 0 1-20 20H14";

export function WorkshopBrandLoader({
  label = "Preparing your order…",
  sub = "Parsing the document and matching the supplier's fields.",
}: {
  label?: string;
  sub?: string;
}) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 22, height: "100%", background: "#F6F7FA" }}>
      <style>{`
        @keyframes plkWire { 0% { stroke-dashoffset: 100; } 100% { stroke-dashoffset: -100; } }
        @keyframes plkNode { 0%,100% { opacity: 0.5; transform: scale(1); } 50% { opacity: 1; transform: scale(1.18); } }
        @media (prefers-reduced-motion: reduce) {
          .plk-wire { animation: none !important; stroke-dashoffset: 0 !important; }
          .plk-node { animation: none !important; opacity: 0.9 !important; }
        }
      `}</style>
      <svg width="88" height="84" viewBox="0 0 76 72" fill="none" aria-hidden role="img">
        <defs>
          <linearGradient id="plkWireGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#1E66C9" />
            <stop offset="100%" stopColor="#2E8E3A" />
          </linearGradient>
        </defs>
        <path d={PATH} stroke="#DCE2EC" strokeWidth="5" strokeLinecap="round" fill="none" />
        <path
          className="plk-wire"
          d={PATH}
          stroke="url(#plkWireGrad)"
          strokeWidth="5"
          strokeLinecap="round"
          fill="none"
          style={{ strokeDasharray: "26 74", animation: "plkWire 1.9s cubic-bezier(.5,0,.5,1) infinite" }}
        />
        <circle className="plk-node" cx="14" cy="16" r="5" fill="#1E66C9" style={{ transformOrigin: "14px 16px", animation: "plkNode 1.9s ease-in-out infinite" }} />
        <circle className="plk-node" cx="14" cy="56" r="5" fill="#2E8E3A" style={{ transformOrigin: "14px 56px", animation: "plkNode 1.9s ease-in-out infinite", animationDelay: ".95s" }} />
      </svg>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#0B1A2F" }}>{label}</div>
        <div style={{ fontSize: 11.5, color: "#8A93A5", marginTop: 3 }}>{sub}</div>
      </div>
    </div>
  );
}
