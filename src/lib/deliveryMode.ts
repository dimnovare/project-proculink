/**
 * deliveryMode.ts — the one name for the per-supplier automatic-sending switch.
 *
 * The switch is `SupplierDeliveryConfig.autoDeliver`. On, an order whose output has been
 * prepared goes straight to the supplier; off (the default), it waits until someone sends it.
 *
 * Until 2026-11 the same switch was printed under four names: "Auto-process" (the suppliers
 * list), "Auto-deliver" (the Delivery tab and the guided setup), "Send automatically" (the
 * supplier Overview summary) and "auto-send" (the supplier Changes summaries). A user who
 * turned on one could not tell it was the others. Every surface now reads these constants, and
 * `deliveryMode.test.ts` fails if any of the four retired names comes back in shipped copy.
 *
 * Code identifiers (`autoDeliver`, `AutoProcessPill`, …) are deliberately unchanged.
 */

/** A flow's check mode: which documents wait for a person. Mirrors `FlowAutomation` (backend). */
export type CheckMode = "marked" | "review" | "auto";

/** The three check modes, in the order they are offered. */
export const CHECK_MODES: readonly { id: CheckMode; title: string; short: string }[] = [
  { id: "marked", title: "Check only what we marked", short: "Only what we marked" },
  { id: "review", title: "Check every document", short: "Every document" },
  { id: "auto", title: "Check nothing", short: "Nothing" },
];

/** The switch on — orders go to the supplier without a further click once prepared. */
export const AUTOMATIC_DELIVERY_LABEL = "Automatic delivery";

/** The switch off, and the default for every new supplier — each order waits to be sent. */
export const REVIEW_BEFORE_DELIVERY_LABEL = "Review before delivery";

/** Header for a column or summary row whose value is one of the two labels above. */
export const DELIVERY_MODE_HEADING = "Delivery mode";

/** The label for a saved `autoDeliver` value. */
export function deliveryModeLabel(autoDeliver: boolean): string {
  return autoDeliver ? AUTOMATIC_DELIVERY_LABEL : REVIEW_BEFORE_DELIVERY_LABEL;
}

/**
 * The names this switch used to ship under. Exported for the guard test only — nothing may
 * render them.
 */
export const RETIRED_DELIVERY_MODE_NAMES = [
  "Auto-process",
  "Auto-deliver",
  "Send automatically",
  "auto-send",
] as const;
