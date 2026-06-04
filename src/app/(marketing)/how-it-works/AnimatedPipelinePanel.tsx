"use client";

/**
 * AnimatedPipelinePanel
 * ---------------------
 * Client component — the only interactive part of the how-it-works page.
 * Everything else in page.tsx stays Server-rendered.
 *
 * Animation mechanism:
 *   • A React state integer `active` (0–N) advances on a 900ms interval,
 *     cycling through the six pipeline stages, then restarting.
 *   • Progress bar: CSS `transform: scaleX(fraction)` with a 700ms ease-out
 *     transition — matches the design reference exactly.
 *   • Active node: size/shadow/color change via inline style; the pulse ring
 *     uses a CSS @keyframes injected once into the document as a <style> tag.
 *   • prefers-reduced-motion: tokens.css globally sets animation-duration 1ms
 *     which effectively freezes both the transition and the keyframe ring,
 *     leaving the panel readable but motionless. No extra guard needed here.
 */

import { useEffect, useState } from "react";

// ── Design tokens (match tokens.css + page.tsx palette) ───────────────────────

const NAVY = "#0B1A2F";
const BLUE_NODE = "#2D7AE0";
const RAIL = "#163052"; // inactive dot background
const RAIL_BORDER = "#21385a"; // inactive dot border
const GREEN_TEXT = "#28C55E";
const BLUE_TEXT = "#1E66C9";

// Per-stage gradient stops — buyer-blue early → supplier-green at Deliver
// Matches design: "blue-blue early → mid → supplier-green at Deliver"
const STAGE_NODE_COLORS = [
  "#2D7AE0", // 0 Receive  — buyer-blue
  "#2D7AE0", // 1 Parse    — buyer-blue
  "#3f7fb8", // 2 Normalize — mid
  "#3f7fb8", // 3 Validate  — mid
  "#3f7fb8", // 4 Transform — mid
  "#3FA84C", // 5 Deliver   — supplier-green
];

const PIPELINE = ["Receive", "Parse", "Normalize", "Validate", "Transform", "Deliver"];

// ── CSS for the pulse ring (static, injected once) ────────────────────────────

const PULSE_CSS = `
@keyframes hiw-node-pulse {
  0%   { box-shadow: 0 0 0 0   rgba(63,127,184,0.55); }
  70%  { box-shadow: 0 0 0 8px rgba(63,127,184,0); }
  100% { box-shadow: 0 0 0 0   rgba(63,127,184,0); }
}
.hiw-node-pulse {
  animation: hiw-node-pulse 1.4s ease-out infinite;
}

/* Rail fill — horizontal (desktop default) */
.hiw-rail-fill {
  position: absolute;
  top: 7px;
  left: 8.3333%;
  right: 8.3333%;
  height: 2px;
  transform-origin: left center;
}

/* On mobile the rail goes vertical; hide the fill overlay —
   the animated node dots convey progress clearly enough. */
@media (max-width: 640px) {
  .hiw-rail-fill { display: none; }
}
`;

// ── Component ─────────────────────────────────────────────────────────────────

interface AnimatedPipelinePanelProps {
  /** ChipTag / MonoLabel / Arrow / DataCell props, forwarded from page.tsx */
  children?: React.ReactNode;
}

