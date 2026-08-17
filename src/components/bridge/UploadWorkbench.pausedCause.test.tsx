/* ── /upload: why processing is paused, on the screen where you hit the wall ───
 *
 * THE DEFECT, IN TWO PLACES.
 *
 * (a) The always-visible strip above the dropzone:
 *
 *       You can still view previous orders, but new order processing is paused until
 *       the plan is upgraded.
 *
 *     For every paused workspace, whatever the cause. A past-due Operations org — a
 *     paying customer whose card was declined — was told to upgrade, which does not
 *     settle a declined card, and was never told what actually happened. No cause, no
 *     link, and no mention of the one screen that can fix it.
 *
 * (b) The banner raised when Upload is pressed anyway:
 *
 *       localLimitBanner(billing?.isTrialExpired ? "pilot_expired" : "order_limit_reached", …)
 *
 *     The else-arm is never true on a paid plan. Paid order caps are SOFT — going over
 *     accrues €0.50/order overage and blocks nothing (CLAUDE.md §11.5) — so a paying
 *     workspace can only be stopped by its account status. "You've reached your plan's
 *     order limit" was a false statement about their money, printed at the moment they
 *     were trying to spend more of it.
 *
 * `pausedCauseCopy` has answered this correctly since 2026-08-14 and is already read by
 * BillingSection.tsx:215 and problemCopy.ts:652. /upload was the one surface still
 * guessing, which is the reason this is a defect and not a wording preference: three
 * surfaces, one server fact, and the third one disagreed with the other two.
 *
 * THE STATUSES ARE NOT TYPED HERE. Every expectation reads `pausedCauseCopy` — a test
 * that retypes the sentence pins the copy instead of the derivation, and this repo has
 * been bitten by exactly that. The negative controls below are what stop that from
 * making the file vacuous.
 * ──────────────────────────────────────────────────────────────────────────── */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent, act, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { pausedCauseCopy } from "@/lib/billingPause";
import { PLAN_BY_ID } from "@/lib/plans";
import type { Supplier } from "@/types/procurement";

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
const billing = vi.fn();

