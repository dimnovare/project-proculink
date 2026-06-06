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

export const PLANS: Plan[] = [
  {
    id: "pilot",
    name: "Pilot",
    priceMonthly: 0,
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
      "Mapping library + validation",
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
    priceLabel: "€999",
    priceCadence: "per month",
    billingPriceLabel: "€999/mo",
    billingSummary: "Up to 1,500 orders / month · 20 suppliers · all channels",
    orderLimit: 1500,
    supplierLimit: 20,
    orderLimitIsMonthly: true,
    blurb: "For higher-volume teams scaling order processing across more suppliers.",
    recommendationBlurb:
      "Higher volume — up to 1,500 orders/month across 20 suppliers at about €0.67 per order, with every channel and custom output templates.",
    features: [
      "1,500 orders/month",
      "20 suppliers",
      "All channels (webhook/API, email, SFTP, S3)",
      "Custom output templates",
      "Advanced audit trail",
      "Assisted onboarding",
    ],
    cta: { label: "Upgrade to Integration", href: SIGN_UP },
    color: "#6F4FCE",
    highlight: false,
    isCheckout: true,
    isCustom: false,
    next: null,
  },
  {
    id: "distributor",
    name: "Distributor",
    priceMonthly: 1499,
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
 * Setup / onboarding fee note. Self-serve plans include light setup at no extra
 * charge; the per-supplier onboarding fee applies only to Enterprise / complex
 * integrations and is arranged manually (never auto-charged through Stripe).
 */
export const SETUP_FEE_NOTE =
  "Growth, Operations, Integration, and Distributor include light, self-serve setup at no extra cost. " +
  "Hands-on, per-supplier onboarding (€500 per supplier for the first 3, then €150 each) applies only to " +
  "Enterprise and other complex setups — arranged manually, never auto-charged, and waived for early design partners.";

/**
 * Recommend the smallest plan whose monthly order allowance covers `ordersPerMonth`.
 * Used by the ROI calculator. Falls back to Enterprise above the Distributor ceiling.
 */
export function recommendPlanByOrders(ordersPerMonth: number): Plan {
  const ladder: PlanId[] = ["growth", "operations", "integration", "distributor"];
  for (const id of ladder) {
    const plan = PLAN_BY_ID[id];
    if (plan.orderLimit != null && ordersPerMonth <= plan.orderLimit) return plan;
  }
  return PLAN_BY_ID.enterprise;
}
