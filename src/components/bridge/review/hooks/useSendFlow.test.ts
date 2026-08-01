import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { Order } from "@/types/procurement";
import type { PartyLabels } from "@/hooks/useOrderDirection";

// ─────────────────────────────────────────────────────────────────────────────
// useSendFlow — resilience tests for Fix 2 (C1): a healthy order must never show a
// red "Send failed" just because the browser-side poll hit a transient error or the
// user navigated away. The Worker jobs are enqueued server-side with
// CancellationToken.None, so the send survives a browser blip; these tests freeze the
// two FE behaviours that previously misreported a healthy order as failed:
//
//   (2a) a transient getOrderById rejection MID-POLL is swallowed — the next
//        successful tick wins, no error surfaces;
//   (2b) the outer-catch re-reads SERVER truth before painting red — a
//        delivered/in-flight order does NOT show a red "Send failed".
//
// The hook is tested in isolation by mocking ONLY the api-client (network) — its
// state machine + flow-notice logic run for real.
// ─────────────────────────────────────────────────────────────────────────────

const api = {
  getOrderById: vi.fn(),
  transformOrder: vi.fn(),
  redeliverOrder: vi.fn(),
  markDelivered: vi.fn(),
  getOrderAudit: vi.fn(),
};

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    getOrderById: (...a: unknown[]) => api.getOrderById(...a),
    transformOrder: (...a: unknown[]) => api.transformOrder(...a),
    redeliverOrder: (...a: unknown[]) => api.redeliverOrder(...a),
    markDelivered: (...a: unknown[]) => api.markDelivered(...a),
    getOrderAudit: (...a: unknown[]) => api.getOrderAudit(...a),
  },
}));

/**
 * Is the background processor running?
 *
 * Mocked rather than provided, to keep this file's stated contract — "the hook is
 * tested in isolation by mocking ONLY the api-client (network)". The real
 * `useProcessingStatus` is a `useQuery` behind `useQueriesEnabled` → Clerk's
 * `useAuth`, so the alternative was a QueryClientProvider plus a Clerk mock in
 * every `renderHook` call, which buys nothing this file is about.
 *
 * It is a knob, not a stub: WP-36 made the send's timeout copy DEPEND on this
 * answer, so both settings are exercised below.
 */
const processing = { paused: false };
vi.mock("@/hooks/useProcessingStatus", () => ({
  useProcessingStatus: () => ({ paused: processing.paused, lastSeen: null }),
}));

// Import AFTER the mock is registered.
import { useSendFlow } from "./useSendFlow";

// ── Fixtures ─────────────────────────────────────────────────────────────────
const LABELS: PartyLabels = {
  counterpartyNoun: "Supplier",
  counterpartyPlural: "Suppliers",
  railHeader: "Supplier",
  primaryCta: "Send to supplier",
  primaryCtaProgress: "Sending…",
  doneLabel: "Sent",
  deliveredLabel: "Delivered to supplier",
  unknownBuyer: "Unknown buyer",
};

function makeOrder(over: Partial<Order> = {}): Order {
  return {
    id: "ord-1",
    poNumber: "PO-1",
    supplierId: "sup-1",
    supplierName: "Acme",
    buyerName: "Buyer Co",
    orderDate: "2026-06-18",
    currency: "EUR",
    status: "pending_review",
    createdAt: "2026-06-18T00:00:00Z",
    updatedAt: "2026-06-18T00:00:00Z",
    lines: [],
    artifacts: [],
    ...over,
  };
}

/**
 * Drive a fake-timer poll loop: the hook's poll calls `await getOrderById` then
 * `await sleep(900)`. Repeatedly flush pending microtasks and advance the 900ms
 * timer so the loop progresses until the predicate resolves.
 */
async function drainPoll(ticks = 10) {
  for (let i = 0; i < ticks; i++) {
    // Flush the getOrderById promise + any chained microtasks.
    await Promise.resolve();
    await Promise.resolve();
    // Fire the 900ms sleep so the loop advances to the next tick.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  api.getOrderById.mockReset();
  api.transformOrder.mockReset().mockResolvedValue(undefined);
  api.redeliverOrder.mockReset().mockResolvedValue(undefined);
  api.markDelivered.mockReset().mockResolvedValue(undefined);
  api.getOrderAudit.mockReset().mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
  processing.paused = false;
});

