/**
 * ProcuLink design tokens — typed TS helpers.
 *
 * Import in any TS file:
 *   import { confidenceTier } from "@/lib/ds-tokens";
 *
 * Source of truth for the raw palette/spacing/etc. is `tailwind.config.ts`
 * (Bridge Layer system). This module exposes only the typed helpers that
 * components consume directly.
 */

/**
 * Confidence threshold helper — used by ConfidenceChip, anatomy zones,
 * spine-node field backgrounds, etc.
 */
export function confidenceTier(pct: number): "ok" | "warn" | "danger" {
  if (pct >= 90) return "ok";
  if (pct >= 75) return "warn";
  return "danger";
}
