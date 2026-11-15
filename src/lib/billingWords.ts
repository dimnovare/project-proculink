import type { BillingPlan, BillingStatus } from "@/types/procurement";
import { PLAN_BY_ID, type Plan } from "@/lib/plans";
import { NUMBER_LOCALE } from "@/lib/format-number";

/**
 * Plan & billing in words. Every price, allowance and rate is read from `src/lib/plans.ts` or
 * from the server's billing status; nothing here types a number or a tier name.
 */

const count = (n: number) => n.toLocaleString(NUMBER_LOCALE);

/** "€35", "€0.24", "€2.40", "€1,499": two decimals only when there are cents. */
export function euro(n: number): string {
  const digits = Math.round(n * 100) % 100 === 0 ? 0 : 2;
  return `€${n.toLocaleString(NUMBER_LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/** "€35 a month" / "€350 a year"; null when the plan has no price for that period (Trial, Enterprise). */
export function priceWords(plan: Plan, interval: "monthly" | "yearly"): string | null {
  const price = interval === "yearly" ? plan.priceYearly : plan.priceMonthly;
  return price ? `${euro(price)} a ${interval === "yearly" ? "year" : "month"}` : null;
}

/** Trial: "Free for 30 days, 9 days left." / "…, 1 day left." / "Free for 30 days." (no end, or past it).
 *  Paid: "€35 a month, billed monthly" / "€350 a year, billed annually" / "€35 a month" (no interval). Enterprise: null. */
export function planLine(s: Pick<BillingStatus, "plan" | "billingInterval" | "trialEndsAt">, now: Date): string | null {
  const plan = PLAN_BY_ID[s.plan];
  if (s.plan === "pilot") {
    const left = Math.ceil((new Date(s.trialEndsAt ?? NaN).getTime() - now.getTime()) / 86_400_000);
    return `Free for ${plan.priceCadence}${left >= 1 ? `, ${left} day${left === 1 ? "" : "s"} left` : ""}.`;
  }
  const words = priceWords(plan, s.billingInterval ?? "monthly");
  if (!words || !s.billingInterval) return words;
  return `${words}, billed ${s.billingInterval === "yearly" ? "annually" : "monthly"}`;
}

export interface Use { label: string; used: number; limit: number | null; sub: string | null; barLabel: string | null }

/** Documents; `limit` null (no bar, no sub) for Enterprise or the unlimited sentinel (>= 2_000_000_000). */
export function documentsUse(
  s: Pick<BillingStatus, "plan" | "ordersThisMonth" | "orderLimit" | "overageOrders" | "overageAmountEur">,
): Use {
  const trial = s.plan === "pilot";
  const label = trial ? "Documents in your trial" : "Documents this month";
  const used = s.ordersThisMonth;
  if (s.plan === "enterprise" || s.orderLimit >= 2_000_000_000) return { label, used, limit: null, sub: null, barLabel: null };
  const left = Math.max(0, s.orderLimit - used);
  const where = trial ? "in your trial" : "this month";
  const sub = trial
    ? `${left ? count(left) : "None"} left in your trial.`
    : s.overageOrders > 0
      ? `${count(s.overageOrders)} extra so far this month, about ${euro(s.overageAmountEur)}.`
      : `${left ? count(left) : "None"} left before extra documents start.`;
  return { label, used, limit: s.orderLimit, sub, barLabel: `${count(used)} of ${count(s.orderLimit)} documents used ${where}` };
}

export function flowsUse(used: number, flowLimit: number | null): Use {
  if (flowLimit == null) return { label: "Flows", used, limit: null, sub: "Your plan has no limit on flows.", barLabel: null };
  const room = flowLimit - used;
  const sub = room > 0 ? `Room for ${count(room)} more flow${room === 1 ? "" : "s"}.` : "No room for more flows on this plan.";
  return { label: "Flows", used, limit: flowLimit, sub, barLabel: `${count(used)} of ${count(flowLimit)} flows used` };
}

/** The two extra-document sentences for a plan with a rate; null for Trial and Enterprise. */
export function extraLines(plan: BillingPlan): readonly [string, string] | null {
  const rate = PLAN_BY_ID[plan]?.overageEur;
  if (rate == null) return null;
  return [
    `${euro(rate)} for each extra document. You're never blocked.`,
    "A busy month never costs more than the larger plan that would have covered it.",
  ];
}
