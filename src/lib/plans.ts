// ─────────────────────────────────────────────────────────────────────────────
// Shared plan constants — the single frontend source of truth for the plan
// ladder. Pricing page, in-app billing section, ROI calculator, and marketing
// copy all import from here so prices, order limits, and supplier limits can
// never drift apart again.
//
// These MUST match the backend `PlanConstants`:
//   Pilot       €0      · 20 orders (trial total) · 1 supplier  · 14-day trial
//   Growth      €149/mo · 150 orders/month        · 5 suppliers
//   Operations  €399/mo · 500 orders/month        · 10 suppliers
//   Integration €999/mo · 1,500 orders/month      · 20 suppliers
//   Distributor €1,499/mo · 2,500 orders/month    · 30 suppliers
//   Enterprise  from €2,500/mo · custom volume     · custom suppliers
//
// Per-order value stays MONOTONIC down the ladder (more volume → cheaper/order):
//   Growth €0.99 · Operations €0.80 · Integration ~€0.67 · Distributor €0.60.
//
// Delivery/ingestion CHANNELS (Webhook/API delivery, email ingestion, SFTP, S3)
// are available on ALL paid plans (Growth+) — the backend gates them at Growth.
// The paid tiers differ on VOLUME and SUPPLIER COUNT, not on which channels
// they unlock.
// ─────────────────────────────────────────────────────────────────────────────

import type { BillingPlan } from "@/types/procurement";

/** Plan identifiers, aligned 1:1 with the backend billing plan enum. */
export type PlanId = BillingPlan;

export interface Plan {
  id: PlanId;
  name: string;
  /** Numeric monthly price in EUR. 0 for Pilot; null for Enterprise (custom). */
  priceMonthly: number | null;
  /**
   * Numeric YEARLY price in EUR (the amount billed once per year on annual
   * billing) — the live Stripe `*YearlyPriceId` list price. null when the plan
   * has no annual price (Pilot, Enterprise). Annual billing is live; see
   * ANNUAL_BILLING_ENABLED below.
   */
  priceYearly: number | null;
  /** Big price label for pricing cards: "Free" / "€149" / "Custom". */
  priceLabel: string;
  /** Sub-label under the price on the pricing page. */
  priceCadence: string;
  /** Compact price for the in-app billing card: "Free trial" / "€149/mo" / "Custom". */
  billingPriceLabel: string;
  /** One-line summary for the in-app billing card. */
  billingSummary: string;
  /** Monthly order allowance. null = custom (Enterprise). Pilot = 20 trial total. */
  orderLimit: number | null;
  /** Supplier-flow allowance. null = custom (Enterprise). */
  supplierLimit: number | null;
  /** False for Pilot (its order limit is a one-time trial total, not monthly). */
  orderLimitIsMonthly: boolean;
  /** Short positioning blurb (pricing card description). */
  blurb: string;
  /** Longer recommendation blurb used by the ROI calculator. */
  recommendationBlurb: string;
  /** Feature bullets for the pricing card. */
  features: string[];
  cta: { label: string; href: string };
  /** Brand accent color (token hex). */
  color: string;
  /** Marketing "first production plan" highlight. */
  highlight: boolean;
  /** Self-serve Stripe Checkout available. */
  isCheckout: boolean;
  /** Custom / contact-sales plan (Enterprise). */
  isCustom: boolean;
  /** Next upgrade plan id for in-app upsell, or null. */
  next: PlanId | null;
  /**
   * When true, this plan is hidden from all public UI (pricing page, in-app
   * pickers, checkout buttons). The plan entry is kept in source so the
   * backend billing engine can still reference it; it is simply not purchasable
   * through the frontend for now.
   */
  hidden?: boolean;
}

const SIGN_UP = "/sign-up";
const SALES = "mailto:sales@proculink.eu";

// ─── Annual billing availability gate (offer⇔works) ──────────────────────────
// Annual billing is LIVE. The FE `createCheckoutSession(plan, "yearly")` sends
// `billingInterval: "yearly"` to `POST /api/billing/checkout`; the backend
// (`StripeBillingService.CreateCheckoutSessionAsync`) maps `(plan, "yearly")` to
// the plan's `Stripe:*YearlyPriceId`, and all four yearly price IDs
// (Growth/Operations/Integration/Distributor) are populated in Railway and active
// in Stripe live mode. So an annual Checkout resolves a real price — the toggle
// is safe to offer.
//
// The `priceYearly` amounts below are the actual live Stripe yearly list prices
// (Growth €1,488/yr · Operations €3,972/yr · Integration €9,948/yr ·
// Distributor €14,928/yr = the monthly price ×12 less ~17%). The advertised
// save-% is DERIVED from them (see yearlySavePercent), never hardcoded, so the
// copy self-corrects if a yearly amount is ever repriced.
//
// Enabled by default now that the end-to-end path is verified. Kept
// env-overridable so annual can be switched OFF without a code change (e.g. to
// pause it) via NEXT_PUBLIC_ANNUAL_BILLING_ENABLED=false; any other value (or
// unset) leaves annual ON.
export const ANNUAL_BILLING_ENABLED =
  process.env.NEXT_PUBLIC_ANNUAL_BILLING_ENABLED !== "false";


