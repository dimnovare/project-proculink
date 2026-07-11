"use client";

/**
 * BridgeLoader — the single canonical loading state for ProcuLink.
 * The ProcuLink "wire" mark (the link/bridge between buyer and supplier) animates:
 * a blue→green gradient dash flows continuously along a curved path joining two
 * pulsing nodes (top blue = buyer, bottom green = supplier). "Never a generic
 * spinner." — §7 identity system. Keyframes are scoped + frozen under
 * prefers-reduced-motion. Tokens per handoff §13.
 *
 * Used by every loading.tsx (via BridgePageLoader) and any suspense fallback.
 */

import { type CSSProperties } from "react";

// Path drawn in a 76×72 viewBox — the buyer→supplier wire.
const PATH = "M14 16h28a20 20 0 0 1 20 20v0a20 20 0 0 1-20 20H14";

interface BridgeLoaderProps {
  /** Optional label below the mark */
  label?: string;
  /** Optional secondary line below the label */
  sub?: string;
  /** Size of the mark in px (default 48) */
  size?: number;
  /** Full-screen centering (default true) */
  fullScreen?: boolean;
}

export function BridgeLoader({
  label,
  sub,
  size = 48,
  fullScreen = true,
}: BridgeLoaderProps) {
  const wrapStyle: CSSProperties = fullScreen
    ? {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        minHeight: 200,
        gap: 16,
        background: "#F6F7FA",
      }
    : {
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 14,
      };

  // The mark keeps its 76×72 aspect ratio; scale height from the size prop.
  const width = size;
  const height = Math.round(size * (72 / 76));

  return (
    <div style={wrapStyle}>
      <svg
        className="bridge-loader-svg"
        width={width}
        height={height}
        viewBox="0 0 76 72"
        fill="none"
        aria-label={label ?? "Loading…"}
        role="status"
      >
        <defs>
          <linearGradient id="bl-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#1E66C9" />
            <stop offset="100%" stopColor="#2E8E3A" />
          </linearGradient>
        </defs>

        {/* Static rail */}
        <path
          d={PATH}
          stroke="#DCE2EC"
          strokeWidth="5"
          strokeLinecap="round"
          fill="none"
        />

        {/* The flowing gradient dash — runs continuously buyer→supplier */}
        <path
          className="plk-wire"
          d={PATH}
          stroke="url(#bl-grad)"
          strokeWidth="5"
          strokeLinecap="round"
          fill="none"
          style={{
            strokeDasharray: "26 74",
            animation: "plkWire 1.9s cubic-bezier(.5,0,.5,1) infinite",
          }}
        />

        {/* Buyer endpoint — pulses */}
        <circle
          className="plk-node"
          cx="14"
          cy="16"
          r="5"
          fill="#1E66C9"
          style={{
            transformOrigin: "14px 16px",
            animation: "plkNode 1.9s ease-in-out infinite",
          }}
        />

        {/* Supplier endpoint — pulses (offset half a cycle) */}
        <circle
          className="plk-node"
          cx="14"
          cy="56"
          r="5"
          fill="#2E8E3A"
          style={{
            transformOrigin: "14px 56px",
            animation: "plkNode 1.9s ease-in-out infinite",
            animationDelay: ".95s",
          }}
        />
      </svg>

      {(label || sub) && (
        <div style={{ textAlign: "center" }}>
          {label && (
            <div style={{ fontSize: 13, fontWeight: 600, color: "#0B1A2F" }}>
              {label}
            </div>
          )}
          {sub && (
            <div style={{ fontSize: 11.5, color: "var(--ink-faint)", marginTop: 3 }}>
              {sub}
            </div>
          )}
        </div>
      )}

      {/* Keyframes injected inline — avoids CSS module dependency */}
      <style>{`
        @keyframes plkWire { 0% { stroke-dashoffset: 100; } 100% { stroke-dashoffset: -100; } }
        @keyframes plkNode { 0%,100% { opacity: 0.5; transform: scale(1); } 50% { opacity: 1; transform: scale(1.18); } }
        @media (prefers-reduced-motion: reduce) {
          .bridge-loader-svg .plk-wire { animation: none !important; stroke-dashoffset: 0 !important; }
          .bridge-loader-svg .plk-node { animation: none !important; opacity: 0.9 !important; }
        }
      `}</style>
    </div>
  );
}

/**
 * Full-page loading screen — used by loading.tsx files.
 * Renders the unified continuous-flow mark over a neutral background.
 */
export function BridgePageLoader({
  label = "Loading…",
  sub,
}: {
  label?: string;
  sub?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        background: "#F6F7FA",
      }}
    >
      <BridgeLoader size={88} fullScreen={false} label={label} sub={sub} />
    </div>
  );
}
