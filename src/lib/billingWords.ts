import type { BillingPlan, BillingStatus } from "@/types/procurement";
import { CHECKOUT_PLAN_IDS, DOCUMENT_PLAN_IDS, DOCUMENT_PLANS, PLAN_BY_ID, type Plan } from "@/lib/plans";
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

/** `warn`: the server says the workspace is near its limit, so the sentence is drawn in amber. */
export interface Use { label: string; used: number; limit: number | null; sub: string | null; barLabel: string | null; warn?: boolean }

/**
 * Documents; `limit` null (no bar, no sub) for Enterprise or the unlimited sentinel (>= 2_000_000_000).
 * The extras are documents above the allowance, so they agree with the bar; the server's
 * `overageOrders` is the billable count after the price cap and is never shown as a count.
 */
export function documentsUse(
  s: Pick<BillingStatus, "plan" | "ordersThisMonth" | "orderLimit" | "overageAmountEur" | "nearLimit">,
): Use {
  const trial = s.plan === "pilot";
  const label = trial ? "Documents in your trial" : "Documents this month";
  const used = s.ordersThisMonth;
  if (s.plan === "enterprise" || s.orderLimit >= 2_000_000_000) return { label, used, limit: null, sub: null, barLabel: null };
  const left = Math.max(0, s.orderLimit - used);
  const extras = Math.max(0, used - s.orderLimit);
  const where = trial ? "in your trial" : "this month";
  const until = trial ? "in your trial" : "before extra documents start";
  const warn = s.nearLimit && left > 0;
  const sub = !trial && extras > 0
    ? `${count(extras)} extra so far this month${s.overageAmountEur > 0 ? `, about ${euro(s.overageAmountEur)} billed` : ""}.`
    : `${warn ? "Nearly at your limit: " : ""}${left ? count(left) : "None"} left ${until}.`;
  return { label, used, limit: s.orderLimit, sub, barLabel: `${count(used)} of ${count(s.orderLimit)} documents used ${where}`, warn };
}

export function flowsUse(used: number, flowLimit: number | null): Use {
  if (flowLimit == null) return { label: "Flows", used, limit: null, sub: "Your plan has no limit on flows.", barLabel: null };
  const room = flowLimit - used;
  const sub = room > 0 ? `Room for ${count(room)} more flow${room === 1 ? "" : "s"}.` : "No room for more flows on this plan.";
  return { label: "Flows", used, limit: flowLimit, sub, barLabel: `${count(used)} of ${count(flowLimit)} flows used`, warn: room <= 0 };
}

export interface PlanRow { plan: Plan; state: "current" | "upgrade" | "lower" }

/**
 * R10. What "Change plan" lists: a document plan sees the document plans; a trial sees them with
 * the engine on, the legacy self-serve plans with it off, and nothing until it answers; a legacy
 * paid plan sees itself and the one its `next` points at; Enterprise sees nothing. The trial is
 * never a row. State is by position on the list, so a cheaper plan is never an upgrade.
 */
export function changePlanRows(current: BillingPlan, engine: "on" | "off" | "unknown"): PlanRow[] {
  const next = PLAN_BY_ID[current]?.next;
  const plans =
    current === "pilot"
      ? engine === "on" ? DOCUMENT_PLANS : engine === "off" ? CHECKOUT_PLAN_IDS.map((id) => PLAN_BY_ID[id]) : []
      : DOCUMENT_PLAN_IDS.includes(current)
        ? DOCUMENT_PLANS
        : current === "enterprise" || !PLAN_BY_ID[current]
          ? []
          : [PLAN_BY_ID[current], ...(next ? [PLAN_BY_ID[next]] : [])];
  const at = plans.findIndex((p) => p.id === current);
  return plans.map((plan, i) => ({ plan, state: i === at ? "current" : i > at ? "upgrade" : "lower" }));
}

/** Whole months an annual price saves on this plan, or null when it has no annual price. */
export function monthsFree(plan: Plan): number | null {
  return plan.priceYearly && plan.priceMonthly ? Math.round(12 - plan.priceYearly / plan.priceMonthly) : null;
}

/**
 * The extra-document sentences for a plan with a rate; null for Trial and Enterprise. "You're never
 * blocked." is left out while the server has paused processing, and the price-cap sentence is left
 * out on the top plan, which has no larger plan to cap a month at.
 */
export function extraLines(plan: BillingPlan, paused = false): readonly [string, string?] | null {
  const p = PLAN_BY_ID[plan];
  if (p?.overageEur == null) return null;
  const rate = `${euro(p.overageEur)} for each extra document.${paused ? "" : " You're never blocked."}`;
  return p.next ? [rate, "A busy month never costs more than the larger plan that would have covered it."] : [rate];
}
