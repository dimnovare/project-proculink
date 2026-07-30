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
 * statuses (one "Problems" chip covers the five failure statuses), so a deep link
 * to `delivery_dead_letter` selects the Problems chip while the SERVER filter
 * stays exact — the chip is a label, not the filter.
 *
 * Index order mirrors InboxView's FILTER_CHIPS:
 *   0 All orders · 1 Needs review · 2 Ready to send · 3 Delivered · 4 Problems
 */
const CHIP_FOR_STATUS: Record<string, number> = {
  pending_review: 1,
  ready_to_deliver: 2,
  delivered: 3,
  failed: 4,
  transform_failed: 4,
  delivery_failed: 4,
  delivery_dead_letter: 4,
  rejected_by_supplier: 4,
};

export function inboxChipIndexFor(raw: string | null | undefined): number {
  if (!raw) return 0;
  return CHIP_FOR_STATUS[raw] ?? 0;
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
