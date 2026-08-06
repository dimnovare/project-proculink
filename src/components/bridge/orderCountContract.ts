// orderCountContract — one label, one status set, one number, everywhere.
//
// WHY THIS EXISTS. The dashboard and the inbox both print order counts, and they
// derived them independently. At 478b809 the label "Ready to send" meant two
// different things in one product:
//
//   BridgeDashboard.tsx:947  { label: "Ready to send", value: countReady }
//   BridgeDashboard.tsx:643  countReady = sumStatuses("ready", "ready_to_deliver")
//   UnifiedStatusBadge.tsx:99  ready → "Ready to send"        ← one status
//   InboxView FILTER_CHIPS     (no chip for `ready` at all)
//
// So an operator read "Ready to send · 12" on the dashboard, clicked it, and the
// number 12 appeared nowhere in the inbox: some rows were badged "Ready to send",
// the rest "Queued to send", and the only chip carrying either wording counted the
// other status. Nothing was wrong with either computation on its own — that is the
// point. Two correct derivations of one label is the defect.
//
// This module is the ONE table. Both surfaces read it, and orderCountParity.test.tsx
// walks it: any label that appears on both screens must print the same number for the
// same fixture. Adding a row here is how a new count enters the product; adding one
// anywhere else is what the test exists to catch.

import type { OrderStatus } from "@/types/procurement";
import { FAILURE_STATUSES } from "@/lib/orderStatusManifest";

/**
 * Every backend status the single red "Failed" row badge collapses.
 *
 * DERIVED from `FAILURE_STATUSES` in `src/lib/orderStatusManifest.ts` — the manifest's
 * computed view of OrderStatusConstants.FailureBucket, and the one copy of the backend's
 * status machine that `src/test/backendMirror.test.ts` diffs against the real C# whenever
 * a backend checkout is reachable.
 *
 * IT USED TO BE HAND-TYPED, under a comment that said "keep in sync by hand". The manifest
 * exists precisely because that instruction is not a mechanism: `?status=failed` is
 * expanded SERVER-side against the backend bucket, so a sixth failure status added there
 * came back under the Failed chip and rendered as "New", while failureBucketPills.test.ts —
 * which iterates THIS array — stayed green, because it was walking the same stale list the
 * product was. Deriving it is what turns that walk into a guard: a status added to the
 * manifest enters this array, the dashboard's and inbox's "Failed" numbers, and every
 * assertion that iterates it, in the same commit.
 *
 * THE CAST is the one place the manifest's `readonly string[]` is narrowed to the
 * `OrderStatus` union, and it is worth being exact about what it does not prove. The union
 * is a type and the manifest is a value; nothing type-checks them against each other, so a
 * manifest failure status absent from the union would narrow here silently and then count
 * zero everywhere. What DOES catch that is behavioural and already exists —
 * `failureBucketPills.test.ts` asserts every member of this array reaches the failed pill
 * rather than the "New" fall-through, and it now reads the manifest through this file.
 *
 * Lives here rather than in InboxView because the dashboard's "Failed" number is the
 * same number — that is the whole thesis of this file. InboxView re-exports it so its
 * existing importers (failureBucketPills.test.ts, statusJourneyFailedStage.test.tsx)
 * are unchanged.
 */
export const FAILED_BUCKET: OrderStatus[] = [...FAILURE_STATUSES] as OrderStatus[];

export interface OrderCountRow {
  /** The exact words a user reads. Two surfaces printing these words print one number. */
  label: string;
  /** The backend statuses this label counts. `null` means "the whole account total". */
  statuses: OrderStatus[] | null;
}

/**
 * The contract. Order is meaningful for the inbox chips only (see INBOX_CHIP_LABELS).
 *
 * "Ready to send" and "Queued to send" are DELIBERATELY two rows, not one. They are
 * different turns in the same handover:
 *   ready            — every check passed, no output built yet   → the HUMAN's turn
 *   ready_to_deliver — output file built, send pending           → OUR turn
 * Summing them under one label is what produced the divergence this file fixes; the
 * dashboard now prints both numbers instead of one ambiguous one.
 *
 * "All orders" and "Received" are TWO LABELS FOR ONE NUMBER (`statuses: null` = the
 * account total), which is the mirror image of the defect above rather than an instance of
 * it, and it is deliberate. The invariant this file enforces is ONE LABEL → ONE NUMBER: a
 * reader who sees a label anywhere must be able to predict the figure next to it. Two
 * labels over the same figure never mislead anyone — nobody compares "All orders · 32" with
 * "Received · 32" and concludes that something is missing. They stay separate because they
 * answer different questions in different places: "All orders" is the inbox chip that
 * CLEARS the filter (its peers are filters, so "Received" would read as one), and
 * "Received" is the dashboard funnel's head, where every other cell is a stage the order
 * has reached. Collapsing them would force one surface to use the other's grammar.
 *
 * `printedCounts`'s shared-label intersection therefore never compares these two, and that
 * is correct: they are not the same claim about the same set, they are the same set under
 * two surfaces' vocabulary.
 */
