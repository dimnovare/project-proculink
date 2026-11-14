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
 *   • prefers-reduced-motion: globals.css sets animation-duration 1ms globally,
 *     which freezes the CSS transition and the keyframe ring — but it does NOT
 *     stop the 900ms setInterval, and that interval is what drives the visible
 *     motion here (each tick rewrites node size / shadow / colour as INLINE
 *     styles, and moves the progress bar). A CSS reset cannot reach a JS timer.
 *     The header comment used to claim "no extra guard needed here"; it was
 *     wrong about its own mechanism. The interval is now guarded, and under
 *     reduce the panel renders its COMPLETED state (every stage done) so the
 *     content it exists to show is still shown — just motionless.
 */

import { useEffect, useState } from "react";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { STAGES } from "@/components/bridge/StatusJourney";

// ── Design tokens (match tokens.css + page.tsx palette) ───────────────────────

const NAVY = "#0B1A2F";
const RAIL = "#163052"; // inactive dot background
const RAIL_BORDER = "#21385a"; // inactive dot border

// Per-stage gradient stops — buyer-blue early → supplier-green at Deliver
// Matches design: "blue-blue early → mid → supplier-green at Deliver"
const STAGE_NODE_COLORS = [
  "#2D7AE0", // 0 In        — buyer-blue
  "#2D7AE0", // 1 Read      — buyer-blue
  "#3f7fb8", // 2 Check     — mid
  "#3f7fb8", // 3 Transform — mid
  "#3FA84C", // 4 Send      — supplier-green
];

// The stage names the in-app status track shows — one source, not a retyped list.
const PIPELINE = STAGES;

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
  left: 10%;
  right: 10%;
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
  const reducedMotion = useReducedMotion();
  const [active, setActive] = useState(0);

  useEffect(() => {
    // No timer at all under reduce — the interval IS the motion.
    if (reducedMotion) return;
    const id = setInterval(() => {
      setActive((a) => (a + 1) % (PIPELINE.length + 1));
    }, 900);
    return () => clearInterval(id);
  }, [reducedMotion]);

  // progress fraction: 0 → 1 across stages; when active === PIPELINE.length
  // (one past the end) the bar briefly shows full before the reset resets to 0.
  // Under reduce the panel is pinned to the finished state.
  const stage = reducedMotion ? PIPELINE.length : active;
  const fraction = stage / PIPELINE.length;

  return (
    <>
      {/* Inject keyframe once */}
      <style>{PULSE_CSS}</style>

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
          const done = i < stage;
          const cur = i === stage;
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
    </>
  );
}
