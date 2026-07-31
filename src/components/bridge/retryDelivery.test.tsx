import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Retry delivery — "the click did something" guard.
//
// POST /api/orders/{id}/retry-delivery answers 202 { status: "delivery_failed",
// retrying: true } and LEAVES the row in delivery_failed on purpose: pre-flipping it
// to `delivering` defeated the job's own atomic claim and stranded the dispatch for
// ~30 minutes. The Worker claims the row and flips it seconds later.
//
// Every assertion here exists because the panel previously said something false or
// useless about that window:
//   • it invalidated ["order", id] the instant the 202 landed, raced the Worker, and
//     re-rendered "Delivery to supplier failed" — the click read as a no-op;
//   • it never polled, so the panel sat on the failure until a manual reload;
//   • the mock faked {status:"delivering"} + a delivered jump the API never performs.
//
// The negative assertions are the point: this panel must never claim `delivering`
// before the row holds it.

vi.mock("next/navigation", () => ({
  usePathname: () => "/inbox/ord-1",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const retryDelivery = vi.fn();
const getOrderById = vi.fn();

vi.mock("@/lib/api-client", () => ({
  isApiMockMode: false,
  apiClient: {
    retryDelivery: (...args: unknown[]) => retryDelivery(...args),
    getOrderById: (...args: unknown[]) => getOrderById(...args),
    getOrderPassport: vi.fn().mockResolvedValue(null),
  },
  requeueDelivery: vi.fn(),
  getOpsHealth: vi.fn().mockResolvedValue({ workerHealthy: true }),
}));

vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => true }));

// The panel under test moved: FailedPanel(stage="delivery") was retired into the
// one OrderProblemPanel (WP-24), which reads its copy from PROBLEM_COPY and its
// pending/claim-window behaviour from useProblemAction — a port of the very hook
// this file was written to pin. The contract is unchanged; only the labels are.
import { OrderProblemPanel } from "./problem/OrderProblemPanel";
import type { Order } from "@/types/procurement";

const FAILED_ORDER = {
  id: "ord-1",
  poNumber: "PO-77120",
  status: "delivery_failed",
  supplierId: "sup-1",
  supplierName: "Nordmark",
  errorMessage: "Supplier endpoint returned 503.",
} as unknown as Order;

function renderPanel(order: Order = FAILED_ORDER) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    qc,
    ...render(
      <QueryClientProvider client={qc}>
        <OrderProblemPanel order={order} />
      </QueryClientProvider>,
    ),
  };
}

beforeEach(() => {
  retryDelivery.mockReset();
  getOrderById.mockReset();
  // The contract the backend actually ships: the row has NOT moved yet.
  retryDelivery.mockResolvedValue({ status: "delivery_failed", retrying: true });
});

afterEach(cleanup);

