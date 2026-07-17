"use client";

// useOrderReview — owns the live order query for the review screen.
// Extracted from SpineReview.tsx (batch 9 Phase A); behaviour unchanged:
//   • 3s conditional refetchInterval while the pipeline is mid-flight
//   • stuck-order detection (2-min early warning ahead of the backend job)
//   • derived exceptionCount from SERVER truth (lines with needsReview) —
//     the ONLY counter the send guard may read (gate G1).

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { useQueriesEnabled } from "@/hooks/useQueriesEnabled";
import type { Order } from "@/types/procurement";
import type { PartyLabels } from "@/hooks/useOrderDirection";

// ── Stuck-order threshold (mirrors the StuckOrderDetectionJob: 30 min for production,
// but we surface a UI warning much earlier — at 2 min — so operators can investigate
// before the backend job fires.)
const STUCK_WARN_MS = 2 * 60 * 1000; // 2 minutes

/**
 * The one sentence explaining a `delivery_held` order, shared by the review screen
 * and the workshop's BillingHeldPanel so the two can never drift. Says what is true:
 * the pause is billing, the artifact survived, and the release is automatic (the
 * backend's ReleaseBillingHeldOrdersAsync re-drives delivery on reactivation) —
 * so the operator resolves the invoice rather than chasing the supplier.
 */
export const BILLING_HELD_MESSAGE =
  "Delivery is paused because your plan can't process orders right now. The supplier file is generated and waiting — nothing has been lost. Sending resumes automatically once your billing is up to date.";

/**
 * The same explanation for a surface that aggregates SEVERAL held orders (the
 * operations-health card). Kept beside the singular so the two can't drift, because
 * the sentence above is about exactly one order — it is written for the workshop
 * panel, which always renders one — and reading "The supplier file is generated"
 * under a count of 12 both disagrees in number and undercounts what is waiting.
 * Every load-bearing claim is identical: billing cause, nothing lost, automatic resume.
 */
export const BILLING_HELD_MESSAGE_PLURAL =
  "Deliveries are paused because your plan can't process orders right now. The supplier files are generated and waiting — nothing has been lost. Sending resumes automatically once your billing is up to date.";

/**
 * The one sentence explaining a `delivery_unconfirmed` order, shared by the review
 * screen, ExceptionDetail, and the workshop's parked-order panel so the three can
 * never drift. "May have sent" is the honest claim — a crash-recovery signal proves
 * the send was attempted, not that it arrived — and the sentence hands the operator
 * both resolutions rather than implying the system will resolve this on its own.
 */
export const DELIVERY_UNCONFIRMED_MESSAGE =
  "We may have sent this order, but lost the connection before the supplier confirmed it — so we can't tell whether it arrived. Check with the supplier, then either send it again or mark it delivered.";

export function finalDeliveryMessage(status: Order["status"], errorMessage: string | null | undefined, labels: PartyLabels): string {
  if (status === "delivered") {
    // Inbound: "Order confirmed." Outbound: "Delivered to supplier." (mechanism identical).
    return `${labels.deliveredLabel}. The audit trail has been updated.`;
  }
  if (status === "delivery_failed") {
    return errorMessage && errorMessage.trim().length > 0
      ? `Delivery failed: ${errorMessage}`
      : "Output generated, but delivery failed. Check the supplier Delivery tab and retry when the endpoint is ready.";
  }
  if (status === "rejected_by_supplier") {
    const noun = labels.counterpartyNoun;
    return errorMessage && errorMessage.trim().length > 0
      ? `${noun} rejected the order: ${errorMessage}`
      : `The ${noun.toLowerCase()} rejected the order. Open the ${noun} response tab for the rejection details.`;
  }
  if (status === "delivery_dead_letter") {
    return "Delivery retries are exhausted. The order is in the dead-letter queue for operator review.";
  }
  if (status === "delivery_held") {
    // Deliberately NOT `errorMessage ?? …` like the branches above: the backend
    // never sets errorMessage when it pauses for billing, so any message present
    // is left over from an earlier failed attempt and would explain the wrong
    // problem. The generic fallback below is worse still — nothing is processing,
    // refreshing changes nothing, and the Delivery Log has no attempt to show.
    return BILLING_HELD_MESSAGE;
  }
  if (status === "delivery_unconfirmed") {
    // Prefer the backend's pinned park sentence (errorMessage) — it carries the
    // same claim as DELIVERY_UNCONFIRMED_MESSAGE but may include order-specific
    // detail. Fall back to the shared constant so the three surfaces never drift.
    return errorMessage && errorMessage.trim().length > 0
      ? errorMessage
      : DELIVERY_UNCONFIRMED_MESSAGE;
  }
  return "Delivery is still processing. Refresh the order or check the Delivery Log for the latest attempt.";
}

export function useOrderReview(orderId: string) {
  // Mock mode AND live QA-bypass e2e have no Clerk session, so gate queries via
  // useQueriesEnabled (mock OR qa-bypass OR signed-in) — otherwise those pages
  // (and the e2e suite) starve on a disabled query.
  const queryEnabled = useQueriesEnabled();

  const { data: order, isLoading, isError, refetch: refetchOrder } = useQuery({
    queryKey: ["order", orderId],
    queryFn: () => apiClient.getOrderById(orderId),
    enabled: queryEnabled,
    retry: 2,
    retryDelay: 600,
    staleTime: 30_000,
    // Auto-refresh ONLY while the pipeline is auto-progressing (parse → transform →
    // deliver) so the screen updates on its own instead of looking stuck until the
    // 2-min banner fires. `ready_to_deliver` is a RESTING state that waits for the
    // user to click Send — it never changes on its own, so polling it every 3s
    // forever is pure waste (and ran indefinitely on every ready order).
    //
    // `delivering` belongs here by that same rule and was only missing because it
    // was missing from the OrderStatus union: the Worker's claim owns it, it settles
    // to delivered / delivery_failed on its own within seconds, and NOTHING else
    // refreshes it unless this tab happens to be the one that clicked Send
    // (useSendFlow polls its own send). An order that reached `delivering` any other
    // way — a retry the Worker just claimed, a send fired from another tab, a
    // delivery this tab merely opened mid-flight — sat on "Sending…" until a manual
    // reload. Resting/terminal states still return false.
    //
    // Note this is deliberately NOT `delivery_failed`: that IS a resting state, and
    // polling every failed order forever would be the same waste. The retry action
    // owns the short claim-window poll for the one order it just retried
    // (useRetryDelivery), and hands over to this interval once the row moves.
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      return s === "parsing" || s === "transforming" || s === "delivering" ? 3_000 : false;
    },
  });

  // ── Stuck-order detection (Task 0.B.2) ────────────────────────────────────
  const isStuck = useMemo(() => {
    if (!order || order.status !== "parsing") return false;
    const updatedMs = new Date(order.updatedAt).getTime();
    return Number.isFinite(updatedMs) && (Date.now() - updatedMs) > STUCK_WARN_MS;
  }, [order]);

  // Count remaining unresolved exceptions from SERVER truth. Resolving a line
  // persists via /resolve + refetch, so needsReview flips to false on the
  // server — no local-state subtraction is needed (or correct) here.
  const exceptionCount = useMemo(
    () => (order ? order.lines.filter(l => l.needsReview).length : 0),
    [order],
  );

  return { order, isLoading, isError, refetchOrder, isStuck, exceptionCount, queryEnabled };
}
