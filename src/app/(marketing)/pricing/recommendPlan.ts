import { DOCUMENT_PLANS, PLAN_BY_ID, type Plan } from "@/lib/plans";

// The /pricing recommender: the cheapest document plan whose monthly allowance covers the
// visitor's volume, Enterprise above the largest. Documents a month is the only question,
// because the plans differ by nothing else a visitor can answer up front (flows are set up
// later; every channel, output and check is on every plan). The trial is never recommended:
// its allowance is a one-off total, not a monthly volume.

/** The slider reaches twice the largest plan, so the Enterprise answer is reachable. */
export const DOCUMENT_SLIDER_STEP = 50;
export const DOCUMENT_SLIDER_MAX = 2 * Math.max(...DOCUMENT_PLANS.map((p) => p.orderLimit ?? 0));

export function recommendPlan(documentsPerMonth: number): Plan {
  return DOCUMENT_PLANS.find((p) => (p.orderLimit ?? 0) >= documentsPerMonth) ?? PLAN_BY_ID.enterprise;
}
