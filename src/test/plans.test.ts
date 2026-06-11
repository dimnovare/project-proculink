import { describe, expect, it } from "vitest";
import {
  OVERAGE_PER_ORDER_EUR,
  PLAN_BY_ID,
  planEffectiveMonthlyCost,
  recommendPlanByOrders,
} from "@/lib/plans";

// Cost-optimal recommendation (LAUNCH BATCH 1, Task C): effective monthly cost
// = flat price + max(0, orders − allowance) × €0.50, mirroring the backend
// PlanConstants best-price overage logic. The recommender upgrades only once
// the current tier's effective cost reaches the next tier's flat price.

describe("planEffectiveMonthlyCost", () => {
  it("matches the backend €0.50/order overage rate", () => {
    expect(OVERAGE_PER_ORDER_EUR).toBe(0.5);
  });

  it("charges flat price with no overage within the allowance (quota-fit edge)", () => {
    const growth = PLAN_BY_ID.growth;
    expect(planEffectiveMonthlyCost(growth, 150)).toEqual({
      total: 149,
      overageOrders: 0,
      overageEur: 0,
    });
  });

  it("adds €0.50 per order above the allowance", () => {
    const growth = PLAN_BY_ID.growth;
    expect(planEffectiveMonthlyCost(growth, 200)).toEqual({
      total: 174, // €149 + 50 × €0.50
      overageOrders: 50,
      overageEur: 25,
    });
  });

  it("returns null for plans without a fixed monthly price (Pilot, Enterprise)", () => {
    expect(planEffectiveMonthlyCost(PLAN_BY_ID.pilot, 100)).toBeNull();
    expect(planEffectiveMonthlyCost(PLAN_BY_ID.enterprise, 100)).toBeNull();
  });
});

describe("recommendPlanByOrders (cost-optimal)", () => {
  it("recommends Growth at 200 orders (€174 effective), NOT Operations (€399)", () => {
    const plan = recommendPlanByOrders(200);
    expect(plan.id).toBe("growth");
    expect(planEffectiveMonthlyCost(plan, 200)?.total).toBe(174);
  });

  it("recommends Growth at exactly the 150-order allowance", () => {
    expect(recommendPlanByOrders(150).id).toBe("growth");
  });

  it("recommends Growth at 500 orders — €324 effective beats Operations €399 flat", () => {
    const plan = recommendPlanByOrders(500);
    expect(plan.id).toBe("growth");
    expect(planEffectiveMonthlyCost(plan, 500)?.total).toBe(324);
  });

  it("crosses over to Operations at 650 orders (Growth effective hits €399)", () => {
    expect(recommendPlanByOrders(649).id).toBe("growth");
    expect(recommendPlanByOrders(650).id).toBe("operations");
    expect(recommendPlanByOrders(700).id).toBe("operations");
  });

  it("stays on Operations at 1,500 orders — €899 effective beats Integration €999 flat", () => {
    const plan = recommendPlanByOrders(1500);
    expect(plan.id).toBe("operations");
    expect(planEffectiveMonthlyCost(plan, 1500)?.total).toBe(899);
  });

  it("crosses over to Integration at 1,700 orders (Operations effective hits €999)", () => {
    expect(recommendPlanByOrders(1699).id).toBe("operations");
    expect(recommendPlanByOrders(1700).id).toBe("integration");
  });

  it("crosses over to Distributor at 2,500 orders (Integration effective hits €1,499)", () => {
    expect(recommendPlanByOrders(2499).id).toBe("integration");
    expect(recommendPlanByOrders(2500).id).toBe("distributor");
  });

  it("recommends Enterprise only once Distributor's effective cost reaches the €2,500 floor", () => {
    expect(recommendPlanByOrders(4501).id).toBe("distributor");
    expect(recommendPlanByOrders(4502).id).toBe("enterprise");
  });
});
