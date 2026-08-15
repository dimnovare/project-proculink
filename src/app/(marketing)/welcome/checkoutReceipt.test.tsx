import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, act, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BillingPlan, BillingStatus } from "@/types/procurement";

// ─────────────────────────────────────────────────────────────────────────────
// THE DEFECT, exactly.
//
// `/welcome` is Stripe's success_url. The backend builds it as
// `{frontendUrl}/welcome?upgraded={plan}&interval={interval}&session_id={…}`, and
// the page rendered its receipt straight off that param:
//
//     You're on {upgraded.charAt(0).toUpperCase() + upgraded.slice(1)}.
//     Your subscription is active. … Receipt was emailed to …
//
// No server read anywhere in the branch. So:
//   • anyone could open /welcome?upgraded=distributor and be told they were on
//     Distributor — signed out, on Pilot, on a workspace that never paid; and
//   • a real customer whose subscription the backend holds as past_due / read_only
//     still got an unconditional "Your subscription is active" on the page they
//     land on immediately after paying, while every ingest path refused them.
//
// EVERY fixture below whose point is the defect has the server DISAGREEING with the
// URL. A test that only drives `upgraded=growth` against an active Growth workspace
// passes the old code untouched — which is exactly how this shipped.
// ─────────────────────────────────────────────────────────────────────────────

const api = { getBillingStatus: vi.fn() };

vi.mock("@/lib/api-client", () => ({
  getBillingStatus: () => api.getBillingStatus(),
}));

import { CheckoutReceipt, welcomeReceiptState, CONFIRM_GRACE_MS } from "./checkoutReceipt";

/** A live, paying workspace. Overrides carry each case's disagreement. */
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
    billingInterval: "monthly",
    ...over,
  };
}

function renderReceipt(expectedPlan: string | null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CheckoutReceipt expectedPlan={expectedPlan} email="ops@buyer.example" />
    </QueryClientProvider>,
  );
}

/**
 * What the visitor can actually read in the receipt block, scoped to the block —
 * an unscoped body read would also pick up whatever a future sibling renders.
 */
async function receiptText(): Promise<string> {
  const block = await screen.findByTestId("checkout-receipt");
  return block.textContent ?? "";
}

/** The one sentence that must never appear without a server response backing it. */
const ACTIVE_CLAIM = "Your subscription is active";