export const PLANS: Plan[] = [
  {
    id: "pilot",
    name: "Pilot",
    priceMonthly: 0,
    priceYearly: null,
    priceLabel: "Free",
    priceCadence: "14 days",
    billingPriceLabel: "Free trial",
    billingSummary: "Up to 20 orders · 1 supplier · 14 days",
    orderLimit: 20,
    supplierLimit: 1,
    orderLimitIsMonthly: false,
    blurb: "Test ProcuLink with real buyer orders and one supplier flow.",
    recommendationBlurb:
      "Free for 14 days. Process up to 20 orders across one supplier flow before you commit to a paid plan.",
    features: [
      "20 orders total",
      "1 supplier",
      "CSV/XLSX/PDF/XML upload",
      "Manual review",
      "Supplier-ready export",
    ],
    cta: { label: "Start Pilot", href: SIGN_UP },
    color: "#C97A14",
    highlight: false,
    isCheckout: false,
    isCustom: false,
    next: "growth",
  },
  {
    id: "growth",
    name: "Growth",
    priceMonthly: 149,
    priceYearly: 1488, // €1,488/yr — live Stripe GrowthYearlyPriceId (149×12 −17%)
    priceLabel: "€149",
    priceCadence: "per month",
    billingPriceLabel: "€149/mo",
    billingSummary: "Up to 150 orders / month · 5 suppliers · all channels",
    orderLimit: 150,
    supplierLimit: 5,
    orderLimitIsMonthly: true,
    blurb: "For teams ready to process recurring buyer orders.",
    recommendationBlurb:
      "Self-serve. Best for a single team replacing up to 150 monthly orders across 5 suppliers — with every delivery and ingestion channel included.",
    features: [
      "150 orders/month",
      "5 suppliers",
      "Webhook/API delivery",
      "Email · SFTP · S3 ingestion",
      // "Mapping library" named a surface that does not exist — WP-11 deleted the
      // BillingFeature of that name for exactly that reason ("no such surface exists anywhere
      // in the product"). What Growth actually gets is the field mapper and validation, so the
      // bullet now says that. The bulk import/export lever is the Operations differentiator and
      // stays there.
      "Field mapping + validation",
      "Audit log",
    ],
    cta: { label: "Upgrade to Growth", href: SIGN_UP },
    color: "#28C55E",
    highlight: true,
    isCheckout: true,
    isCustom: false,
    next: "operations",
  },
  {
    id: "operations",
    name: "Operations",
    priceMonthly: 399,
    priceYearly: 3972, // €3,972/yr — live Stripe OperationsYearlyPriceId (399×12 −17%)
    priceLabel: "€399",
    priceCadence: "per month",
    billingPriceLabel: "€399/mo",
    billingSummary: "Up to 500 orders / month · 10 suppliers · all channels",
    orderLimit: 500,
    supplierLimit: 10,
    orderLimitIsMonthly: true,
    blurb: "For order teams that need reliable daily processing.",
    recommendationBlurb:
      "Reliable daily processing for 150–500 monthly orders across up to 10 suppliers, with every channel included.",
    features: [
      "500 orders/month",
      "10 suppliers",
      "Webhook/API + email/SFTP/S3 channels",
      "Bulk mapping import/export",
      "cXML support",
      "Advanced audit trail + priority support",
    ],
    cta: { label: "Upgrade to Operations", href: SIGN_UP },
    color: "#2E8E3A",
    highlight: false,
    isCheckout: true,
    isCustom: false,
    next: "integration",
  },
  {
    id: "integration",
    name: "Integration",
    priceMonthly: 999,
    priceYearly: 9948, // €9,948/yr — live Stripe IntegrationYearlyPriceId (999×12 −17%)
    priceLabel: "€999",
    priceCadence: "per month",
    billingPriceLabel: "€999/mo",
    billingSummary: "Up to 1,500 orders / month · 20 suppliers · all channels",
    orderLimit: 1500,
    supplierLimit: 20,
    orderLimitIsMonthly: true,
    blurb: "For higher-volume teams scaling order processing across more suppliers.",
    recommendationBlurb:
      "Higher volume — up to 1,500 orders/month across 20 suppliers at about €0.67 per order, with every channel included.",
    // "Custom output templates" was removed: the saved-template subsystem it named was retired
    // (BE #75) and its plan flag deleted with it (BE #80), so nothing gated it at Integration —
    // the output designer and the per-order template override are available on every plan. Selling
    // an ungated capability as a €999 differentiator is the offer⇔works rule broken on the price
    // list itself. Integration's real differentiators are volume, suppliers and onboarding; the
    // card now says only that.
    features: [
      "1,500 orders/month",
      "20 suppliers",
      "All channels (webhook/API, email, SFTP, S3)",
      "Advanced audit trail",
      "Assisted onboarding",
    ],
    cta: { label: "Upgrade to Integration", href: SIGN_UP },
    color: "#6F4FCE",
    highlight: false,
    isCheckout: true,
    isCustom: false,
    // Integration → Distributor completes the in-app upsell chain so a growing
    // org can self-serve up to the Distributor ICP tier before Enterprise.
    next: "distributor",
  },
  {
    id: "distributor",
    name: "Distributor",
    priceMonthly: 1499,
    priceYearly: 14928, // €14,928/yr — live Stripe DistributorYearlyPriceId (1,499×12 −17%)
    priceLabel: "€1,499",
    priceCadence: "per month",
    billingPriceLabel: "€1,499/mo",
    billingSummary: "Up to 2,500 orders / month · 30 suppliers · all channels",
    orderLimit: 2500,
    supplierLimit: 30,
    orderLimitIsMonthly: true,
    blurb: "For distributors and resellers routing high order volume across many suppliers.",
    recommendationBlurb:
      "For distributors and resellers: up to 2,500 orders/month across 30 suppliers.",
    features: [
      "2,500 orders/month",
      "30 suppliers",
      "All channels (webhook/API, email, SFTP, S3)",
      "Bulk mapping import/export",
      "Priority onboarding",
      "Founder-led supplier setup",
    ],
    // Distributor is the ICP tier (Baltic IT distributors / resellers): shown on
    // /pricing AND self-serve. The Stripe Distributor product + monthly/yearly
    // prices exist (Stripe:DistributorPriceId is set in Railway and verified
    // active), and the backend checkout maps `distributor` -> that price, so it is
    // purchasable through self-serve Checkout like the other paid tiers. The
    // founder-led supplier onboarding fee (see SETUP_FEE_NOTE) is arranged
    // manually, separate from the self-serve subscription.
    cta: { label: "Upgrade to Distributor", href: SIGN_UP },
    color: "#0E7490",
    highlight: false,
    isCheckout: true,
    isCustom: false,
    next: null,
    hidden: false,
  },
  {
    id: "enterprise",
    name: "Enterprise",
    priceMonthly: null,
    priceYearly: null,
    priceLabel: "Custom",
    priceCadence: "from €2,500/mo",
    billingPriceLabel: "Custom",
    billingSummary: "Volume, SLA, and connector scope by agreement",
    orderLimit: null,
    supplierLimit: null,
    orderLimitIsMonthly: true,
    blurb: "For complex supplier networks, ERP integrations, and high-volume order flows.",
    recommendationBlurb:
      "Custom volume above 2,500 orders/month, named onboarding, DPA, and a tailored security review.",
    features: [
      "Custom volume",
      "Custom suppliers",
      "ERP connectors",
      // Enterprise SSO was claimed on /security and in CLAUDE.md §11.5 but missing from this
      // list — three surfaces, two answers. BillingFeature.Sso really is Enterprise-only, so the
      // card is the one that was wrong. Worth knowing WHY it is the one gate with no 403: Clerk
      // Enterprise Connections delivers the auth and ProcuLink never sits in front of it (a SAML
      // session's JWT is identical), so the flag drives availability and onboarding, not a refusal.
      "SSO (SAML/OIDC)",
      "Dedicated onboarding",
      "SLA",
      "Custom transformation rules",
    ],
    cta: { label: "Contact sales", href: SALES },
    color: "#0B1A2F",
    highlight: false,
    isCheckout: false,
    isCustom: true,
    next: null,
  },
];