export default function AnimatedPipelinePanel(_props: AnimatedPipelinePanelProps) {
  const [active, setActive] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setActive((a) => (a + 1) % (PIPELINE.length + 1));
    }, 900);
    return () => clearInterval(id);
  }, []);

  // progress fraction: 0 → 1 across stages; when active === PIPELINE.length
  // (one past the end) the bar briefly shows full before the reset resets to 0
  const fraction = active / PIPELINE.length;

  return (
    <>
      {/* Inject keyframe once */}
      <style>{PULSE_CSS}</style>

      {/* ── Input → output badges ─────────────────────────────────────────── */}
      <div className="hiw-io" style={{ marginBottom: 26 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 9 }}>
          <ChipTag fg="#BC3F3F" bg="#FBEEEE">PDF</ChipTag>
          <Arrow />
          <MonoLabel style={{ color: BLUE_TEXT, fontWeight: 600 }}>buyer order</MonoLabel>
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 9 }}>
          <MonoLabel style={{ color: GREEN_TEXT, fontWeight: 600 }}>supplier output</MonoLabel>
          <Arrow />
          <ChipTag fg="#6F4FCE" bg="#EEE7FB">CXML</ChipTag>
        </span>
      </div>

      {/* ── Stage rail ────────────────────────────────────────────────────── */}
      <div className="hiw-rail" style={{ position: "relative", marginBottom: 28 }}>

        {/* Track line (inactive) */}
        <div
          className="hiw-rail-line"
          style={{ position: "absolute", background: RAIL }}
        />

        {/* Progress fill — animates left→right (desktop) or top→bottom (mobile) */}
        <div
          className="hiw-rail-fill"
          style={{
            background: "linear-gradient(90deg, #1E66C9 0%, #1E66C9 35%, #2E8E3A 65%, #2E8E3A 100%)",
            backgroundSize: "200% 100%",
            // scaleX on desktop; CSS media query switches transform-origin to "top center"
            // so scaleX will appear as scaleY on vertical mobile rail (same fraction, different axis)
            transform: `scaleX(${fraction})`,
            transition: "transform 700ms cubic-bezier(0.16,1,0.3,1)",
          }}
        />

        {PIPELINE.map((label, i) => {
          const done = i < active;
          const cur = i === active;
          const nodeColor = done || cur ? STAGE_NODE_COLORS[i] : NAVY;
          const nodeBorder = done || cur ? STAGE_NODE_COLORS[i] : RAIL_BORDER;

          return (
            <div key={label} className="hiw-node" style={{ position: "relative" }}>
              <span
                className={cur ? "hiw-node-pulse" : undefined}
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: "50%",
                  background: nodeColor,
                  border: `2px solid ${nodeBorder}`,
                  display: "inline-block",
                  zIndex: 1,
                  // The active node grows via transform (not width/height) so its
                  // layout box stays 14px — the column no longer reflows and the
                  // page stops jumping as the active dot cycles.
                  transform: cur ? "scale(1.3)" : "scale(1)",
                  transformOrigin: "center center",
                  transition: "transform 300ms ease, background 300ms ease, border-color 300ms ease",
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  fontSize: 12.5,
                  fontWeight: cur ? 700 : done ? 600 : 500,
                  color: cur ? "#FFFFFF" : done ? "#C5D2E4" : "#7E8DA3",
                  fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
                  transition: "color 300ms ease",
                }}
              >
                {label}
              </span>
            </div>
          );
        })}
      </div>

      {/* ── Data cells — fade in as stages complete ────────────────────────── */}
      <div className="hiw-cells">
        <DataCell
          label="PO Number"
          value="PO-2026-008412"
          valueColor="#5B9BE8"
          visible={active > 1}
        />
        <DataCell
          label="Grand Total"
          value="€71,240.00"
          visible={active > 2}
        />
        <DataCell
          label="Ship To"
          value="Dortmund, DE"
          valueColor="#43C06B"
          visible={active > 3}
        />
      </div>
    </>
  );
}

// ── Small helpers (inlined so this component is self-contained) ───────────────

function ChipTag({
  children,
  fg,
  bg,
}: {
  children: React.ReactNode;
  fg: string;
  bg: string;
}) {
  return (
    <span
      style={{
        fontFamily: "'JetBrains Mono', ui-monospace, monospace",
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.04em",
        color: fg,
        background: bg,
        padding: "3px 8px",
        borderRadius: 6,
        boxShadow: "0 1px 0 rgba(0,0,0,0.04)",
      }}
    >
      {children}
    </span>
  );
}

function MonoLabel({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <span
      style={{
        fontFamily: "'JetBrains Mono', ui-monospace, monospace",
        fontSize: 12.5,
        color: "#9FB0C7",
        ...style,
      }}
    >
      {children}
    </span>
  );
}

function DataCell({
  label,
  value,
  valueColor,
  visible = true,
}: {
  label: string;
  value: string;
  valueColor?: string;
  visible?: boolean;
}) {
  return (
    <div
      style={{
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(255,255,255,0.02)",
        borderRadius: 10,
        padding: "14px 16px",
        opacity: visible ? 1 : 0.3,
        transition: "opacity 400ms ease",
      }}
    >
      <div
        style={{
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "#6C7C93",
          marginBottom: 7,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
          fontSize: 14,
          fontWeight: 600,
          color: valueColor ?? "#CBD6E6",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function Arrow() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#6880A0"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}
