/* ── The supplier-limit banner: which number, and which tier ──────────────────
 *
 * TWO DEFECTS IN ONE STRING, both verbatim from UploadWorkbench.tsx.
 *
 * (1) SELECTED BY SUBSTRING.
 *
 *       if (rawError.includes("supplier")) return "supplier_limit_reached";
 *
 *     Any 429 body whose text merely contained the word "supplier" routed to the
 *     supplier-allowance banner. And the case it was written for cannot reach it:
 *     `supplier_limit_reached` is emitted by POST /api/suppliers only
 *     (SuppliersController.cs:126); POST /api/orders/upload answers `pilot_expired`
 *     or `order_limit_reached` and nothing else (OrdersController.cs:353-360). So on
 *     this screen the branch was unreachable by its own cause and reachable only by
 *     accident — a supplier-scoped throttle message, an edge page naming a supplier
 *     host — and it then told the operator their supplier allowance was full.
 *
 * (2) HARDCODED TIER AND ALLOWANCE.
 *
 *       title:   "Your plan includes 1 supplier.",
 *       message: "Upgrade to Growth to add more supplier flows.",
 *
 *     For every plan. A Distributor org — €1,499/mo, 30 supplier flows — was told it
 *     had one supplier and should upgrade to the €149 tier.
 *
 * WHY IT SURVIVED, AND WHY THE PILOT CASE IS HERE.
 *
 * For a Pilot org the hardcoded sentence is CORRECT: pilot.supplierLimit is 1 and
 * pilot.next is "growth". Every fixture anyone would reach for first passes against
 * the defect. `pilot_hides_the_defect` is that negative control, kept so a later
 * reader does not mistake it for coverage — it is the test that proves nothing, and
 * it must keep passing byte-identically after the fix.
 *
 * ELEMENT QUERIES FOR NEGATIVE CLAIMS. `document.body.textContent` concatenates
 * across element boundaries, so a \b-anchored negative regex over whole-body text is
 * unreliable in both directions — it can match across a seam that renders as two
 * separate words, and it can miss a match split by markup. Every "did NOT say" claim
 * below therefore reads the banner element (data-testid="upload-error-banner"), and
 * the anti-vacuity floor asserts that element really rendered first.
 *
 * jsdom applies no Tailwind, so responsive subtrees all mount. The banner has one
 * render site, asserted below, so `within` is unnecessary here — but the floor pins
 * that fact so a future mobile duplicate fails loudly instead of silently doubling
 * the text a negative regex scans.
 * ──────────────────────────────────────────────────────────────────────────── */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent, act, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Supplier } from "@/types/procurement";
import { PLAN_BY_ID } from "@/lib/plans";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/upload",
  useSearchParams: () => new URLSearchParams(),
}));

const api = {
  getSuppliers: vi.fn(),
  getOrders: vi.fn(),
  detectFormat: vi.fn(),
  uploadPurchaseOrder: vi.fn(),
};

vi.mock("@/lib/api-client", () => ({
  isApiMockMode: false,
  // Declared inside the factory: vi.mock is hoisted above every top-level binding in
  // this file, so a class defined outside would be in its temporal dead zone by the
  // time the component imports it.
  // Same parameter order as the real class in src/lib/api/core.ts —
  // `(message, status, body)`. The type checker resolves ApiHttpError from the REAL
  // module even though the runtime value comes from this factory, so a mock that
  // reorders the parameters compiles against one signature and runs against another.
  ApiHttpError: class ApiHttpError extends Error {
    status: number;
    body: unknown;
    constructor(message: string, status: number, body: unknown = null) {
      super(message);
      this.name = "ApiHttpError";
      this.status = status;
      this.body = body;
    }
  },
  getBillingStatus: () =>
    Promise.resolve({ canProcessOrders: true, isTrialExpired: false, plan: "growth" }),
  getOrgSettings: () => Promise.resolve({ direction: "outbound" }),
  apiClient: {
    getSuppliers: (...a: unknown[]) => api.getSuppliers(...a),
    getOrders: (...a: unknown[]) => api.getOrders(...a),
    detectFormat: (...a: unknown[]) => api.detectFormat(...a),
    uploadPurchaseOrder: (...a: unknown[]) => api.uploadPurchaseOrder(...a),
  },
}));

vi.mock("@/lib/analytics", () => ({ capture: vi.fn() }));
vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => true }));
vi.mock("@/hooks/useOnboardingStatus", () => ({ useOnboardingStatus: () => ({ data: undefined }) }));
vi.mock("@/hooks/useSampleOrder", () => ({
  useSampleOrder: () => ({ runSample: vi.fn(), isPending: false, error: null }),
  usePracticeOrderEmail: () => "",
}));

import { UploadWorkbench } from "./UploadWorkbench";
import { ApiHttpError } from "@/lib/api-client";