/** Plans keyed by id for O(1) lookup. */
export const PLAN_BY_ID: Record<PlanId, Plan> = PLANS.reduce(
  (acc, plan) => {
    acc[plan.id] = plan;
    return acc;
  },
  {} as Record<PlanId, Plan>,
);

/** Plan ids that go through self-serve Stripe Checkout (excludes Pilot, Enterprise, and hidden plans). */
export const CHECKOUT_PLAN_IDS: PlanId[] = PLANS.filter((p) => p.isCheckout && !p.hidden).map((p) => p.id);

/**
 * Derived annual savings for a plan, in whole percent (e.g. 17), comparing the
 * yearly price to 12× the monthly price. null when the plan has no yearly
 * price. ALWAYS derive the advertised save-% from this — never hardcode it —
 * so the copy self-corrects when the intended yearly amounts are replaced with
 * the verified Stripe ones once annual goes live (see ANNUAL_BILLING_ENABLED).
 */
export function yearlySavePercent(plan: Plan): number | null {
  if (plan.priceYearly == null || plan.priceMonthly == null || plan.priceMonthly <= 0) return null;
  return Math.round((1 - plan.priceYearly / (plan.priceMonthly * 12)) * 100);
}

/** Monthly-equivalent of the annual price (yearly ÷ 12, rounded). null when no yearly price. */
export function yearlyMonthlyEquivalent(plan: Plan): number | null {
  if (plan.priceYearly == null) return null;
  return Math.round(plan.priceYearly / 12);
}

