// Pure helpers for the field badges (Task 9). No React, no network — unit-tested in
// fieldBadgesModel.test.ts. These turn the Phase-2 validation + catalog-hint arrays into
// per-field lookups and format the catalog-price inline action's label, and answer the one
// question the Deliver button cares about: "are there any BLOCKING review badges?".

import type { FieldValidationState, CatalogPriceHint } from "@/lib/api/types";

/** Index validation states by their field key/path for O(1) per-row lookup. */
export function indexValidation(states: FieldValidationState[]): Map<string, FieldValidationState> {
  const m = new Map<string, FieldValidationState>();
  for (const s of states) m.set(s.key, s);
  return m;
}

/** Index catalog hints by their line key for O(1) per-row lookup. */
export function indexCatalogHints(hints: CatalogPriceHint[]): Map<string, CatalogPriceHint> {
  const m = new Map<string, CatalogPriceHint>();
  for (const h of hints) m.set(h.lineKey, h);
  return m;
}

/** True when at least one validation state is a BLOCKING review (gates Deliver). */
export function hasBlockingReview(states: FieldValidationState[]): boolean {
  return states.some((s) => s.state === "review" && s.blocking === true);
}

/** Count of blocking review badges (for the action-bar "N blockers" copy). */
export function blockingReviewCount(states: FieldValidationState[]): number {
  return states.reduce((n, s) => n + (s.state === "review" && s.blocking ? 1 : 0), 0);
}

/** Format a currency amount for a badge label (no trailing .00 on whole numbers). */
export function formatMoney(amount: number | null | undefined, currency?: string | null): string {
  if (amount == null || Number.isNaN(amount)) return "—";
  const sym = currency === "EUR" ? "€" : currency === "USD" ? "$" : currency === "GBP" ? "£" : "";
  const body = Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
  return sym ? `${sym}${body}` : `${body}${currency ? ` ${currency}` : ""}`;
}

/** Signed percent string for the variance, e.g. "+12%" / "-3%" / "" when unknown. */
export function formatVariance(variancePercent: number | null | undefined): string {
  if (variancePercent == null || Number.isNaN(variancePercent)) return "";
  const rounded = Math.round(variancePercent);
  return `${rounded >= 0 ? "+" : ""}${rounded}%`;
}

/**
 * Build the catalog-price action label: "Use catalog €X (PO €Y, +Z%)". Returns null when
 * there's no actionable catalog price (nothing to suggest), so the action hides cleanly.
 */
export function catalogActionLabel(hint: CatalogPriceHint | undefined | null): string | null {
  if (!hint || hint.catalogPrice == null) return null;
  const cat = formatMoney(hint.catalogPrice, hint.currency);
  const po = hint.poPrice != null ? formatMoney(hint.poPrice, hint.currency) : null;
  const variance = formatVariance(hint.variancePercent);
  const tail = [po ? `PO ${po}` : null, variance || null].filter(Boolean).join(", ");
  return tail ? `Use catalog ${cat} (${tail})` : `Use catalog ${cat}`;
}
