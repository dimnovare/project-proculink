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
import { PLAN_BY_ID } from "@/lib/plans";

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
  await within(container).findByText("Current plan");
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

    expect(view.getByText("Upgrade when this is ready for daily use.")).toBeTruthy();
    for (const name of ["Pro", "Business", "Scale"]) expect(view.getByRole("button", { name })).toBeTruthy();
    expect(view.queryByRole("button", { name: "Upgrade to Growth" })).toBeNull();

    fireEvent.click(view.getByRole("button", { name: "Upgrade to Starter" }));
    await waitFor(() => expect(api.createCheckoutSession).toHaveBeenCalledWith("starter", "monthly"));

    const flows = (await view.findByText("Flows")).parentElement!;
    expect(within(flows).getByText("1 / 2")).toBeTruthy();
  });

  it("a Starter plan's overage notice states its own rate", async () => {
    const view = await renderWith(
      billing({ plan: "starter", accountStatus: "active", ordersThisMonth: 160, orderLimit: 150, overageOrders: 10, overageAmountEur: 2.4, atLimit: true }),
    );

    const notice = view.getByText("You're over your monthly document allowance.").parentElement!;
    expect(notice.textContent).toContain("€0.24");
    expect(notice.textContent).not.toContain("€0.50");
    // A paid document plan changes its live subscription, so its next plan is on offer again.
    expect(view.getByRole("button", { name: /Need more volume\? Upgrade to Pro/ })).toBeTruthy();

    const growth = await renderWith(
      billing({ plan: "growth", accountStatus: "active", ordersThisMonth: 160, orderLimit: 150, overageOrders: 10, overageAmountEur: 5, atLimit: true }),
    );
    expect(growth.getByText("You're over your monthly document allowance.").parentElement!.textContent).toContain("€0.50");
  });

  it("a trial whose engine is unknown is sold neither ladder", async () => {
    engine.state = "unknown";
    const view = await renderWith(billing());

    expect((view.getByRole("button", { name: "Upgrade to Growth" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("the trial is called by its plan name, never by its wire id", () => {
  const trial = PLAN_BY_ID.pilot.name;
  const trialWord = trial.toLowerCase();

  it("reads the trial name in every trial state and says Pilot nowhere", async () => {
    const states = [
      { over: {}, expected: [`${trial} · ${PLAN_BY_ID.pilot.priceCadence}`, `Documents (${trialWord} total)`] },
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
    expect(view.getByText(growth.billingPriceLabel)).toBeTruthy();
  });
});
