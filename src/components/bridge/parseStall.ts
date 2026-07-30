// parseStall — the single threshold behind "this parse is taking too long". No React, so the
// decision is unit-testable on its own (parseStall.test.ts).
//
// HISTORY. An earlier version of this module drove a worker-down escalation on MagicMappingPreview.
// Both were deleted in WP-08: the screen could not do what it showed, and upload had long since
// routed to /inbox/{id} instead, so the escalation was already unreachable. Deleting it was right;
// leaving the surviving parse gate (OrderWorkshop) with NO stall escalation was not. That gate polls
// every 3 seconds and, with the Worker down, would spin forever under copy promising "a few
// seconds". "Nothing happens" is this product's canonical symptom of a Worker outage.
//
// ONE threshold, two consumers: useOrderReview computes the flag from the order's updatedAt, and
// OrderWorkshop's parsing gate renders it. The value is 2 minutes because that is what
// useOrderReview was already using for its (previously unrendered) isStuck flag — restoring the
// escalation must not smuggle in a timing change. The backend StuckOrderDetectionJob only fires at
// 30 minutes, so this is deliberately the earlier, user-facing warning.
//
// HONESTY CONTRACT (G9): a stall escalation says processing MAY be paused and points at system
// health. It never claims the order failed — the Worker may just be catching up — and polling
// continues unchanged, so the screen still auto-advances the moment the parse completes.

/** How long an order may sit in `parsing` before the UI escalates. */
export const PARSE_STALL_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes

/**
 * True when the elapsed time since the order last moved exceeds the stall threshold.
 * Non-finite/negative elapsed values are treated as "not stalled": a clock skew must never
 * manufacture an outage warning on a healthy parse.
 */
export function isParseStalled(
  elapsedMs: number,
  thresholdMs: number = PARSE_STALL_THRESHOLD_MS,
): boolean {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return false;
  return elapsedMs > thresholdMs;
}