beforeEach(() => {
  api.getBillingStatus.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// ─────────────────────────────────────────────────────────────────────────────
// The decision itself. Pure, so every arm is reachable without a network stub.
// ─────────────────────────────────────────────────────────────────────────────

describe("welcomeReceiptState", () => {
  it("renders nothing without an `upgraded` hint", () => {
    expect(
      welcomeReceiptState({ expectedPlan: null, status: undefined, isError: false, settled: false }),
    ).toEqual({ kind: "none" });
    expect(
      welcomeReceiptState({ expectedPlan: "  ", status: undefined, isError: false, settled: true }),
    ).toEqual({ kind: "none" });
  });

  it("is `confirming` while no server answer has arrived", () => {
    expect(
      welcomeReceiptState({
        expectedPlan: "growth",
        status: undefined,
        isError: false,
        settled: false,
      }),
    ).toEqual({ kind: "confirming" });
  });

  it("is `unconfirmed` when the status call fails", () => {
    expect(
      welcomeReceiptState({
        expectedPlan: "growth",
        status: undefined,
        isError: true,
        settled: false,
      }),
    ).toEqual({ kind: "unconfirmed" });
  });

  it("never reports `active` for a workspace the server has paused — on any plan", () => {
    const plans: BillingPlan[] = [
      "pilot",
      "growth",
      "operations",
      "integration",
      "distributor",
      "enterprise",
    ];
    for (const plan of plans) {
      for (const accountStatus of ["past_due", "cancelled", "read_only", "trial_expired", "who_knows"]) {
        const state = welcomeReceiptState({
          // The URL asks for the very plan the customer thinks they bought.
          expectedPlan: plan,
          status: billing({ plan, accountStatus, canProcessOrders: false }),
          isError: false,
          settled: true,
        });
        expect(state, `${plan}/${accountStatus}`).toEqual({ kind: "paused", plan });
      }
    }
  });

  it("reports the SERVER's plan, never the URL's, once the webhook window closes", () => {
    const state = welcomeReceiptState({
      expectedPlan: "distributor",
      status: billing({ plan: "growth" }),
      isError: false,
      settled: true,
    });
    expect(state).toEqual({ kind: "active", plan: "growth" });
  });

  it("holds at `confirming` while the server still shows the pre-checkout plan", () => {
    // Stripe redirects the browser back before its webhook necessarily lands.
    expect(
      welcomeReceiptState({
        expectedPlan: "operations",
        status: billing({ plan: "growth" }),
        isError: false,
        settled: false,
      }),
    ).toEqual({ kind: "confirming" });
  });

  it("confirms a genuine upgrade the server agrees with", () => {
    expect(
      welcomeReceiptState({
        expectedPlan: "operations",
        status: billing({ plan: "operations" }),
        isError: false,
        settled: false,
      }),
    ).toEqual({ kind: "active", plan: "operations" });
  });

  it("matches the hint case-insensitively", () => {
    expect(
      welcomeReceiptState({
        expectedPlan: "Operations",
        status: billing({ plan: "operations" }),
        isError: false,
        settled: false,
      }),
    ).toEqual({ kind: "active", plan: "operations" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The rendered page. The negative cases come first; they are the finding.
// ─────────────────────────────────────────────────────────────────────────────

describe("CheckoutReceipt — the claim is never made without the server", () => {
  it("does NOT say the subscription is active when the server says processing is paused", async () => {
    api.getBillingStatus.mockResolvedValue(
      billing({ plan: "operations", accountStatus: "past_due", canProcessOrders: false }),
    );

    renderReceipt("operations");

    await waitFor(() => expect(api.getBillingStatus).toHaveBeenCalled());
    const block = await screen.findByTestId("checkout-receipt");
    await waitFor(() => expect(block.dataset.receiptState).toBe("paused"));

    const text = block.textContent ?? "";
    expect(text).not.toContain(ACTIVE_CLAIM);
    expect(text).not.toContain("You're on");
    expect(text).toContain("Order processing is paused on your account.");
    // The route back is offered, because a paused customer needs one.
    expect(within(block).getByRole("link", { name: /Settings → Billing/ })).toBeTruthy();
  });

  it("CONTROL: an active subscription still gets its confirmation", async () => {
    api.getBillingStatus.mockResolvedValue(billing({ plan: "operations" }));

    renderReceipt("operations");

    const block = await screen.findByTestId("checkout-receipt");
    await waitFor(() => expect(block.dataset.receiptState).toBe("active"));

    const text = block.textContent ?? "";
    expect(text).toContain("You're on Operations.");
    expect(text).toContain(ACTIVE_CLAIM);
    expect(text).toContain("ops@buyer.example");
  });

  it("does NOT print a plan the URL asked for and the server does not hold", async () => {
    // The bare attack: any visitor, any URL. Server says Pilot, and Pilot is what
    // the page may eventually say — "Distributor" must never appear at all.
    api.getBillingStatus.mockResolvedValue(billing({ plan: "pilot", accountStatus: "trialing" }));

    renderReceipt("distributor");

    const block = await screen.findByTestId("checkout-receipt");
    await waitFor(() => expect(api.getBillingStatus).toHaveBeenCalled());

    expect(block.textContent ?? "").not.toContain("Distributor");
    expect(block.textContent ?? "").not.toContain(ACTIVE_CLAIM);
    expect(block.dataset.receiptState).toBe("confirming");
  });

  it("settles onto the server's plan once the webhook window closes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.getBillingStatus.mockResolvedValue(billing({ plan: "pilot", accountStatus: "trialing" }));

    renderReceipt("distributor");

    const block = await screen.findByTestId("checkout-receipt");
    await waitFor(() => expect(api.getBillingStatus).toHaveBeenCalled());

    await act(async () => {
      vi.advanceTimersByTime(CONFIRM_GRACE_MS + 500);
    });

    await waitFor(() => expect(block.dataset.receiptState).toBe("active"));
    expect(block.textContent ?? "").toContain("You're on Pilot.");
    expect(block.textContent ?? "").not.toContain("Distributor");
  });

  it("asserts nothing while the status is still loading", async () => {
    // A promise that never resolves: the state the page is in for the first
    // few hundred ms of every single arrival from Stripe.
    api.getBillingStatus.mockReturnValue(new Promise(() => {}));

    renderReceipt("growth");

    const text = await receiptText();
    expect(text).not.toContain(ACTIVE_CLAIM);
    expect(text).not.toContain("Growth");
    expect(text).toContain("Confirming your subscription");
  });

  it("asserts nothing when the status call fails (a signed-out visitor gets a 401 here)", async () => {
    api.getBillingStatus.mockRejectedValue(new Error("401 Unauthorized"));

    renderReceipt("distributor");

    const block = await screen.findByTestId("checkout-receipt");
    // The component asks for one retry before it gives up, and TanStack's default
    // retry delay is ~1s — longer than waitFor's own 1s default.
    await waitFor(() => expect(block.dataset.receiptState).toBe("unconfirmed"), { timeout: 8000 });

    const text = block.textContent ?? "";
    expect(text).not.toContain(ACTIVE_CLAIM);
    expect(text).not.toContain("Distributor");
    expect(text).toContain("We couldn't confirm your subscription here.");
  });

  it("renders nothing at all, and reads no billing status, without the `upgraded` hint", async () => {
    api.getBillingStatus.mockResolvedValue(billing());

    renderReceipt(null);

    expect(screen.queryByTestId("checkout-receipt")).toBeNull();
    // A first-run visitor who never bought anything should not trigger a billing read.
    await new Promise((r) => setTimeout(r, 20));
    expect(api.getBillingStatus).not.toHaveBeenCalled();
  });
});
