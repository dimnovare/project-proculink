import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BillingPlan, BillingStatus } from "@/types/procurement";
import { accountStatusLabel } from "@/lib/billingPause";

// ─────────────────────────────────────────────────────────────────────────────
// THE DEFECT, exactly.
//
// An Operations workspace whose card was declined. The backend
// (StripeBillingService.GetStatusAsync) answers `plan: "operations"`,
// `accountStatus: "past_due"`, `canProcessOrders: false` — and every ingest path
// refuses from that moment: uploads, inbound email, IMAP, SFTP, S3, the REST API.
// Nothing is queued for later. Orders simply stop arriving.
//
// The billing screen said nothing. `LimitBanner` opened both of its arms with
// `status.plan === "pilot" && …`, so it returned null for every paying customer.
// `OverageNotice` skipped pilot/enterprise and then keyed only on VOLUME, which is
// not what stopped them. `PlanCard`'s `isExpired` was `plan === "pilot" && …`, so
// the "Processing paused" label was unreachable for a paid plan and the card stayed
// buyer-blue and healthy-looking. The only trace on the whole screen was a usage bar
// at 0.58 opacity and the raw string "past due" at 11px in --ink-faint.
//
// And customers are ROUTED here: operations/health's DeliveryPausedCard links
// /settings?tab=billing labelled "Go to billing" under "Sending resumes
// automatically once your billing is up to date."
//
// EVERY fixture below is a NON-PILOT plan with canProcessOrders: false. A pilot
// fixture passes this file's subject without touching the defect at all, which is
// precisely how the defect survived: the pilot path always worked.
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

import { BillingSection, pausedCauseCopy } from "./BillingSection";

/**
 * A paying workspace the server has stopped. Defaults are the live shape of the
 * reported defect: Operations, past_due, canProcessOrders false, and volume WELL
 * under the cap — because volume is not why it stopped, and a fixture that also
 * broke the cap would let a volume-keyed banner pass this file by accident.
 */
function billing(over: Partial<BillingStatus> = {}): BillingStatus {
  return {
    plan: "operations",
    accountStatus: "past_due",
    ordersThisMonth: 118,
    orderLimit: 500,
    suppliersUsed: 4,
    supplierLimit: 10,
    trialStartedAt: null,
    trialEndsAt: null,
    isTrialExpired: false,
    isOrderLimitReached: false,
    isSupplierLimitReached: false,
    canProcessOrders: false,
    canAddSupplier: false,
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

/** What the customer can actually read on the page. */
function pageText(): string {
  return document.body.textContent ?? "";
}

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  // Never resolves: onSuccess assigns window.location.href, which jsdom cannot do.
  // Every assertion here is about the request being made, not the redirect.
  api.createPortalSession.mockReturnValue(new Promise<string>(() => {}));
  api.createCheckoutSession.mockReturnValue(new Promise<string>(() => {}));
});
afterEach(cleanup);

// The five statuses AccountStatusConstants can hold that are not in
// StripeBillingService.ProcessingAllowedStatuses {trialing, active} — plus one
// this build has never seen. Membership of that ALLOWLIST is what decides
// canProcessOrders, so an unknown status is paused, and must render as paused.
const PAUSED_STATUSES = ["past_due", "read_only", "cancelled", "trial_expired", "suspended_by_stripe_2027"];
const ALL_PLANS: BillingPlan[] = ["pilot", "growth", "operations", "integration", "distributor", "enterprise"];

