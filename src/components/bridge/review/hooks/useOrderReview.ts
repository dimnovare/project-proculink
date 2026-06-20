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
    // Auto-refresh ONLY while the pipeline is auto-progressing (parse → transform)
    // so the screen updates on its own instead of looking stuck until the 2-min
    // banner fires. `ready_to_deliver` is a RESTING state that waits for the user
    // to click Send — it never changes on its own, so polling it every 3s forever
    // is pure waste (and ran indefinitely on every ready order). The send action
    // owns its own delivering→delivered refresh via useSendFlow.
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      return s === "parsing" || s === "transforming" ? 3_000 : false;
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
