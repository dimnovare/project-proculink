"use client";

/**
 * BridgeLoader — the canonical loading state for ProcuLink.
 * The mark completes its link arc via stroke-dashoffset animation.
 * "Never a generic spinner." — §7 identity system.
 *
 * Used by all loading.tsx files and any suspense fallback.
 */

import { type CSSProperties } from "react";

interface BridgeLoaderProps {
  /** Optional label below the mark */
  label?: string;
  /** Size of the mark in px (default 48) */
  size?: number;
  /** Full-screen centering (default true) */
  fullScreen?: boolean;
}

export function BridgeLoader({
  label,
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
        gap: 8,
      };

  // The mark path length for a 40×40 viewBox:
  // "M8 10h14a10 10 0 0 1 10 10v0a10 10 0 0 1-10 10H8"
  // Measured ≈ 88.5. We use 90 as dasharray.
  const DASH = 90;

  return (
    <div style={wrapStyle}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 40 40"
        fill="none"
        aria-label="Loading…"
        role="status"
      >
        <defs>
          <linearGradient id="bl-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%"   stopColor="#1E66C9" />
            <stop offset="100%" stopColor="#2E8E3A" />
          </linearGradient>
        </defs>

        {/* The arc — draws itself left-to-right */}
        <path
          d="M8 10h14a10 10 0 0 1 10 10v0a10 10 0 0 1-10 10H8"
          stroke="url(#bl-grad)"
          strokeWidth="3.6"
          strokeLinecap="round"
          fill="none"
          strokeDasharray={DASH}
          strokeDashoffset={DASH}
          style={{
            animation: `bridge-draw 1.1s cubic-bezier(0.16,1,0.3,1) infinite`,
          }}
        />

        {/* Buyer endpoint — fades in with the start of the arc */}
        <circle
          cx="8"
          cy="10"
          r="2.5"
          fill="#1E66C9"
          style={{
            animation: `bridge-dot-a 1.1s cubic-bezier(0.16,1,0.3,1) infinite`,
          }}
        />

        {/* Supplier endpoint — fades in as arc completes */}
        <circle
          cx="8"
          cy="30"
          r="2.5"
          fill="#2E8E3A"
          style={{
            animation: `bridge-dot-b 1.1s cubic-bezier(0.16,1,0.3,1) infinite`,
          }}
        />
      </svg>

      {label && (
        <span style={{ fontSize: 12.5, color: "#8A93A5", letterSpacing: "0.01em" }}>
          {label}
        </span>
      )}

      {/* Keyframes injected inline — avoids CSS module dependency */}
      <style>{`
        @keyframes bridge-draw {
          0%   { stroke-dashoffset: ${DASH}; opacity: 0.3; }
          20%  { opacity: 1; }
          70%  { stroke-dashoffset: 0; opacity: 1; }
          100% { stroke-dashoffset: 0; opacity: 0; }
        }
        @keyframes bridge-dot-a {
          0%, 10% { opacity: 0; }
          25%     { opacity: 1; }
          80%     { opacity: 1; }
          100%    { opacity: 0; }
        }
        @keyframes bridge-dot-b {
          0%, 60%  { opacity: 0; }
          80%      { opacity: 1; }
          100%     { opacity: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .bridge-loader-svg * { animation: none !important; stroke-dashoffset: 0 !important; opacity: 1 !important; }
        }
      `}</style>
    </div>
  );
}

/**
 * Full-page loading screen — used by loading.tsx files.
 * Shows the mark completing its link over a neutral background.
 */
export function BridgePageLoader({ label = "Loading…" }: { label?: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        gap: 20,
        background: "#F6F7FA",
      }}
    >
      <BridgeLoader size={56} fullScreen={false} />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
        <span
          style={{
            fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
            fontSize: 15,
            fontWeight: 600,
            color: "#0B1A2F",
          }}
        >
          {label}
        </span>
        <span style={{ fontSize: 12, color: "#8A93A5" }}>
          Loading…
        </span>
      </div>
    </div>
  );
}