describe("a paid plan the server has stopped says so, loudly", () => {
  it("names the cause, the consequence, and the way back", async () => {
    await renderBilling(billing());
    const text = pageText();

    expect(text, "the cause must be named").toContain("Your last payment didn't go through.");
    // The consequence is the part a customer cannot infer. Naming the channels is
    // what stops them assuming their POs are piling up somewhere safe.
    expect(text).toContain("New orders aren't being accepted");
    expect(text).toMatch(/uploads, emailed orders, SFTP and S3 pickups, and the REST API/);
    expect(text, "nothing is held for later — they must redirect suppliers").toMatch(
      /nothing is held to deliver later/,
    );
    expect(text, "must not read as data loss").toMatch(/stays readable and exportable/);

    // The route back, next to the sentence that explains why they need it.
    expect(screen.getAllByRole("button", { name: "Manage in Stripe" }).length).toBeGreaterThan(0);
  });

  it("is announced, not decoration", async () => {
    await renderBilling(billing());
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Your last payment didn't go through.");
  });

  it("the plan card stops reading as healthy", async () => {
    await renderBilling(billing());
    // `isExpired = plan === "pilot" && isTrialExpired` made this label unreachable
    // for every paid plan, so a declined Operations card rendered exactly like a
    // paid-up one.
    expect(pageText()).toContain("Operations · Processing paused");
  });

  it("stops printing the raw account status at the customer", async () => {
    // "past due" is the database value with its underscore swapped for a space. It
    // was the ONLY signal on the screen. The banner says it in words now; the same
    // rule already guards the cancellation disclosure in this file
    // (gatedCapabilityClaims: "never leaks the internal status name").
    //
    // queryByText, NOT a regex over document.body.textContent. textContent
    // concatenates adjacent nodes with no separator, so the string really reads
    // "…Change planpast due" and `/\bpast due\b/` cannot match it — the word
    // boundary the assertion depended on does not exist. Written that way this
    // test passed against the DEFECT, which is worse than not having it.
    // The raw status is its own element whose whole text is the value.
    await renderBilling(billing());
    expect(screen.queryByText("past due")).toBeNull();

    // Anti-vacuity: the same exact-text query DOES find that element on a healthy
    // workspace, so a null above means "not rendered", not "never findable".
    //
    // It used to look for the literal `active` here, because that is what a healthy
    // workspace printed — and that was the rest of the same defect. Hiding the line
    // while PAUSED covered only the statuses that already had a banner spelling them
    // out; `trialing` and `active` are what a WORKING workspace has, so the raw token
    // was the normal rendering, and live production read the word "trialing" back to a
    // Pilot customer on 2026-08-18. The line is derived now
    // (`accountStatusLabel`, src/lib/billingPause.ts) and the control follows it —
    // still an exact-text lookup of that one element, still proving the query bites.
    // See BillingSection.accountStatusCopy.test.tsx for the derivation itself.
    cleanup();
    await renderBilling(billing({ accountStatus: "active", canProcessOrders: true }));
    expect(screen.queryByText("active")).toBeNull();
    expect(screen.getByText(accountStatusLabel("active")!)).toBeInTheDocument();
  });

  it("the banner's own Manage button really opens the portal, and reports a refusal", async () => {
    await renderBilling(billing());
    const button = screen.getAllByRole("button", { name: "Manage in Stripe" })[0];

    fireEvent.click(button);
    await waitFor(() => expect(api.createPortalSession).toHaveBeenCalled());

    // A member who is not an org admin cannot open the portal at all. The refusal has
    // to appear beside the control that was pressed — the pre-existing error line sits
    // in a different card, which is the same "no feedback at all" shape.
    cleanup();
    api.createPortalSession.mockRejectedValue(new Error("No billing customer on file"));
    await renderBilling(billing());
    fireEvent.click(screen.getAllByRole("button", { name: "Manage in Stripe" })[0]);
    await waitFor(() => expect(pageText()).toMatch(/No billing customer on file/i));
  });
});

