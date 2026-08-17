import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BillingStatus, BillingPlan } from "@/types/procurement";
import type { Plan, PlanId } from "@/lib/plans";

// ─────────────────────────────────────────────────────────────────────────────
// THREE DEFECTS, all the same shape: a fact about the plan ladder typed into this
// screen instead of read out of it.
//
//   1. `<span>Upgrade to Growth to continue processing new orders.</span>` — in the
//      SAME banner whose order count is already `PLAN_BY_ID.pilot.orderLimit`. Half a
//      sentence derived, half hand-typed. This is the shape CLAUDE.md §11.5 records as
//      the supplier banner that told a 30-supplier Distributor org it had one, and
//      offered it the €149 tier.
//
//   2. `{nextPlan.charAt(0).toUpperCase() + nextPlan.slice(1)}` — the raw wire value
//      with its first letter forced upper, with `PLAN_META[nextPlan].label` in scope on
//      the line above. plans.ts:437-453 records this exact trick as the bug that printed
//      `Acme · distributor` to a €1,499/month customer.
//
//   3. The whole Payment method card ("Manage in Stripe", Stripe cancellation disclosure)
//      and the "Change plan" button were gated on `isPaid || isEnterprise` — a plan name —
//      five lines below "Enterprise plans use a manual agreement. Contact support…".
//      `stripeCustomerId` was on the payload all along and this component never read it,
//      so the customer discovered which sentence was true by pressing the button and
//      being told "No billing customer on file."
//
// A test that asserted the literal strings would pass against all three. So the ladder
// itself is PATCHED here — renamed and re-pointed — and the assertions are computed from
// the patch. Hand-typed copy cannot follow a ladder it is not reading.
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

/**
 * A MUTABLE clone of the ladder, shared with the component under test.
 *
 * `Distributor` is renamed inside the factory because `PLAN_META` is built at module load
 * and can only see a rename that is already in place. `pilot.next` is re-pointed inside
 * individual tests instead, because `upgradeSentence` reads the ladder at CALL time — which
 * is what lets one file cover both a re-pointed `next` and a null one.
 */
const h = vi.hoisted(() => ({
  ladder: {} as Record<string, unknown>,
  /** The rename. Deliberately not a plausible tier name: nothing may match it by accident. */
  renamedDistributor: "Distributor Network",
}));

const RENAMED_DISTRIBUTOR = h.renamedDistributor;

vi.mock("@/lib/plans", async () => {
  const actual = await vi.importActual<typeof import("@/lib/plans")>("@/lib/plans");
  for (const [id, plan] of Object.entries(actual.PLAN_BY_ID)) {
    h.ladder[id] = { ...plan };
  }
  (h.ladder.distributor as Plan).name = h.renamedDistributor;
  return { ...actual, PLAN_BY_ID: h.ladder };
});

import { BillingSection } from "./BillingSection";

const ladder = h.ladder as Record<PlanId, Plan>;
/** The ladder as the factory left it, so each test restores what it moved. */
const PRISTINE_PILOT_NEXT = "growth" as const;

function billing(over: Partial<BillingStatus> = {}): BillingStatus {
  return {
    plan: "pilot",
    accountStatus: "active",
    ordersThisMonth: 20,
    orderLimit: 20,
    suppliersUsed: 1,
    supplierLimit: 1,
    trialStartedAt: null,
    trialEndsAt: null,
    isTrialExpired: false,
    isOrderLimitReached: true,
    isSupplierLimitReached: false,
    canProcessOrders: true,
    canAddSupplier: false,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    overageOrders: 0,
    overageAmountEur: 0,
    nearLimit: false,
    atLimit: false,
    billingInterval: null,
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

function pageText(): string {
  return document.body.textContent ?? "";
}

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  api.createPortalSession.mockReturnValue(new Promise<string>(() => {}));
  api.createCheckoutSession.mockReturnValue(new Promise<string>(() => {}));
  ladder.pilot.next = PRISTINE_PILOT_NEXT;
});
afterEach(() => {
  cleanup();
  ladder.pilot.next = PRISTINE_PILOT_NEXT;
});

describe("the Pilot limit banner reads its upgrade tier off the ladder", () => {
  it("names whichever tier `next` points at — not the one that was typed", async () => {
    // Re-point the ladder. Nothing else about the fixture changes.
    ladder.pilot.next = "distributor";
    await renderBilling(billing());

    expect(pageText()).toContain(`Upgrade to ${RENAMED_DISTRIBUTOR} to continue processing new orders.`);
    expect(pageText(), "the hardcoded tier must be gone, not merely joined").not.toContain("Upgrade to Growth to continue");
  });

  it("says 'Contact us' when `next` is null — never a cheaper tier", async () => {
    // The real state at the top of the self-serve ladder (Distributor) and on Enterprise.
    // CLAUDE.md §11.5: that null is a real branch, and naming a tier there names a CHEAPER one.
    ladder.pilot.next = null;
    await renderBilling(billing());

    expect(pageText()).toContain("Contact us to continue processing new orders.");
    for (const name of ["Growth", "Operations", "Integration", RENAMED_DISTRIBUTOR]) {
      expect(pageText(), `must not offer ${name} when there is no upgrade`).not.toContain(
        `Upgrade to ${name} to continue`,
      );
    }
  });

  it("ANTI-VACUITY: with the ladder untouched it still resolves to today's real answer", async () => {
    // If `upgradeSentence` had been written to read some patched-only field, or the banner had
    // stopped rendering, the two tests above would pass on nothing. This pins the live value.
    await renderBilling(billing());

    expect(ladder.pilot.next, "the real ladder still points Pilot at Growth").toBe("growth");
    expect(pageText()).toContain("Upgrade to Growth to continue processing new orders.");
    // And the other half of the same sentence, which was already derived, is still derived.
    expect(pageText()).toContain(`You've used all ${ladder.pilot.orderLimit} Pilot orders.`);
  });
});

