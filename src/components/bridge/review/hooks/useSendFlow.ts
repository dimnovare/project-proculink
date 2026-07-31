"use client";

// useSendFlow — the transform/deliver send pipeline + the flow-notice strip +
// the confirm-dialog open state. Extracted from SpineReview.tsx (batch 9
// Phase A); behaviour unchanged:
//   • confirmSend re-checks SERVER truth (order.lines.some(l => l.needsReview))
//     before doing anything — the send guard never trusts local state (gate G1).
//   • severity-tracked flow notices (info/success/error) with severity inferred
//     from failure keywords when omitted, so failure messages never render green.

import { useState, useCallback, useEffect, useRef } from "react";
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

  // ── Finding-1: remount resilience ───────────────────────────────────────────
  // If the operator navigates away mid-generation and back, the freshly-loaded
  // order can be in an in-flight server state (transforming / delivering) even
  // though local sendState reset to "idle" on mount. Reflect the in-flight server
  // status so the header shows "Generating…"/"Sending…" instead of an idle/ready
  // CTA — and clear it back to idle once the server settles (ready_to_deliver /
  // terminal), so the button never sticks on "Generating…".
  //
  // `delivering` is adopted for the same reason `transforming` is, and it is the
  // state the retry action now lands on: the Worker's claim flips the row to
  // `delivering` seconds after the retry POST, and without adopting it, canSend
  // (which only requires sendState === "idle") re-armed the green Send button on an
  // order with a dispatch already in flight. Clicking it fired /redeliver against a
  // fresh `delivering` row, which the backend rejects — a red error on an order that
  // was fine. Adopting it renders the existing "Sending…" progress CTA instead.
  //
  // `serverDrivenSend` flags that the effect (not the user's confirmSend) owns the
  // current non-idle state. confirmSend sets sendState synchronously to
  // "transforming"/"delivering" WITHOUT setting this flag, so the effect treats a
  // user-initiated send as foreign and never overwrites it. The order query
  // auto-refetches while mid-flight (useOrderReview), so this re-runs on each status
  // change and converges.
  const serverDrivenSend = useRef(false);
  useEffect(() => {
    if (!order) return; // order not loaded yet
    // A user-initiated send is running (sendState non-idle but not ours) — hands off.
    if (sendState !== "idle" && !serverDrivenSend.current) return;

    if (order.status === "transforming" || order.status === "delivering") {
      // Server is mid-transform / mid-dispatch — reflect it (idempotent: re-setting
      // the same value is a no-op for React state).
      serverDrivenSend.current = true;
      setSendState(order.status === "delivering" ? "delivering" : "transforming");
    } else if (serverDrivenSend.current) {
      // We had adopted an in-flight status, but the order has since settled (the
      // transform finished server-side, the dispatch landed, or it failed). Release
      // back to idle so the real CTA (green Send for ready_to_deliver, the failure
      // panel for *_failed) takes over — the button never sticks on "Generating…".
      serverDrivenSend.current = false;
      setSendState("idle");
    }
    // parsing / pending_review / ready / ready_to_deliver / delivered / *_failed with
    // no adopted state → leave sendState untouched (the resting CTA is already right).
  }, [order, sendState]);

  const pollOrderUntil = useCallback(async (
    predicate: (next: Order) => boolean,
    timeoutMs: number,
  ): Promise<Order> => {
    const started = Date.now();
    let latest: Order | null = null;

    while (Date.now() - started < timeoutMs) {
      // A single transient rejection (cold-auth 401, a network blip, or the per-call
      // fetch timeout) must NOT abort the whole send — the Worker job is enqueued
      // server-side with CancellationToken.None and is mid-transform/deliver. Swallow
      // the error and try again on the next tick; we only give up after the timeout
      // with ZERO successful reads (latest === null).
      try {
        latest = await apiClient.getOrderById(orderId);
      } catch {
        // not refreshed yet — fall through to the next 900ms tick.
      }
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
        setFlow(current.errorMessage ?? "We couldn't build the output file. Check the output template and try again.", "error");
        return;
      }

      if (current.status === "delivered") {
        setCrossed(true);
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
          next.status === "delivery_dead_letter" ||
          // A send by an org whose billing lapsed between transform and delivery is
          // paused into delivery_held rather than delivered. That IS terminal for this
          // poll — without it the poll burns its full 45s and paints a red "Send failed"
          // for an order that was deliberately paused and will resume on its own.
          next.status === "delivery_held" ||
          // A "Send again" that hits a SECOND crash re-parks into delivery_unconfirmed
          // rather than delivering. Also terminal for this poll — without it, a re-park
          // burns the full 45s timeout and shows a false "Send failed" for an order that
          // is actually sitting in the (correct) parked state, waiting on the operator.
          next.status === "delivery_unconfirmed",
        45_000,
      );

      if (current.status === "delivered") {
        setCrossed(true);
        setFlow(finalDeliveryMessage(current.status, current.errorMessage, labels), "success");
      } else if (current.status === "delivery_held") {
        // Explicitly "info", not the "error" the else branch would apply: billing paused
        // the send, the output is intact, and it resumes on its own. Red would tell the
        // operator to chase the supplier over what is actually an invoice.
        setFlow(finalDeliveryMessage(current.status, current.errorMessage, labels), "info");
      } else {
        // delivery_unconfirmed (a re-park on a second crash) deliberately falls through
        // to here rather than getting its own "info" branch like delivery_held above:
        // a billing hold resolves itself, but a re-park still needs the operator to act
        // (send again or mark delivered) — the "error" severity below is the honest
        // signal that this send did not reach a resolved state.
        setFlow(finalDeliveryMessage(current.status, current.errorMessage, labels), "error");
      }
      await refetchOrder();
    } catch (err) {
      // Before painting a red "Send failed", re-read SERVER truth once. The browser
      // poll can throw on a navigation-away / cold-auth / network blip while the
      // Worker job (enqueued with CancellationToken.None) is still healthily mid-flight
      // or already done — so a thrown poll error does NOT mean the order failed.
      let live: Order | null = null;
      try {
        live = await apiClient.getOrderById(orderId);
      } catch {
        // The re-read itself failed too — fall through to the honest error below.
      }

      if (live && live.status === "delivered") {
        // Already delivered — reflect success, not failure.
        setCrossed(true);
        setFlow(finalDeliveryMessage("delivered", null, labels), "success");
      } else if (live && (live.status === "transforming" || live.status === "ready_to_deliver")) {
        // Still in-flight server-side — show a neutral "still processing" note, NOT red.
        setFlow("Still processing — generating and sending the output. This page will update when it finishes.", "info");
      } else {
        // The re-read confirms a genuinely failed/terminal state, or the re-read also
        // failed — surface the honest error.
        setFlow(err instanceof Error ? err.message : "Send failed. Check the Delivery Log and try again.", "error");
      }
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
    showConfirm,
    setShowConfirm,
    confirmSend,
  };
}

export type SendFlowApi = ReturnType<typeof useSendFlow>;
