"use client";

// GhostWire — a single AI-suggested mapping rendered as a dashed, faint bezier with a
// confidence ring and ✓/✗ accept-reject controls (Task 8). It is the visual promise of a
// wire the engine HASN'T committed: accept (✓) promotes it to a real connection via the
// model's onSourceConnect/onTargetConnect; reject (✗) dismisses it locally (and the model
// records the decision so the V9 calibration loop sees it).
//
// Drawn INSIDE MapperWireLayer's SVG (same coordinate space as the real wires), so this is
// an <g> of SVG primitives — never a DOM element. Endpoints (hx,hy)→(zx,zy) are resolved by
// the engine from the suggestion's source/target anchors; this component only paints + wires
// the two hit controls. Coloring follows the plan's ghost thresholds (.85/.60 on the raw
// 0..1 confidence) via ghostWireModel so a low-confidence suggestion reads visibly riskier.

import type { MappingSuggestion } from "@/lib/api/types";
import {
  ghostConfidenceTier,
  ghostTierColor,
  ghostTierTextColor,
  ghostConfidencePercent,
} from "./ghostWireModel";

const VIOLET = "#6F4FCE"; // the AI accent (matches the source→canonical wire + AiSuggestion card)
const GREEN = "#2E8E3A";
// The ✓ glyph's own green. #2E8E3A on the white accept disc is 4.1613:1, under
// the 4.5:1 floor for this 8.5px mark; #1E6D29 is 6.4128:1. GREEN above stays
// on the disc's STROKE, which is non-text.
const GREEN_TEXT = "#1E6D29";
const DANGER = "#C0392B";

export interface GhostWireProps {
  suggestion: MappingSuggestion;
  /** Source anchor (a token chip right-edge or a canonical dot centre). */
  hx: number;
  hy: number;
  /** Target anchor (a canonical dot centre or an output zone). */
  zx: number;
  zy: number;
  onAccept: (s: MappingSuggestion) => void;
  onReject: (s: MappingSuggestion) => void;
}

/** A cubic bezier with a clamped horizontal control offset (mirrors wireMath.bezier). */
function ghostPath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = x2 - x1;
  const off = Math.sign(dx || 1) * Math.max(24, Math.min(Math.abs(dx) * 0.5, 80));
  return `M ${x1} ${y1} C ${x1 + off} ${y1} ${x2 - off} ${y2} ${x2} ${y2}`;
}

export function GhostWire({ suggestion: s, hx, hy, zx, zy, onAccept, onReject }: GhostWireProps) {
  const tier = ghostConfidenceTier(s.confidence);
  const tierColor = ghostTierColor(tier);
  // Same tier, two floors: the wire/ring STROKE is non-text (3:1) so it keeps
  // ghostTierColor; the numeral below is a glyph (4.5:1) and needs the sibling.
  const tierTextColor = ghostTierTextColor(tier);
  const pct = ghostConfidencePercent(s.confidence);
  // The ring sits at the midpoint of the wire so it doesn't collide with the accept/reject
  // controls clustered at the target end.
  const mx = (hx + zx) / 2;
  const my = (hy + zy) / 2;
  const reasonLabel = `${s.reason} (AI ${pct}% confidence)`;

  return (
    <g style={{ opacity: 0.95 }} data-ghost-wire={`${s.targetKey}<-${s.sourceId}`}>
      {/* Faint dashed wire, tinted by confidence tier. */}
      <path
        d={ghostPath(hx, hy, zx, zy)}
        fill="none"
        stroke={tierColor}
        strokeWidth={1.8}
        strokeDasharray="4 4"
        style={{ pointerEvents: "none", opacity: 0.5 }}
      />
      <circle cx={hx} cy={hy} r={2.4} fill={VIOLET} style={{ pointerEvents: "none" }} opacity={0.7} />

      {/* Confidence ring at the wire midpoint — a thin tier-colored ring with the % inside. */}
      <g style={{ pointerEvents: "none" }}>
        <circle cx={mx} cy={my} r={9} fill="#FFFFFF" stroke={tierColor} strokeWidth={1.4} opacity={0.95} />
        <text
          x={mx}
          y={my + 2.6}
          textAnchor="middle"
          fontSize={7}
          fontWeight={800}
          // An SVG <text> fill IS a text colour, and 7px/800 is normal size (the
          // 3:1 large-text floor needs ≥18.66px bold). On the ring's #FFFFFF the
          // stroke values were 4.1613:1 (ok) / 4.1061:1 (warn); the text
          // siblings are 6.4128:1 / 6.3150:1. Danger was already 5.8932:1.
          fill={tierTextColor}
          style={{ userSelect: "none", fontFamily: "'JetBrains Mono',monospace" }}
        >
          {pct}
        </text>
      </g>

      {/* Accept ✓ — promotes the ghost to a real wire. */}
      <g
        role="button"
        tabIndex={0}
        aria-label={`Accept AI suggestion: ${reasonLabel}`}
        style={{ pointerEvents: "auto", cursor: "pointer" }}
        onClick={() => onAccept(s)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onAccept(s); } }}
      >
        <circle cx={zx - 9} cy={zy - 9} r={6.5} fill="#FFFFFF" stroke={GREEN} strokeWidth={1.3} />
        {/* GREEN_TEXT, not GREEN: #2E8E3A on #FFFFFF is 4.1613:1, #1E6D29 is 6.4128:1. */}
        <text x={zx - 9} y={zy - 6} textAnchor="middle" fontSize={8.5} fontWeight={800} fill={GREEN_TEXT} style={{ pointerEvents: "none", userSelect: "none" }}>✓</text>
      </g>

      {/* Reject ✕ — dismisses the suggestion. */}
      <g
        role="button"
        tabIndex={0}
        aria-label={`Dismiss AI suggestion: ${reasonLabel}`}
        style={{ pointerEvents: "auto", cursor: "pointer" }}
        onClick={() => onReject(s)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onReject(s); } }}
      >
        <circle cx={zx + 9} cy={zy - 9} r={6.5} fill="#FFFFFF" stroke={DANGER} strokeWidth={1.3} />
        <text x={zx + 9} y={zy - 6} textAnchor="middle" fontSize={8.5} fontWeight={800} fill={DANGER} style={{ pointerEvents: "none", userSelect: "none" }}>✕</text>
      </g>
    </g>
  );
}
