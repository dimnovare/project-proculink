import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BillingStatus, Order } from "@/types/procurement";
import { ConfirmProvider } from "@/components/ui/confirm";
import { pausedCauseCopy } from "@/lib/billingPause";

/**
 * D-F9 — the read-only presentation was DEAD CODE.
 *
 * `OrderProblemPanel` declared `readOnly?: boolean` with a `false` default, `ProblemCtx`
 * carried it, `postGuard()` branched on it and `READ_ONLY_REASON` was written for it — and
 * not one of the two production call sites (OrderWorkshop.tsx:1037, :1230) ever passed it.
 * So a workspace the server had already stopped saw the full-capability panel: a live
 * "Start sending again" whose POST could only come back refused, and no sentence anywhere
 * saying why. The reason string was unreachable from the running app.
 *
 * These tests render the real panel against a real billing answer. They fail if the wiring
 * is removed, if the gate is re-written as a plan-name check, or if the reason stops naming
 * the cause.
 *
 * ── ANTI-VACUITY ──────────────────────────────────────────────────────────────────────────
 * "the button is disabled" passes trivially against a panel that failed to render at all, so
 * every blocked case below is paired with a healthy org that renders the SAME control ENABLED.
 */

const api = {
  getBillingStatus: vi.fn(),
  requeueDelivery: vi.fn(),
  getOrderPassport: vi.fn(),
};

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    getOrderPassport: (...a: unknown[]) => api.getOrderPassport(...a),
    getOrderById: vi.fn(),
    redeliverOrder: vi.fn(),
    markDelivered: vi.fn(),
    transformOrder: vi.fn(),
    retryDelivery: vi.fn(),
  },
  requeueDelivery: (...a: unknown[]) => api.requeueDelivery(...a),
  getBillingStatus: (...a: unknown[]) => api.getBillingStatus(...a),
  getOpsHealth: vi.fn().mockResolvedValue({ workerHealthy: true }),
}));

vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => true }));

import { OrderProblemPanel } from "../OrderProblemPanel";

/**
 * Out of retries: it carries BOTH a recovery POST ("Start sending again") and a plain link
 * ("Check the delivery settings"), so one fixture proves the POST is blocked and the route
 * to the fix is not.
 */
const DEAD_LETTER = {
  id: "ord-ro-1",
  poNumber: "PO-77120",
  status: "delivery_dead_letter",
  supplierId: "sup-4",
  supplierName: "Nordmark",
  currency: "EUR",
  orderDate: "2026-08-14",
  lines: [],
  artifacts: [],
  errorMessage: null,
} as unknown as Order;

const RETRY_BUTTON = "Start sending again";

/** A full billing answer, so a test only has to state the field it is about. */
function billing(over: Partial<BillingStatus> = {}): BillingStatus {
  return {
    plan: "operations",
    accountStatus: "active",
    ordersThisMonth: 12,
    orderLimit: 500,
    suppliersUsed: 3,
    supplierLimit: 10,
    trialStartedAt: null,
    trialEndsAt: null,
    isTrialExpired: false,
    isOrderLimitReached: false,
    isSupplierLimitReached: false,
    canProcessOrders: true,
    canAddSupplier: true,
    stripeCustomerId: "cus_1",
    stripeSubscriptionId: "sub_1",
    overageOrders: 0,
    overageAmountEur: 0,
    nearLimit: false,
    atLimit: false,
    billingInterval: "monthly",
    ...over,
  } as BillingStatus;
}

/**
 * Renders the panel and returns a scope BOUND TO THE PANEL.
 *
 * The decoy is the control that proves the scoping bites: it sits outside the panel and
 * carries the exact sentence under test, so a query that forgot to scope would find two
 * matches (or the wrong one) instead of the panel's own.
 */
async function renderPanel(status: BillingStatus | Error, decoy?: string) {
  if (status instanceof Error) api.getBillingStatus.mockRejectedValue(status);
  else api.getBillingStatus.mockResolvedValue(status);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ConfirmProvider>
        {decoy ? <div data-testid="decoy">{decoy}</div> : null}
        <OrderProblemPanel order={DEAD_LETTER} />
      </ConfirmProvider>
    </QueryClientProvider>,
  );
  return within(await screen.findByTestId("order-problem-panel"));
}

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.getOrderPassport.mockResolvedValue(null);
});
afterEach(cleanup);

