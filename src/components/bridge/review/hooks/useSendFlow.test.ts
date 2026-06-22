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
  getOrderAudit: vi.fn(),
};

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    getOrderById: (...a: unknown[]) => api.getOrderById(...a),
    transformOrder: (...a: unknown[]) => api.transformOrder(...a),
    redeliverOrder: (...a: unknown[]) => api.redeliverOrder(...a),
    getOrderAudit: (...a: unknown[]) => api.getOrderAudit(...a),
  },
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
  api.getOrderAudit.mockReset().mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
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
