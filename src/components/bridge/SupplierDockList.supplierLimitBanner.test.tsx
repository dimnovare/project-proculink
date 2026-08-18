// ─────────────────────────────────────────────────────────────────────────────
// THE DEFECT, exactly.
//
// /library/suppliers, a workspace at its supplier ceiling. The New-supplier button greys
// out and reads "Supplier limit reached", and the banner under it said:
//
//     Your Growth plan includes 5 suppliers.
//     Existing supplier flows remain viewable. Upgrade when you are ready to add another
//     supplier route.
//
// CLAUDE.md §11.5 mandates the DERIVED form — "Your plan includes {limit} supplier(s)." plus
// "Upgrade to {next} to add more supplier flows." — and this banner missed the half that
// tells the reader what to do:
//
//   1. NO TIER. "Upgrade when you are ready" names nothing to upgrade TO, so the one fact
//      that lets a customer act is the one fact absent.
//   2. NO NULL BRANCH. `next` is null at the top of the self-serve ladder (Distributor) and
//      on Enterprise. That null is a real branch, not a missing value: the copy must ask for
//      a conversation and must NEVER name a cheaper tier.
//   3. AN EMPTY NUMBER. Enterprise supplier counts are set by agreement, so
//      `PLAN_BY_ID.enterprise.supplierLimit` is null and the sentence rendered as
//      "Your Enterprise plan includes  suppliers." — a gap where the allowance should be.
//
// WHY IT SHIPPED. The copy was already correct on the OTHER surface. `limitRefusalCopy`
// (src/lib/limitRefusal.ts) derives all of it, and `UploadWorkbench.supplierLimitCopy.test.tsx`
// pins it — for UploadWorkbench, a screen that can never receive `supplier_limit_reached`.
// The add-supplier MODAL on this screen was wired to it too. Only the proactive banner —
// the one an org at its ceiling sees before it clicks anything — kept its own hand-typed
// sentence, and no test looked at it. This file is the missing surface.
//
// HOW "DERIVED" IS PROVED. Reading a tier name back out of `PLAN_BY_ID` and asserting the
// banner contains it passes just as well against copy that happens to be typed correctly
// today. So the ladder itself is PATCHED at runtime — a tier renamed, a `next` re-pointed,
// a `next` set to null — and the banner is required to follow. Typed copy cannot.
//
// SCOPING. jsdom applies no Tailwind, so both breakpoint trees mount. Everything is read
// inside the banner by test id; `the_scoping_bites` proves that scope is real. The banner
// lookup itself is the anti-vacuity floor: it throws when nothing rendered, and asserts
// there is exactly one, so a duplicated subtree cannot let a negative pass on one copy.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BillingStatus, Supplier } from "@/types/procurement";
import { PLAN_BY_ID, type PlanId } from "@/lib/plans";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/library/suppliers",
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: true, orgId: "org_1", userId: "user_1" }),
}));

const getSuppliers = vi.fn();
const getBillingStatus = vi.fn();
const listConnections = vi.fn();
const getOrgSettings = vi.fn();

vi.mock("@/lib/api-client", () => ({
  isApiMockMode: false,
  isQaBypass: false,
  getBillingStatus: (...a: unknown[]) => getBillingStatus(...a),
  listConnections: (...a: unknown[]) => listConnections(...a),
  getOrgSettings: (...a: unknown[]) => getOrgSettings(...a),
  apiClient: {
    createSupplier: vi.fn(),
    getSuppliers: (...a: unknown[]) => getSuppliers(...a),
  },
}));

vi.mock("@/lib/api/delivery", () => ({
  getDeliveryConfig: vi.fn().mockResolvedValue(null),
  upsertDeliveryConfig: vi.fn().mockResolvedValue({}),
}));

import { SupplierDockList } from "./SupplierDockList";

const EXISTING: Supplier[] = [{ id: "sup-1", name: "BoltWorks BV" } as Supplier];

/** A workspace the SERVER says cannot add another supplier — `canAddSupplier: false`. */
function billing(over: Partial<BillingStatus> = {}): BillingStatus {
  return {
    plan: "growth",
    accountStatus: "active",
    ordersThisMonth: 12,
    orderLimit: 150,
    suppliersUsed: 5,
    supplierLimit: 5,
    trialStartedAt: null,
    trialEndsAt: null,
    isTrialExpired: false,
    isOrderLimitReached: false,
    isSupplierLimitReached: true,
    canProcessOrders: true,
    canAddSupplier: false,
    stripeCustomerId: "cus_live",
    stripeSubscriptionId: "sub_live",
    overageOrders: 0,
    overageAmountEur: 0,
    nearLimit: false,
    atLimit: false,
    billingInterval: "monthly",
    ...over,
  } as BillingStatus;
}