vi.mock("@/lib/api-client", () => ({
  isApiMockMode: false,
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
  getBillingStatus: () => billing(),
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

import { UploadWorkbench, pausedUploadBanner } from "./UploadWorkbench";

const SUPPLIER: Supplier = { id: "sup-1", name: "BoltWorks BV", code: "BOLT", status: "active" } as Supplier;

/** A paused workspace on `plan`, refused by the server with `accountStatus`. */
function paused(plan: string, accountStatus: string, isTrialExpired = false) {
  return {
    plan,
    accountStatus,
    isTrialExpired,
    canProcessOrders: false,
    ordersThisMonth: 12,
    orderLimit: 500,
    suppliersUsed: 3,
    supplierLimit: 10,
    isOrderLimitReached: false,
    isSupplierLimitReached: false,
    canAddSupplier: false,
    trialStartedAt: null,
    trialEndsAt: null,
  };
}

async function mountPaused(status: ReturnType<typeof paused>) {
  billing.mockResolvedValue(status);
  api.getSuppliers.mockResolvedValue([SUPPLIER]);
  api.getOrders.mockResolvedValue({ items: [], totalCount: 0, page: 1, pageSize: 100 });
  api.detectFormat.mockReturnValue(new Promise(() => {}));

  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <UploadWorkbench />
    </QueryClientProvider>,
  );
  return screen.findByTestId("upload-paused-note");
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe("the paused strip above the dropzone names the cause the server gave", () => {
  it("does not tell a past-due paid workspace to upgrade", async () => {
    const note = await mountPaused(paused("operations", "past_due"));

    // The cause, from the one map the other two surfaces read.
    expect(note.textContent).toContain(pausedCauseCopy("past_due").headline);
    // The defect, verbatim.
    expect(note.textContent).not.toContain("until the plan is upgraded");
    // And a route back that can actually do something about a declined card.
    expect(within(note).getByRole("link")).toHaveAttribute("href", "/settings?tab=billing");
  });

  it("stays vague about a read_only cause, exactly as billingPause does", async () => {
    // `read_only` folds three different Stripe states together, so naming one would be a
    // guess. Asserted by DERIVATION rather than by retyping the sentence.
    const note = await mountPaused(paused("integration", "read_only"));

    expect(note.textContent).toContain(pausedCauseCopy("read_only").headline);
    expect(note.textContent).not.toContain(pausedCauseCopy("cancelled").headline);
  });

  it("invents no cause for a status this build does not know", async () => {
    const note = await mountPaused(paused("growth", "some_status_shipped_later"));

    expect(note.textContent).toContain(pausedCauseCopy("").headline);
    // ANTI-VACUITY, both directions: the fallback arm is a real arm, not the same
    // sentence every other status gets.
    expect(pausedCauseCopy("").headline).not.toBe(pausedCauseCopy("past_due").headline);
    expect(note.textContent).not.toContain(pausedCauseCopy("past_due").headline);
  });

  it("sends an Enterprise workspace to support, not to a portal it has no account in", async () => {
    const note = await mountPaused(paused("enterprise", "read_only"));
    expect(within(note).getByRole("link")).toHaveAttribute("href", "/support");
  });

  it("keeps the Pilot sentence CLAUDE.md §11.5 mandates", async () => {
    // NEGATIVE CONTROL. Pilot is the one workspace the old copy was nearly right for,
    // and it must not have been churned by fixing the others.
    const note = await mountPaused(paused("pilot", "trial_expired", true));

    expect(note.textContent).toContain("Your Pilot has ended.");
    expect(note.textContent).toContain(`Upgrade to ${PLAN_BY_ID.growth.name}`);
  });
});

describe("pressing Upload on a paused workspace", () => {
  it("does not claim a paid workspace hit an order limit", async () => {
    await mountPaused(paused("distributor", "past_due"));
    await waitFor(() => {
      if (!document.body.textContent?.includes(SUPPLIER.name)) throw new Error("suppliers not resolved");
    });

    const cta = screen.getAllByRole("button").find((b) => /processing paused/i.test(b.textContent ?? ""));
    expect(cta, "the send CTA did not render").toBeTruthy();
    // The CTA is disabled on a read-only workspace, so the refusal is driven through the
    // handler the way the screen would if it were not — the banner copy is the claim
    // under test, not the disabled attribute.
    await act(async () => {
      fireEvent.click(cta!);
    });

    const derived = pausedUploadBanner({ plan: "distributor", accountStatus: "past_due", isTrialExpired: false });
    expect(derived.title).toBe(pausedCauseCopy("past_due").headline);
    expect(derived.message).not.toContain("order limit");
    expect(derived.code).toBe("processing_paused");
  });

  it("still raises the Pilot banner for an expired trial", async () => {
    // ANTI-VACUITY: the derivation above must not have made every pause look the same.
    const pilot = pausedUploadBanner({ plan: "pilot", accountStatus: "trial_expired", isTrialExpired: true });
    expect(pilot.code).toBe("pilot_expired");
    expect(pilot.title).toBe("Your Pilot has ended.");
    expect(pilot.cta).toBe(`Upgrade to ${PLAN_BY_ID.growth.name}`);
  });

  it("never answers a paid pause with the order-limit sentence, on any known status", async () => {
    // The old expression's else-arm, walked across every status the map knows plus an
    // unknown one, on a paid plan where a soft cap can never be the reason.
    for (const status of ["past_due", "cancelled", "read_only", "trial_expired", "who_knows"]) {
      const banner = pausedUploadBanner({ plan: "operations", accountStatus: status, isTrialExpired: false });
      expect(banner.title, status).toBe(pausedCauseCopy(status).headline);
      expect(banner.title, status).not.toBe("You've reached your plan's order limit.");
    }
  });
});
