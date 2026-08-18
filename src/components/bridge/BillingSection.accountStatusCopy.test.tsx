// ─────────────────────────────────────────────────────────────────────────────
// THE DEFECT, exactly.
//
// Live production, 2026-08-18. A Pilot workspace opens /settings?tab=billing and the plan
// card reads the word **trialing** back to it — the raw `accountStatus` from
// GET /api/billing/status, rendered by
//
//     {status.accountStatus.replaceAll("_", " ")}
//
// at 11px in --ink-faint under the price.
//
// WHY THE EXISTING REPAIR MISSED IT. That line already carried a comment about being a
// database word doing a sentence's job, and a `!isPaused &&` guard put in to fix it. The
// guard covers exactly the statuses that ALREADY have a banner spelling them out. It does
// nothing for the two a healthy workspace actually has — `trialing` and `active` — so the
// raw token was not an edge case at all: it was the normal rendering, on every screen that
// was working correctly. A repair aimed at the failure path left the happy path printing
// the database's own vocabulary.
//
// WHAT THIS FILE PINS.
//
//   • The line renders `accountStatusLabel`'s phrase EXACTLY, and that phrase is IMPORTED
//     from the module that owns it rather than retyped here. A phrase re-typed into the
//     component drifts from the map and fails — which is what makes this derived copy and
//     not merely different copy.
//   • No status reaches the line as its own token, in either spelling (`past_due` and the
//     `past due` the old transform produced).
//   • An UNRECOGNISED status renders NO line — neither the token nor a reassuring phrase.
//     Both of those are defects this repo has shipped: the first is the bug above, the
//     second is "unknown renders as success".
//
// EXACT-TEXT, NOT SUBSTRING. Every claim reads the line element's whole text and compares
// it. A substring claim is unusable on this subject in both directions: "Subscription
// active" legitimately CONTAINS the token `active`, so `not.toContain("active")` is
// unsatisfiable, while `document.body.textContent` concatenates across element seams and
// would let a token hide next to a phrase. Comparing the element's full text says the one
// thing that matters — the line IS the derived phrase and nothing else.
//
// SCOPING. jsdom applies no Tailwind, so responsive subtrees all mount. Everything is read
// by test id, and `the_scoping_bites` proves the card scope really excludes the rest of the
// page rather than being a document-wide query wearing a scope.
//
// ANTI-VACUITY. `planCard()` throws when the card is missing and asserts exactly one
// rendered, so a component that produced nothing fails at lookup instead of satisfying
// every "does not contain" claim for free.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BillingStatus } from "@/types/procurement";
import { accountStatusLabel } from "@/lib/billingPause";

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

/**
 * A HEALTHY workspace — `canProcessOrders: true`. That is the whole point of the fixture:
 * the previous repair hid the status line whenever processing was paused, so ANY paused
 * fixture passes this file without ever touching the defect.
 */
function billing(over: Partial<BillingStatus> = {}): BillingStatus {
  return {
    plan: "pilot",
    accountStatus: "trialing",
    ordersThisMonth: 5,
    orderLimit: 20,
    suppliersUsed: 1,
    supplierLimit: 1,
    trialStartedAt: new Date(Date.now() - 5 * 86_400_000).toISOString(),
    trialEndsAt: new Date(Date.now() + 9 * 86_400_000).toISOString(),
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

/**
 * The plan card, with the anti-vacuity floor attached: it must exist, and there must be
 * exactly one of it. A duplicated responsive subtree would otherwise let an absence claim
 * pass against one copy while the other printed the token.
 */
function planCard(): HTMLElement {
  const cards = screen.getAllByTestId("plan-card");
  expect(cards, "the plan card did not render — every claim below would pass vacuously").toHaveLength(1);
  return cards[0];
}

/** The status line's own text, or null when the card renders no line at all. */
function statusLineText(): string | null {
  const lines = within(planCard()).queryAllByTestId("account-status-line");
  expect(lines.length, "more than one status line rendered").toBeLessThanOrEqual(1);
  return lines.length === 0 ? null : lines[0].textContent;
}

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  // Never resolve: onSuccess assigns window.location.href, which jsdom cannot do.
  api.createPortalSession.mockReturnValue(new Promise<string>(() => {}));
  api.createCheckoutSession.mockReturnValue(new Promise<string>(() => {}));
});
afterEach(cleanup);

/**
 * Every value AccountStatusConstants can hold. `trialing` and `active` are
 * StripeBillingService.ProcessingAllowedStatuses — the two a working workspace has, and
 * the two the previous repair left printing raw. The rest are the paused set.
 */
const PROCESSING_STATUSES = ["trialing", "active"] as const;
const PAUSED_STATUSES = ["past_due", "cancelled", "read_only", "trial_expired"] as const;
const KNOWN_STATUSES = [...PROCESSING_STATUSES, ...PAUSED_STATUSES];

