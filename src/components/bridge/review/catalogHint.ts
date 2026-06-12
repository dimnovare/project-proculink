// catalogHint — pure show/hide predicate for the review screen's catalog hint
// card (CatalogHintCard). No React, no fetching — unit-tested in
// catalogHint.test.ts.
//
// The hint teaches the catalog cliff exactly when it bites: the order has
// unresolved lines, NOTHING resolved automatically (no item mapping matched),
// and the supplier's catalog is KNOWN to be empty (per-supplier probe — not
// the org-level flag, so the hint re-teaches on supplier #2 and #5).
//
// Honesty rule: `catalogState` must be "known-empty" — while the catalog query
// is loading or errored the card renders nothing (never a hint built on an
// unknown), and once the catalog has rows the hint self-resolves.

export type CatalogProbeState = "unknown" | "known-empty" | "has-rows";

export function shouldShowCatalogHint(args: {
  /** The order still has lines needing a supplier code (server truth). */
  hasUnresolvedLines: boolean;
  /** At least one line already carries a supplier code (mapping/manual/AI-accepted). */
  anyLineResolved: boolean;
  /** Result of the per-supplier catalog probe. */
  catalogState: CatalogProbeState;
}): boolean {
  return (
    args.hasUnresolvedLines &&
    !args.anyLineResolved &&
    args.catalogState === "known-empty"
  );
}
