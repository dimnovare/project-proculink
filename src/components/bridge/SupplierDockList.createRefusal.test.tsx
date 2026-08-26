// A-F3c — the add-supplier modal printed the refusal's machine token at the customer.
//
// `POST /api/suppliers` answers 429 `{ error: "supplier_limit_reached", plan, limit, upgradeUrl }`
// when the allowance is spent. `apiClient.createSupplier` runs the body through `serverReason`,
// which lifts the `error` field, so the thrown Error's message IS the bare code. The mutation's
// onError then did:
//
//     const parsed = JSON.parse(err.message);
//     setAddError(parsed.error ?? err.message);
//
// and the modal rendered `addError` verbatim. What an operator saw, inside a dialog, at the
// moment they were deciding whether to spend money, was `supplier_limit_reached`.
//
// The correct sentence for that code already existed — in `UploadWorkbench`, on a screen that
// never calls this endpoint and therefore can never receive the code. This file pins the fix:
// one derivation (`src/lib/limitRefusal.ts`), imported by the screen that really receives it.
//
// FOUR CAUSES, FOUR ANSWERS, AND THEY MUST STAY APART:
//
//   quota     429 supplier_limit_reached   the tier HAS the capability; the allowance is spent
//   plan gate 403 <capability>_requires_<plan>  the tier does not have the capability at all
//   org admin 403 requires_org_admin        the reader lacks a role; money fixes nothing
//   anything else                            a malfunction
//
// Quota and plan gate both end in "upgrade", which is exactly why they are easy to collapse
// into one another, and why they are asserted separately here.
//
// ORDERING. Every "the raw token is absent" assertion is preceded, in the same test, by an
// assertion that the humane sentence is PRESENT. A `queryByText(...).toBeNull()` passes
// perfectly when the component threw during render and produced nothing at all; the positive
// assertion fails first and takes that vacuous pass with it.
//
// SCOPING. jsdom applies no Tailwind, so a component with `lg:hidden` / `hidden lg:block`
// branches renders BOTH. Every assertion below is scoped inside the failure element by test id
// rather than run against the whole document, and `the_scoping_bites` proves the scope really
// excludes the rest of the screen.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BillingStatus, Supplier } from "@/types/procurement";
import { orgAdminMessage } from "@/lib/planGate";

vi.mock("next/navigation", () => ({
  usePathname: () => "/library/suppliers",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: true, orgId: "org_1", userId: "user_1" }),
  // An active organisation implies a membership it was activated from. Present
  // because useTenantQueriesEnabled reads this list unconditionally (rules of
  // hooks) before it ever looks at orgId.
  useOrganizationList: () => ({
    isLoaded: true,
    userMemberships: {
      isLoading: false,
      isError: false,
      count: 1,
      data: [{ organization: { id: "org_1" } }],
    },
  }),
}));

const createSupplier = vi.fn();
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
    createSupplier: (...a: unknown[]) => createSupplier(...a),
    getSuppliers: (...a: unknown[]) => getSuppliers(...a),
  },
}));

vi.mock("@/lib/api/delivery", () => ({
  getDeliveryConfig: vi.fn().mockResolvedValue(null),
  upsertDeliveryConfig: vi.fn().mockResolvedValue({}),
}));

import { SupplierDockList } from "./SupplierDockList";

const NEW_SUPPLIER: Supplier = { id: "sup-new", name: "Acme Components" };

function billing(overrides: Partial<BillingStatus> = {}): BillingStatus {
  return {
    plan: "growth",
    accountStatus: "active",
    ordersThisMonth: 0,
    orderLimit: 150,
    suppliersUsed: 0,
    supplierLimit: 5,
    trialStartedAt: null,
    trialEndsAt: null,
    isTrialExpired: false,
    isOrderLimitReached: false,
    isSupplierLimitReached: false,
    canProcessOrders: true,
    canAddSupplier: true,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    ...overrides,
  } as BillingStatus;
}

/**
 * Drive the REAL path: open the New-supplier modal, name it, save, and let step 1 be refused.
 * No channel is picked, so the second write (the delivery config) is never attempted — this
 * file is about the FIRST one, which was the path with no derivation.
 */
async function refuseCreateWith(message: string) {
  createSupplier.mockRejectedValue(new Error(message));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <SupplierDockList />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: /New supplier/i }));
  fireEvent.change(await screen.findByLabelText(/Supplier name/i), {
    target: { value: "Acme Components" },
  });
  fireEvent.click(screen.getByRole("button", { name: /^Add supplier$/i }));
}

