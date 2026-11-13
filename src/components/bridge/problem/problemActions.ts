// problemActions — every recovery a problem panel may offer, with the backend
// guard set that decides whether it can succeed.
//
// This table is the reason D2 could not happen again. The shipped dead-letter
// screen told the operator to click a Send button that called
// POST /api/orders/{id}/redeliver — an endpoint whose guard set
// (OrderStatusMachine.RedeliverableFrom) does not contain delivery_dead_letter,
// so it answered 400 every time. The ops requeue that was its rescue path was deleted with the
// order pipeline's operations screens (2026-11-13).
//
// So: an action names an `op`, the op names the statuses it is legal FROM, and a
// test walks PROBLEM_COPY asserting every offered op is legal from its own state.
// A control the backend will reject can no longer reach a screen without a red test.

import { apiClient } from "@/lib/api-client";

export type ProblemOp =
  | "transformOrder"
  | "retryDelivery"
  | "redeliverOrder"
  | "markDelivered";

/**
 * Raw backend statuses each op WAS accepted from: FROZEN LITERALS, NOT A MIRROR (2026-11-13,
 * plan 13b).
 *
 * These sets used to be derived from OP_GUARDS in `src/lib/orderStatusManifest.ts`, which
 * mirrored OrderStatusMachine's endpoint guard sets and was diffed against the C# by
 * `src/test/backendMirror.test.ts`. The machine, OP_GUARDS and every order write endpoint were
 * deleted with the order pipeline. The backend now admits none of these ops from any status, and
 * nothing renders a post action, because the problem panel went with the order screens. The sets
 * are the guards as they last mirrored the backend. They are frozen only so PROBLEM_COPY's dead
 * post actions keep type-checking until the frontend orphan sweep removes the post kind.
 *
 * `delivery_held` is in none of them: every send endpoint refused while held.
 */
export const OP_ALLOWED_FROM: Record<ProblemOp, ReadonlySet<string>> = {
  transformOrder: new Set(["ready", "transform_failed", "rejected_by_supplier"]),
  retryDelivery: new Set(["delivery_failed"]),
  redeliverOrder: new Set(["ready_to_deliver", "delivery_failed", "delivery_unconfirmed"]),
  markDelivered: new Set(["delivery_unconfirmed"]),
};

export function opIsAllowedFrom(op: ProblemOp, status: string): boolean {
  return OP_ALLOWED_FROM[op].has(status);
}

/** The real call behind each op. One place, so no panel hand-rolls a fetch. */
export const PROBLEM_OP_CALL: Record<ProblemOp, (orderId: string) => Promise<unknown>> = {
  transformOrder: (orderId) => apiClient.transformOrder(orderId),
  retryDelivery: (orderId) => apiClient.retryDelivery(orderId),
  redeliverOrder: (orderId) => apiClient.redeliverOrder(orderId),
  markDelivered: (orderId) => apiClient.markDelivered(orderId),
};

/**
 * Ops that leave the row in its FAILING status on purpose and are picked up by
 * the Worker moments later (the 202 pattern). The panel watches for the claim
 * instead of refetching straight into the failure it just tried to clear — see
 * useProblemAction, ported from useRetryDelivery.
 */
export const OPS_WITH_CLAIM_WINDOW: ReadonlySet<ProblemOp> = new Set([
  "retryDelivery",
  "transformOrder",
]);
