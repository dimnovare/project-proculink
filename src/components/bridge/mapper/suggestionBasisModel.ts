// What a mapping suggestion's confidence is ALLOWED to say it is. Pure, no React —
// unit-tested in suggestionBasisModel.test.ts.
//
// THE DEFECT THIS EXISTS TO KILL: `GET /api/orders/{id}/mapping-suggestions` used to
// send a hard-coded `confidence: 0.95` for every entry read back from a supplier's SAVED
// PO mapping. No model produced that number — the suggester is deliberately never invoked
// on that path — and the mapper rendered it as "AI confidence 95%". A configured fact was
// being displayed as a probability, and a high one.
//
// The backend now sends `confidence: null` with `basis: "saved_mapping"` for that path, and
// a real 0..1 score with `basis: "model"` when a scorer actually ran. Deployed-but-older
// responses omit `basis` entirely, so this module owns the rollout rule in ONE place rather
// than letting five call sites each guess:
//
//   • basis present  → believe it, in both directions.
//   • basis absent   → "model" ONLY when confidence is a finite number; otherwise
//                      "saved_mapping". A null confidence never becomes a number.
//
// Note the ordering in `suggestionConfidenceDisplay`: basis is checked BEFORE the number.
// A stale backend that sends `basis: "saved_mapping"` alongside a leftover 0.95 must still
// render "Saved mapping", never "95%" — that pairing is exactly the defect, so the number
// is the thing we distrust.

/** Where a suggestion came from. Mirrors `MappingSuggestion["basis"]`. */
export type SuggestionBasis = "saved_mapping" | "model";

/**
 * How a suggestion's confidence may be rendered.
 *  • "score"         — a scorer ran; show the percentage.
 *  • "saved_mapping" — read back from the supplier's saved mapping; show a neutral marker.
 *  • "none"          — claims a model but carries no number. Nothing honest to show, so
 *                      show nothing rather than invent either a percentage or a provenance.
 */
export type SuggestionConfidenceDisplay = "score" | "saved_mapping" | "none";

function isScore(confidence: number | null | undefined): confidence is number {
  return typeof confidence === "number" && Number.isFinite(confidence);
}

/** The rollout rule: an absent `basis` is "model" only when a real number came with it. */
export function resolveSuggestionBasis(
  basis: SuggestionBasis | null | undefined,
  confidence: number | null | undefined,
): SuggestionBasis {
  if (basis === "saved_mapping" || basis === "model") return basis;
  return isScore(confidence) ? "model" : "saved_mapping";
}

/** What a confidence surface is allowed to render for this suggestion. */
export function suggestionConfidenceDisplay(
  basis: SuggestionBasis | null | undefined,
  confidence: number | null | undefined,
): SuggestionConfidenceDisplay {
  if (resolveSuggestionBasis(basis, confidence) === "saved_mapping") return "saved_mapping";
  return isScore(confidence) ? "score" : "none";
}

/** User-facing marker for a suggestion that came from the supplier's saved mapping. */
export const SAVED_MAPPING_LABEL = "Saved mapping";

/** Tooltip for that marker — says where it came from without claiming a score. */
export const SAVED_MAPPING_TITLE = "Read back from this supplier's saved mapping — not scored";
