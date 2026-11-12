import { describe, it, expect } from "vitest";
import { DOCUMENT_PLANS, PLAN_BY_ID } from "@/lib/plans";
import { DOCUMENT_SLIDER_MAX, DOCUMENT_SLIDER_STEP, recommendPlan } from "./recommendPlan";

// Expectations are derived from the ladder, never typed.

describe("recommendPlan — documents a month only", () => {
  it("picks the cheapest document plan whose allowance covers the volume", () => {
    const largest = Math.max(...DOCUMENT_PLANS.map((p) => p.orderLimit!));
    for (let documents = DOCUMENT_SLIDER_STEP; documents <= DOCUMENT_SLIDER_MAX; documents += DOCUMENT_SLIDER_STEP) {
      const pick = recommendPlan(documents);
      if (pick.isCustom) {
        expect(documents, "Enterprise only above the largest allowance").toBeGreaterThan(largest);
      } else {
        expect(pick.orderLimit!).toBeGreaterThanOrEqual(documents);
        const cheaperCovering = DOCUMENT_PLANS.filter(
          (p) => p.priceMonthly! < pick.priceMonthly! && p.orderLimit! >= documents,
        );
        expect(cheaperCovering, `${documents} documents`).toEqual([]);
      }
    }
    expect(recommendPlan(DOCUMENT_SLIDER_MAX).id).toBe(PLAN_BY_ID.enterprise.id);
  });
});