describe("retry delivery — the 202 window is visible and honest", () => {
  it("acknowledges the retry even though the server still says delivery_failed", async () => {
    // The Worker hasn't claimed the row yet — exactly the race the old code lost.
    getOrderById.mockResolvedValue({ ...FAILED_ORDER });

    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /try sending now/i }));

    await waitFor(() => expect(retryDelivery).toHaveBeenCalledWith("ord-1"));
    // The whole bug: this is the moment the panel used to look untouched.
    expect(await screen.findByRole("status")).toHaveTextContent(/queued/i);
    expect(screen.getByRole("button", { name: /queued/i })).toBeDisabled();
  });

  it("never claims the order is sending before the row says so", async () => {
    getOrderById.mockResolvedValue({ ...FAILED_ORDER });

    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /try sending now/i }));
    await screen.findByRole("status");

    // The queued strip reports OUR REQUEST, not a server status. If these ever pass,
    // the client has started inventing `delivering` again — the exact lie the backend
    // fix removed.
    expect(screen.queryByText(/\bsending\b/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\bdelivering\b/i)).not.toBeInTheDocument();
    // The failure header stays: the row IS still delivery_failed.
    expect(screen.getByText(/we couldn't reach this supplier/i)).toBeInTheDocument();
  });

  it("polls past the 202 and publishes the claim once the Worker takes the row", async () => {
    // First read: not claimed yet. Second: the Worker's claim landed.
    getOrderById
      .mockResolvedValueOnce({ ...FAILED_ORDER })
      .mockResolvedValue({ ...FAILED_ORDER, status: "delivering", errorMessage: null });

    const { qc } = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /try sending now/i }));

    // The cache is what the workshop's delivery_failed gate reads: once it holds
    // `delivering`, the gate stops matching and this panel gives way to the send
    // progress CTA. Without the poll, nothing ever wrote this.
    await waitFor(
      () => expect((qc.getQueryData(["order", "ord-1"]) as Order | undefined)?.status).toBe("delivering"),
      { timeout: 5_000 },
    );
    expect(getOrderById.mock.calls.length).toBeGreaterThan(1);
  }, 10_000);

  it("stays disabled while our job is outstanding, so a second click can't burn the retry budget", async () => {
    // The Worker hasn't claimed yet, so the row is still delivery_failed — which is
    // exactly when a second POST is now ACCEPTED (the endpoint's
    // `status != delivery_failed → 400` guard only blocked duplicates by accident,
    // via the old pre-flip). Two jobs → the second claims the row job A just failed
    // back to delivery_failed (the claim has no staleness gate on that status) →
    // burns an attempt → dead-letters the order. The button is the only thing
    // standing between an anxious operator and a dead-lettered PO.
    getOrderById.mockResolvedValue({ ...FAILED_ORDER });

    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /try sending now/i }));
    await screen.findByRole("status");

    const btn = screen.getByRole("button", { name: /queued/i });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(retryDelivery).toHaveBeenCalledTimes(1);
  });

  it("surfaces a rejected retry as an error, not as a queued retry", async () => {
    retryDelivery.mockRejectedValue(new Error("retry-delivery failed: Order is in dead-letter state."));

    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /try sending now/i }));

    // No job was enqueued, so "queued" would be a lie in the other direction.
    expect(await screen.findByText(/dead-letter state/i)).toBeInTheDocument();
    expect(screen.queryByText(/queued/i)).not.toBeInTheDocument();
    // ...and the operator gets the button back.
    await waitFor(() => expect(screen.getByRole("button", { name: /try sending now/i })).toBeEnabled());
  });

  it("keeps the button disabled after the claim window elapses — the job is still queued", async () => {
    // REGRESSION GUARD. An earlier draft re-enabled the button here ("Retry again")
    // on the theory that a second click was safe because the backend takes a per-order
    // lock. It isn't: the mutex serialises duplicate jobs, it does not deduplicate
    // them, so the second one burns an attempt and can dead-letter the order. The
    // Worker being slow is the case where an operator is MOST likely to click again,
    // so re-arming the button here is precisely the wrong move.
    vi.useFakeTimers();
    try {
      getOrderById.mockResolvedValue({ ...FAILED_ORDER });
      renderPanel();
      fireEvent.click(screen.getByRole("button", { name: /try sending now/i }));

      // Drive past CLAIM_WINDOW_MS (30s) with the row never leaving delivery_failed.
      // Inside act(): the poll resolves and flips phase → "slow" on a timer, so the
      // re-render happens outside React's knowledge otherwise.
      await act(async () => { await vi.advanceTimersByTimeAsync(35_000); });

      expect(screen.getByText(/waiting for it to start/i)).toBeInTheDocument();
      // Never reads as a failure, and never re-arms.
      expect(screen.queryByText(/retry again/i)).not.toBeInTheDocument();
      const btn = screen.getByRole("button", { name: /queued/i });
      expect(btn).toBeDisabled();
      fireEvent.click(btn);
      expect(retryDelivery).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not fire a retry that can only 400 while delivery config is missing", async () => {
    const configless = { ...FAILED_ORDER, errorMessage: "Supplier delivery config is missing. Add a delivery endpoint before sending this order." } as Order;

    renderPanel(configless);
    const btn = screen.getByRole("button", { name: /try sending now/i });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(retryDelivery).not.toHaveBeenCalled();
  });
});