/** The amber quota/allowance panel. */
const quotaPanel = () => screen.findByTestId("add-supplier-quota");
/** The red "something broke" line — org-admin and generic failures share it. */
const errorLine = () => screen.findByTestId("add-supplier-error");

beforeEach(() => {
  vi.clearAllMocks();
  getBillingStatus.mockResolvedValue(billing());
  listConnections.mockResolvedValue([]);
  getOrgSettings.mockResolvedValue({ orderDirection: "outbound" });
  getSuppliers.mockResolvedValue([]);
  createSupplier.mockResolvedValue(NEW_SUPPLIER);
});

describe("add-supplier refusals never reach the operator as a machine token", () => {
  it("the_quota_code_becomes_the_allowance_and_the_tier_above_it", async () => {
    await refuseCreateWith("supplier_limit_reached");
    const panel = await quotaPanel();

    // Positive first. Growth's cached allowance is 5 and the tier above it is Operations —
    // both DERIVED (billing status + plans.ts), neither typed into this component.
    expect(within(panel).getByText(/Your plan includes 5 suppliers\./)).toBeTruthy();
    expect(within(panel).getByText(/Upgrade to Operations to add more supplier flows\./)).toBeTruthy();

    // Only now the absence claim. This is the defect, verbatim.
    expect(within(panel).queryByText(/supplier_limit_reached/)).toBeNull();
    expect(document.body.textContent).not.toContain("supplier_limit_reached");
  });

  it("the_top_of_the_ladder_is_not_sold_a_cheaper_tier", async () => {
    // Distributor has `next: null` in plans.ts. There is no upgrade to offer, and naming
    // Growth here would be an invitation to pay less for less.
    getBillingStatus.mockResolvedValue(billing({ plan: "distributor", supplierLimit: 30 }));
    await refuseCreateWith("supplier_limit_reached");
    const panel = await quotaPanel();

    expect(within(panel).getByText(/Your plan includes 30 suppliers\./)).toBeTruthy();
    expect(within(panel).getByText(/Contact us to add more supplier flows\./)).toBeTruthy();
    expect(within(panel).queryByText(/Upgrade to Growth/)).toBeNull();
  });

  it("a_plan_gate_names_the_plan_the_server_named_and_is_not_the_quota_panel", async () => {
    // The plan segment is derived server-side, so the client must read it back out of the
    // code rather than match the code whole.
    await refuseCreateWith("supplier_create_requires_operations");
    const gate = await screen.findByRole("status");

    expect(gate.textContent).toContain("Adding a supplier is not included in your plan");
    expect(gate.textContent).toContain("Operations");
    expect(document.body.textContent).not.toContain("supplier_create_requires_operations");

    // A gate is NOT a spent allowance. If these two collapsed into one arm, this passes only
    // because the quota panel never rendered.
    expect(screen.queryByTestId("add-supplier-quota")).toBeNull();
  });

  it("a_role_refusal_asks_for_an_administrator_and_never_offers_an_upgrade", async () => {
    await refuseCreateWith("requires_org_admin");
    const line = await errorLine();

    expect(line.textContent).toBe(orgAdminMessage());
    expect(document.body.textContent).not.toContain("requires_org_admin");
    // Telling someone who merely lacks a role to spend money invents a reason to spend it.
    expect(screen.queryByTestId("add-supplier-quota")).toBeNull();
    expect(document.body.textContent).not.toContain("not included in your plan");
  });

  it("a_code_this_build_does_not_know_still_does_not_become_user_facing_text", async () => {
    // The rule is structural, not a list: an unrecognised snake_case token is a machine code
    // whatever it says, so a NEW one added on the server cannot leak by default.
    await refuseCreateWith("duplicate_supplier_name");
    const line = await errorLine();

    expect(line.textContent).toContain("Could not add this supplier");
    expect(document.body.textContent).not.toContain("duplicate_supplier_name");
  });

  it("a_sentence_the_server_really_wrote_is_still_shown", async () => {
    // The negative control for the rule above. Suppressing EVERY server string would pass
    // every absence assertion in this file while making the product less useful, so the
    // pass-through half is pinned too.
    await refuseCreateWith("A supplier with that name already exists.");
    const line = await errorLine();

    expect(line.textContent).toContain("A supplier with that name already exists.");
  });

  it("the_scoping_bites", async () => {
    // Proof that `within(panel)` is a real narrowing and not a document-wide query wearing a
    // scope. The proactive banner elsewhere on this screen contains "supplier"; the failure
    // panel must not answer for it.
    await refuseCreateWith("supplier_limit_reached");
    const panel = await quotaPanel();

    expect(document.body.textContent).toContain("New supplier");
    expect(within(panel).queryByText(/New supplier/)).toBeNull();
  });
});
