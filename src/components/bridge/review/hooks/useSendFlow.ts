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
import { useProcessingStatus } from "@/hooks/useProcessingStatus";
import { finalDeliveryMessage } from "./useOrderReview";
import { serverReason } from "@/lib/serverText";

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}

/**
 * How long a send waits for the server to reach a status worth reporting.
 *
 * A named constant, not two `45_000` literals, because WP-36 made the number
 * user-visible: `stillRunningNotice` quotes it back to the operator, and a copy
 * string that hard-codes "45 seconds" beside a call site somebody later tunes to
 * 60 is a lie with a very long fuse.
 */
const SEND_POLL_WINDOW_MS = 45_000;

/**
 * The outcome of one poll window.
 *
 * `settled` is the ONLY way a caller can tell "the status this poll was waiting
 * for arrived" from "the window elapsed and this is merely the last thing we
 * managed to read". Before WP-36 there was no way at all: pollOrderUntil returned
 * a bare Order for both outcomes, so a timeout handed back an order still sitting
 * in `transforming`/`delivering` — a value that matches none of confirmSend's
 * terminal branches and therefore fell through to the generic red failure notice.
 * Identical return value, opposite meaning.
 *
 * Deliberately NOT modelled as a throw. The enqueue succeeded and the server-side
 * job is real, so throwing would land in confirmSend's catch, which paints
 * "Send failed" — the same false claim in a different colour.
 */
type PollOutcome = { order: Order; settled: boolean };

/**
 * What to say when a send's poll window elapses with the order still mid-flight.
 *
 * The old behaviour was a red banner reading "Delivery is still processing.
 * Refresh the order or check the Delivery Log for the latest attempt." — wrong
 * severity (nothing failed), wrong fact, and a next step that does nothing.
 * ProcuLink runs ONE background processor: when it is down nothing parses,
 * transforms or delivers, so the operator who waited 45s and got red was looking
 * at an order that is intact and queued behind an outage. Refreshing does not
 * start it, and the deliveries page has no attempt to show yet.
 *
 * `processingPaused` comes from useProcessingStatus, which is FALSE while the
 * answer is unknown — so an unreachable API can never manufacture the outage
 * claim, and the second sentence stays the safe default.
 *
 * Both branches are "info", not "error", for the same reason: the order is
 * mid-flight, not failed. And both must actively suppress a second Send —
 * clicking it again on a paused system enqueues a duplicate dispatch that fires
 * twice the moment processing resumes.
 *
 * The notice is rendered as PLAIN TEXT (OrderWorkshop pipes flowNotice straight
 * into a div and into the status bar's `notice` slot — there is no link slot), so
 * the destination is named in words the operator can navigate to: "System status"
 * is /operations/health and "Deliveries" is /operations/log, exactly as they read
 * in the nav.
 */
function stillRunningNotice(processingPaused: boolean): string {
  if (processingPaused) {
    return "Order processing is paused, so this order hasn't been sent yet. It's saved and waiting — nothing has been lost, and it goes out on its own as soon as processing restarts. Don't send it again. Open System status to see when processing is back.";
  }
  const seconds = Math.round(SEND_POLL_WINDOW_MS / 1000);
  return `This order was accepted for sending but hasn't finished within ${seconds} seconds. Nothing has been lost — this page updates on its own when it's done. Don't send it again; the Deliveries page shows the latest attempt once it's made.`;
}

export function useSendFlow({ orderId, order, labels, refetchOrder }: {
  orderId: string;
  order: Order | null | undefined;
  labels: PartyLabels;
  refetchOrder: () => Promise<unknown>;
}) {
  // Is the background processor running? Read at the TOP LEVEL (rules of hooks —
  // never inside confirmSend, which is where it is consumed) and off the shared
  // ["ops-health"] query key, so this is the same cache entry /operations/health
  // and OrderProblemPanel already poll: no extra network for the review screen.
  const { paused: processingPaused } = useProcessingStatus();

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
  ): Promise<PollOutcome> => {
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
        return { order: latest, settled: true };
      }
      await sleep(900);
    }

    // The window elapsed. `latest` is a real, current read — it is simply not in
    // a status this poll was waiting for, which means the job is still running
    // (or nothing is running it). settled:false is how the caller learns that,
    // instead of inferring "failure" from a status that matches no branch.
    if (latest) return { order: latest, settled: false };
    // Zero successful reads in the whole window is a different failure: we never
    // got server truth at all. That still throws — the catch re-reads once before
    // painting red, so a healthy order cannot be misreported by this path.
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
        const transformPoll = await pollOrderUntil(
          next =>
            next.status === "ready_to_deliver" ||
            next.status === "delivered" ||
            next.status === "delivery_failed" ||
            next.status === "transform_failed",
          SEND_POLL_WINDOW_MS,
        );
        current = transformPoll.order;

        // A timed-out transform poll leaves `current` in `transforming` (or
        // wherever it was stuck), which matches none of the branches below —
        // it used to slide down to the `artifacts.length === 0` guard and paint
        // a red "Output generation has not finished yet. Refresh the order and
        // try again." on an order that had not failed, telling the operator to
        // retry a job that is already running. Stop here and say what is true.
        if (!transformPoll.settled) {
          setFlow(stillRunningNotice(processingPaused), "info");
          await refetchOrder();
          return;
        }
      }

      if (current.status === "transform_failed") {
        // Same treatment as finalDeliveryMessage's branches: this order row's errorMessage can
        // carry the raw response body, and it is rendered as the whole notice.
        setFlow(serverReason(current.errorMessage, "We couldn't build the output file. Check the output template and try again."), "error");
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
      const deliveryPoll = await pollOrderUntil(
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
        SEND_POLL_WINDOW_MS,
      );
      current = deliveryPoll.order;

      if (!deliveryPoll.settled) {
        // THE WP-36 DEFECT. `current.status` is still `delivering` here, so it
        // matched no branch and dropped into the final `else`, whose
        // finalDeliveryMessage fallback was painted red: "Delivery is still
        // processing. Refresh the order or check the Delivery Log…". Wrong
        // severity for an order that is intact and in flight, and both next steps
        // were dead ends — refreshing does not run the job, and no attempt has
        // been recorded to go and read. This branch answers the question the
        // operator actually has ("did my send work?") with the one fact that
        // settles it: whether processing is running at all.
        setFlow(stillRunningNotice(processingPaused), "info");
      } else if (current.status === "delivered") {
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
  }, [order, orderId, pollOrderUntil, refetchOrder, sendState, labels, setFlow, processingPaused]);

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
