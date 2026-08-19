import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BillingPlan, BillingStatus } from "@/types/procurement";
import { PLAN_BY_ID, CHECKOUT_PLAN_IDS, billingPriceLabelFor } from "@/lib/plans";

// ─────────────────────────────────────────────────────────────────────────────
// THE DEFECT, exactly.
//
// PLAN_META is built once at module scope from plans.ts `billingPriceLabel` — the
// MONTHLY price and nothing else. The plan card printed it unconditionally, so an
// annual workspace saw "€149/mo" with "Billed annually" directly beneath it. A
// reader multiplies and gets €1,788. Stripe charges €1,488. The card overstated
// the bill by exactly the 17% annual discount the customer had just taken, on all
// four self-serve tiers — and plans.ts has carried `priceYearly` the whole time.
//
// Verified against real Stripe test-mode traffic: a €1,488/yr Growth subscription
// (price id from Stripe:GrowthYearlyPriceId, recurring interval "year") rendered
// "€149/mo" on the billing screen.
// ─────────────────────────────────────────────────────────────────────────────

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

function billing(over: Partial<BillingStatus> = {}): BillingStatus {
  return {
    plan: "growth",
    accountStatus: "active",
    ordersThisMonth: 12,
    orderLimit: 150,
    suppliersUsed: 2,
    supplierLimit: 5,
    trialStartedAt: null,
    trialEndsAt: null,
    isTrialExpired: false,
    isOrderLimitReached: false,
    isSupplierLimitReached: false,
    canProcessOrders: true,
    canAddSupplier: true,
    stripeCustomerId: "cus_live",
    stripeSubscriptionId: "sub_live",
    overageOrders: 0,
    overageAmountEur: 0,
    nearLimit: false,
    atLimit: false,
    billingInterval: "yearly",
    ...over,
  };
}

async function renderBilling(status: BillingStatus) {
  api.getBillingStatus.mockResolvedValue(status);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={qc}>
      <BillingSection />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(api.getBillingStatus).toHaveBeenCalled());
  await screen.findByText("Current plan");
  return view;
}

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  api.createPortalSession.mockReturnValue(new Promise<string>(() => {}));
  api.createCheckoutSession.mockReturnValue(new Promise<string>(() => {}));
});
afterEach(cleanup);

function yearlyLabel(plan: (typeof PLAN_BY_ID)[keyof typeof PLAN_BY_ID]): string {
  return "€" + plan.priceYearly!.toLocaleString("en-US") + "/yr";
}

describe("billingPriceLabelFor derives the price from the interval actually billed", () => {
  it("names the YEARLY total on an annual subscription, for every self-serve tier", () => {
    // Anti-vacuity floor: an empty ladder would make the loop below pass silently.
    expect(CHECKOUT_PLAN_IDS.length).toBeGreaterThanOrEqual(4);

    for (const id of CHECKOUT_PLAN_IDS) {
      const plan = PLAN_BY_ID[id];
      expect(plan.priceYearly, id + " must have a yearly price to name").not.toBeNull();

      const yearly = billingPriceLabelFor(plan, "yearly");
      const monthly = billingPriceLabelFor(plan, "monthly");

      expect(monthly, id + " monthly").toBe(plan.billingPriceLabel);
      expect(yearly, id + " must not print the monthly price on an annual plan").not.toBe(monthly);
      expect(yearly).toBe(yearlyLabel(plan));

      // The number shown must be the number charged — the whole point of the fix.
      const digits = Number(yearly.replace(/[^0-9]/g, ""));
      expect(digits, id + " label must equal priceYearly").toBe(plan.priceYearly);
      // ...and strictly less than 12x the monthly price, i.e. the discount is real
      // and the old label really was an overstatement.
      expect(digits).toBeLessThan(plan.priceMonthly! * 12);
    }
  });

  it("falls back to the monthly label when there is no yearly price to name", () => {
    // Pilot and Enterprise carry priceYearly: null by design.
    expect(PLAN_BY_ID.pilot.priceYearly).toBeNull();
    expect(billingPriceLabelFor(PLAN_BY_ID.pilot, "yearly")).toBe(PLAN_BY_ID.pilot.billingPriceLabel);
    expect(billingPriceLabelFor(PLAN_BY_ID.enterprise, "yearly")).toBe(
      PLAN_BY_ID.enterprise.billingPriceLabel,
    );
  });

  it("treats a null or absent interval as monthly, never as annual", () => {
    expect(billingPriceLabelFor(PLAN_BY_ID.growth, null)).toBe(PLAN_BY_ID.growth.billingPriceLabel);
    expect(billingPriceLabelFor(PLAN_BY_ID.growth, undefined)).toBe(PLAN_BY_ID.growth.billingPriceLabel);
  });
});

// jsdom applies no Tailwind, so breakpoint-specific subtrees BOTH mount. Every
// assertion below is scoped to the plan card so it cannot pass against the wrong one.
describe("the plan card prints the price the workspace is actually charged", () => {
  it("an annual Growth workspace is not shown the monthly price", async () => {
    await renderBilling(billing({ plan: "growth", billingInterval: "yearly" }));

    const card = within(screen.getByTestId("plan-card"));
    expect(card.getByText(yearlyLabel(PLAN_BY_ID.growth))).toBeTruthy();
    expect(
      card.queryByText(PLAN_BY_ID.growth.billingPriceLabel),
      "€149/mo above 'Billed annually' reads as €1,788 a year",
    ).toBeNull();
    // The interval line stays — it is what makes the yearly figure legible.
    expect(card.getByText("Billed annually")).toBeTruthy();
  });

  it("a monthly workspace is unchanged — the control that proves the test bites", async () => {
    await renderBilling(billing({ plan: "growth", billingInterval: "monthly" }));

    const card = within(screen.getByTestId("plan-card"));
    expect(card.getByText(PLAN_BY_ID.growth.billingPriceLabel)).toBeTruthy();
    expect(card.queryByText(yearlyLabel(PLAN_BY_ID.growth))).toBeNull();
    expect(card.getByText("Billed monthly")).toBeTruthy();
  });

  for (const id of ["operations", "integration", "distributor"] as BillingPlan[]) {
    it("an annual " + id + " workspace shows its yearly total", async () => {
      const plan = PLAN_BY_ID[id];
      await renderBilling(billing({ plan: id, billingInterval: "yearly" }));
      const card = within(screen.getByTestId("plan-card"));
      expect(card.getByText(yearlyLabel(plan))).toBeTruthy();
      expect(card.queryByText(plan.billingPriceLabel)).toBeNull();
    });
  }
});
