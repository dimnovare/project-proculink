import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// /operations/health and the billing hold — truthfulness guard.
//
// The page is the most trusted-at-a-glance surface in the product: an operator reads
// the green "All clear" banner and stops looking. `delivery_held` orders are PAUSED —
// the PO is not going to the supplier — but the all-clear gate was a fixed list of
// zero-checks that had no idea the status existed. So the page rendered green while
// POs sat unsent. That is the bug these tests pin.
//
// The negative assertions are the point, twice over:
//   • held orders must BREAK the green banner (it must not lie), and
//   • they must never read as a FAILURE (it is a deliberate, self-releasing pause —
//     the operator's action is the invoice, not chasing the supplier).

import { isAllClear } from "./opsHealthState";
import { DeliveryPausedCard } from "./DeliveryPausedCard";
import { BILLING_HELD_MESSAGE } from "@/components/bridge/review/hooks/useOrderReview";
import type { OpsHealth } from "@/lib/api-client";

afterEach(cleanup);

/** A perfectly healthy org: every count the gate knows about is zero. */
const CLEAN: OpsHealth = {
  parsingStuck: 0,
  deliveringStuck: 0,
  transformFailed: 0,
  deliveryFailed: 0,
  deliveryDeadLetter: 0,
  rejectedBySupplier: 0,
  failed: 0,
  slaBreached: 0,
  openExceptions: 0,
  pendingReview: 0,
  deliveryHeld: 0,
  stuckThresholdMinutes: 30,
  totalProblemOrders: 0,
  workerHealthy: true,
  activeWorkers: 1,
  lastWorkerHeartbeatUtc: new Date().toISOString(),
  secondsSinceWorkerHeartbeat: 3,
};

describe("the all-clear gate accounts for paused deliveries", () => {
  it("still reads All clear when genuinely nothing is wrong", () => {
    expect(isAllClear(CLEAN)).toBe(true);
  });

  it("is NOT All clear while a delivery is paused for billing", () => {
    // The live bug: every other count is zero, so the old gate said green while
    // the PO sat unsent.
    expect(isAllClear({ ...CLEAN, deliveryHeld: 1 })).toBe(false);
  });

  it("treats a missing deliveryHeld field as zero, not as a problem", () => {
    // The backend field ships separately; an API that predates it omits the key.
    // Undefined must not manufacture a phantom paused order (that would replace a
    // false green with a false amber — the same class of lie, opposite direction).
    const { deliveryHeld: _omitted, ...withoutField } = CLEAN;
    expect(isAllClear(withoutField as OpsHealth)).toBe(true);
  });

  it("keeps reading the other problem states it always did", () => {
    // Guard against a refactor that swaps the direct checks for the BE aggregate:
    // the page's own rule is that the aggregate is an optimization and these
    // direct checks are the source of truth.
    expect(isAllClear({ ...CLEAN, deliveryFailed: 1 })).toBe(false);
    expect(isAllClear({ ...CLEAN, deliveryDeadLetter: 1 })).toBe(false);
    expect(isAllClear({ ...CLEAN, openExceptions: 1 })).toBe(false);
    expect(isAllClear({ ...CLEAN, slaBreached: 1 })).toBe(false);
    expect(isAllClear({ ...CLEAN, totalProblemOrders: 1 })).toBe(false);
  });

  it("is not fooled by a backend that folds held into totalProblemOrders", () => {
    // The BE may or may not count held in its aggregate — that call is still open.
    // Either way the direct check decides, so the gate behaves identically.
    expect(isAllClear({ ...CLEAN, deliveryHeld: 2, totalProblemOrders: 2 })).toBe(false);
    expect(isAllClear({ ...CLEAN, deliveryHeld: 2, totalProblemOrders: 0 })).toBe(false);
  });
});

describe("the paused-delivery card reads as paused, not failed", () => {
  it("names the count and the state", () => {
    render(<DeliveryPausedCard count={3} />);
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("Deliveries paused")).toBeInTheDocument();
  });

  it("uses the same explanation as the rest of the held work, not a retyped variant", () => {
    render(<DeliveryPausedCard count={1} />);
    expect(screen.getByText(BILLING_HELD_MESSAGE)).toBeInTheDocument();
  });

  it("does not claim a single supplier file when several orders are paused", () => {
    // BILLING_HELD_MESSAGE was authored for BillingHeldPanel, which always renders
    // exactly ONE order — hence "The supplier file is generated and waiting". This
    // card aggregates N. Reusing the sentence verbatim under a plural "Deliveries
    // paused" heading disagrees in number and undercounts what is waiting.
    render(<DeliveryPausedCard count={3} />);
    expect(screen.queryByText(/The supplier file is generated/)).not.toBeInTheDocument();
    // The load-bearing claims must survive the rewording: billing cause, nothing
    // lost, automatic resume.
    const body = screen.getByTestId("paused-explanation").textContent ?? "";
    expect(body).toMatch(/billing/i);
    expect(body).toMatch(/automatically/i);
    expect(body).toMatch(/nothing has been lost/i);
    expect(body).not.toMatch(/failed/i);
  });

  it("never calls the pause a failure", () => {
    render(<DeliveryPausedCard count={2} />);
    expect(screen.queryByText(/failed/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/error/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/stuck/i)).not.toBeInTheDocument();
  });

  it("says the resume is automatic, so nobody chases the supplier", () => {
    render(<DeliveryPausedCard count={1} />);
    expect(screen.getByText(/automatically/i)).toBeInTheDocument();
  });

  it("points at billing — the only thing that actually releases the order", () => {
    render(<DeliveryPausedCard count={1} />);
    expect(screen.getByRole("link", { name: /go to billing/i })).toHaveAttribute(
      "href",
      "/settings?tab=billing",
    );
  });

  it("links to the paused orders themselves, like the review-backlog card does", () => {
    render(<DeliveryPausedCard count={4} />);
    expect(screen.getByRole("link", { name: /paused/i })).toHaveAttribute(
      "href",
      "/inbox?status=delivery_held",
    );
  });

  it("announces the count as words, not welded to the label", () => {
    // The count and the label are separate elements with only a visual `gap` between
    // them, so the link's textContent is the run-together "4Deliveries paused". The
    // accessible name is NOT textContent — name computation separates element children —
    // but that distinction is easy to lose in a refactor. Flattening these two spans
    // into one interpolated string, or dropping the element boundary, would genuinely
    // weld them. This pins the announced name so that regression is caught.
    render(<DeliveryPausedCard count={4} />);
    const link = screen.getByRole("link", { name: /paused/i });
    expect(link).toHaveAccessibleName("4 Deliveries paused");
  });

  it("offers no retry or send action — the release is not a button", () => {
    // POST /redeliver answers 400 for a held order (RedeliverableFrom excludes it).
    // A control that always errors is worse than no control.
    render(<DeliveryPausedCard count={1} />);
    expect(screen.queryByRole("button", { name: /send|retry|requeue/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /send|retry|requeue/i })).not.toBeInTheDocument();
  });
});
