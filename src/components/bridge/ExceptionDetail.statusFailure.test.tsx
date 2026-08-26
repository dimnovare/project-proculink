import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Order, OrderException } from "@/types/procurement";

// ─────────────────────────────────────────────────────────────────────────────
// THE STATUS SHIMMER ANIMATED FOREVER.
//
// THE DEFECT, VERBATIM:
//
//     const { data: order, isLoading } = useQuery({          // isError never read
//       queryKey: ["order", orderId], …, retry: 1,
//     });
//     …
//     {!orderId ? … : isLoading || !order ? (
//       <span className="… animate-pulse" />                 // ← terminal state
//
// Once `retry: 1` was exhausted, `isLoading` went false and `order` stayed
// undefined, so the render fell through to `!order` and the skeleton kept
// pulsing. Forever. Under a page whose own instruction line promises that
// expanding a row shows "what's wrong, why, how to fix it, and its REAL DELIVERY
// STATUS".
//
// A pulsing skeleton is not a neutral placeholder — it is an assertion that an
// answer is on its way. Here no answer was ever coming, and the operator's only
// options were to keep waiting or to assume. On a screen that exists to resolve
// stuck deliveries, "assume" is the expensive one.
//
// This is the third instance of one pattern in this packet: `isError` present on
// the query object, never destructured, and the fallthrough branch happens to be
// a reassuring one.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The component sets `retry: 1`, which beats the test client's `retry: false` —
 * so a rejected fetch is not terminal until the retry AND its ~1s backoff have
 * elapsed. Testing Library's default 1000ms waitFor window expires first, which
 * would report the fix as broken. `--testTimeout=60000` does not help: it bounds
 * the TEST, not the wait.
 */
const RETRY_WAIT = { timeout: 15_000 } as const;

const getOrderById = vi.fn();

vi.mock("@/lib/api-client", () => ({
  apiClient: { getOrderById: (...a: unknown[]) => getOrderById(...a) },
}));

vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => true, useTenantQueriesEnabled: () => true }));

import { ExceptionDetail } from "./ExceptionDetail";

const EXC: OrderException = {
  id: "exc-1",
  severity: "error",
  message: "Supplier item code missing on 3 lines.",
  createdAt: "2026-08-15T09:00:00.000Z",
  orderId: "ord-77",
  stage: "validate",
  code: "unresolved_mapping",
  state: "open",
};

/** Minimal live order. `delivery_failed` so the healthy branch has a real badge. */
const ORDER = {
  id: "ord-77",
  poNumber: "PO-9001",
  status: "delivery_failed",
  supplierId: "sup-1",
  lines: [],
} as unknown as Order;

function renderDetail(exc: OrderException = EXC) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { container } = render(
    <QueryClientProvider client={client}>
      <ExceptionDetail exc={exc} />
    </QueryClientProvider>,
  );
  return container;
}

/**
 * The Status section, by its own heading. jsdom applies no Tailwind, so every
 * branch of this component's markup is in the document at once and an unscoped
 * text query would happily read a different section's copy. `scopingBites`
 * below proves this narrows.
 */
function statusSection(container: HTMLElement): HTMLElement {
  const heading = within(container).getByText("Status");
  const section = heading.closest("div")?.parentElement;
  if (!section) throw new Error("Status section not found");
  return section as HTMLElement;
}

function shimmerCount(container: HTMLElement): number {
  return container.querySelectorAll(".animate-pulse").length;
}

beforeEach(() => {
  getOrderById.mockReset();
});

afterEach(cleanup);

describe("exception detail status — scoping control (anti-vacuity)", () => {
  it("the Status section really is narrower than the whole detail body", async () => {
    getOrderById.mockResolvedValue(ORDER);
    const container = renderDetail();

    await waitFor(() => expect(getOrderById).toHaveBeenCalled());
    // Section 1's message is in the container and must NOT be inside Status. If
    // the scoping helper silently returned the whole body, this would fail and
    // every scoped assertion below would be a body-wide search.
    expect(within(container).getByText(EXC.message)).toBeTruthy();
    expect(within(statusSection(container)).queryByText(EXC.message)).toBeNull();
  });
});

describe("exception detail status — a failed order fetch stops pretending to load", () => {
  it("replaces the shimmer with a stated failure", async () => {
    getOrderById.mockRejectedValue(new Error("500 Internal Server Error"));
    const container = renderDetail();

    await waitFor(() =>
      expect(
        within(statusSection(container)).getByText(/couldn't load this order's delivery status/i),
      ).toBeTruthy(),
      RETRY_WAIT,
    );
    // The defect itself: the animation that never ends.
    expect(shimmerCount(container)).toBe(0);
  });

  it("does not let the failure read as a verdict about the order", async () => {
    getOrderById.mockRejectedValue(new Error("500 Internal Server Error"));
    const container = renderDetail();

    await waitFor(() =>
      expect(
        within(statusSection(container)).getByText(/couldn't load this order's delivery status/i),
      ).toBeTruthy(),
      RETRY_WAIT,
    );
    expect(within(statusSection(container)).getByText(/not the same as/i)).toBeTruthy();
  });

  it("offers a way out", async () => {
    getOrderById.mockRejectedValue(new Error("500 Internal Server Error"));
    renderDetail();

    expect(await screen.findByRole("button", { name: /try again/i }, RETRY_WAIT)).toBeTruthy();
  });
});

describe("exception detail status — the healthy and empty paths are untouched (controls)", () => {
  it("still renders the real status badge when the order loads", async () => {
    // Same component, same exception, one difference: the fetch resolves. If the
    // failure copy showed up here too, the tests above would prove nothing.
    getOrderById.mockResolvedValue(ORDER);
    const container = renderDetail();

    await waitFor(() => expect(shimmerCount(container)).toBe(0));
    expect(
      within(statusSection(container)).queryByText(/couldn't load this order's delivery status/i),
    ).toBeNull();
  });

  it("still says 'No owning order.' for an exception with no order — not a failure", async () => {
    // The other thing that must not be swallowed by the new branch: a genuinely
    // order-less exception never fetches at all, and that is not an error.
    const container = renderDetail({ ...EXC, orderId: null });

    expect(within(statusSection(container)).getByText("No owning order.")).toBeTruthy();
    expect(
      within(statusSection(container)).queryByText(/couldn't load this order's delivery status/i),
    ).toBeNull();
    expect(getOrderById).not.toHaveBeenCalled();
  });
});
