"use client";

// useSendFlow — the transform/deliver send pipeline + the flow-notice strip +
// the confirm-dialog open state. Extracted from SpineReview.tsx (batch 9
// Phase A); behaviour unchanged:
//   • confirmSend re-checks SERVER truth (order.lines.some(l => l.needsReview))
//     before doing anything — the send guard never trusts local state (gate G1).
//   • severity-tracked flow notices (info/success/error) with severity inferred
//     from failure keywords when omitted, so failure messages never render green.

import { useState, useCallback } from "react";
import { apiClient } from "@/lib/api-client";
import type { Order } from "@/types/procurement";
import type { PartyLabels } from "@/hooks/useOrderDirection";
import { finalDeliveryMessage } from "./useOrderReview";

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}

export function useSendFlow({ orderId, order, labels, refetchOrder }: {
  orderId: string;
  order: Order | null | undefined;
  labels: PartyLabels;
  refetchOrder: () => Promise<unknown>;
}) {
  const [flowNotice, setFlowNotice] = useState<string | null>(null);
  // Severity drives the flow-notice colour (info/success/error) so failure
  // messages don't render green just because order.status isn't "rejected".
  // setFlow sets both; when severity is omitted it is INFERRED from failure
  // keywords in the message, so callsites that pass a bare message string
  // still colour errors correctly.
  const [flowSeverity, setFlowSeverity] = useState<"info" | "success" | "error">("info");
  const setFlow = useCallback((message: string | null, severity?: "info" | "success" | "error") => {
    setFlowNotice(message);
    if (severity) { setFlowSeverity(severity); return; }
    const m = (message ?? "").toLowerCase();
    setFlowSeverity(/fail|failed|reject|error|couldn't|could not|exhausted|unresolved|resolve every/.test(m) ? "error" : "info");
  }, []);

  const [sendState, setSendState] = useState<"idle" | "transforming" | "delivering">("idle");
  const [showConfirm, setShowConfirm] = useState(false);
  const [crossed, setCrossed] = useState(false);
  const [showToast, setShowToast] = useState(false);

  const pollOrderUntil = useCallback(async (
    predicate: (next: Order) => boolean,
    timeoutMs: number,
  ): Promise<Order> => {
    const started = Date.now();
    let latest: Order | null = null;

    while (Date.now() - started < timeoutMs) {
      latest = await apiClient.getOrderById(orderId);
      if (latest && predicate(latest)) {
        return latest;
      }
      await sleep(900);
    }

    if (latest) return latest;
    throw new Error("Order did not refresh. Check your connection and try again.");
  }, [orderId]);

  // ── Cross the bridge (was handleConfirm) ────────────────────────────────────
  const confirmSend = useCallback(async () => {
    setShowConfirm(false);
    if (!order || sendState !== "idle") return;

    if (order.lines.some(l => l.needsReview)) {
      setFlow("Resolve every missing supplier code before completing this order.", "error");
      return;
    }

    try {
      let current = order;

      if (current.status === "delivered") {
        setCrossed(true);
        setShowToast(true);
        setFlow(finalDeliveryMessage("delivered", null, labels), "success");
        return;
      }

      if (current.artifacts.length === 0 && current.status !== "ready_to_deliver") {
        setSendState("transforming");
        setFlow("Generating the output...", "info");
        // No explicit format → backend transforms into the supplier's configured output format.
        await apiClient.transformOrder(orderId);
        current = await pollOrderUntil(
          next =>
            next.status === "ready_to_deliver" ||
            next.status === "delivered" ||
            next.status === "delivery_failed" ||
            next.status === "transform_failed",
          45_000,
        );
      }

      if (current.status === "transform_failed") {
        setFlow(current.errorMessage ?? "Transform failed. Check the output template and try again.", "error");
        return;
      }

      if (current.status === "delivered") {
        setCrossed(true);
        setShowToast(true);
        setFlow(finalDeliveryMessage("delivered", null, labels), "success");
        await refetchOrder();
        return;
      }

      if (current.status === "delivery_failed") {
        setFlow(finalDeliveryMessage(current.status, current.errorMessage, labels), "error");
        await refetchOrder();
        return;
      }

      if (current.artifacts.length === 0) {
        setFlow("Output generation has not finished yet. Refresh the order and try again.", "error");
        await refetchOrder();
        return;
      }

      setSendState("delivering");
      setFlow(
        labels.counterpartyNoun === "Customer"
          ? "Confirming the order..."
          : "Sending the generated output to the supplier...",
        "info",
      );
      await apiClient.redeliverOrder(orderId);
      current = await pollOrderUntil(
        next =>
          next.status === "delivered" ||
          next.status === "delivery_failed" ||
          next.status === "rejected_by_supplier" ||
          next.status === "delivery_dead_letter",
        45_000,
      );

      if (current.status === "delivered") {
        setCrossed(true);
        setShowToast(true);
        setFlow(finalDeliveryMessage(current.status, current.errorMessage, labels), "success");
      } else {
        setFlow(finalDeliveryMessage(current.status, current.errorMessage, labels), "error");
      }
      await refetchOrder();
    } catch (err) {
      setFlow(err instanceof Error ? err.message : "Send failed. Check the Delivery Log and try again.", "error");
      await refetchOrder();
    } finally {
      setSendState("idle");
    }
  }, [order, orderId, pollOrderUntil, refetchOrder, sendState, labels, setFlow]);

  return {
    flowNotice,
    flowSeverity,
    setFlow,
    sendState,
    crossed,
    showToast,
    setShowToast,
    showConfirm,
    setShowConfirm,
    confirmSend,
  };
}

export type SendFlowApi = ReturnType<typeof useSendFlow>;
