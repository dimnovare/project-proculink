"use client";

// useProblemAction — the shared pending / error / double-submit state behind every
// recovery button in a problem panel.
//
// It inherits the hardest lesson on this screen wholesale from useRetryDelivery:
// the retry / requeue endpoints answer 202 and deliberately LEAVE the row in its
// failing status, because pre-flipping it defeated the Worker's own atomic claim.
// So at the instant the POST resolves, server truth still says "failed":
//
//   • a bare invalidate here races the Worker and refetches into that failure,
//     which is why the operator's click used to read as a no-op;
//   • and a SECOND click is not harmless — two enqueued jobs serialise on the
//     per-order mutex without de-duplicating, and the claim accepts the failed
//     status with no staleness gate, so the pair can burn the retry budget and
//     dead-letter the order in seconds.
//
// Hence: an `inFlight` ref (written synchronously, so two clicks dispatched in one
// frame cannot both POST), a short poll for the claim, and a button that stays
// disabled while a job of ours is outstanding.

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { OPS_WITH_CLAIM_WINDOW, PROBLEM_OP_CALL, type ProblemOp } from "./problemActions";

const POLL_MS = 1_000;

/** How long we watch for the Worker's claim before saying "queued, not started". */
export const CLAIM_WINDOW_MS = 30_000;

export type ProblemActionPhase = "idle" | "pending" | "queued" | "done";

/** sessionStorage key for the escalation ladder's promotion counter (§4). */
export function attemptsKey(orderId: string, status: string): string {
  return `problemAttempts:${orderId}:${status}`;
}

function readAttempts(orderId: string, status: string): number {
  try {
    return Number(sessionStorage.getItem(attemptsKey(orderId, status)) ?? "0") || 0;
  } catch {
    return 0;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function useProblemAction(orderId: string, status: string) {
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<ProblemActionPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [activeOp, setActiveOp] = useState<ProblemOp | null>(null);
  const [failedAttempts, setFailedAttempts] = useState(() => readAttempts(orderId, status));

  // Lifecycle only — cancels the claim poll if the operator navigates away.
  // Reset on mount as well as cleanup: StrictMode double-invokes effects in dev,
  // which would otherwise leave every poll pre-cancelled.
  const cancelled = useRef(false);
  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
    };
  }, []);

  const inFlight = useRef(false);

  const run = useCallback(
    async (op: ProblemOp) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setError(null);
      setActiveOp(op);
      setPhase("pending");

      try {
        await PROBLEM_OP_CALL[op](orderId);
      } catch (err) {
        // A rejected POST means nothing was enqueued — drop straight back to an
        // actionable panel with the server's reason, and count the failed attempt
        // so the escalation ladder can promote this state to `us`.
        inFlight.current = false;
        if (cancelled.current) return;
        setPhase("idle");
        setActiveOp(null);
        setError(err instanceof Error ? err.message : "That didn't go through. Check your connection and try again.");
        const next = readAttempts(orderId, status) + 1;
        try {
          sessionStorage.setItem(attemptsKey(orderId, status), String(next));
        } catch {
          /* private mode — the in-memory count below still promotes for this view */
        }
        setFailedAttempts(next);
        return;
      }

      if (!OPS_WITH_CLAIM_WINDOW.has(op)) {
        // Terminal-effect ops (mark delivered / redeliver from the park) move the
        // row server-side, so publishing the invalidation IS the handoff: the panel
        // unmounts when the refetched status stops being a problem.
        inFlight.current = false;
        if (cancelled.current) return;
        setPhase("done");
        void queryClient.invalidateQueries({ queryKey: ["order", orderId] });
        void queryClient.invalidateQueries({ queryKey: ["orders"] });
        return;
      }

      setPhase("queued");
      const deadline = Date.now() + CLAIM_WINDOW_MS;
      while (!cancelled.current && Date.now() < deadline) {
        await sleep(POLL_MS);
        if (cancelled.current) return;

        let next = null;
        try {
          next = await apiClient.getOrderById(orderId);
        } catch {
          // A transient rejection (cold-auth 401, a blip, the fetch timeout) does
          // not mean the job failed — it is enqueued server-side either way.
          continue;
        }

        if (next && next.status !== status) {
          // Server truth moved: the Worker claimed the row. Publish it and stand
          // down — the panel unmounts as the status stops matching.
          inFlight.current = false;
          setPhase("done");
          queryClient.setQueryData(["order", orderId], next);
          void queryClient.invalidateQueries({ queryKey: ["orders"] });
          return;
        }
      }

      if (cancelled.current) return;
      // The window elapsed with the row unmoved. The 202 is the receipt that the
      // job IS enqueued, so this is "not started yet" — never "failed". inFlight is
      // deliberately NOT released: a second enqueue cannot make the Worker start
      // sooner and can only burn the retry budget.
      setPhase("queued");
    },
    [orderId, status, queryClient],
  );

  return {
    phase,
    activeOp,
    error,
    run,
    /** A job of ours is outstanding — every post control stays disabled. */
    busy: phase === "pending" || phase === "queued",
    /** §4: one failed self-serve attempt promotes the state to the `us` tier. */
    promoted: failedAttempts >= 1,
  };
}