const SUPPLIER: Supplier = {
  id: "sup-1",
  name: "BoltWorks BV",
  code: "BOLT",
  status: "active",
} as Supplier;

/** Mount with one supplier resolved, then choose a file so the send CTA is live. */
async function mountWithFile() {
  api.getSuppliers.mockResolvedValue([SUPPLIER]);
  api.getOrders.mockResolvedValue({ items: [], totalCount: 0, page: 1, pageSize: 100 });
  api.detectFormat.mockReturnValue(new Promise(() => {}));

  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <UploadWorkbench />
    </QueryClientProvider>,
  );
  // Wait for the supplier query to SETTLE, not merely to have been called: the send
  // CTA is disabled while `suppliersLoading` is true.
  await waitFor(() => {
    if (!document.body.textContent?.includes(SUPPLIER.name)) {
      throw new Error("supplier list has not resolved yet");
    }
  });

  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("no file input rendered");
  await act(async () => {
    fireEvent.change(input, {
      target: { files: [new File(["po,qty\nA-1,2\n"], "purchase-order.csv", { type: "text/csv" })] },
    });
  });
}

function sendButton(): HTMLButtonElement {
  const el = screen
    .getAllByRole("button")
    .find((b) => /upload & review|add a file to send|upload \d+ files/i.test(b.textContent ?? "")) as
    | HTMLButtonElement
    | undefined;
  if (!el) throw new Error("no send CTA rendered");
  return el;
}

/**
 * Drive one real upload attempt that the API refuses with `body` at HTTP 429, then
 * return the rendered banner element.
 *
 * ANTI-VACUITY FLOOR. Every negative claim below is of the shape "the banner did NOT
 * say that", and a screen that rendered no banner satisfies all of them for free.
 * This throws when the banner is absent, so a render-nothing regression fails at
 * lookup instead of reporting a clean bill of health — and it asserts there is
 * exactly ONE banner, so a duplicated responsive subtree cannot let a negative pass
 * on one copy while the other says the wrong thing.
 */
async function refuseWith(body: unknown): Promise<HTMLElement> {
  await mountWithFile();
  api.uploadPurchaseOrder.mockRejectedValue(new ApiHttpError("Upload failed", 429, body));
  await act(async () => {
    fireEvent.click(sendButton());
  });
  const banners = await screen.findAllByTestId("upload-error-banner");
  expect(banners, "the upload error banner did not render — every negative below would pass vacuously").toHaveLength(1);
  return banners[0];
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
});

describe("supplier-limit banner — the allowance and the tier are derived, not typed", () => {
  it("distributor_is_not_told_to_buy_growth", async () => {
    // The ACTUAL defect. Distributor: 30 supplier flows, €1,499/mo, and — because
    // `next` is null at the top of the self-serve ladder — no tier above it to sell.
    const banner = await refuseWith({
      error: "supplier_limit_reached",
      plan: "distributor",
      limit: 30,
      upgradeUrl: "/settings",
    });

    // The real allowance, read from the ladder rather than retyped here, so this
    // assertion cannot drift away from plans.ts the way the banner did.
    expect(PLAN_BY_ID.distributor.supplierLimit).toBe(30);
    expect(banner.textContent).toContain(`Your plan includes ${PLAN_BY_ID.distributor.supplierLimit} suppliers.`);

    // The load-bearing negative, on the ELEMENT, not on whole-body text.
    expect(banner.textContent).not.toContain("Growth");
    expect(banner.textContent).not.toContain("1 supplier.");
    // ...and it must not silently name any other cheaper tier either.
    for (const cheaper of ["Growth", "Operations", "Integration"]) {
      expect(banner.textContent, `Distributor was offered the ${cheaper} tier`).not.toContain(cheaper);
    }

    // No upgrade exists to offer, so the route is a conversation, not a checkout.
    expect(PLAN_BY_ID.distributor.next).toBeNull();
    expect(banner.textContent).toContain("Contact us to add more supplier flows.");
    expect(within(banner).getByRole("link")).toHaveAttribute("href", "/support");
  });

  it("growth_names_the_tier_above_it", async () => {
    // A mid-ladder tier: the allowance and the named tier both move with plans.ts.
    const banner = await refuseWith({ error: "supplier_limit_reached", plan: "growth", limit: 5 });

    expect(banner.textContent).toContain(`Your plan includes ${PLAN_BY_ID.growth.supplierLimit} suppliers.`);
    expect(PLAN_BY_ID.growth.next).toBe("operations");
    expect(banner.textContent).toContain(`Upgrade to ${PLAN_BY_ID.operations.name} to add more supplier flows.`);
    // The old hardcode named the tier the org is ALREADY on.
    expect(banner.textContent).not.toContain("Upgrade to Growth");
  });

  it("pilot_hides_the_defect", async () => {
    // THE NEGATIVE CONTROL. This fixture passes with the hardcoded sentence in place —
    // pilot.supplierLimit is 1 and pilot.next is "growth" — which is exactly why the
    // defect survived. It is kept so nobody mistakes it for coverage, and so the fix
    // is proven not to have churned the one tier whose copy was already right.
    const banner = await refuseWith({ error: "supplier_limit_reached", plan: "pilot", limit: 1 });

    expect(PLAN_BY_ID.pilot.supplierLimit).toBe(1);
    expect(PLAN_BY_ID.pilot.next).toBe("growth");
    // Byte-identical to the sentence CLAUDE.md §11.5 used to mandate for every plan.
    expect(banner.textContent).toContain("Your plan includes 1 supplier.");
    expect(banner.textContent).toContain("Upgrade to Growth to add more supplier flows.");
  });

  it("an_unknown_plan_invents_no_number_and_no_tier", async () => {
    // A plan id this build does not know (a tier added server-side first). The old
    // code answered "1 supplier / upgrade to Growth" with equal confidence.
    const banner = await refuseWith({ error: "supplier_limit_reached", plan: "platinum" });

    expect(banner.textContent).toContain("You've reached your plan's supplier limit.");
    expect(banner.textContent).not.toContain("Growth");
    expect(banner.textContent).not.toMatch(/includes \d/);
  });

  it("prefers_the_servers_effective_limit_over_the_plan_default", async () => {
    // `limit` is LimitCheckResult.Limit = `admin override ?? plan default`, so an org
    // whose supplier cap was raised by an admin (AdminController SetOrgLimits) must be
    // shown the raised number, not the smaller one its tier ships with.
    const banner = await refuseWith({ error: "supplier_limit_reached", plan: "growth", limit: 25 });

    expect(PLAN_BY_ID.growth.supplierLimit).toBe(5);
    expect(banner.textContent).toContain("Your plan includes 25 suppliers.");
    expect(banner.textContent).not.toContain("includes 5 suppliers");
  });
});