// ─────────────────────────────────────────────────────────────────────────────
// WP-36 — the poll window elapsing is not a failure.
//
// The delivery poll's terminal predicate covers six statuses. When the window
// elapses the order is still `delivering`, which matches none of them, so control
// fell through to the final `else` and painted finalDeliveryMessage's fallback
// RED: "Delivery is still processing. Refresh the order or check the Delivery Log
// for the latest attempt."
//
// ProcuLink runs one background processor. When it is down nothing is delivered,
// so the operator who clicked Send and waited 45 seconds got a red failure for an
// order that is intact and queued — told to refresh, which does not start the job,
// and to read a log with no attempt in it. Wrong severity, wrong fact, two dead
// ends for next steps.
// ─────────────────────────────────────────────────────────────────────────────
describe("WP-36 — a send that outlives its poll window is reported as in-flight, not failed", () => {
  /** Reads succeed all the way through, but the order never leaves `delivering`. */
  function stuckDelivering() {
    const order = makeOrder({
      status: "ready_to_deliver",
      artifacts: [{ id: "a1", format: "csv", fileKey: "k", createdAt: "" }],
    });
    api.getOrderById.mockResolvedValue(makeOrder({ status: "delivering", artifacts: order.artifacts }));
    return order;
  }

  async function runUntilTimeout(order: Order) {
    const refetchOrder = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useSendFlow({ orderId: "ord-1", order, labels: LABELS, refetchOrder }),
    );
    let sendPromise!: Promise<void>;
    act(() => {
      sendPromise = result.current.confirmSend();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(47_000);
      await sendPromise;
    });
    return result;
  }

  test("processing paused: says so, promises nothing is lost, and forbids a second send", async () => {
    processing.paused = true;
    const result = await runUntilTimeout(stuckDelivering());

    expect(result.current.flowSeverity).toBe("info");
    expect(result.current.flowNotice).toMatch(/paused/i);
    expect(result.current.flowNotice).toMatch(/nothing has been lost/i);
    // The load-bearing sentence. A second Send on a paused system enqueues a
    // duplicate dispatch that fires twice the moment processing resumes — this is
    // the one thing standing between a paused mid-flight order and a duplicate PO.
    expect(result.current.flowNotice).toMatch(/don't send it again/i);
    // And it names somewhere to go. `setFlow` is string-only, so the destination
    // is words: "System status" is what /operations/health is called in the nav.
    expect(result.current.flowNotice).toMatch(/system status/i);
    expect(result.current.crossed).toBe(false);
  });

  test("processing healthy: still in-flight, still not a failure", async () => {
    processing.paused = false;
    const result = await runUntilTimeout(stuckDelivering());

    expect(result.current.flowSeverity).toBe("info");
    expect(result.current.flowNotice).not.toMatch(/paused/i);
    expect(result.current.flowNotice).toMatch(/don't send it again/i);
    expect(result.current.crossed).toBe(false);
  });

  test("neither branch tells the operator to refresh, and neither claims a failure", async () => {
    // The two clauses of the sentence this replaced. "Refresh the order" named an
    // action that changes nothing — a queued job is not a rendering problem.
    for (const paused of [true, false]) {
      processing.paused = paused;
      const result = await runUntilTimeout(stuckDelivering());
      expect(result.current.flowNotice, `paused=${paused}`).not.toMatch(/refresh the order/i);
      expect(result.current.flowSeverity, `paused=${paused}`).not.toBe("error");
    }
  });

  test("a poll that DOES settle is unaffected — the timeout branch is not swallowing real outcomes", async () => {
    // The anti-vacuity control. If `settled` were always false the three tests
    // above would pass while every real delivery outcome vanished into the
    // in-flight notice.
    const order = makeOrder({
      status: "ready_to_deliver",
      artifacts: [{ id: "a1", format: "csv", fileKey: "k", createdAt: "" }],
    });
    api.getOrderById.mockResolvedValue(makeOrder({ status: "delivered", artifacts: order.artifacts }));
    const result = await runUntilTimeout(order);

    expect(result.current.flowSeverity).toBe("success");
    expect(result.current.crossed).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (2a) A transient getOrderById rejection mid-poll is swallowed; the next
// successful tick wins, and the send completes WITHOUT a red error.
// ─────────────────────────────────────────────────────────────────────────────
describe("Fix 2a — a transient poll error is swallowed; the next tick wins", () => {
  test("one rejected getOrderById mid-transform does NOT abort; send reaches delivered", async () => {
    // Order starts ready-to-deliver-pending (needs transform), no lines needing review.
    const order = makeOrder({ status: "pending_review", artifacts: [] });

    // Poll sequence after transformOrder():
    //   tick 1 → reject (transient blip)        ← must be swallowed, NOT surface red
    //   tick 2 → ready_to_deliver (transform done)
    // Then redeliverOrder() poll:
    //   tick 3 → delivered
    api.getOrderById
      .mockRejectedValueOnce(new Error("Network request failed")) // transient mid-transform poll
      .mockResolvedValueOnce(makeOrder({ status: "ready_to_deliver", artifacts: [{ id: "a1", format: "csv", fileKey: "k", createdAt: "" }] }))
      .mockResolvedValueOnce(makeOrder({ status: "delivered", artifacts: [{ id: "a1", format: "csv", fileKey: "k", createdAt: "" }] }));

    const refetchOrder = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useSendFlow({ orderId: "ord-1", order, labels: LABELS, refetchOrder }),
    );

    let sendPromise!: Promise<void>;
    act(() => {
      sendPromise = result.current.confirmSend();
    });

    // Let the transform call + both poll loops run through their ticks.
    await drainPoll(8);
    await act(async () => {
      await sendPromise;
    });

    // The transient rejection was swallowed — the flow is SUCCESS, never a red error.
    expect(result.current.flowSeverity).toBe("success");
    expect(result.current.crossed).toBe(true);
    // The order DID refresh successfully on a later tick, so the terminal
    // "Order did not refresh" error was never thrown.
    expect(result.current.flowNotice).not.toMatch(/did not refresh/i);
    expect(result.current.flowNotice).not.toMatch(/send failed/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (4) A "Send again" that re-parks (a second crash) is TERMINAL for the poll —
// without delivery_unconfirmed in the terminal set, this would burn the full
// 45s timeout and show a false "Send failed" for an order that actually landed
// in the correct (parked) state, waiting on the operator.
// ─────────────────────────────────────────────────────────────────────────────
describe("Fix 4 — a re-park on Send again is terminal for the poll, not a 45s timeout", () => {
  test("redeliverOrder that re-parks resolves quickly with an error-severity notice, not a timeout", async () => {
    // Already transformed — redeliverOrder() fires immediately, no transform step.
    const order = makeOrder({
      status: "ready_to_deliver",
      artifacts: [{ id: "a1", format: "csv", fileKey: "k", createdAt: "" }],
    });
    api.getOrderById.mockResolvedValue(
      makeOrder({ status: "delivery_unconfirmed", artifacts: [{ id: "a1", format: "csv", fileKey: "k", createdAt: "" }] }),
    );

    const refetchOrder = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useSendFlow({ orderId: "ord-1", order, labels: LABELS, refetchOrder }),
    );

    let sendPromise!: Promise<void>;
    act(() => {
      sendPromise = result.current.confirmSend();
    });

    // A SINGLE poll tick is enough to see the re-park — nowhere near the 45s
    // timeout the bug would otherwise burn.
    await drainPoll(2);
    await act(async () => {
      await sendPromise;
    });

    // Terminal, not "did not refresh" (which is what a burned-out 45s timeout
    // with zero terminal match would throw).
    expect(result.current.flowNotice).not.toMatch(/did not refresh/i);
    // Deliberately "error", not the "info" delivery_held gets — a re-park still
    // needs the operator, unlike a self-resolving billing pause.
    expect(result.current.flowSeverity).toBe("error");
    expect(result.current.crossed).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (2b) The outer-catch re-reads server truth: a delivered / in-flight order does
// NOT paint a red "Send failed".
// ─────────────────────────────────────────────────────────────────────────────
describe("Fix 2b — the outer-catch re-read of a healthy order does not paint red", () => {
  // The send throws mid-flight (here the transform request fails on the browser side —
  // equivalently a poll/network blip or a navigation-away), reaching confirmSend's
  // outer catch. getOrderById is then the SINGLE re-read of server truth. Driving the
  // throw through transformOrder keeps the test deterministic: no 45s poll-timeout race
  // over which getOrderById call is the poll vs the re-read.
  function sendThrowsThenReReads(reReadOrder: Order) {
    api.transformOrder.mockRejectedValue(new Error("Network request failed"));
    api.getOrderById.mockResolvedValue(reReadOrder);
  }

  test("a send error re-reads server truth: DELIVERED → success, not red", async () => {
    const order = makeOrder({ status: "pending_review", artifacts: [] });

    // The browser send throws, but the Worker finished server-side — the outer-catch
    // re-read returns a DELIVERED order, so the hook must reflect success, NOT red.
    sendThrowsThenReReads(makeOrder({ status: "delivered", artifacts: [{ id: "a1", format: "csv", fileKey: "k", createdAt: "" }] }));

    const refetchOrder = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useSendFlow({ orderId: "ord-1", order, labels: LABELS, refetchOrder }),
    );

    await act(async () => {
      await result.current.confirmSend();
    });

    // The re-read says DELIVERED → success, never a red "Send failed".
    expect(result.current.flowSeverity).toBe("success");
    expect(result.current.crossed).toBe(true);
    expect(result.current.flowNotice).not.toMatch(/send failed/i);
  });

  test("a send error re-reads server truth: TRANSFORMING (in-flight) → neutral info, not red", async () => {
    const order = makeOrder({ status: "pending_review", artifacts: [] });

    // The send throws but the order is still mid-transform server-side — the re-read
    // returns TRANSFORMING, so a neutral "still processing" note shows, not red.
    sendThrowsThenReReads(makeOrder({ status: "transforming", artifacts: [] }));

    const refetchOrder = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useSendFlow({ orderId: "ord-1", order, labels: LABELS, refetchOrder }),
    );

    await act(async () => {
      await result.current.confirmSend();
    });

    // In-flight → a neutral "still processing" info notice, NOT a red error.
    expect(result.current.flowSeverity).toBe("info");
    expect(result.current.flowNotice).toMatch(/still processing/i);
    expect(result.current.crossed).toBe(false);
  });

  test("poll times out AND the re-read also fails → honest red error (the only red case)", async () => {
    const order = makeOrder({ status: "pending_review", artifacts: [] });

    // Every call rejects, including the outer-catch re-read → the hook MUST surface
    // the honest error (this is the one path that should still go red).
    api.getOrderById.mockImplementation(() => Promise.reject(new Error("Network down")));

    const refetchOrder = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useSendFlow({ orderId: "ord-1", order, labels: LABELS, refetchOrder }),
    );

    let sendPromise!: Promise<void>;
    act(() => {
      sendPromise = result.current.confirmSend();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(47_000);
      await sendPromise;
    });

    expect(result.current.flowSeverity).toBe("error");
    expect(result.current.crossed).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (2c) Remount resilience: when the order loads already in an in-flight server
// state, the hook reflects it instead of showing a misleading idle CTA; when the
// order later settles, the hook releases back to idle (the button never sticks).
// ─────────────────────────────────────────────────────────────────────────────
describe("Fix 2c — sendState reflects the in-flight server status on mount, then releases", () => {
  test("an order loaded as 'transforming' makes sendState 'transforming' (not idle)", async () => {
    api.getOrderById.mockResolvedValue(makeOrder({ status: "transforming" }));
    const refetchOrder = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useSendFlow({ orderId: "ord-1", order: makeOrder({ status: "transforming" }), labels: LABELS, refetchOrder }),
    );

    // The remount-resilience effect runs after paint — flush it.
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.sendState).toBe("transforming");
  });

  test("once the order settles to ready_to_deliver, sendState releases back to idle", async () => {
    api.getOrderById.mockResolvedValue(makeOrder({ status: "ready_to_deliver" }));
    const refetchOrder = vi.fn().mockResolvedValue(undefined);

    // Start mid-transform, then rerender with the settled order (mirrors the
    // useOrderReview query auto-refetch converging after the transform finishes).
    const { result, rerender } = renderHook(
      ({ order }) => useSendFlow({ orderId: "ord-1", order, labels: LABELS, refetchOrder }),
      { initialProps: { order: makeOrder({ status: "transforming" }) } },
    );
    await act(async () => { await Promise.resolve(); });
    expect(result.current.sendState).toBe("transforming");

    rerender({ order: makeOrder({ status: "ready_to_deliver", artifacts: [{ id: "a1", format: "csv", fileKey: "k", createdAt: "" }] }) });
    await act(async () => { await Promise.resolve(); });

    // The button must NOT stick on "Generating…" — it releases to idle so the green
    // Send CTA takes over.
    expect(result.current.sendState).toBe("idle");
  });

  test("an order loaded as ready_to_deliver stays idle (resting state, green Send CTA)", async () => {
    api.getOrderById.mockResolvedValue(makeOrder({ status: "ready_to_deliver" }));
    const refetchOrder = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useSendFlow({
        orderId: "ord-1",
        order: makeOrder({ status: "ready_to_deliver", artifacts: [{ id: "a1", format: "csv", fileKey: "k", createdAt: "" }] }),
        labels: LABELS,
        refetchOrder,
      }),
    );
    await act(async () => { await Promise.resolve(); });

    expect(result.current.sendState).toBe("idle");
  });
});
