// transformFlow — the transform-and-wait step, shared by useSendFlow (send) and
// useDownloadFinished (download). One poll loop; the two callers differ only in what
// they do after the file exists.

import { apiClient } from "@/lib/api-client";
import type { Order } from "@/types/procurement";

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
export const SEND_POLL_WINDOW_MS = 45_000;

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
export type PollOutcome = { order: Order; settled: boolean };


export async function pollOrder(
  orderId: string,
  predicate: (next: Order) => boolean,
  timeoutMs: number,
): Promise<PollOutcome> {
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
}

/** Statuses at which a transform poll stops: the file exists, or the build failed. */
const TRANSFORM_SETTLED = ["ready_to_deliver", "delivered", "delivery_failed", "transform_failed"];

/** Ask the server to build the supplier's file (its configured format), then wait for it. */
export async function transformAndWait(orderId: string): Promise<PollOutcome> {
  await apiClient.transformOrder(orderId);
  return pollOrder(orderId, next => TRANSFORM_SETTLED.includes(next.status), SEND_POLL_WINDOW_MS);
}
