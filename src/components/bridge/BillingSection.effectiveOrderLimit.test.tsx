import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BillingStatus } from "@/types/procurement";
import { PLAN_BY_ID } from "@/lib/plans";

// ─────────────────────────────────────────────────────────────────────────────
// The Pilot order-cap banner states the EFFECTIVE allowance, not the plan default.
//
// THE DEFECT. The banner read `PLAN_BY_ID.pilot.orderLimit` — the ladder's 20 — while
// `status.orderLimit` was on the payload all along, already resolved server-side as
// `admin override ?? plan default` (PlanConstants.GetEffectiveOrderLimit). The two agree
// on every org that has no override, which is why it read correctly for as long as it did.
// They part company in exactly the case that makes the banner reachable at all: an admin
// grant. StripeBillingService derives the Pilot trigger from the SAME effective number
// (`ordersUsed >= pilotOrderCap`), so an org granted 100 Pilot orders trips the banner at
// 100 and was told it had used all 20 — the ladder's figure, quoted at an org the ladder
// no longer describes. It is the supplier-limit banner's defect (CLAUDE.md §11.5) in the
// other allowance.
//
// WHY THE ARM STILL EXISTS. Nothing the server can build reaches it: on Pilot,
// `isOrderLimitReached` implies `isTrialExpired`, so the trial-expired arm always claims
// the workspace first. Deleting it would open a hole rather than close one —
// `pilotLimitBannerCovers` hands that payload to LimitBanner and sends
// ProcessingPausedBanner away, so a paused workspace would get NO banner instead of
// exactly one. It stays, and it stays honest. This file pins the number it quotes; the
// hand-off between the two banners is pinned by BillingSection.paused.test.tsx.
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

/** The ladder's own Pilot allowance — the number the banner used to quote unconditionally. */
const PLAN_DEFAULT_ORDER_LIMIT = PLAN_BY_ID.pilot.orderLimit;

/**
 * A Pilot workspace that has hit its order cap without its 14 days having elapsed.
 *
 * `orderLimit` is the EFFECTIVE cap and is deliberately not the plan default: an org with
 * an admin grant is the only org whose two numbers differ, and therefore the only org that
 * can tell a derived banner from a typed one.
 */
function billing(over: Partial<BillingStatus> = {}): BillingStatus {
  return {
    plan: "pilot",
    accountStatus: "active",
    ordersThisMonth: 100,
    orderLimit: 100, // admin override ?? plan default — here, a grant of 100
    suppliersUsed: 1,
    supplierLimit: 1,
    trialStartedAt: null,
    trialEndsAt: null,
    isTrialExpired: false,
    isOrderLimitReached: true,
    isSupplierLimitReached: false,
    canProcessOrders: false,
    canAddSupplier: false,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    overageOrders: 0,
    overageAmountEur: 0,
    nearLimit: true,
    atLimit: true,
    billingInterval: null,
    ...over,
  };
}

async function renderBilling(status: BillingStatus) {
  api.getBillingStatus.mockResolvedValue(status);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <BillingSection />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(api.getBillingStatus).toHaveBeenCalled());
  await screen.findByText("Current plan");
}

/** Rendered copy, whitespace collapsed, so a sentence split across nodes still matches. */
function pageText(): string {
  return (document.body.textContent ?? "").replace(/\s+/g, " ");
}

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  api.createPortalSession.mockReturnValue(new Promise<string>(() => {}));
  api.createCheckoutSession.mockReturnValue(new Promise<string>(() => {}));
});

afterEach(cleanup);

describe("the Pilot order-cap banner quotes the effective allowance", () => {
  it("states the granted cap, not the ladder's plan default", async () => {
    await renderBilling(billing());

    expect(pageText()).toContain("You've used all 100 Pilot orders.");
    expect(
      pageText(),
      "the plan-default allowance must be gone, not merely joined by the effective one",
    ).not.toContain(`You've used all ${PLAN_DEFAULT_ORDER_LIMIT} Pilot orders.`);
  });

  it("still reads correctly for a workspace with no override", async () => {
    // The control. A grant-free Pilot is where the typed and derived numbers agree, so
    // this half proves the fix did not simply move the sentence somewhere else.
    await renderBilling(billing({ ordersThisMonth: 20, orderLimit: 20 }));

    expect(pageText()).toContain(`You've used all ${PLAN_DEFAULT_ORDER_LIMIT} Pilot orders.`);
  });

  it("names the upgrade tier the ladder points at, in the same sentence", async () => {
    // Anti-vacuity: the assertions above would pass against a banner that rendered the
    // number and nothing else. The tier name is derived too (`PLAN_BY_ID.pilot.next`),
    // so read it off the ladder rather than typing "Growth".
    await renderBilling(billing());

    const next = PLAN_BY_ID.pilot.next;
    expect(next, "plans.ts no longer gives Pilot an upgrade tier").not.toBeNull();
    expect(pageText()).toContain(
      `Upgrade to ${PLAN_BY_ID[next!].name} to continue processing new orders.`,
    );
  });
});