async function renderAtCeiling(status: BillingStatus = billing()) {
  getBillingStatus.mockResolvedValue(status);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <SupplierDockList />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(getBillingStatus).toHaveBeenCalled());
}

/**
 * The banner, with the anti-vacuity floor attached: it must have rendered, and there must
 * be exactly ONE of it. Every claim below is of the shape "the banner did/did not say X",
 * and a screen that rendered no banner satisfies all the negatives for free.
 */
async function banner(): Promise<HTMLElement> {
  const found = await screen.findAllByTestId("supplier-limit-banner");
  expect(found, "the supplier-limit banner did not render — every negative below would pass vacuously").toHaveLength(1);
  return found[0];
}

/**
 * Patch one field of the plan ladder for the duration of a test, restoring it afterwards.
 *
 * This is what separates derived copy from copy that is merely correct today. `PLAN_BY_ID`
 * is the object `limitRefusalCopy` reads at call time, so a banner that really follows the
 * ladder moves when the ladder moves — and a sentence with a tier name typed into it cannot.
 */
const restores: Array<() => void> = [];
function patchPlan<K extends keyof (typeof PLAN_BY_ID)[PlanId]>(
  plan: PlanId,
  key: K,
  value: (typeof PLAN_BY_ID)[PlanId][K],
) {
  const original = PLAN_BY_ID[plan][key];
  PLAN_BY_ID[plan][key] = value;
  restores.push(() => {
    PLAN_BY_ID[plan][key] = original;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  listConnections.mockResolvedValue([]);
  getOrgSettings.mockResolvedValue({ orderDirection: "outbound" });
  getSuppliers.mockResolvedValue(EXISTING);
});

afterEach(() => {
  while (restores.length) restores.pop()!();
  cleanup();
});

describe("the supplier-limit banner names the allowance and the tier", () => {
  it("a_mid_ladder_tier_is_told_which_tier_to_buy", async () => {
    // The reported defect: the banner named no tier at all, so "Upgrade when you are ready"
    // was the entire instruction.
    await renderAtCeiling(billing({ plan: "growth", supplierLimit: 5 }));
    const el = await banner();

    expect(PLAN_BY_ID.growth.next).toBe("operations");
    expect(el.textContent).toContain(`Your plan includes ${PLAN_BY_ID.growth.supplierLimit} suppliers.`);
    expect(el.textContent).toContain(`Upgrade to ${PLAN_BY_ID.operations.name} to add more supplier flows.`);
    // Only now the absence claim — the vague sentence that replaced the tier name.
    expect(el.textContent).not.toContain("Upgrade when you are ready");
    // ...and it must not name the tier the org is already ON.
    expect(el.textContent).not.toContain(`Upgrade to ${PLAN_BY_ID.growth.name}`);
  });

  it("the_named_tier_follows_the_ladder_when_the_ladder_moves", async () => {
    // The proof of derivation. Rename the tier above Growth and re-point `next` at a
    // different rung; a banner reading the ladder says both new things, a banner with
    // "Operations" typed into it says neither.
    patchPlan("integration", "name", "Zephyr");
    patchPlan("growth", "next", "integration");

    await renderAtCeiling(billing({ plan: "growth", supplierLimit: 5 }));
    const el = await banner();

    expect(el.textContent).toContain("Upgrade to Zephyr to add more supplier flows.");
    expect(el.textContent).not.toContain("Operations");
  });

  it("the_top_of_the_self_serve_ladder_is_never_offered_a_cheaper_tier", async () => {
    // Distributor: €1,499/mo, 30 supplier flows, and `next: null` — there is nothing above
    // it to sell. Naming any tier here is naming a cheaper one.
    await renderAtCeiling(billing({ plan: "distributor", supplierLimit: 30, suppliersUsed: 30 }));
    const el = await banner();

    expect(PLAN_BY_ID.distributor.next).toBeNull();
    expect(el.textContent).toContain(`Your plan includes ${PLAN_BY_ID.distributor.supplierLimit} suppliers.`);
    expect(el.textContent).toContain("Contact us to add more supplier flows.");
    for (const cheaper of ["Growth", "Operations", "Integration"] as const) {
      expect(el.textContent, `Distributor was offered the ${cheaper} tier`).not.toContain(cheaper);
    }
    // The route matches the copy: a conversation, not a checkout.
    within(el).getByRole("button", { name: "Contact support" }).click();
    expect(push).toHaveBeenCalledWith("/support");
  });

  it("enterprise_claims_no_allowance_it_was_never_given", async () => {
    // Enterprise supplier counts are set by agreement, so plans.ts gives it
    // `supplierLimit: null` and the server sends null too. The old sentence interpolated
    // that null and rendered "Your Enterprise plan includes  suppliers." — a hole where the
    // number should be, in a banner whose whole job is to state the number.
    await renderAtCeiling(billing({ plan: "enterprise", supplierLimit: null, orderLimit: null }));
    const el = await banner();

    expect(PLAN_BY_ID.enterprise.supplierLimit).toBeNull();
    expect(PLAN_BY_ID.enterprise.next).toBeNull();
    expect(el.textContent).toContain("You've reached your plan's supplier limit.");
    expect(el.textContent).toContain("Contact us to add more supplier flows.");
    expect(el.textContent).not.toMatch(/includes\s+suppliers/);
    expect(el.textContent).not.toMatch(/includes \d/);
  });

  it("a_tier_that_loses_its_upgrade_stops_offering_one", async () => {
    // The null branch, reached by moving the ladder rather than by picking the one tier that
    // already has it — so the branch is proven to be a reading of `next`, not a hardcoded
    // special case for Distributor and Enterprise.
    patchPlan("growth", "next", null);

    await renderAtCeiling(billing({ plan: "growth", supplierLimit: 5 }));
    const el = await banner();

    expect(el.textContent).toContain("Contact us to add more supplier flows.");
    expect(el.textContent).not.toContain("Upgrade to");
    expect(within(el).getByRole("button", { name: "Contact support" })).toBeTruthy();
  });

  it("the_servers_effective_allowance_is_preferred_over_the_plan_default", async () => {
    // `supplierLimit` on the billing status is the EFFECTIVE cap — `admin override ?? plan
    // default` — so an org whose ceiling was raised by an administrator must be shown the
    // raised number, not the smaller one its tier ships with.
    await renderAtCeiling(billing({ plan: "growth", supplierLimit: 25, suppliersUsed: 25 }));
    const el = await banner();

    expect(PLAN_BY_ID.growth.supplierLimit).toBe(5);
    expect(el.textContent).toContain("Your plan includes 25 suppliers.");
    expect(el.textContent).not.toContain("includes 5 suppliers");
  });

  it("an_unknown_plan_invents_no_number_and_no_tier", async () => {
    // A tier added server-side before this build knows it. The banner used to print the id
    // through `planName`, which returns an unknown id unchanged, next to whatever number
    // arrived — stating an allowance for a plan whose ladder entry does not exist.
    await renderAtCeiling(billing({ plan: "platinum" as BillingStatus["plan"], supplierLimit: null }));
    const el = await banner();

    expect(el.textContent).toContain("You've reached your plan's supplier limit.");
    expect(el.textContent).not.toContain("platinum");
    expect(el.textContent).not.toContain("Upgrade to");
    expect(el.textContent).not.toMatch(/includes \d/);
  });

  it("the_singular_allowance_still_reads_as_one_supplier", async () => {
    // Pilot is the fixture anyone reaches for first, and on the OTHER surface it is the one
    // that hides this defect entirely: §11.5 records that the UploadWorkbench hardcode
    // ("Your plan includes 1 supplier. Upgrade to Growth…") is byte-for-byte correct for a
    // Pilot org, which is why that banner's bug survived for months. Here it is a real case
    // rather than a blind one — the old sentence named the plan and so differed — and it is
    // kept for the pluralisation, the one branch the singular allowance is the only way to
    // reach.
    await renderAtCeiling(billing({ plan: "pilot", supplierLimit: 1, suppliersUsed: 1, orderLimit: 20 }));
    const el = await banner();

    expect(PLAN_BY_ID.pilot.supplierLimit).toBe(1);
    expect(PLAN_BY_ID.pilot.next).toBe("growth");
    expect(el.textContent).toContain("Your plan includes 1 supplier.");
    expect(el.textContent).toContain("Upgrade to Growth to add more supplier flows.");
  });

  it("the_refused_button_points_at_the_reason", async () => {
    // What a screen-reader user got was the label alone: "Supplier limit reached" — the door
    // is shut, and nothing about the allowance, the tier, or the way through. The banner
    // carries all three; the disabled control has to name it.
    await renderAtCeiling(billing({ plan: "growth", supplierLimit: 5 }));
    const el = await banner();

    const button = screen.getByRole("button", { name: /Supplier limit reached/i });
    expect(button).toBeDisabled();
    expect(button.getAttribute("aria-describedby")).toBe(el.getAttribute("id"));
    expect(el.getAttribute("id")).toBeTruthy();
  });

  it("the_scoping_bites", async () => {
    // Proof that `within(banner)` is a real narrowing. The page elsewhere carries the
    // supplier list and the page sub-line; the banner must not answer for them, or every
    // negative above is really a document-wide query wearing a scope.
    await renderAtCeiling();
    const el = await banner();

    expect(document.body.textContent).toContain("BoltWorks BV");
    expect(within(el).queryByText(/BoltWorks BV/)).toBeNull();
  });
});
