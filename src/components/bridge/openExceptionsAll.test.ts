import { describe, it, expect } from "vitest";
import { sumByStatuses, EXCEPTION_STATUSES } from "./BridgeDashboard";
import type { OrderStatus } from "@/types/procurement";

// openExceptionsAll — the live "N orders need your attention" amber strip.
//
// The live branch used to hand-list six status literals while mock mode derived
// the same count from EXCEPTION_STATUSES. They silently diverged: adding a status
// to EXCEPTION_STATUSES (delivery_held, then delivery_unconfirmed) changed nothing
// in the only mode that ships. sumByStatuses is the fix — both branches now read
// the one set, so a status added there can never be counted in mock mode but
// invisible live.

describe("sumByStatuses — the live exception count cannot drift from EXCEPTION_STATUSES", () => {
  it("counts a delivery_unconfirmed order (a parked order needing an operator decision)", () => {
    const byStatus: Partial<Record<OrderStatus, number>> = { delivery_unconfirmed: 1 };
    expect(sumByStatuses(byStatus, EXCEPTION_STATUSES)).toBe(1);
  });

  it("counts a delivery_held order (a billing-paused order)", () => {
    const byStatus: Partial<Record<OrderStatus, number>> = { delivery_held: 1 };
    expect(sumByStatuses(byStatus, EXCEPTION_STATUSES)).toBe(1);
  });

  it("sums every status in the set, ignoring statuses outside it", () => {
    const byStatus: Partial<Record<OrderStatus, number>> = {
      pending_review: 2,
      failed: 1,
      delivery_failed: 1,
      transform_failed: 1,
      delivery_dead_letter: 1,
      rejected_by_supplier: 1,
      delivery_held: 1,
      delivery_unconfirmed: 1,
      ready: 99, // not an exception status — must not be counted
      delivered: 42, // not an exception status — must not be counted
    };
    expect(sumByStatuses(byStatus, EXCEPTION_STATUSES)).toBe(9);
  });

  it("treats a missing byStatus as zero, never throwing", () => {
    expect(sumByStatuses(undefined, EXCEPTION_STATUSES)).toBe(0);
    expect(sumByStatuses({}, EXCEPTION_STATUSES)).toBe(0);
  });

  it("EXCEPTION_STATUSES still contains both — the invariant this guards", () => {
    expect(EXCEPTION_STATUSES.has("delivery_held")).toBe(true);
    expect(EXCEPTION_STATUSES.has("delivery_unconfirmed")).toBe(true);
  });
});
