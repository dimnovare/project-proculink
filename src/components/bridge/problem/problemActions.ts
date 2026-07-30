// problemActions — every recovery a problem panel may offer, with the backend
// guard set that decides whether it can succeed.
//
// This table is the reason D2 could not happen again. The shipped dead-letter
// screen told the operator to click a Send button that called
// POST /api/orders/{id}/redeliver — an endpoint whose guard set
// (OrderStatusMachine.RedeliverableFrom) does not contain delivery_dead_letter,
// so it answered 400 every time. The rescue path was the separate ops requeue,
// reachable only from /operations/health.
//
// So: an action names an `op`, the op names the statuses it is legal FROM, and a
// test walks PROBLEM_COPY asserting every offered op is legal from its own state.
// A control the backend will reject can no longer reach a screen without a red test.

import { apiClient, requeueDelivery as requeueDeliveryApi } from "@/lib/api-client";

export type ProblemOp =
  | "transformOrder"
  | "retryDelivery"
  | "requeueDelivery"
  | "redeliverOrder"
  | "markDelivered";

/**
 * Raw backend statuses each op is accepted FROM. Hand-maintained mirrors of
 * ProcuLink.Core:
 *   transformOrder   ← OrderStatusMachine: `transforming` accepts these entry statuses
 *                      (transform_failed included ON PURPOSE — it holds no output,
 *                      so a rebuild cannot ship anything stale)
 *   retryDelivery    ← ClaimableForRetryFrom  {ready_to_deliver, delivery_failed}
 *   redeliverOrder   ← RedeliverableFrom      {delivery_failed, ready_to_deliver,
 *                                              delivery_unconfirmed}
 *   requeueDelivery  ← the ops rescue path for exhausted retries
 *   markDelivered    ← only from the park
 *
 * `delivery_held` appears in NONE of them: the release is automatic when billing
 * settles, and every send endpoint 400s while held. `rejected_by_supplier` and
 * `failed` appear in none either — both are terminal.
 */
export const OP_ALLOWED_FROM: Record<ProblemOp, ReadonlySet<string>> = {
  transformOrder: new Set(["ready", "pending_review", "transform_failed"]),
  retryDelivery: new Set(["ready_to_deliver", "delivery_failed"]),
  requeueDelivery: new Set(["delivery_dead_letter", "delivery_failed"]),
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
  requeueDelivery: (orderId) => requeueDeliveryApi(orderId),
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
  "requeueDelivery",
  "transformOrder",
]);
