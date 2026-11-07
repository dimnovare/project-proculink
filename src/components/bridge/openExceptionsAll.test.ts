import { describe, it, expect } from "vitest";
import { sumByStatuses, EXCEPTION_ROW_STATUSES, EXCEPTION_STATUSES } from "./BridgeDashboard";
import type { OrderStatus } from "@/types/procurement";

// openExceptionsAll — the live "N orders need your attention" amber strip.
//
// The strip is a LINK to /operations/exceptions, and that page renders OrderException
// rows only. So the count must mirror the statuses the backend actually writes an
// exception row for (OrderExceptionService.ProblemFor) — not the dashboard's broader
// "needs a human" grouping (EXCEPTION_STATUSES), which also covers delivery_held.
//
// Counting a status ProblemFor has no case for is the failure mode these tests exist to
// stop: the strip promises "3 orders need your attention", the operator clicks, and the
// page is empty. Under-counting is merely a missed nudge; over-counting is a lie with a
// dead end at the other side of it.

describe("sumByStatuses — the live exception count mirrors the backend's ProblemFor", () => {
  it("counts a delivery_unconfirmed order — ProblemFor writes a row for it (warning)", () => {
    const byStatus: Partial<Record<OrderStatus, number>> = { delivery_unconfirmed: 1 };
    expect(sumByStatuses(byStatus, EXCEPTION_ROW_STATUSES)).toBe(1);
  });

  it("does NOT count a delivery_held order — ProblemFor has no case, so the page shows nothing", () => {
    // The regression this pins: billing lapses, 3 orders go delivery_held, the strip
    // says "3 orders need your attention", the operator clicks → empty page.
    const byStatus: Partial<Record<OrderStatus, number>> = { delivery_held: 3 };
    expect(sumByStatuses(byStatus, EXCEPTION_ROW_STATUSES)).toBe(0);
  });

  it("sums every exception-producing status, ignoring statuses outside the set", () => {
    const byStatus: Partial<Record<OrderStatus, number>> = {
      pending_review: 2,
      failed: 1,
      delivery_failed: 1,
      transform_failed: 1,
      delivery_dead_letter: 1,
      rejected_by_supplier: 1,
      delivery_unconfirmed: 1,
      delivery_held: 5, // paused, not an exception row — must not be counted
      ready: 99, // not an exception status — must not be counted
      delivered: 42, // not an exception status — must not be counted
    };
    expect(sumByStatuses(byStatus, EXCEPTION_ROW_STATUSES)).toBe(8);
  });

  it("treats a missing byStatus as zero, never throwing", () => {
    expect(sumByStatuses(undefined, EXCEPTION_ROW_STATUSES)).toBe(0);
    expect(sumByStatuses({}, EXCEPTION_ROW_STATUSES)).toBe(0);
  });

  it("EXCEPTION_ROW_STATUSES is exactly the ProblemFor set — re-adding delivery_held fails here", () => {
    // Structural pin, not a sample: this is the whole invariant. Mirrors
    // ProcuLink.Infrastructure/Services/OrderExceptionService.cs ProblemFor.
    expect([...EXCEPTION_ROW_STATUSES].sort()).toEqual([
      "delivery_dead_letter",
      "delivery_failed",
      "delivery_unconfirmed",
      "failed",
      "pending_review",
      "rejected_by_supplier",
      "transform_failed",
    ]);
    expect(EXCEPTION_ROW_STATUSES.has("delivery_held")).toBe(false);
  });

  it("EXCEPTION_STATUSES keeps delivery_held for its own consumers — the two sets differ on purpose", () => {
    // The dashboard's "needs a human" grouping (supplier-health exception counts,
    // the "Needs you" rows) is broader than the exception-row count and renders its
    // rows from the working set, so a billing-paused order still belongs there.
    expect(EXCEPTION_STATUSES.has("delivery_held")).toBe(true);
    expect(EXCEPTION_STATUSES.has("delivery_unconfirmed")).toBe(true);
  });
});
