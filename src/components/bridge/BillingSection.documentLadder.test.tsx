// Plan 11, Task 7 — Settings → Plan & billing on the document ladder.
//
// A workspace with the document engine is offered Starter / Pro / Business / Scale, sees its
// flow allowance, and is told its own overage rate. The legacy block (engine off)
// is pinned by the other BillingSection.*.test.tsx files, which never report the engine on.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, within, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BillingStatus } from "@/types/procurement";

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
const engine = { state: "on" as "on" | "off" | "unknown" };
vi.mock("@/hooks/useDocumentEngine", () => ({
  useDocumentEngine: () => engine.state,
  flowsQuery: { queryKey: ["flows"], queryFn: async () => [{ id: "flow-1" }] },
}));

import { BillingSection } from "./BillingSection";
import { DOCUMENT_PLANS, PLAN_BY_ID, nextPlanFor } from "@/lib/plans";
import { limitRefusalCopy, readLimitRefusal } from "@/lib/limitRefusal";

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

async function renderWith(status: BillingStatus) {
  api.getBillingStatus.mockResolvedValue(status);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const { container } = render(
    <QueryClientProvider client={qc}>
      <BillingSection />
    </QueryClientProvider>,
  );
  await within(container).findByTestId("plan-card");
  return within(container);
}

beforeEach(() => {
  engine.state = "on";
  Object.values(api).forEach((fn) => fn.mockReset());
  api.createCheckoutSession.mockReturnValue(new Promise<string>(() => {}));
});

describe("BillingSection on the document ladder", () => {
  it("a trial with the engine is offered the document ladder", async () => {
    const view = await renderWith(billing());

    expect(view.getByText(/Plans differ only by documents a month and flows\./)).toBeTruthy();
    // A trial buys any plan on Stripe's own page, as on main.
    for (const p of DOCUMENT_PLANS) expect(view.getByRole("button", { name: `Upgrade to ${p.name}` })).toBeTruthy();
    expect(view.queryByRole("button", { name: `Upgrade to ${PLAN_BY_ID.growth.name}` })).toBeNull();

    const first = DOCUMENT_PLANS[0];
    fireEvent.click(view.getByRole("button", { name: `Upgrade to ${first.name}` }));
    await waitFor(() => expect(api.createCheckoutSession).toHaveBeenCalledWith(first.id, "monthly"));

    expect(await view.findByRole("img", { name: `1 of ${PLAN_BY_ID.pilot.flowLimit} flows used` })).toBeTruthy();
  });

  it("a Starter plan's extra-document line states its own rate", async () => {
    const starter = PLAN_BY_ID.starter;
    // A heavy month: the server's billable overage (141, after the price cap) is not the count of extras.
    const view = await renderWith(
      billing({ plan: "starter", accountStatus: "active", ordersThisMonth: 400, orderLimit: starter.orderLimit!, overageOrders: 141, overageAmountEur: 33.84, atLimit: true, nearLimit: true }),
    );

    const line = view.getByText(/for each extra document/).textContent!;
    expect(line).toContain(`€${starter.overageEur}`);
    expect(line).not.toContain("€0.50");
    expect(view.getByText(`${400 - starter.orderLimit!} extra so far this month, about €33.84 billed.`)).toBeTruthy();
    // A paid document plan changes its live subscription, so its next plan is on offer again.
    expect(view.getByRole("button", { name: `Upgrade to ${PLAN_BY_ID[starter.next!].name}` })).toBeTruthy();

    // Near the limit, the documents line warns in words with the number left.
    const near = await renderWith(billing({ plan: "starter", accountStatus: "active", ordersThisMonth: 130, orderLimit: starter.orderLimit!, nearLimit: true }));
    expect(near.getByText(`Nearly at your limit: ${starter.orderLimit! - 130} left before extra documents start.`)).toBeTruthy();

    const growth = await renderWith(
      billing({ plan: "growth", accountStatus: "active", ordersThisMonth: 160, orderLimit: 150, overageOrders: 10, overageAmountEur: 5, atLimit: true }),
    );
    expect(growth.getByText(/for each extra document/).textContent).toContain(`€${PLAN_BY_ID.growth.overageEur!.toFixed(2)}`);
  });

  it("a trial whose engine is unknown is sold neither ladder", async () => {
    engine.state = "unknown";
    const view = await renderWith(billing());

    expect(within(view.getByRole("region", { name: "Change plan" })).getByText("Loading plans…")).toBeTruthy();
    expect(view.queryAllByRole("button", { name: /Upgrade to/ })).toEqual([]);
  });

  it("a Starter workspace with Stripe: one upgrade button, the next plan's, filled; a paid upgrade asks first; the period reaches checkout", async () => {
    const next = PLAN_BY_ID[PLAN_BY_ID.starter.next!];
    const filledNames = () => [...document.querySelectorAll("button.bg-navy, button.bg-brand-green-btn, button.bg-brand-blue")].map((b) => b.textContent);
    const view = await renderWith(billing({ plan: "starter", accountStatus: "active", orderLimit: PLAN_BY_ID.starter.orderLimit!, stripeCustomerId: "cus_example" }));
    const change = view.getByRole("region", { name: "Change plan" });
    expect(within(change).getByText("Your plan")).toBeTruthy();
    // The comparison shows every plan, but only the next one up is on sale, as before.
    for (const p of DOCUMENT_PLANS) expect(within(change).getByText(p.name)).toBeTruthy();
    expect(within(change).getAllByRole("button").map((b) => b.textContent)).toEqual([`Upgrade to ${next.name}`]);
    expect(filledNames()).toEqual([`Upgrade to ${next.name}`]);
    fireEvent.click(within(view.getByRole("radiogroup", { name: "Billing period" })).getByRole("radio", { name: "Annual" }));
    expect(within(change).getByText(`€${next.priceYearly!.toLocaleString("en-IE")} a year`)).toBeTruthy();
    fireEvent.click(within(change).getByRole("button", { name: `Upgrade to ${next.name}` }));
    expect(api.createCheckoutSession).not.toHaveBeenCalled();
    const confirm = view.getByRole("group", { name: `Confirm upgrade to ${next.name}` });
    // With the confirm open, the one filled button is the one that sends it.
    expect(filledNames()).toEqual(["Upgrade now"]);
    fireEvent.click(within(confirm).getByRole("button", { name: "Upgrade now" }));
    fireEvent.click(within(confirm).getByRole("button", { name: /Upgrad/ }));
    await waitFor(() => expect(api.createCheckoutSession).toHaveBeenCalledTimes(1));
    expect(api.createCheckoutSession).toHaveBeenCalledWith(next.id, "yearly");
    expect(view.getByRole("region", { name: "Payment and invoices" })).toHaveTextContent("Your card, billing email and invoices are kept in Stripe.");
    expect(view.getByRole("region", { name: "If you cancel" })).toHaveTextContent("so tell your senders first.");
  });
});

