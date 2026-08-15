// A-F8d — a failed checkout printed a raw status line or an internal code at the customer.
//
// Both upgrade blocks rendered
//
//     {(checkoutMutation.error as Error)?.message || "Could not start checkout. Please try again."}
//
// and NOTHING on this path writes a message for a person to read:
//
//   • `readRefusal` (src/lib/api/refusal.ts) puts the body's `error` field into the message
//     verbatim — the machine token, on purpose, so a downstream reader can pull the plan out
//     of a gate code. `BillingSection` had no such reader.
//   • when the body carries no `error` field, that same function falls back to the string
//     `billing.ts` handed it: `billing/checkout: <status>` — an internal label with an HTTP
//     number in it, built by the CLIENT.
//
// So the last screen a customer sees before paying showed one of those. The portal button on
// the same component had had `portalErrorCopy` since #203; the checkout button never got one.
//
// WHAT THIS FILE PINS:
//   1. neither carrier reaches the screen;
//   2. a plan gate and a malfunction are visibly DIFFERENT things — one is an upsell, the
//      other is a fault, and reading either as the other sends the customer the wrong way;
//   3. a role refusal still says "ask an administrator" and never offers an upgrade;
//   4. the success path is untouched (the negative control — a component that renders no
//      failure at all would satisfy every absence assertion above).
//
// Every absence assertion is preceded by a positive one in the same test.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BillingStatus } from "@/types/procurement";
import { orgAdminMessage } from "@/lib/planGate";

const api = {
  getBillingStatus: vi.fn(),
  createPortalSession: vi.fn(),
  createCheckoutSession: vi.fn(),
};

vi.mock("@/lib/api-client", () => ({
  getBillingStatus: () => api.getBillingStatus(),
  createPortalSession: () => api.createPortalSession(),
  createCheckoutSession: (...a: unknown[]) => api.createCheckoutSession(...a),
}));

vi.mock("@/lib/analytics", () => ({ capture: vi.fn() }));

import { BillingSection } from "./BillingSection";

/** A healthy Pilot — the workspace that reaches the upgrade buttons. */
function billing(over: Partial<BillingStatus> = {}): BillingStatus {
  return {
    plan: "pilot",
    accountStatus: "trialing",
    ordersThisMonth: 3,
    orderLimit: 20,
    suppliersUsed: 1,
    supplierLimit: 1,
    trialStartedAt: null,
    trialEndsAt: null,
    isTrialExpired: false,
    isOrderLimitReached: false,
    isSupplierLimitReached: false,
    canProcessOrders: true,
    canAddSupplier: true,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    overageOrders: 0,
    overageAmountEur: 0,
    nearLimit: false,
    atLimit: false,
    billingInterval: "monthly",
    ...over,
  };
}

/** Render, click the real upgrade button, and let checkout be refused with `message`. */
async function refuseCheckoutWith(message: string, status: BillingStatus = billing()) {
  api.getBillingStatus.mockResolvedValue(status);
  api.createCheckoutSession.mockRejectedValue(new Error(message));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <BillingSection />
    </QueryClientProvider>,
  );
  await screen.findByText("Current plan");
  fireEvent.click(await screen.findByRole("button", { name: /Upgrade to Growth/i }));
  await waitFor(() => expect(api.createCheckoutSession).toHaveBeenCalled());
}

const pageText = () => document.body.textContent ?? "";

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  api.createPortalSession.mockReturnValue(new Promise<string>(() => {}));
});
afterEach(cleanup);

describe("A-F8d — a refused checkout never shows a status line or an internal code", () => {
  it("the_client_built_status_line_never_reaches_the_customer", async () => {
    // The exact fallback `billing.ts` passes to readRefusal when the body has no `error`.
    await refuseCheckoutWith("billing/checkout: 502");

    const line = await screen.findByTestId("checkout-error");
    // Positive first — there IS a sentence, and it says what to do next.
    expect(line.textContent).toContain("Could not start checkout");
    expect(line.textContent).toContain("contact support");

    // Then the defect, verbatim.
    expect(pageText()).not.toContain("billing/checkout");
    expect(pageText()).not.toContain("502");
  });

  it("an_internal_code_never_reaches_the_customer", async () => {
    await refuseCheckoutWith("stripe_price_not_configured");

    const line = await screen.findByTestId("checkout-error");
    expect(line.textContent).toContain("Could not start checkout");
    expect(pageText()).not.toContain("stripe_price_not_configured");
  });

  it("a_plan_gate_reads_as_an_upsell_and_not_as_a_fault", async () => {
    await refuseCheckoutWith("plan_change_requires_operations");

    // The amber gate banner, with the plan derived from the code the SERVER wrote.
    const gate = await screen.findByRole("status");
    expect(gate.textContent).toContain("This plan change is not included in your plan");
    expect(gate.textContent).toContain("Operations");
    expect(pageText()).not.toContain("plan_change_requires_operations");

    // And NOT the red malfunction line. If both arms rendered, or if the gate fell through
    // to the generic copy, "something broke" and "you need a bigger plan" would be the same
    // message — which is the failure mode this whole packet is about.
    expect(screen.queryByTestId("checkout-error")).toBeNull();
  });

  it("a_role_refusal_asks_for_an_administrator_and_offers_no_upgrade", async () => {
    // `refusal.ts` already swaps this code for the finished sentence, so the component sees
    // prose — and must still not print it through the generic arm, which would lose it.
    await refuseCheckoutWith(orgAdminMessage());

    const line = await screen.findByTestId("checkout-error");
    expect(line.textContent).toBe(orgAdminMessage());
    expect(pageText()).not.toContain("Could not start checkout");
    expect(pageText()).not.toContain("not included in your plan");
  });

  it("nothing_is_shown_while_checkout_is_still_in_flight", async () => {
    // The negative control. A component that rendered its failure line unconditionally would
    // satisfy every "the raw string is absent" assertion above by never showing the raw
    // string — and would also shout at a customer whose checkout is working.
    api.getBillingStatus.mockResolvedValue(billing());
    api.createCheckoutSession.mockReturnValue(new Promise<string>(() => {}));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <BillingSection />
      </QueryClientProvider>,
    );
    await screen.findByText("Current plan");
    fireEvent.click(await screen.findByRole("button", { name: /Upgrade to Growth/i }));
    await waitFor(() => expect(api.createCheckoutSession).toHaveBeenCalled());

    expect(screen.queryByTestId("checkout-error")).toBeNull();
    expect(pageText()).not.toContain("Could not start checkout");
  });
});