describe("supplier-limit banner — selected by code, never by the word 'supplier'", () => {
  it("a_non_plan_gate_error_containing_supplier_does_not_upsell", async () => {
    // The ACTUAL reachable defect. This is a real 429 shape — the global rate limiter
    // (ProcuLink.Api/Program.cs) writes a prose sentence — carrying the word
    // "supplier". `rawError.includes("supplier")` matched it BEFORE the rate-limit
    // sniff could, so a transient throttle was reported as an exhausted plan.
    const banner = await refuseWith({
      error: "Rate limit exceeded for supplier BoltWorks BV. Please slow down and retry shortly.",
    });

    // Negatives on the element: no allowance claim, no tier, no upgrade route.
    expect(banner.textContent).not.toContain("supplier flows");
    expect(banner.textContent).not.toMatch(/Your plan includes/);
    expect(banner.textContent).not.toContain("Upgrade");
    // A speed throttle is dismissible, not a billing destination — so there is no
    // upgrade LINK at all, which whole-body text could not have told us.
    expect(within(banner).queryByRole("link")).toBeNull();
    // Positive counterpart, so this is not passing because the banner said nothing.
    expect(banner.textContent).toContain("Uploading a little fast.");
  });

  it("an_order_limit_429_mentioning_a_supplier_stays_an_order_limit", async () => {
    // The other direction, and the supplier name has to be INSIDE `error` for this to
    // mean anything: `error` is the only field the classifier reads, so a supplier name
    // in a sibling key was never scanned and this test would stay green against the
    // defect — a control that exercises nothing. Prose here, not a code, which is the
    // shape a supplier-scoped quota message would really take.
    const banner = await refuseWith({
      error: "Order limit reached for supplier BoltWorks BV.",
      plan: "growth",
      limit: 150,
    });

    expect(banner.textContent).toContain("You've reached your plan's order limit.");
    expect(banner.textContent).not.toContain("supplier flows");
    expect(banner.textContent).not.toMatch(/Your plan includes/);
  });

  it("a_supplier_limit_code_is_still_honoured_when_it_arrives", async () => {
    // The positive counterpart to both negatives above: tightening the match must not
    // have made the supplier banner unreachable. Asserted with the exact code the
    // backend emits (SuppliersController.cs), uppercased and padded to pin the
    // normalisation rather than an incidental exact-string comparison.
    const banner = await refuseWith({ error: "  SUPPLIER_LIMIT_REACHED  ", plan: "operations", limit: 10 });

    expect(banner.textContent).toContain("Your plan includes 10 suppliers.");
    expect(banner.textContent).toContain(`Upgrade to ${PLAN_BY_ID.integration.name} to add more supplier flows.`);
  });
});
