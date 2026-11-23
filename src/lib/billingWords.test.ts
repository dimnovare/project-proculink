import { describe, expect, it } from "vitest";
import { CHECKOUT_PLAN_IDS, DOCUMENT_PLANS, PLAN_BY_ID } from "@/lib/plans";
import { changePlanRows, documentsUse, euro, extraLines, flowsUse, monthsFree, planLine, priceWords } from "./billingWords";

const now = new Date(2026, 5, 1, 9, 30);
const days = (n: number) => new Date(now.getTime() + n * 86_400_000).toISOString();
const trial = PLAN_BY_ID.pilot.priceCadence;
const starter = PLAN_BY_ID.starter;
const use = (over: object) => ({ plan: "starter" as const, ordersThisMonth: 0, orderLimit: starter.orderLimit!, overageOrders: 0, overageAmountEur: 0, nearLimit: false, ...over });

describe("billing words", () => {
  it("prices a plan by the period billed, and a trial by the days left", () => {
    expect(planLine({ plan: "pilot", billingInterval: null, trialEndsAt: days(9) }, now)).toBe(`Free for ${trial}, 9 days left.`);
    expect(planLine({ plan: "pilot", billingInterval: null, trialEndsAt: days(0.5) }, now)).toBe(`Free for ${trial}, 1 day left.`);
    for (const end of [null, days(-2), "not a date"]) {
      expect(planLine({ plan: "pilot", billingInterval: null, trialEndsAt: end }, now)).toBe(`Free for ${trial}.`);
    }
    expect(planLine({ plan: "starter", billingInterval: "monthly", trialEndsAt: null }, now)).toBe(`€${starter.priceMonthly} a month, billed monthly`);
    expect(planLine({ plan: "starter", billingInterval: "yearly", trialEndsAt: null }, now)).toBe(`€${starter.priceYearly} a year, billed annually`);
    expect(planLine({ plan: "starter", billingInterval: null, trialEndsAt: null }, now)).toBe(`€${starter.priceMonthly} a month`);
    expect(planLine({ plan: "enterprise", billingInterval: null, trialEndsAt: null }, now)).toBeNull();
    expect(priceWords(PLAN_BY_ID.pilot, "monthly")).toBeNull();
    expect([euro(0.24), euro(2.4), euro(1499)]).toEqual(["€0.24", "€2.40", "€1,499"]);
  });

  it("words what is used and never prints a number it does not know", () => {
    expect(documentsUse(use({ plan: "pilot", ordersThisMonth: 5, orderLimit: 20 }))).toEqual({
      label: "Documents in your trial", used: 5, limit: 20, sub: "15 left in your trial.", barLabel: "5 of 20 documents used in your trial", warn: false,
    });
    // Near the limit the server says so, and the line says it in words with what is left.
    expect(documentsUse(use({ ordersThisMonth: 130, nearLimit: true }))).toMatchObject({
      sub: `Nearly at your limit: ${starter.orderLimit! - 130} left before extra documents start.`, warn: true,
    });
    expect(documentsUse(use({ plan: "pilot", ordersThisMonth: 17, orderLimit: 20, nearLimit: true })).sub).toBe("Nearly at your limit: 3 left in your trial.");
    // A heavy month: the extras are documents above the allowance, not the capped billable count.
    expect(documentsUse(use({ ordersThisMonth: 400, overageOrders: 141, overageAmountEur: 33.84, nearLimit: true })).sub)
      .toBe(`${400 - starter.orderLimit!} extra so far this month, about €33.84 billed.`);
    expect(documentsUse(use({ plan: "pilot", ordersThisMonth: 20, orderLimit: 20 })).sub).toBe("None left in your trial.");
    expect(documentsUse(use({ ordersThisMonth: 112 }))).toMatchObject({
      label: "Documents this month", sub: "38 left before extra documents start.", barLabel: "112 of 150 documents used this month",
    });
    expect(documentsUse(use({ ordersThisMonth: 150 })).sub).toBe("None left before extra documents start.");
    expect(documentsUse(use({ ordersThisMonth: 160, overageOrders: 10, overageAmountEur: 2.4 })).sub).toBe("10 extra so far this month, about €2.40 billed.");
    for (const over of [{ plan: "enterprise", orderLimit: 500 }, { orderLimit: 2_147_483_647 }]) {
      expect(documentsUse(use({ ordersThisMonth: 40, ...over }))).toMatchObject({ used: 40, limit: null, sub: null, barLabel: null });
    }
    expect(flowsUse(3, 5)).toMatchObject({ label: "Flows", limit: 5, sub: "Room for 2 more flows.", barLabel: "3 of 5 flows used" });
    expect(flowsUse(4, 5).sub).toBe("Room for 1 more flow.");
    expect(flowsUse(6, 5).sub).toBe("No room for more flows on this plan.");
    expect([flowsUse(4, 5).warn, flowsUse(5, 5).warn, flowsUse(6, 5).warn]).toEqual([false, true, true]);
    expect(flowsUse(3, null)).toMatchObject({ limit: null, sub: "Your plan has no limit on flows.", barLabel: null });
    expect(extraLines("starter")).toEqual([
      `€${starter.overageEur} for each extra document. You're never blocked.`,
      "A busy month never costs more than the larger plan that would have covered it.",
    ]);
    // The top plan has no larger plan to cap a month at, so it does not promise one.
    expect(extraLines("scale")).toEqual([`${euro(PLAN_BY_ID.scale.overageEur!)} for each extra document. You're never blocked.`]);
    expect([extraLines("pilot"), extraLines("enterprise")]).toEqual([null, null]);
  });

  const ids = (rows: ReturnType<typeof changePlanRows>) => rows.map((r) => [r.plan.id, r.state]);

  it("offers only the plans above the current one, and nothing while the engine is unknown", () => {
    expect(ids(changePlanRows("pilot", "on"))).toEqual(DOCUMENT_PLANS.map((p) => [p.id, "upgrade"]));
    expect(ids(changePlanRows("pilot", "off"))).toEqual(CHECKOUT_PLAN_IDS.map((id) => [id, "upgrade"]));
    expect(changePlanRows("pilot", "unknown")).toEqual([]);
    expect(ids(changePlanRows("pro", "unknown"))).toEqual([["starter", "lower"], ["pro", "current"], ["business", "upgrade"], ["scale", "upgrade"]]);
    expect(ids(changePlanRows("scale", "on")).filter(([, s]) => s === "upgrade")).toEqual([]);
    expect(ids(changePlanRows("growth", "on"))).toEqual([["growth", "current"], ["operations", "upgrade"]]);
    expect(ids(changePlanRows("distributor", "on"))).toEqual([["distributor", "current"]]);
    expect(changePlanRows("enterprise", "on")).toEqual([]);
    expect(monthsFree(DOCUMENT_PLANS[0])).toBe(12 - DOCUMENT_PLANS[0].priceYearly! / DOCUMENT_PLANS[0].priceMonthly!);
    expect(monthsFree(PLAN_BY_ID.pilot)).toBeNull();
  });
});
