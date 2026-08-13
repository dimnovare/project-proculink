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
//
// NOT EVERY GHOST WIRE HAS A SCORE. A suggestion read back from the supplier's saved PO
// mapping is a configured fact that no model produced, and the endpoint used to dress it in a
// hard-coded `confidence: 0.95` — which this component painted as a confident green ring
// reading "95", labelled "Accept AI suggestion: … (AI 95% confidence)". Such a suggestion now
// arrives with `confidence: null`, and everything that would claim a score is withheld: no
// numeral, no tier colour, no violet AI accent, and controls that say "saved mapping
// suggestion". The scored path is unchanged. `suggestionBasisModel` owns the decision.

import type { MappingSuggestion } from "@/lib/api/types";
import {
  ghostConfidenceTier,
  ghostTierColor,
  ghostTierTextColor,
  ghostConfidencePercent,
} from "./ghostWireModel";
import { suggestionConfidenceDisplay } from "./suggestionBasisModel";

const VIOLET = "#6F4FCE"; // the AI accent (matches the source→canonical wire + AiSuggestion card)
// The neutral, non-tier stroke for a suggestion nothing scored: buyer/structural, and unlike
// green/amber/red it makes no claim about how good the pairing is. Spelled as the token rather
// than the hex the older constants above are frozen at — an SVG presentation attribute resolves
// `var()` like any CSS value, which several icons in this codebase already rely on.
const BLUE = "var(--brand-blue)";
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
  // A tier colour and a numeral are both claims about a SCORE. Neither may be painted for a
  // suggestion nothing scored — the endpoint used to send a hard-coded 0.95 for every entry of
  // a supplier's saved mapping, and this ring drew it as a confident green "95".
  const display = suggestionConfidenceDisplay(s.basis, s.confidence);
  const scored = display === "score" && s.confidence != null;
  const tier = scored ? ghostConfidenceTier(s.confidence as number) : null;
  // Unscored wires fall back to buyer-blue: a neutral structural tone that carries no tier
  // meaning, so nobody reads risk off a wire that was never assessed.
  const tierColor = tier ? ghostTierColor(tier) : BLUE;
  // Same tier, two floors: the wire/ring STROKE is non-text (3:1) so it keeps
  // ghostTierColor; the numeral below is a glyph (4.5:1) and needs the sibling.
  const tierTextColor = tier ? ghostTierTextColor(tier) : BLUE;
  const pct = scored ? ghostConfidencePercent(s.confidence as number) : null;
  // The ring sits at the midpoint of the wire so it doesn't collide with the accept/reject
  // controls clustered at the target end.
  const mx = (hx + zx) / 2;
  const my = (hy + zy) / 2;
  // What the accept/dismiss controls call this suggestion. Only the scored path may say "AI".
  const provenance =
    scored ? `AI ${pct}% confidence`
    : display === "saved_mapping" ? "saved supplier mapping"
    : "no confidence score";
  const reasonLabel = `${s.reason} (${provenance})`;
  const kind = display === "saved_mapping" ? "saved mapping suggestion" : scored ? "AI suggestion" : "suggestion";

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
      {/* Source anchor. Violet is the AI accent and is reserved for AI-generated content
          (CLAUDE.md §3), so a saved-mapping wire anchors in neutral buyer-blue instead. */}
      <circle cx={hx} cy={hy} r={2.4} fill={scored ? VIOLET : tierColor} style={{ pointerEvents: "none" }} opacity={0.7} />

      {/* Confidence ring at the wire midpoint — a thin tier-colored ring with the % inside.
          The ring itself is ALWAYS drawn, scored or not: it is the wire's visual midpoint and
          removing it would move the geometry. Only the numeral is withheld when nothing scored
          the suggestion — an empty ring reads as "no score", a fabricated number does not. */}
      <g style={{ pointerEvents: "none" }}>
        <circle cx={mx} cy={my} r={9} fill="#FFFFFF" stroke={tierColor} strokeWidth={1.4} opacity={0.95} />
        {pct != null && (
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
        )}
      </g>

      {/* Accept ✓ — promotes the ghost to a real wire. */}
      <g
        role="button"
        tabIndex={0}
        aria-label={`Accept ${kind}: ${reasonLabel}`}
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
        aria-label={`Dismiss ${kind}: ${reasonLabel}`}
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
