// ─────────────────────────────────────────────────────────────────────────────
// THE DEFECT, exactly.
//
// /library/suppliers, one line:
//
//     const canAddSupplier = billingError ? true : (billing?.canAddSupplier ?? true);
//
// `?? true` answered TWO different questions with one answer: "billing said no"
// and "billing has not answered yet". So on every load of this screen, a
// workspace at its supplier ceiling was shown a blue, enabled **New supplier**
// button until the billing query resolved — and a click inside that window
// opened the create panel for a request the server was always going to refuse
// with a 429.
//
// The same component already had the correct guard three hundred lines further
// down:
//
//     const limitReached = !billingError && billing && !billing.canAddSupplier;
//
// which requires `billing` to EXIST before it claims anything. Two guards, one
// component, disagreeing about the same fact — and the wrong one was the one
// wired to `disabled`.
//
// HOW IT WAS FOUND. The three-viewport control sweep, as a hydration failure on
// /library/suppliers: React logged the server tree rendering `disabled={null}`
// and the client tree rendering `disabled={true}` with the label flipping to
// "Supplier limit reached". The hydration error is the loud symptom; the flash of
// an enabled button that lies is the defect, and it is present in production
// whether or not the hydration diff fires.
//
// WHAT THE FIX MUST NOT DO — and this is why the test below has as many negative
// cases as positive ones. Two failing-open behaviours here are DELIBERATE and
// must survive:
//
//   1. Billing ERRORED → still allow. Locking someone out of their own workspace
//      because a billing call 500'd is worse than letting the backend refuse a
//      create it was going to refuse anyway.
//   2. Billing query DISABLED → still allow. TanStack reports `isPending` for a
//      disabled query, so the obvious predicate (`isPending`) would leave a
//      workspace with no active organisation sitting behind a permanently dead
//      button. That is a worse bug than the one being fixed.
//
// SCOPING. jsdom applies no Tailwind, so both breakpoint trees mount. Every
// button lookup asserts exactly one match, which doubles as the anti-vacuity
// floor: a screen that rendered no button would satisfy every negative for free.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BillingStatus, Supplier } from "@/types/procurement";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/library/suppliers",
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

/**
 * Mutable so one test can take the organisation away and watch the query switch
 * off — the disabled-query case that the naive fix breaks.
 */
const clerkState = {
  orgId: "org_1" as string | null,
  membershipCount: 1,
  // SupplierDockList gates on `useQueriesEnabled`, which is
  // `isLoaded && isSignedIn` — NOT the org-aware `useTenantQueriesEnabled`. So
  // the state that switches its billing query off is Clerk not having loaded,
  // not the organisation being absent. Learned by writing this test against the
  // wrong hook and watching the query fire anyway.
  isLoaded: true,
};

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ isLoaded: clerkState.isLoaded, isSignedIn: true, orgId: clerkState.orgId, userId: "user_1" }),
  useOrganizationList: () => ({
    isLoaded: true,
    userMemberships: {
      isLoading: false,
      isError: false,
      count: clerkState.membershipCount,
      data: Array.from({ length: clerkState.membershipCount }, () => ({ organization: { id: "org_1" } })),
    },
  }),
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

/**
 * The add button, with the anti-vacuity floor attached. Matches either label —
 * the point of several tests below is WHICH label rendered, so the lookup must
 * not presuppose one.
 */
function addButtons(): HTMLButtonElement[] {
  const found = screen.getAllByRole("button", { name: /New supplier|Supplier limit reached/i });
  expect(found.length, "no add-supplier control rendered — every assertion here would pass vacuously").toBeGreaterThan(0);
  return found as HTMLButtonElement[];
}

/**
 * The header's add button, when there is exactly one add control on screen.
 *
 * There is not always exactly one: when the supplier LIST query is also off or
 * empty, the empty state renders its own "New supplier" call to action beside
 * the header's. That is why the disabled-query test below asserts over ALL of
 * them rather than picking one — a fix that left either control dead would be
 * the same defect, and singling one out would hide it.
 */
function addButton(): HTMLButtonElement {
  const found = addButtons();
  expect(found, "expected a single add control on this screen").toHaveLength(1);
  return found[0];
}

function renderList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <SupplierDockList />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  clerkState.orgId = "org_1";
  clerkState.membershipCount = 1;
  clerkState.isLoaded = true;
  getSuppliers.mockResolvedValue(EXISTING);
  listConnections.mockResolvedValue([]);
  getOrgSettings.mockResolvedValue({});
});

afterEach(cleanup);

describe("the add button while billing has not answered", () => {
  it("is not pressable, and does not claim a limit it has not checked", async () => {
    // A promise that never settles: this IS the window the defect lived in, and
    // the only way to observe it is to hold the query open.
    getBillingStatus.mockReturnValue(new Promise<BillingStatus>(() => {}));
    renderList();

    await waitFor(() => expect(getBillingStatus).toHaveBeenCalled());

    const button = addButton();
    expect(button.disabled, "an unanswered billing query left the button pressable").toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");

    // The label must stay neutral. Saying "Supplier limit reached" here would be
    // a different lie from the original one — asserting a ceiling nothing has
    // confirmed — and the fix is not allowed to trade one for the other.
    expect(button.textContent).toMatch(/New supplier/i);
    expect(button.textContent).not.toMatch(/limit reached/i);
  });

  it("becomes a refusal once billing says no", async () => {
    getBillingStatus.mockResolvedValue(billing({ canAddSupplier: false }));
    renderList();

    await waitFor(() => expect(addButton().textContent).toMatch(/limit reached/i));
    const button = addButton();
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-busy"), "still reporting busy after the answer arrived").toBeNull();
    expect(button.getAttribute("aria-describedby")).toBe("supplier-limit-banner");
  });

  it("becomes pressable once billing says yes", async () => {
    getBillingStatus.mockResolvedValue(billing({ canAddSupplier: true, isSupplierLimitReached: false }));
    renderList();

    await waitFor(() => expect(addButton().disabled).toBe(false));
    const button = addButton();
    expect(button.textContent).toMatch(/New supplier/i);
    expect(button.getAttribute("aria-busy")).toBeNull();
  });
});

describe("the two fail-open behaviours that must survive the fix", () => {
  it("still allows adding when the billing call FAILS", async () => {
    // Deliberate, and older than this fix: a billing outage must not lock a
    // customer out of their own workspace. The backend refuses if it must.
    getBillingStatus.mockRejectedValue(new Error("billing unavailable"));
    renderList();

    await waitFor(() => expect(getBillingStatus).toHaveBeenCalled());
    await waitFor(() => expect(addButton().disabled).toBe(false));
    expect(addButton().textContent).toMatch(/New supplier/i);
  });

  it("still allows adding when the billing query is DISABLED", async () => {
    // The regression the obvious fix introduces. TanStack reports `isPending`
    // for a query that never ran, so gating on `isPending` alone would leave
    // this screen behind a permanently dead button — no spinner, no error, no
    // way forward.
    clerkState.isLoaded = false;
    renderList();

    await waitFor(() => expect(addButtons().length).toBeGreaterThan(0));
    expect(getBillingStatus, "the query was expected to be disabled in this state").not.toHaveBeenCalled();

    for (const button of addButtons()) {
      expect(button.disabled, `a disabled billing query left "${button.textContent?.trim()}" permanently dead`).toBe(false);
      expect(button.getAttribute("aria-busy")).toBeNull();
    }
  });
});
