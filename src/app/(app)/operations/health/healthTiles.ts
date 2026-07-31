import type { OpsHealth } from "@/lib/api-client";

export interface HealthTile {
  key: keyof OpsHealth;
  label: string;
  href: string;
  /** Rendered under the label when the link is an honest approximation. */
  helper?: string;
}

/**
 * The problem tiles on /operations/health.
 *
 * Lives beside the page rather than inside it: a Next.js `page.tsx` may not export
 * anything but the route's own members (the build fails on it), and the
 * link-integrity test needs the table itself. Same reasoning as opsHealthState.ts.
 *
 * EVERY href here is a promise the inbox now keeps (WP-24 / D3: InboxView derives
 * its filter from ?status=, so these links used to land on an unfiltered inbox).
 * Two rules the old table broke, both re-tested in healthDeepLinks.test.tsx:
 *
 *   1  A tile's link must be as narrow as its label. Four separate tiles pointed at
 *      ?status=failed, which the backend expands to the whole failure bucket — so
 *      "Out of retries: 5" opened a page of output failures and supplier rejections
 *      too. Each failure status now deep-links to itself.
 *   2  A tile must never link to a bare /inbox. "Stuck reading the file" and
 *      "Overdue" did, which is a filter link that filters nothing. `slaBreached`
 *      has no server-side age filter at all, so it sorts oldest-first and SAYS so
 *      in its helper line rather than pretending to filter.
 */
export const TILES: HealthTile[] = [
  { key: "parsingStuck",       label: "Stuck reading the file", href: "/inbox?status=parsing" },
  { key: "deliveringStuck",    label: "Stuck sending",     href: "/inbox?status=delivering" },
  // D6 — the one problem state whose fix is 100% self-serve was invisible here:
  // the API returns pendingRouting and this frontend's interface omitted the field.
  { key: "pendingRouting",     label: "Needs supplier",    href: "/inbox?status=unrouted" },
  { key: "failed",             label: "Couldn't read the file", href: "/inbox?status=failed" },
  { key: "transformFailed",    label: "Output failed",     href: "/inbox?status=transform_failed" },
  { key: "deliveryFailed",     label: "Delivery failed",   href: "/inbox?status=delivery_failed" },
  { key: "deliveryDeadLetter", label: "Out of retries",    href: "/inbox?status=delivery_dead_letter" },
  { key: "rejectedBySupplier", label: "Supplier refused it", href: "/inbox?status=rejected_by_supplier" },
  // Plain tile, not a bespoke card: unlike deliveryHeld (one global Settings→Billing
  // fix), a parked order's fix is per-order on the order screen — so it belongs in
  // the grid the operator already scans, routed like every other tile.
  { key: "deliveryUnconfirmed", label: "Delivery unknown", href: "/inbox?status=delivery_unconfirmed" },
  { key: "slaBreached",        label: "Overdue",           href: "/inbox?sort=oldest",
    helper: "Sorted oldest first — we can't filter by age yet." },
  { key: "openExceptions",     label: "Open issues",       href: "/operations/exceptions" },
];
