// Pure helpers for AI ghost wires (Task 8). No React, no network — unit-tested in
// ghostWireModel.test.ts. The ghost wire is the dashed, faint bezier the user accepts
// (✓ promotes it to a real wire) or rejects (✗ dismisses it). Its coloring follows the
// plan's explicit ghost-wire thresholds (conf≥85 green / ≥60 amber / else red).
//
// This IS a second threshold ladder alongside ds-tokens.confidenceTier, and the
// 0..1 input is not what makes it separate (ConfidenceChip normalises 0..1
// itself). What makes it separate is the QUESTION: how risky is an unaccepted
// suggestion, versus how confident is an extracted field. The 0.85/0.60 numbers
// are a deliberate plan requirement and are pinned by ghostWireModel.test.ts —
// folding them into confidenceTier would change tested behaviour to satisfy no
// stated need. See src/components/bridge/ConfidenceChip.tsx for the full note.

import type { MappingSuggestion } from "@/lib/api/types";

export type GhostTier = "ok" | "warn" | "danger";

/** The ghost wire's confidence tier from a 0..1 score (plan thresholds: .85 / .60). */
export function ghostConfidenceTier(confidence: number): GhostTier {
  if (confidence >= 0.85) return "ok";
  if (confidence >= 0.6) return "warn";
  return "danger";
}

/**
 * Stroke color per tier. NON-TEXT (a dashed bezier), so the floor is 3:1.
 *
 * The danger value was #C0392B — a fifth red that exists nowhere in globals.css.
 * It is now --danger (#B43838), so this map holds three real tokens rather than
 * two tokens and an orphan. Green and amber are the non-text members of their
 * families, which is correct for a stroke (--amber is explicitly documented as
 * the dot/border/stroke amber; --amber-text is the text one).
 */
export function ghostTierColor(tier: GhostTier): string {
  return tier === "ok" ? "#2E8E3A" : tier === "warn" ? "#B36D14" : "#B43838";
}

/** Round a 0..1 confidence to a whole-percent for the ring label. */
export function ghostConfidencePercent(confidence: number): number {
  return Math.round(Math.max(0, Math.min(1, confidence)) * 100);
}

/** Stable key for a suggestion (matches useMapperModel's dismissal key). */
export function suggestionKey(s: Pick<MappingSuggestion, "targetKey" | "sourceId">): string {
  return `${s.targetKey}<-${s.sourceId}`;
}
