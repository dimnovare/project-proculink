import { describe, it, expect } from "vitest";
import {
  PLAN_BY_ID,
  VOLUME_SLIDER_MAX,
  planEffectiveMonthlyCost,
  recommendPlanByOrders,
  type Plan,
} from "@/lib/plans";
import {
  MAX_SELF_SERVE_SUPPLIERS,
  SELF_SERVE_TIERS,
  fitsSuppliers,
  recommendPlan,
} from "./recommendPlan";

// Every expectation below is derived from the plan ladder, never typed. A literal
// "200 documents, 8 suppliers → Operations" would keep passing after a repricing moved
// the answer, which is the drift the recommender exists to prevent.

/** Same range and step the /pricing documents slider offers. */
const ORDER_GRID = Array.from({ length: VOLUME_SLIDER_MAX / 10 }, (_, i) => 10 + i * 10);
const SUPPLIER_GRID = Array.from({ length: MAX_SELF_SERVE_SUPPLIERS + 5 }, (_, i) => i + 1);

const cost = (plan: Plan, orders: number) => planEffectiveMonthlyCost(plan, orders)?.total ?? Infinity;

describe("recommendPlan — documents AND suppliers", () => {
  it("THE DEFECT: a volume-only answer whose supplier allowance is too small is no longer recommended", () => {
    // Find a real case where the old volume-only recommender undershoots the supplier
    // count — then assert the new one does not. Derived, so it survives repricing.
    const orders = SELF_SERVE_TIERS[0].orderLimit!;
    const byVolume = recommendPlanByOrders(orders);
    expect(byVolume.supplierLimit, "the volume answer must be a capped tier for this case").not.toBeNull();
    const suppliers = byVolume.supplierLimit! + 1;

    const pick = recommendPlan(orders, suppliers);
    expect(fitsSuppliers(byVolume, suppliers)).toBe(false);
    expect(fitsSuppliers(pick, suppliers)).toBe(true);
    expect(pick.id).not.toBe(byVolume.id);
    // …and it is the first self-serve tier that fits, not a jump to the top.
    expect(pick.id).toBe(SELF_SERVE_TIERS.find((p) => fitsSuppliers(p, suppliers))!.id);
  });

  it("agrees with the volume-only recommender whenever one supplier is enough", () => {
    for (const orders of ORDER_GRID) {
      expect(recommendPlan(orders, 1).id, `${orders} orders, 1 supplier`).toBe(recommendPlanByOrders(orders).id);
    }
  });

  it("always recommends a plan that fits the supplier count", () => {
    for (const orders of ORDER_GRID) {
      for (const suppliers of SUPPLIER_GRID) {
        const pick = recommendPlan(orders, suppliers);
        expect(fitsSuppliers(pick, suppliers), `${orders} orders, ${suppliers} suppliers → ${pick.id}`).toBe(true);
      }
    }
  });

  it("moves up the ladder only as far as the supplier count forces it", () => {
    // "Cheapest plan satisfying both", stated in ladder terms: never below the tier the
    // volume calls for, never below the first tier whose supplier allowance fits — and no
    // higher than the greater of the two. A walk that overshot (or a naive flat+overage
    // comparison that undershot the volume answer) fails here.
    const rank = (p: Plan) => SELF_SERVE_TIERS.findIndex((t) => t.id === p.id);
    for (const orders of ORDER_GRID) {
      for (const suppliers of SUPPLIER_GRID) {
        const pick = recommendPlan(orders, suppliers);
        if (pick.isCustom) continue;
        const firstFit = SELF_SERVE_TIERS.find((p) => fitsSuppliers(p, suppliers))!;
        const expected = Math.max(rank(recommendPlanByOrders(orders)), rank(firstFit));
        expect(rank(pick), `${orders} orders, ${suppliers} suppliers → ${pick.id}`).toBe(expected);
      }
    }
  });

  it("when suppliers force a dearer tier, it costs no more than the next tier up would", () => {
    // The supplier-driven pick is the cheapest tier that fits, so the tier above it (where
    // there is one) must not be a cheaper way to the same supplier allowance.
    for (const orders of ORDER_GRID) {
      for (const suppliers of SUPPLIER_GRID) {
        const pick = recommendPlan(orders, suppliers);
        if (pick.isCustom || pick.id === recommendPlanByOrders(orders).id || pick.next == null) continue;
        const above = PLAN_BY_ID[pick.next];
        if (above.isCustom) continue;
        expect(cost(pick, orders) < cost(above, orders), `${orders} orders, ${suppliers} suppliers`).toBe(true);
      }
    }
  });

  it("sends a visitor to Enterprise only when volume demands it or no self-serve tier fits", () => {
    for (const orders of ORDER_GRID) {
      for (const suppliers of SUPPLIER_GRID) {
        const pick = recommendPlan(orders, suppliers);
        if (!pick.isCustom) continue;
        const volumeSaysEnterprise = recommendPlanByOrders(orders).isCustom;
        const nothingSelfServeFits = !SELF_SERVE_TIERS.some((p) => fitsSuppliers(p, suppliers));
        expect(volumeSaysEnterprise || nothingSelfServeFits, `${orders} orders, ${suppliers} suppliers`).toBe(true);
      }
    }
  });

  it("goes to Enterprise one supplier past the largest self-serve allowance", () => {
    const documents = SELF_SERVE_TIERS[0].orderLimit!;
    expect(recommendPlan(documents, MAX_SELF_SERVE_SUPPLIERS).isCustom).toBe(false);
    expect(recommendPlan(documents, MAX_SELF_SERVE_SUPPLIERS + 1).id).toBe(PLAN_BY_ID.enterprise.id);
  });

  it("never recommends the Pilot trial as a monthly plan", () => {
    for (const orders of ORDER_GRID) {
      for (const suppliers of SUPPLIER_GRID) {
        expect(recommendPlan(orders, suppliers).id).not.toBe(PLAN_BY_ID.pilot.id);
      }
    }
  });

  it("ANTI-VACUITY: the grid really exercises the supplier-driven branch and the Enterprise branch", () => {
    // Without this, a recommendPlan that simply returned recommendPlanByOrders would pass
    // every grid assertion above that `continue`s past the cases it never produces.
    let supplierDriven = 0;
    let enterpriseBySuppliers = 0;
    for (const orders of ORDER_GRID) {
      for (const suppliers of SUPPLIER_GRID) {
        const pick = recommendPlan(orders, suppliers);
        const byVolume = recommendPlanByOrders(orders);
        if (pick.id !== byVolume.id && !pick.isCustom) supplierDriven++;
        if (pick.isCustom && !byVolume.isCustom) enterpriseBySuppliers++;
      }
    }
    expect(supplierDriven).toBeGreaterThan(100);
    expect(enterpriseBySuppliers).toBeGreaterThan(100);
    expect(SELF_SERVE_TIERS.length).toBeGreaterThanOrEqual(3);
  });
});