/**
 * Setup / onboarding fee note. Self-serve plans include light setup at no extra
 * charge; the per-supplier onboarding fee applies only to Enterprise / complex
 * integrations and is arranged manually (never auto-charged through Stripe).
 *
 * The waiver is stated as a STANDING OFFER, not an existing arrangement: there
 * are no design partners yet (2026-07-30 production census — one org has ever
 * held an order, and it is the founder's own), so "waived for early design
 * partners" implied customers we do not have. Pinned by
 * src/app/(marketing)/legalCommitments.test.tsx; keep the same sentence in the
 * ROI calculator fine print.
 */
export const SETUP_FEE_NOTE =
  "Growth, Operations, Integration, and Distributor include light, self-serve setup at no extra cost. " +
  "Hands-on, per-supplier onboarding (€500 per supplier for the first 3, then €150 each) applies only to " +
  "Enterprise and other complex setups — arranged manually, never auto-charged, and we will waive it for " +
  "the first design partners we take on.";

/**
 * Per-order overage fee (EUR) on every order a paid self-serve plan processes
 * above its monthly allowance. MUST match backend
 * `PlanConstants.OveragePerOrderEur`. Going over the allowance never blocks —
 * it is a soft cap, metered at €0.50/order via a Stripe invoice item.
 */
export const OVERAGE_PER_ORDER_EUR = 0.5;

/** Enterprise "from" price floor (EUR/month) — used only as a recommendation
 *  threshold; Enterprise itself is custom / contact-sales. */
const ENTERPRISE_FLOOR_EUR = 2500;

export interface EffectiveCost {
  /** Flat list price + overage, EUR/month. */
  total: number;
  /** Orders above the plan's monthly allowance at the given volume. */
  overageOrders: number;
  /** Overage cost in EUR (overageOrders × €0.50). */
  overageEur: number;
}

/**
 * Effective monthly cost of a paid self-serve plan at a given order volume:
 * flat price + max(0, orders − allowance) × €0.50. Returns null for plans
 * without a fixed list price or monthly allowance (Pilot, Enterprise).
 */
export function planEffectiveMonthlyCost(plan: Plan, ordersPerMonth: number): EffectiveCost | null {
  if (plan.priceMonthly == null || plan.priceMonthly <= 0 || plan.orderLimit == null || !plan.orderLimitIsMonthly) {
    return null;
  }
  const overageOrders = Math.max(0, ordersPerMonth - plan.orderLimit);
  const overageEur = overageOrders * OVERAGE_PER_ORDER_EUR;
  return { total: plan.priceMonthly + overageEur, overageOrders, overageEur };
}

/**
 * COST-OPTIMAL plan recommendation (mirrors the backend best-price overage
 * logic in `PlanConstants.BestPriceOverageOrders`): walk the self-serve ladder
 * smallest → largest and upgrade whenever the current tier's effective monthly
 * cost (flat + €0.50 × overage) reaches the next tier's flat price — at that
 * point you are already paying next-tier money, so you should be ON that tier
 * (more included volume for the same or less). The backend guarantees a
 * customer is never charged more than the cheapest tier covering their usage,
 * so this recommendation never costs more than the old volume-fit one.
 *
 * Crossovers: 200 → Growth (€149 + 50×€0.50 = €174, NOT Operations €399);
 * 650 → Operations (Growth effective hits €399); 1,700 → Integration;
 * 2,500 → Distributor; Enterprise only once even Distributor's effective cost
 * reaches the €2,500/mo Enterprise floor.
 */
export function recommendPlanByOrders(ordersPerMonth: number): Plan {
  const ladder: PlanId[] = ["growth", "operations", "integration", "distributor"];
  let current = PLAN_BY_ID[ladder[0]];
  for (let i = 1; i < ladder.length; i++) {
    const next = PLAN_BY_ID[ladder[i]];
    const cost = planEffectiveMonthlyCost(current, ordersPerMonth);
    if (cost != null && next.priceMonthly != null && cost.total >= next.priceMonthly) {
      current = next;
    }
  }
  const cost = planEffectiveMonthlyCost(current, ordersPerMonth);
  if (current.id === "distributor" && cost != null && cost.total >= ENTERPRISE_FLOOR_EUR) {
    return PLAN_BY_ID.enterprise;
  }
  return current;
}