describe("the plan card never reads a database word back to the customer", () => {
  it("trialing_is_not_printed_at_the_customer", async () => {
    // THE REPORTED DEFECT, verbatim: a Pilot workspace, mid-trial, on live production.
    await renderBilling(billing({ plan: "pilot", accountStatus: "trialing" }));

    // Floor first: the card really rendered its own content.
    expect(planCard().textContent).toContain("Pilot");
    // The old code rendered exactly this string. Stated as its own claim so the failure
    // message names the defect rather than a diff between two phrases.
    expect(statusLineText()).not.toBe("trialing");
    expect(statusLineText()).toBe(accountStatusLabel("trialing"));
    expect(planCard().textContent).not.toContain("trialing");
  });

  it("active_is_not_printed_at_the_customer", async () => {
    // The other half of the happy path, and the one a PAYING customer sees.
    await renderBilling(billing({ plan: "operations", accountStatus: "active" }));

    expect(planCard().textContent).toContain("Operations");
    expect(statusLineText()).not.toBe("active");
    expect(statusLineText()).toBe(accountStatusLabel("active"));
  });

  it("every_processing_status_renders_its_derived_phrase_and_not_its_token", async () => {
    // The walk, so a status added to the map later cannot quietly regress.
    for (const status of PROCESSING_STATUSES) {
      cleanup();
      await renderBilling(billing({ plan: "growth", accountStatus: status }));

      expect(planCard().textContent, `${status}: the card rendered no plan label`).toContain("Growth");
      expect(statusLineText(), `${status}: no status line rendered`).toBe(accountStatusLabel(status));
      expect(statusLineText(), `${status}: the raw token reached the line`).not.toBe(status);
      expect(statusLineText(), `${status}: the underscore-swapped token reached the line`).not.toBe(
        status.replaceAll("_", " "),
      );
    }
  });

  it("a_paused_status_still_renders_no_line_and_no_token", async () => {
    // The half the previous repair DID cover — kept so the fix is proven not to have
    // re-opened it. The blocking banner says these in words; a second, quieter copy of the
    // same fact under the price would only compete with it.
    for (const status of PAUSED_STATUSES) {
      cleanup();
      await renderBilling(billing({ plan: "growth", accountStatus: status, canProcessOrders: false }));

      expect(planCard().textContent, `${status}: the card rendered no plan label`).toContain("Growth");
      expect(statusLineText(), `${status}: a status line rendered on a paused workspace`).toBeNull();
      expect(planCard().textContent, `${status}: the raw token reached the card`).not.toContain(status);
      expect(planCard().textContent, `${status}: the underscore-swapped token reached the card`).not.toContain(
        status.replaceAll("_", " "),
      );
    }
  });

  it("an_unknown_status_prints_neither_the_token_nor_a_reassuring_phrase", async () => {
    // A status added server-side before this build knows it, on a workspace the server says
    // is still processing. Printing it is the reported defect; borrowing "Subscription
    // active" would be the worse one — an unknown state told everything is fine.
    await renderBilling(billing({ plan: "growth", accountStatus: "some_status_from_2028" }));

    expect(planCard().textContent).toContain("Growth");
    expect(statusLineText()).toBeNull();
    expect(planCard().textContent).not.toContain("some_status_from_2028");
    expect(planCard().textContent).not.toContain("some status from 2028");
    for (const known of KNOWN_STATUSES) {
      expect(planCard().textContent, `an unknown status borrowed ${known}'s phrase`).not.toContain(
        accountStatusLabel(known),
      );
    }
  });

  it("the_scoping_bites", async () => {
    // Proof that the card scope is a real narrowing. The page elsewhere carries "Current
    // plan"; the card must not answer for it, or every claim above is really being made
    // against the whole document.
    await renderBilling(billing());

    expect(document.body.textContent).toContain("Current plan");
    expect(within(planCard()).queryByText("Current plan")).toBeNull();
  });
});

describe("accountStatusLabel is a derivation, not a text transform", () => {
  it("no_phrase_is_the_token_with_its_underscores_swapped", () => {
    // The control that separates THIS fix from the transform it replaces. `.replaceAll("_",
    // " ")` also yields a lower-case, space-separated string, so a later edit could satisfy
    // "the line is not the raw token" while still emitting the database's own word.
    //
    // Note what is NOT asserted: that a phrase avoids the token's WORDS. "Subscription
    // active" contains "active" and is the right copy — `active` is ordinary English as
    // well as a database value, so a word ban would be unsatisfiable here and would push
    // the phrase towards something worse. The claims are structural instead: sentence
    // case, more than one word, and never equal to either spelling of the token — all
    // three of which the transform fails and every phrase in the map passes.
    for (const status of KNOWN_STATUSES) {
      const label = accountStatusLabel(status);
      expect(label, `${status} has no phrase`).toBeTruthy();
      expect(label).not.toBe(status);
      expect(label).not.toBe(status.replaceAll("_", " "));
      expect(label, `${status}: not sentence case — a database value is lower case`).toMatch(/^[A-Z]/);
      expect(label!.trim().split(/\s+/).length, `${status}: a single word is a token, not a phrase`).toBeGreaterThan(1);
    }
  });

  it("absent_and_unknown_values_answer_null_rather_than_guessing", () => {
    // `frozen`, `paused` and `canceled` are the ops/Stripe spellings this build does NOT
    // use — near-misses for the values it does. A map that answered them by fuzzy match
    // would be guessing about someone's money.
    for (const value of ["", "  ", "frozen", "paused", "canceled", "Active", null, undefined]) {
      expect(accountStatusLabel(value), `${String(value)} invented a phrase`).toBeNull();
    }
  });
});
