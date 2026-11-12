import {
  PLANS,
  PLAN_BY_ID,
  planEffectiveMonthlyCost,
  recommendPlanByOrders,
  type Plan,
} from "@/lib/plans";

// ─────────────────────────────────────────────────────────────────────────────
// The /pricing recommender: the cheapest plan that fits BOTH the visitor's document
// volume and the number of suppliers they send orders to.
//
// It used to ask for volume alone (recommendPlanByOrders), which could point a
// visitor at a plan their supplier count does not fit — 200 orders a month across
// eight suppliers came out as Growth, which includes five. The two allowances are
// not the same kind of limit, and that is why they are combined the way they are:
//
//   • ORDERS are a soft cap on paid plans. Going over never blocks; it accrues the
//     per-order overage. So volume is a COST question, and recommendPlanByOrders
//     already answers it cost-optimally (flat price + overage) — it is reused, not
//     re-implemented, so the ROI calculator and this page cannot disagree about
//     volume alone.
//   • SUPPLIERS are a hard cap. POST /api/suppliers refuses past the plan's allowance
//     (`supplier_limit_reached`), so a plan whose supplierLimit is below the visitor's
//     count is not a cheaper option, it is not an option.
//
// So: take the volume answer when it fits the supplier count. Otherwise walk the
// self-serve tiers that DO fit with recommendPlanByOrders' own upgrade rule (move up
// once this tier's flat + overage reaches the next tier's flat price) — the same cost
// model, just over a ladder with the too-small tiers removed. If no self-serve tier
// fits, Enterprise (supplier counts set by agreement, supplierLimit: null).
//
// "Cheapest" is deliberately recommendPlanByOrders' notion of cheapest and not a raw
// flat + overage comparison: that helper mirrors the backend's best-price overage cap,
// under which a customer is never charged more than the cheapest tier covering their
// volume. A naive comparison would disagree with it at the crossovers (650 orders:
// Growth at €149 + overage = €399 vs Operations' €399 flat) and the pricing page would
// then recommend differently from the ROI calculator for the same volume.
//
// Every number comes from src/lib/plans.ts. Nothing here names a tier or an allowance.
// Pilot is never recommended, matching recommendPlanByOrders: its allowance is a
// one-off trial total, not a monthly volume, so it cannot answer "per month".
// ─────────────────────────────────────────────────────────────────────────────

/** Self-serve paid tiers, cheapest first — the tiers a visitor can buy without talking to us. */
export const SELF_SERVE_TIERS: Plan[] = PLANS.filter((p) => p.isCheckout);

/** The largest supplier allowance any self-serve tier includes. Above it, only Enterprise fits. */
export const MAX_SELF_SERVE_SUPPLIERS: number = Math.max(
  ...SELF_SERVE_TIERS.map((p) => p.supplierLimit ?? 0),
);

/** True when the plan's supplier allowance covers `suppliers`. null = by agreement (Enterprise). */
export function fitsSuppliers(plan: Plan, suppliers: number): boolean {
  return plan.supplierLimit == null || plan.supplierLimit >= suppliers;
}

export function recommendPlan(documentsPerMonth: number, suppliers: number): Plan {
  const byVolume = recommendPlanByOrders(documentsPerMonth);
  if (byVolume.isCustom || fitsSuppliers(byVolume, suppliers)) return byVolume;

  const fitting = SELF_SERVE_TIERS.filter((p) => fitsSuppliers(p, suppliers));
  if (fitting.length === 0) return PLAN_BY_ID.enterprise;

  // recommendPlanByOrders' upgrade rule, over the tiers that fit. (Its Enterprise-floor
  // check is not repeated: reaching it needs a volume at which byVolume above is already
  // Enterprise, and that returned early.)
  let current = fitting[0];
  for (const next of fitting.slice(1)) {
    const cost = planEffectiveMonthlyCost(current, documentsPerMonth);
    if (cost != null && next.priceMonthly != null && cost.total >= next.priceMonthly) current = next;
  }
  return current;
}