describe("the trial is called by its plan name, never by its wire id", () => {
  const trial = PLAN_BY_ID.pilot.name;
  const trialWord = trial.toLowerCase();

  it("reads the trial name in every trial state and says Pilot nowhere", async () => {
    const first = await renderWith(billing());
    expect(within(first.getByTestId("plan-card")).getByRole("heading", { level: 2 }).textContent).toBe(trial);
    cleanup();
    const states = [
      { over: {}, expected: [trial, `Documents in your ${trialWord}`] },
      {
        over: { accountStatus: "trial_expired", isTrialExpired: true, canProcessOrders: false } as Partial<BillingStatus>,
        expected: [`${trial} ended · Processing paused`, `Your ${trialWord} has ended.`],
      },
      {
        over: { ordersThisMonth: 20, orderLimit: 20, isOrderLimitReached: true, atLimit: true } as Partial<BillingStatus>,
        expected: [`You've used all 20 ${trialWord} documents.`],
      },
    ];
    for (const { over, expected } of states) {
      const view = await renderWith(billing(over));
      const text = document.body.textContent ?? "";
      expected.forEach((s) => expect(text, s).toContain(s));
      expect(view.queryByText(/Pilot/)).toBeNull();
      cleanup();
    }
  });

  it("a Growth workspace still names Growth and its price", async () => {
    const growth = PLAN_BY_ID.growth;
    const view = await renderWith(billing({ plan: "growth", accountStatus: "active" }));
    expect(view.getAllByText(growth.name).length).toBeGreaterThan(0);
    expect(view.getByText(`€${growth.priceMonthly} a month, billed monthly`)).toBeTruthy();
  });
});

describe("trial copy details", () => {
  it("the allowance-used banner names the derived next plan", async () => {
    const next = PLAN_BY_ID[nextPlanFor("pilot", true)!].name;
    const view = await renderWith(billing({ ordersThisMonth: 20, orderLimit: 20, isOrderLimitReached: true, atLimit: true }));
    // Scoped to the banner, so the row's "Upgrade to …" button cannot satisfy it.
    const banner = view.getByText(/You've used all/).parentElement!;
    expect(banner.textContent).toContain(`Upgrade to ${next} to continue processing new documents.`);
  });

  it("limitRefusal's trial-ended title is C4's first sentence and never says Pilot", () => {
    const copy = limitRefusalCopy(readLimitRefusal({ error: "pilot_expired", plan: "pilot" }));
    expect(copy.title).toBe(`Your ${PLAN_BY_ID.pilot.name.toLowerCase()} is used up.`);
    expect(copy.title).not.toMatch(/Pilot/);
    expect(copy.cta).toBe(`Upgrade to ${PLAN_BY_ID[PLAN_BY_ID.pilot.next!].name}`);
  });
});