export const ORDER_COUNT_CONTRACT: readonly OrderCountRow[] = [
  // Same number, two surfaces' grammar — see the note above; not a divergence.
  { label: "All orders", statuses: null },
  { label: "Received", statuses: null },
  { label: "Needs review", statuses: ["pending_review"] },
  { label: "Ready to send", statuses: ["ready"] },
  { label: "Queued to send", statuses: ["ready_to_deliver"] },
  { label: "Delivered", statuses: ["delivered"] },
  { label: "Failed", statuses: FAILED_BUCKET },
];

/** Sum a `byStatus` histogram over a set of statuses. Absent statuses count as 0. */
export function sumStatuses(
  byStatus: Partial<Record<OrderStatus, number>> | undefined,
  keys: readonly OrderStatus[],
): number {
  if (!byStatus) return 0;
  return keys.reduce((acc, k) => acc + (byStatus[k] ?? 0), 0);
}

/** The statuses a label counts. `null` = the account total; `undefined` = not a contract label. */
export function statusesForLabel(label: string): OrderStatus[] | null | undefined {
  const row = ORDER_COUNT_CONTRACT.find((r) => r.label === label);
  return row ? row.statuses : undefined;
}

/**
 * The number a contract label must print, for any surface. Both the dashboard and the
 * inbox call this instead of summing statuses themselves — which is what makes the
 * parity test a guard rather than a snapshot.
 */
export function countFor(
  label: string,
  byStatus: Partial<Record<OrderStatus, number>> | undefined,
  total: number | undefined,
): number {
  const statuses = statusesForLabel(label);
  if (statuses === undefined) {
    throw new Error(
      `orderCountContract: "${label}" is not a contract label. Add it to ORDER_COUNT_CONTRACT ` +
        `rather than computing a count next to the markup — that is how "Ready to send" came to ` +
        `mean two different things.`,
    );
  }
  if (statuses === null) return total ?? 0;
  return sumStatuses(byStatus, statuses);
}

// ─── The inbox filter chips ───────────────────────────────────────────────────

/**
 * The inbox chip labels, in render order.
 *
 * FILTER_CHIPS still LIVES in InboxView.tsx — the vocabulary gate's noun budget is
 * path-pinned to that file (scripts/check-vocabulary.mjs NOUN_REGISTRIES), and moving
 * the declaration would make the gate report a missing registry. What lives here is the
 * ORDER, so that `inboxChipIndexFor` can derive an index instead of hard-coding one.
 *
 * That hard-coded map is not hypothetical: at 478b809 `?status=ready` passed the server
 * filter (INBOX_FILTERABLE_STATUSES accepts it) but lit the "All orders" chip, because
 * CHIP_FOR_STATUS had no `ready` entry. Inserting a chip is exactly when that class of
 * bug appears, and this packet inserts one.
 *
 * inboxChipLabelsMatchContract (orderCountParity.test.tsx) pins InboxView's array
 * against this one, so the two cannot drift.
 */
export const INBOX_CHIP_LABELS: readonly string[] = [
  "All orders",
  "Needs review",
  "Ready to send",
  "Queued to send",
  "Delivered",
  "Failed",
];

/**
 * Which chip a `?status=` value lights, derived from the contract.
 *
 * A status inside a chip's status set lights that chip; everything else — `unrouted`,
 * `parsing`, `delivering`, `delivery_held`, `delivery_unconfirmed` — falls back to
 * "All orders" (index 0). Those statuses stay deep-linkable and keep their own row
 * badges; they simply do not get a chip of their own. Eleven chips would make the
 * toolbar a second navigation.
 */
export function chipIndexForStatus(raw: string | null | undefined): number {
  if (!raw) return 0;
  for (let i = 0; i < INBOX_CHIP_LABELS.length; i += 1) {
    const statuses = statusesForLabel(INBOX_CHIP_LABELS[i]);
    if (statuses && (statuses as readonly string[]).includes(raw)) return i;
  }
  return 0;
}