describe("the upgrade button prints the tier's NAME, not its wire value", () => {
  it("follows a renamed tier, which capitalising the id cannot do", async () => {
    await renderBilling(
      billing({
        plan: "integration",
        accountStatus: "active",
        isOrderLimitReached: false,
        orderLimit: 1500,
        supplierLimit: 20,
        stripeCustomerId: "cus_live",
        stripeSubscriptionId: "sub_live",
        billingInterval: "monthly",
      }),
    );

    const button = screen.getByRole("button", { name: /Need more volume/ });
    expect(button.textContent).toBe(`Need more volume? Upgrade to ${RENAMED_DISTRIBUTOR}.`);
    // The exact string the old expression produced from the id `distributor`.
    expect(button.textContent).not.toBe("Need more volume? Upgrade to Distributor.");
  });

  it("ANTI-VACUITY: the button is really reached, and really points at the next tier", async () => {
    await renderBilling(
      billing({
        plan: "growth",
        accountStatus: "active",
        isOrderLimitReached: false,
        orderLimit: 150,
        supplierLimit: 5,
        stripeCustomerId: "cus_live",
        stripeSubscriptionId: "sub_live",
        billingInterval: "monthly",
      }),
    );

    // Growth → Operations is not renamed, so this is the unpatched ladder answering.
    expect(screen.getByRole("button", { name: /Need more volume/ }).textContent).toBe(
      "Need more volume? Upgrade to Operations.",
    );
  });
});

describe("a Stripe portal is offered only to a workspace that has one", () => {
  const enterprise = (over: Partial<BillingStatus> = {}) =>
    billing({
      plan: "enterprise",
      accountStatus: "active",
      isOrderLimitReached: false,
      orderLimit: 2_000_000_000,
      supplierLimit: 2_000_000_000,
      billingInterval: null,
      ...over,
    });

  it("an Enterprise workspace on a manual agreement is not sent to a portal it has no customer in", async () => {
    await renderBilling(enterprise({ stripeCustomerId: null, stripeSubscriptionId: null }));

    // The sentence that IS true stays.
    expect(pageText()).toContain("Enterprise plans use a manual agreement.");
    // Everything that contradicted it, five lines below, is gone.
    expect(screen.queryByRole("button", { name: /Manage in Stripe/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Change plan" })).toBeNull();
    expect(screen.queryByText("Payment method")).toBeNull();
    expect(pageText(), "a Stripe cancellation disclosure to a customer with no Stripe subscription")
      .not.toMatch(/If you cancel in Stripe/i);
  });

  it("ANTI-VACUITY: the same Enterprise workspace WITH a Stripe customer keeps all of it", async () => {
    // Without this, hiding the card unconditionally — or breaking the render — would pass above.
    await renderBilling(enterprise({ stripeCustomerId: "cus_live", stripeSubscriptionId: "sub_live" }));

    expect(screen.getByText("Payment method")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /Manage in Stripe/ }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Change plan" })).toBeTruthy();
    expect(pageText()).toMatch(/If you cancel in Stripe/i);
  });

  it("a paid plan with no Stripe customer is told where to go instead of being left with nothing", async () => {
    await renderBilling(
      billing({
        plan: "operations",
        accountStatus: "active",
        isOrderLimitReached: false,
        orderLimit: 500,
        supplierLimit: 10,
        stripeCustomerId: null,
        stripeSubscriptionId: null,
      }),
    );

    expect(screen.queryByText("Payment method")).toBeNull();
    expect(pageText()).toMatch(/isn't linked to a self-serve Stripe account/i);
    expect(screen.getByRole("link", { name: "Contact support" })).toBeTruthy();
  });
});

/** Every plan id, so a tier added later cannot slip past the rule above. */
const ALL_PLANS: BillingPlan[] = ["pilot", "growth", "operations", "integration", "distributor", "enterprise"];

describe("no plan, on any tier, is offered a portal without a Stripe customer", () => {
  it.each(ALL_PLANS)("%s", async (plan) => {
    await renderBilling(
      billing({
        plan,
        accountStatus: "active",
        isTrialExpired: false,
        isOrderLimitReached: false,
        orderLimit: 500,
        supplierLimit: 10,
        stripeCustomerId: null,
        stripeSubscriptionId: null,
      }),
    );

    expect(screen.queryByRole("button", { name: /Manage in Stripe/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Change plan" })).toBeNull();
  });
});
