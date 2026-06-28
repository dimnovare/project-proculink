// Pure helpers for AI ghost wires (Task 8). No React, no network — unit-tested in
// ghostWireModel.test.ts. The ghost wire is the dashed, faint bezier the user accepts
// (✓ promotes it to a real wire) or rejects (✗ dismisses it). Its coloring follows the
// plan's explicit ghost-wire thresholds (conf≥85 green / ≥60 amber / else red), which
// run on a 0..1 confidence — the SAME tiering language as ds-tokens.confidenceTier but
// applied to the suggestion's raw 0..1 score so a low-confidence suggestion reads "risky".

import type { MappingSuggestion } from "@/lib/api/types";

export type GhostTier = "ok" | "warn" | "danger";

/** The ghost wire's confidence tier from a 0..1 score (plan thresholds: .85 / .60). */
export function ghostConfidenceTier(confidence: number): GhostTier {
  if (confidence >= 0.85) return "ok";
  if (confidence >= 0.6) return "warn";
  return "danger";
}

/** Stroke color per tier (locked tokens: brand green / amber / danger). */
export function ghostTierColor(tier: GhostTier): string {
  return tier === "ok" ? "#2E8E3A" : tier === "warn" ? "#B36D14" : "#C0392B";
}

/** Round a 0..1 confidence to a whole-percent for the ring label. */
export function ghostConfidencePercent(confidence: number): number {
  return Math.round(Math.max(0, Math.min(1, confidence)) * 100);
}

/** Stable key for a suggestion (matches useMapperModel's dismissal key). */
export function suggestionKey(s: Pick<MappingSuggestion, "targetKey" | "sourceId">): string {
  return `${s.targetKey}<-${s.sourceId}`;
}
