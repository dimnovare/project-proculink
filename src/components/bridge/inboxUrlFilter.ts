// inboxUrlFilter — the inbox's filter state, derived from the URL.
//
// WHY THIS EXISTS: InboxView held `statusFilter` and `activeChip` in useState and
// never read the query string. There is no `useSearchParams` anywhere in that
// file. So every `?status=` link in the product — nine tiles on
// /operations/health, the review-backlog card, the paused-delivery card, the
// sidebar's own Inbox sub-items — landed on a completely unfiltered inbox. An
// operator clicked "5 out of retries" and got all 300 orders in the account.
//
// The fix is DERIVATION, not "also reads on mount": two sources of truth for the
// same filter is how those links died. These helpers are pure so the contract can
// be tested without mounting a 1,800-line table, and so /operations/health can
// assert its own hrefs against the very set this module accepts.

import type { SortingState } from "@tanstack/react-table";
import type { OrderStatus } from "@/types/procurement";
import { chipIndexForStatus } from "./orderCountContract";

/**
 * Every status the inbox accepts as a `?status=` filter. Anything here is passed
 * straight to `GET /api/orders?status=`, which matches it exactly — except
 * `failed`, which the backend expands SERVER-side to its whole FailureBucket
 * (that expansion is deliberate: the red pill collapses the same five statuses,
 * so the count and the rows agree).
 */
export const INBOX_FILTERABLE_STATUSES: ReadonlySet<string> = new Set<OrderStatus>([
  "parsing",
  "unrouted",
  "pending_review",
  "ready",
  "ready_to_deliver",
  "transforming",
  "delivering",
  "delivered",
  "failed",
  "transform_failed",
  "delivery_failed",
  "delivery_dead_letter",
  "rejected_by_supplier",
  "delivery_unconfirmed",
  "delivery_held",
]);

export interface ResolvedInboxStatus {
  /** The value handed to the API, or undefined for "no filter". */
  status: OrderStatus | undefined;
  /**
   * False ONLY for a value we do not recognise. An unknown filter must never
   * silently fall through to "All orders": an inbox that quietly shows every
   * order reads as "you have no problems", which is the one lie this page
   * cannot afford. The caller says so instead.
   */
  known: boolean;
}

export function resolveInboxStatusParam(raw: string | null | undefined): ResolvedInboxStatus {
  if (raw === null || raw === undefined || raw === "") return { status: undefined, known: true };
  if (INBOX_FILTERABLE_STATUSES.has(raw)) return { status: raw as OrderStatus, known: true };
  return { status: undefined, known: false };
}

/**
 * Which filter chip a `?status=` value lights up. The chips are coarser than the
 * statuses (one "Failed" chip covers the five failure statuses), so a deep link
 * to `delivery_dead_letter` selects the Failed chip while the SERVER filter
 * stays exact — the chip is a label, not the filter.
 *
 * DERIVED, not hand-written. This was a `Record<string, number>` of literal indices,
 * and it carried exactly the bug that shape invites: `?status=ready` passed
 * INBOX_FILTERABLE_STATUSES, so the server filter ran and the view showed only `ready`
 * orders — while the map had no `ready` entry, so the toolbar lit "All orders" and told
 * the operator they were looking at everything. WP-29 then INSERTED a chip, which is
 * precisely when hard-coded indices go wrong for every status after it.
 *
 * chipIndexForStatus walks the chip order in orderCountContract.ts and asks the
 * contract which label owns the status. Adding or reordering a chip cannot mis-light
 * another one, and orderCountParity.test.tsx pins InboxView's FILTER_CHIPS against the
 * same list so the two can't drift.
 */
export function inboxChipIndexFor(raw: string | null | undefined): number {
  return chipIndexForStatus(raw);
}

/**
 * `?sort=oldest` — the honest target for the health page's "Overdue" tile. There
 * is no server-side age filter, so rather than link to an unfiltered inbox and
 * call it a filter, that tile sorts by age and says so.
 */
export function inboxSortingFor(raw: string | null | undefined): SortingState {
  return raw === "oldest" ? [{ id: "ageMin", desc: true }] : [{ id: "ageMin", desc: false }];
}

/** The canonical deep link for a status. Keeps every caller spelling it one way. */
export function inboxHrefForStatus(status: OrderStatus | "failed"): string {
  return `/inbox?status=${status}`;
}