describe("the pause is derived from the server's answer, not from a plan name", () => {
  /**
   * THE ANTI-REGRESSION WALK, and the whole reason this file is a cross-product.
   *
   * The defect was not "one banner had a wrong condition" — it was that every
   * blocking surface on the screen was keyed on the PLAN, so the entire paid ladder
   * was invisible at once. A single past_due/operations test would pass again the
   * moment someone re-gated on `plan === "growth" || …` and forgot a tier.
   *
   * `canProcessOrders` is the only correct key: the backend computes it from an
   * ALLOWLIST ({trialing, active}), so a status nobody has seen yet arrives here
   * already false. That is why an invented status is in PAUSED_STATUSES.
   */
  for (const plan of ALL_PLANS) {
    for (const accountStatus of PAUSED_STATUSES) {
      it(`${plan} + ${accountStatus} gets a blocking banner`, async () => {
        await renderBilling(
          billing({
            plan,
            accountStatus,
            // Pilot's own banner owns the two states it can speak to; hold both
            // false so this case lands on the generic path and proves the hand-off
            // has no gap. (A Pilot org CAN be set read_only before its trial ends.)
            isTrialExpired: false,
            isOrderLimitReached: false,
          }),
        );
        const alerts = screen.queryAllByRole("alert");
        expect(alerts.length, "a stopped workspace must be told").toBeGreaterThan(0);
        expect(pageText()).toMatch(/paused|isn't active|ended|didn't go through/i);
      });
    }
  }

  it("a Pilot whose trial really expired keeps its own pinned copy, not two banners", async () => {
    await renderBilling(
      billing({ plan: "pilot", accountStatus: "trial_expired", isTrialExpired: true }),
    );
    expect(pageText()).toContain("Your Pilot has ended.");
    expect(pageText()).toContain("Pilot ended · Processing paused");
    // The generic headline must NOT also fire — one pause, one banner.
    expect(pageText()).not.toContain("Your trial has ended.");
  });

  it("NEGATIVE CONTROL: a healthy paid plan gets none of it", async () => {
    // Without this the walk above is satisfied by a banner that is simply always on,
    // which would be its own lie — and would move the committed /settings baseline.
    await renderBilling(
      billing({ accountStatus: "active", canProcessOrders: true, canAddSupplier: true }),
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(pageText()).not.toMatch(/Processing paused/);
    expect(pageText()).not.toMatch(/New orders aren't being accepted/);
    // The raw status line is untouched on the healthy path — the committed
    // /settings visual baselines are captured against a healthy mock org.
    expect(pageText()).toContain("active");
  });
});

describe("the cause copy claims only what the backend can support", () => {
  it("read_only does NOT guess which of three Stripe states it is", async () => {
    // StripeBillingMapping.MapStatusToAccountStatus folds `paused`, `canceled` AND a
    // deleted subscription into read_only. "Your subscription has ended" would be a
    // guess on a paused one — a guess about someone's money, which is the same class
    // of defect as the silence this replaces.
    await renderBilling(billing({ accountStatus: "read_only" }));
    const text = pageText();
    expect(text).toContain("Your subscription isn't active.");
    expect(text).not.toContain("Your subscription has ended.");
    expect(text).not.toMatch(/\bcancell?ed\b/i);
  });

  it("an unrecognised status invents neither a cause nor a mechanism", async () => {
    await renderBilling(billing({ accountStatus: "some_status_from_2028" }));
    // Scoped to the banner's own rendered text: the page-wide string legitimately
    // contains "Payment method", which is a section heading, not a claimed cause.
    const banner = screen.getByRole("alert").textContent ?? "";
    expect(banner).toContain("Order processing is paused on your account.");
    expect(banner, "no invented cause").not.toMatch(
      /payment|subscription has ended|trial has ended/i,
    );
    expect(banner, "we cannot promise a restart we cannot predict").not.toMatch(
      /restarts on its own/i,
    );
    expect(pageText(), "and never the raw value").not.toMatch(/some_status_from_2028/);
  });

  it("only the causes that really self-heal promise a restart", () => {
    // past_due and read_only recover through a webhook that flips the org back into a
    // processing status, at which point ReleaseBillingHeldOrdersAsync re-drives every
    // held order. A cancelled subscription has nothing to recover — telling that
    // customer to sit and wait would strand them.
    expect(pausedCauseCopy("past_due").resume).toMatch(/restarts on its own/i);
    expect(pausedCauseCopy("read_only").resume).toMatch(/restarts on its own/i);
    expect(pausedCauseCopy("cancelled").resume).not.toMatch(/restarts on its own/i);
    expect(pausedCauseCopy("cancelled").resume).toMatch(/start a plan again/i);
    expect(pausedCauseCopy("trial_expired").resume).not.toMatch(/restarts on its own/i);
  });

  it("every cause has distinct copy — the map is not a switch with one live arm", () => {
    const headlines = PAUSED_STATUSES.map((s) => pausedCauseCopy(s).headline);
    expect(new Set(headlines).size, "at least four distinct causes").toBeGreaterThanOrEqual(4);
  });
});

describe("the route back is one that exists for this workspace", () => {
  it("Enterprise is pointed at support, not at a portal it has no subscription in", async () => {
    await renderBilling(billing({ plan: "enterprise", accountStatus: "read_only" }));
    expect(pageText()).toContain("Contact support to restore processing on your agreement.");
    const alert = screen.getByRole("alert");
    expect(alert.querySelector('a[href^="mailto:"]')).not.toBeNull();
    expect(alert.querySelector("button")).toBeNull();
  });

  it("a paused Pilot is pointed at the plans below, not at a Stripe customer it never had", async () => {
    await renderBilling(
      billing({
        plan: "pilot",
        accountStatus: "read_only",
        isTrialExpired: false,
        isOrderLimitReached: false,
        stripeCustomerId: null,
        stripeSubscriptionId: null,
      }),
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Choose a plan below to resume processing.");
    expect(alert.querySelector("button"), "no portal button — there is no portal").toBeNull();
    // And the plans really are below it.
    expect(screen.getByRole("button", { name: /Upgrade to continue|Upgrade to Growth/ })).toBeTruthy();
  });
});
