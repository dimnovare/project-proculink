// orderCountContract — the order population a screen may print. The dashboard/inbox count
// table that shared this file went with the order screens (2026-11-13).

import type { OrdersPage } from "@/types/procurement";

// ─── Practice orders: shown in every list, counted by nothing ─────────────────
//
// THE SECOND WAY TWO NUMBERS DISAGREE. Everything above this line is about one label
// being derived twice. This is about two labels derived over two different POPULATIONS,
// and it put a "0" on the dashboard next to a card reading "1 orders received" and a
// table listing that order (v2 audit P0-5).
//
// The split is real and deliberate on the backend (dimnovare/ProcuLink#173):
//
//   GET /api/orders/summary   .Where(o => o.OrgId == orgId && !o.IsSample)   real only
//   GET /api/orders           .Where(o => o.OrgId == organisationId)         + practice
//
// and the summary side is the one that is RIGHT — it is the population Stripe invoices
// (cumulative for Pilot, per calendar month for paid, and again for the overage billed on
// invoice.created) and the population every plan gate enforces. A count that included
// practice orders would overstate usage against what the customer is actually charged.
//
// The list is right to keep RETURNING them: a first-run user is routed to a practice order
// to rehearse review, and `OnboardingStatus.sampleOrderId` exists to route them back.
// Filtering the row out would strand work the product told them to do.
//
// So the answer is a LABEL, NOT A FILTER — the same conclusion #173 reached on the API
// side. Counts print the metered population; lists show every row; and wherever the two
// sit together the surface prints `practiceOrderNote` so the difference is stated instead
// of being left for the reader to notice. `practiceOrderCountParity.test.tsx` renders both
// screens for an org whose only order is a practice one and reconciles what is printed
// against the rows printed beside it.

/** What a screen may print, split into the two populations that are not interchangeable. */
export interface OrderPopulation {
  /** Real orders. THE number — billing meters it, plan gates enforce it, counts print it. */
  metered: number;
  /** Practice orders. Rendered in lists, excluded from `metered`, never hidden. */
  practice: number;
  /** Every row, practice included. Pagination arithmetic ONLY — never a printed count. */
  rows: number;
}

/**
 * The population behind `GET /api/orders`.
 *
 * `sampleCount` absent (an API older than #173) collapses this to `totalCount`, so the
 * screen behaves exactly as it did rather than under-reporting a practice split it was
 * never told about. `Math.min` keeps `metered` from going negative if the two ever
 * disagree — a negative order count is a worse lie than a slightly high one.
 */
export function pagePopulation(page: Pick<OrdersPage, "totalCount" | "sampleCount"> | undefined): OrderPopulation {
  const rows = page?.totalCount ?? 0;
  const practice = Math.min(Math.max(page?.sampleCount ?? 0, 0), rows);
  return { metered: rows - practice, practice, rows };
}
