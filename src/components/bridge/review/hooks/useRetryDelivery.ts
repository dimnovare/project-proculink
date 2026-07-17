"use client";

// useRetryDelivery — owns the operator's "Retry delivery" click on a delivery_failed
// order, and the short poll that makes the retry VISIBLE.
//
// Why a poll is needed at all. POST /api/orders/{id}/retry-delivery answers
// 202 { status: "delivery_failed", retrying: true } and deliberately leaves the row
// in delivery_failed. That is the fix, not a bug: the endpoint used to pre-flip the
// row to `delivering` "so the UI reflects the retry immediately", which defeated
// RetryDeliveryAsync's own atomic claim (it rejects a FRESH `delivering`) — the job
// matched 0 rows, backed off, and nothing was sent for ~30 minutes while the UI read
// "Sending". The Worker's job now claims the row and flips it to `delivering` within
// seconds of the 202.
//
// So at the instant the POST resolves, server truth is STILL delivery_failed. The
// panel's old handler invalidated ["order", id] right there, raced the Worker, and
// refetched into that truth — re-rendering the same "Delivery to supplier failed"
// screen. The click read as a no-op, which invites the repeat clicks.
//
// The poll is scoped to the retry itself rather than added to useOrderReview's
// refetchInterval, because delivery_failed is a RESTING state: an idle failed order
// nobody retried must not poll forever. Only the order we just retried has a reason
// to expect movement, and only until the claim window closes.
//
// What this hook must never do: report `delivering` before the row holds it. `phase`
// describes OUR REQUEST — "queued" means a job is enqueued (which the 202 attests),
// not that a dispatch is under way. The status the operator reads always comes from
// the server.

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import type { Order } from "@/types/procurement";

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}

const POLL_MS = 1_000;

/**
 * How long to watch for the Worker's claim before saying so. The claim normally
 * lands within seconds; this is the "something is wrong with the Worker" threshold,
 * not the retry's deadline — the job stays enqueued either way.
 */
export const CLAIM_WINDOW_MS = 30_000;

/**
 * - `idle`   — no retry of ours is outstanding.
 * - `queued` — our POST was accepted; the job is enqueued and we are watching for
 *              the Worker to claim it. NOT a claim that delivery is under way.
 * - `slow`   — the claim window elapsed with the row still delivery_failed. The job
 *              is still enqueued and will run; the Worker just hasn't started it.
 *
 * `queued` and `slow` both mean "a job of ours is outstanding", so both must keep the
 * retry button disabled. A SECOND enqueue is not harmless — see `start`.
 */
export type RetryPhase = "idle" | "queued" | "slow";

export function useRetryDelivery(orderId: string) {
  const [phase, setPhase] = useState<RetryPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  // Stops the poll if the operator navigates away mid-window. (The normal exit is
  // this component unmounting because the status moved — see below — but a poll that
  // outlives the screen would keep fetching for nothing.) Effect is lifecycle-only:
  // it does not fetch, so it doesn't cross the "no useEffect for data fetching" rule.
  // Reset on mount, not just cleanup, because StrictMode double-invokes effects in
  // dev: mount → cleanup (cancels) → mount, which would otherwise leave every poll
  // pre-cancelled.
  const cancelled = useRef(false);
  useEffect(() => {
    cancelled.current = false;
    return () => { cancelled.current = true; };
  }, []);

  // Guards the POST against a second enqueue. A ref, not `phase`: state reads inside
  // this callback are a snapshot, so two clicks dispatched before React re-renders
  // both see phase === "idle" and both POST. A ref is written synchronously and so is
  // visible to the second call immediately.
  //
  // A second enqueue is NOT harmless, and the endpoint will no longer stop it. Its
  // `status != delivery_failed → 400` guard used to double as double-submit
  // protection only because the old pre-flip wrote `delivering` before returning; now
  // that the pre-flip is gone (correctly), the row stays delivery_failed and a second
  // POST is ACCEPTED. Two jobs then serialise on the per-order mutex — which
  // serialises but does NOT deduplicate — and DeliveryService's claim accepts
  // `delivery_failed` with NO staleness gate (unlike `delivering`). So when the
  // supplier is down: job A claims, dispatches, fails, writes the row back to
  // delivery_failed; job B immediately claims that same row and burns another
  // attempt; `priorAttempts + 1 >= maxAttempts` dead-letters the order in seconds —
  // instead of it delivering on the backoff once the supplier recovered. The
  // operator's second click destroys the retry budget, so this guard is load-bearing
  // and is never released while a job of ours is outstanding.
  const inFlight = useRef(false);

  const start = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setError(null);
    setPhase("queued");

    try {
      await apiClient.retryDelivery(orderId);
    } catch (err) {
      // A rejected POST means no job was enqueued — nothing is coming, so drop
      // straight back to an actionable panel with the reason.
      inFlight.current = false;
      if (cancelled.current) return;
      setPhase("idle");
      setError(err instanceof Error ? err.message : "Retry failed. Check the delivery config.");
      return;
    }

    const deadline = Date.now() + CLAIM_WINDOW_MS;
    while (!cancelled.current && Date.now() < deadline) {
      await sleep(POLL_MS);
      if (cancelled.current) return;

      let next: Order | null = null;
      try {
        next = await apiClient.getOrderById(orderId);
      } catch {
        // A single transient rejection (cold-auth 401, a network blip, the per-call
        // fetch timeout) does NOT mean the retry failed — the job is enqueued
        // server-side and runs regardless of this tab. Try again on the next tick.
        continue;
      }

      if (next.status !== "delivery_failed") {
        // Server truth moved: the job claimed the row (→ delivering), or the whole
        // attempt already settled. Publish it and stand down — the workshop's
        // delivery_failed gate stops matching, this panel unmounts, and
        // useOrderReview's interval polls `delivering` through to its final state.
        inFlight.current = false;
        setPhase("idle");
        queryClient.setQueryData(["order", orderId], next);
        // The inbox row for this order is now wrong (it still reads "Failed") — this
        // is the one place we know it moved, so refresh the list too.
        void queryClient.invalidateQueries({ queryKey: ["orders"] });
        return;
      }
    }

    if (cancelled.current) return;
    // The window elapsed with the row still delivery_failed. The 202 is the receipt
    // that the job IS enqueued, so this is "not started yet" — never "failed", and
    // never a silent drop back to a panel that looks untouched.
    //
    // `inFlight` is deliberately NOT released here. Our job is still queued and WILL
    // run; a second click would enqueue a duplicate that can only burn the order's
    // retry budget (see the guard's comment above) and cannot make the Worker start
    // any sooner. So the button stays disabled and the notice explains why. A reload
    // is the escape hatch if an operator truly needs to force another attempt.
    //
    // No ["orders"] invalidate here on purpose: nothing moved, so refetching the whole
    // list would buy no new information.
    setPhase("slow");
  }, [orderId, queryClient]);

  // `isRetrying` gates the button, so it covers BOTH outstanding phases — `slow` is
  // still "a job of ours is queued", not "go ahead and click again".
  return { phase, error, start, isRetrying: phase !== "idle" };
}
