import { describe, it, expect } from "vitest";

// /operations/health and a parked order — truthfulness guard.
//
// Sibling to deliveryHeld.test.tsx, same shape of bug: the all-clear gate was a fixed
// list of zero-checks that had no idea `delivery_unconfirmed` existed. Unlike a billing
// hold, a parked order IS a fault (the backend counts it in `totalProblemOrders`), so
// this file only needs the gate half of the sibling suite — there is no bespoke card
// to pin, because Task 4 deliberately uses a plain tile instead (see page.tsx TILES).

import { isAllClear } from "./opsHealthState";
import type { OpsHealth } from "@/lib/api-client";

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
  deliveryUnconfirmed: 0,
  stuckThresholdMinutes: 30,
  totalProblemOrders: 0,
  workerHealthy: true,
  activeWorkers: 1,
  lastWorkerHeartbeatUtc: new Date().toISOString(),
  secondsSinceWorkerHeartbeat: 3,
};

describe("the all-clear gate accounts for parked (unconfirmed-delivery) orders", () => {
  it("still reads All clear when genuinely nothing is wrong", () => {
    expect(isAllClear(CLEAN)).toBe(true);
  });

  it("is NOT All clear while an order is parked with an unconfirmed delivery", () => {
    // The live bug: every other count is zero, so the old gate said green while a
    // possibly-sent order sat waiting for an operator to check with the supplier.
    expect(isAllClear({ ...CLEAN, deliveryUnconfirmed: 1 })).toBe(false);
  });

  it("treats a missing deliveryUnconfirmed field as zero, not as a problem", () => {
    // The backend field ships separately (PR #27); an API that predates it omits the
    // key. Undefined must not manufacture a phantom parked order.
    const { deliveryUnconfirmed: _omitted, ...withoutField } = CLEAN;
    expect(isAllClear(withoutField as OpsHealth)).toBe(true);
  });

  it("keeps reading the other problem states it always did", () => {
    expect(isAllClear({ ...CLEAN, deliveryFailed: 1 })).toBe(false);
    expect(isAllClear({ ...CLEAN, deliveryHeld: 1 })).toBe(false);
    expect(isAllClear({ ...CLEAN, totalProblemOrders: 1 })).toBe(false);
  });

  it("still catches it even though the backend folds it into totalProblemOrders", () => {
    // Unlike deliveryHeld, the backend DOES count deliveryUnconfirmed inside
    // totalProblemOrders — so the aggregate backstop alone would already break green
    // here. The direct check must agree regardless of what the aggregate says.
    expect(isAllClear({ ...CLEAN, deliveryUnconfirmed: 2, totalProblemOrders: 2 })).toBe(false);
  });
});