describe("a workspace the server has stopped is told so, on the control it blocks", () => {
  it("disables the recovery POST and says WHY, naming the real cause", async () => {
    const panel = await renderPanel(billing({ accountStatus: "past_due", canProcessOrders: false }));

    const button = await panel.findByRole("button", { name: RETRY_BUTTON });
    expect(button).toBeDisabled();

    // Derived from the billing screen's own map, not typed here: rename the headline in
    // pausedCauseCopy and this fails, which is the only way two surfaces stay in step.
    const cause = pausedCauseCopy("past_due").headline;
    expect(cause).toBe("Your last payment didn't go through."); // the map really says this
    expect(await panel.findByText(new RegExp(cause.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))).toBeTruthy();

    // And it routes somewhere. A cause with no way out is half an answer.
    expect(panel.getByText(/Settings → Billing/)).toBeTruthy();
  });

  it("does NOT tell a paying customer their Pilot ended", async () => {
    const panel = await renderPanel(
      billing({ plan: "operations", accountStatus: "past_due", canProcessOrders: false }),
    );
    await panel.findByRole("button", { name: RETRY_BUTTON });

    // The frozen string this replaces. It was the ONLY read-only sentence in the build,
    // so every blocked workspace — Growth, Operations, Distributor — would have read it.
    expect(panel.queryByText(/Pilot has ended/i)).toBeNull();
  });

  it("names a lapsed trial as a lapsed trial", async () => {
    const panel = await renderPanel(
      billing({ plan: "pilot", accountStatus: "trial_expired", canProcessOrders: false }),
    );
    expect(await panel.findByRole("button", { name: RETRY_BUTTON })).toBeDisabled();
    expect(panel.getByText(/Your trial has ended\./)).toBeTruthy();
  });

  it("says the pause without inventing a cause when the status is one we don't know", async () => {
    const panel = await renderPanel(
      billing({ accountStatus: "some_status_this_build_has_never_seen", canProcessOrders: false }),
    );
    expect(await panel.findByRole("button", { name: RETRY_BUTTON })).toBeDisabled();
    expect(panel.getByText(/Order processing is paused on your account\./)).toBeTruthy();
    expect(panel.queryByText(/payment/i)).toBeNull();
    expect(panel.queryByText(/subscription/i)).toBeNull();
  });

  it("blocks the POST but never the route to the fix, or the explanation", async () => {
    const panel = await renderPanel(billing({ accountStatus: "cancelled", canProcessOrders: false }));
    await panel.findByRole("button", { name: RETRY_BUTTON });

    // A read-only workspace can still READ and still navigate (CLAUDE.md §11.5).
    expect(panel.getByRole("link", { name: "Check the delivery settings" })).toBeTruthy();
    // The state's own explanation is untouched by the block.
    expect(panel.getByText(/We stopped trying to reach this supplier/)).toBeTruthy();
  });
});

describe("the gate is the server's canProcessOrders — not a plan name", () => {
  // ANTI-VACUITY + the actual regression guard. `plan === "pilot"` is the check that
  // caused the defect CLAUDE.md §11.5 records; these two cases disagree with it in both
  // directions, so re-introducing it fails one of them.
  it("leaves the control LIVE for a healthy paid workspace", async () => {
    const panel = await renderPanel(billing({ plan: "operations", canProcessOrders: true }));
    expect(await panel.findByRole("button", { name: RETRY_BUTTON })).toBeEnabled();
    expect(panel.queryByText(/Settings → Billing/)).toBeNull();
  });

  it("leaves the control LIVE for an ACTIVE Pilot — a plan name is not a verdict", async () => {
    const panel = await renderPanel(
      billing({ plan: "pilot", accountStatus: "trialing", canProcessOrders: true }),
    );
    expect(await panel.findByRole("button", { name: RETRY_BUTTON })).toBeEnabled();
    expect(panel.queryByText(/Settings → Billing/)).toBeNull();
  });

  it("blocks a NON-Pilot workspace — read-only is not a Pilot state", async () => {
    const panel = await renderPanel(
      billing({ plan: "distributor", accountStatus: "read_only", canProcessOrders: false }),
    );
    expect(await panel.findByRole("button", { name: RETRY_BUTTON })).toBeDisabled();
    expect(panel.getByText(/Your subscription isn't active\./)).toBeTruthy();
  });
});

describe("an unknown billing answer never manufactures a block", () => {
  it("keeps the control live when the billing call fails", async () => {
    const panel = await renderPanel(new Error("billing/status: 503"));
    expect(await panel.findByRole("button", { name: RETRY_BUTTON })).toBeEnabled();
    expect(panel.queryByText(/Settings → Billing/)).toBeNull();
  });
});

describe("the scoping in this file bites", () => {
  it("a decoy carrying the same sentence outside the panel is NOT what these tests read", async () => {
    const sentence = pausedCauseCopy("past_due").headline;
    const panel = await renderPanel(
      billing({ accountStatus: "past_due", canProcessOrders: false }),
      sentence,
    );
    await panel.findByRole("button", { name: RETRY_BUTTON });

    // Unscoped: two matches — the decoy and the panel's own reason. An unscoped
    // getByText would have thrown, and a getAllByText would have hidden which is which.
    expect(screen.getAllByText(new RegExp(sentence.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).length)
      .toBeGreaterThan(1);
    // Scoped: exactly the panel's.
    expect(
      panel.getAllByText(new RegExp(sentence.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))),
    ).toHaveLength(1);
    expect(within(screen.getByTestId("decoy")).getByText(sentence)).toBeTruthy();
  });
});
