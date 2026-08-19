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
  /**
   * The DIFFERENTIATING feature bullets for the pricing card — what this tier adds on top of
   * `inheritsFrom`, not a restatement of the whole ladder. Read `effectiveFeatures(plan)` when
   * you need everything a tier includes.
   */
  features: string[];
  /**
   * The tier immediately below this one, whose capabilities this tier also includes — rendered
   * as "Everything in {name}, plus". null only for Pilot, the bottom of the ladder.
   *
   * ── Why this exists ──────────────────────────────────────────────────────────
   *
   * Gates are MINIMUM-plan, so Integration and Distributor both include `Cxml`, `BulkMapping`
   * and `AdvancedAudit`. Their cards listed none of them: Integration named neither cXML nor
   * bulk mapping, Distributor named neither cXML nor advanced audit. A buyer reading the page
   * left to right saw the €1,499 tier apparently LOSE capabilities the €399 tier has. The
   * bullets were not false — they were incomplete, which on a comparison table is the same
   * thing.
   *
   * Restating every inherited bullet on every card was the obvious repair and is the one the
   * founder's design position rules out (`docs/design-system/pricing-security-rebalance.md`
   * §1: "Stop selling by bullet count… 'Everything in {previous}, plus' + max 3 differentiating
   * bullets", on a fixed comparison axis of orders/month and suppliers). So the ladder is
   * declared once, here, and monotonicity is a property of the structure rather than of six
   * hand-maintained lists that have to agree. `gatedCapabilityClaims.test.ts` asserts the chain
   * is unbroken and that no tier's effective capability set is smaller than the tier below it.
   */
  inheritsFrom: PlanId | null;
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
    inheritsFrom: null,
    cta: { label: "Start Pilot", href: SIGN_UP },
    // #8A5310, not the stale #C97A14 (which is not a token in globals.css and
    // measured 3.1094:1 as label text on its own tint). 5.7164:1.
    color: "#8A5310",
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
      // in the product"). The bulk import/export lever is the Operations differentiator and
      // stays there.
      //
      // The repair for that then read "Field mapping + validation", and its second half was
      // false at a €2,350/month distance. ProcuLink has TWO validation products and only one of
      // them is on this tier:
      //
      //   • BUILT-IN checks — InvariantValidator plus OutputFieldValidator (required fields,
      //     zero/negative unit price, zero/negative quantity, format-mandatory buyer item code,
      //     delimiter contamination). Ungated on every plan, Pilot included: every transform
      //     calls OutputFieldValidator.ValidateEntity before writing a byte
      //     (CsvTransformService.cs:46, CxmlTransformService.cs:112, JsonTransformService.cs:38,
      //     UblOrderTransformService.cs:103, X12TransformService.cs:108, XmlTransformService.cs:45),
      //     and SupplierAcceptanceService.cs:202-204 runs the invariant and output-field passes
      //     alongside the profile pass — EvaluateProfile returns empty when there is no profile
      //     (:389), so these two still produce results with no profile at all.
      //   • PER-SUPPLIER ACCEPTANCE RULES — the versioned acceptance profile on the supplier's
      //     Validation rules tab. Gated on BillingFeature.CustomSupplierRules, whose minimum is
      //     Enterprise (PlanConstants.cs:287), refused on BOTH authoring and activating
      //     (SupplierAcceptanceController.cs:37-46, :70, :99). The Enterprise card sells it as
      //     "Custom transformation rules"; only reading existing versions is left open, so a
      //     downgraded org can still see what its suppliers enforce.
      //
      // "validation" on a €149 card points a reader straight at the tab named "Validation
      // rules", which is the Enterprise one. The bullet now names the half Growth really has.
      // Deleting it outright was the wrong repair in the other direction — the built-in checks
      // are real, they run on every order, and under-claiming them is its own false statement.
      "Field mapping + built-in order checks",
      // "Audit log" was imprecise in the one direction that costs a customer money. ProcuLink has
      // TWO audit surfaces and only one of them is on this tier:
      //
      //   • per-order trail — GET /api/orders/{id}/audit (OrdersController.cs:2029). No gate at
      //     all; pinned deliberately as the IL scanner's negative control
      //     (BillingGateEnforcementIsRealTests.cs:143-155). Every plan has it, Pilot included.
      //   • org-wide delivery log — GET /api/audit (AuditController.cs:49), gated on
      //     BillingFeature.AdvancedAudit, whose minimum is Operations (PlanConstants.cs:276).
      //
      // A live Growth org read this bullet, opened /operations/log on 2026-08-06 and was told
      // "The full delivery log is not included in your plan" (CrossingsLog.tsx:606). The bullet
      // now names the surface Growth actually gets; Operations keeps "Advanced audit trail".
      "Per-order audit trail",
    ],
    inheritsFrom: "pilot",
    cta: { label: "Upgrade to Growth", href: SIGN_UP },
    // #1E6D29, not the retired emerald. `color` is rendered as BUTTON LABEL text
    // over a 7%-alpha tint of itself (BillingSection.secondaryButton), where the
    // emerald measured 2.1443:1 against a 4.5:1 floor at 12px/700.
    color: "#1E6D29",
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
    // "Webhook/API + email/SFTP/S3 channels" is gone because `inheritsFrom: "growth"` already
    // says it — the channels gate at Growth and restating them here is what forced every card
    // above to restate them too, and then to be judged on how many bullets it had.
    //
    // "+ priority support" is gone because nothing delivers it. It is not a BillingFeature, and
    // BillingFeature.cs:20-21 records that `SlaOnboarding` was deleted for precisely this reason
    // — an SLA and named support are commitments fulfilled by people, and no code path can check
    // them. The published commitment is undifferentiated in any case: /support offers every plan,
    // Pilot included, the same "within one business day". Selling a €399 tier on a promise the
    // free tier already has is the offer⇔works rule broken on the price list itself.
    features: [
      "500 orders/month",
      "10 suppliers",
      "Bulk mapping import/export",
      "cXML support",
      "Advanced audit trail",
    ],
    inheritsFrom: "growth",
    cta: { label: "Upgrade to Operations", href: SIGN_UP },
    // #1E6D29, not --brand-green: this renders as BUTTON LABEL text over a
    // 7%-alpha tint of itself, where #2E8E3A measured 3.8204:1. 5.7988:1.
    color: "#1E6D29",
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
    //
    // The channels bullet and "Advanced audit trail" are now carried by
    // `inheritsFrom: "operations"`. Listing them again was not what made this card honest — what
    // made it DIShonest was listing those two and silently dropping cXML and bulk mapping, which
    // Integration also includes (gates are minimum-plan). A buyer comparing €399 to €999 saw the
    // dearer tier lose two capabilities. Integration's real differentiators are volume,
    // suppliers, and onboarding; the two numbers sit on the fixed axis every card shares.
    features: [
      "1,500 orders/month",
      "20 suppliers",
      "Assisted onboarding",
    ],
    inheritsFrom: "operations",
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
    // Channels and bulk mapping come from `inheritsFrom: "integration"`. This card used to list
    // those two and omit cXML and advanced audit — both of which Distributor includes — so the
    // €1,499 tier read as thinner than the €399 one.
    features: [
      "2,500 orders/month",
      "30 suppliers",
      "Priority onboarding",
      "Founder-led supplier setup",
    ],
    inheritsFrom: "integration",
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
      // SSO is deliberately NOT sold here, and the earlier note on this line had it backwards:
      // it reasoned that because `BillingFeature.Sso` is Enterprise-only, the card was the
      // surface that was wrong. The tier was never the problem. The problem is that nothing is
      // gated and nothing is built.
      //
      // `Sso` is the one BillingFeature that refuses nothing. Its only production reference is
      // `PlanConstants.PlanHasFeature` (StripeBillingService.cs:191), surfaced as
      // `BillingStatus.SsoAvailable`. Its exemption from the IL-scanning gate test is granted
      // on the grounds that "the flag drives the Settings availability/upsell only"
      // (BillingGateEnforcementIsRealTests.cs:100-103) — and that Settings surface does not
      // exist. `ssoAvailable` has zero consumers in this codebase: no type field, no mock, no
      // component. A customer who pays for this bullet has nowhere to configure it.
      //
      // Reversal is mechanical, not a matter of remembering this comment. `gatedCapabilityClaims`
      // fails while a card sells SSO and no Settings SSO surface exists, and fails the other way
      // once that surface ships and nothing sells it — so the guard asks for this bullet back on
      // the day it becomes true.
      "Dedicated onboarding",
      "SLA",
      "Custom transformation rules",
    ],
    inheritsFrom: "distributor",
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

/**
 * Every plan id the ladder declares, longest-first.
 *
 * The ordering matters to `src/lib/planGate.ts`, which builds a regex alternation out of it:
 * a shorter id that prefixes a longer one would shadow it. Nothing in the current ladder does,
 * but the sort makes that a property of the code rather than of today's six names.
 */
export const PLAN_IDS: PlanId[] = PLANS.map((p) => p.id).sort((a, b) => b.length - a.length);

/**
 * A plan's name as a user reads it — `"Distributor plan"`.
 *
 * ── Why this is derived and not a map ────────────────────────────────────────
 *
 * Settings kept its own `PLAN_LABELS` object listing five of the six tiers. Distributor was
 * missing, so a Distributor org — a live, self-serve tier with live Stripe prices — read
 * `Acme · distributor` in its own Settings header: a raw lowercase wire value shown to a
 * customer paying €1,499/month. The topbar and the sidebar each rolled their own instead,
 * capitalising the FIRST LETTER OF THE WIRE VALUE, which happens to agree with the ladder
 * today and is not derived from it at all.
 *
 * Three producers, three chances to miss the next tier. There is now one, here, next to the
 * data it names, so adding a plan to `PLANS` is the whole change. `src/test/plans.test.ts`
 * pins that every tier resolves to a name and that none of them renders as its own id.
 *
 * Unknown ids are returned unchanged. That path is unreachable through `BillingPlan`, and is
 * only live if the backend ships a tier this ladder has not got yet — in which case the raw
 * value is the honest thing to show, because inventing a display name for a plan we know
 * nothing about is the larger lie.
 */
export function planDisplayName(plan: string): string {
  const known = PLAN_BY_ID[plan as PlanId] as Plan | undefined;
  return known ? `${known.name} plan` : plan;
}

/** Just the tier's own name — `"Distributor"` — for prose that supplies its own noun. */
export function planName(plan: string): string {
  const known = PLAN_BY_ID[plan as PlanId] as Plan | undefined;
  return known ? known.name : plan;
}

/**
 * The line a card shows above its own bullets — `"Everything in Operations, plus"` — or null
 * for Pilot, which inherits nothing.
 *
 * Derived from `inheritsFrom` rather than typed per card, so a card can never advertise an
 * inheritance the data does not declare (or, worse, quietly stop advertising one it does).
 */
export function inheritanceLine(plan: Plan): string | null {
  if (plan.inheritsFrom == null) return null;
  return `Everything in ${PLAN_BY_ID[plan.inheritsFrom].name}, plus`;
}

/**
 * Everything a tier includes: its own bullets plus, transitively, every bullet of the tiers
 * below it. This is what the CARD COMMUNICATES, and therefore the set any honesty check about
 * a tier's capabilities has to reason over — `plan.features` alone is only the delta.
 *
 * Ordered cheapest-tier-first so the result reads like the ladder. Throws on a cycle rather
 * than looping: `inheritsFrom` is hand-written and a typo that pointed a tier at itself would
 * otherwise hang the pricing page's static render.
 */
export function effectiveFeatures(plan: Plan): string[] {
  const seen = new Set<PlanId>();
  const chain: Plan[] = [];
  let current: Plan | undefined = plan;
  while (current) {
    if (seen.has(current.id)) {
      throw new Error(`plans: inheritsFrom cycle at '${current.id}' — the ladder must terminate at Pilot`);
    }
    seen.add(current.id);
    chain.unshift(current);
    current = current.inheritsFrom == null ? undefined : PLAN_BY_ID[current.inheritsFrom];
  }
  return chain.flatMap((p) => p.features);
}

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
 * The price to print on the IN-APP billing card, for the interval the workspace's
 * subscription is actually on.
 *
 * `billingPriceLabel` is the MONTHLY price and nothing else. The billing card used it
 * unconditionally, so an annual workspace was shown "€149/mo" with "Billed annually"
 * printed directly beneath — and ×12 comes to €1,788 against a real charge of €1,488.
 * It overstated the bill by exactly the annual discount the customer had just taken, on
 * all four self-serve tiers.
 *
 * Annual returns the YEARLY total rather than a monthly-equivalent
 * (see `yearlyMonthlyEquivalent`, which the /pricing comparison still wants) because
 * this card's job is to be reconcilable against the Stripe invoice, and the invoice is
 * one annual charge. Grouping is pinned to en-US so the rendered string does not depend
 * on the reader's machine locale — "€1,488" is the same shape `priceLabel` already uses.
 *
 * Falls back to the monthly label whenever there is no yearly price to name: Pilot
 * ("Free trial") and Enterprise ("Custom") have `priceYearly: null` by design.
 */
export function billingPriceLabelFor(
  plan: Plan,
  billingInterval: "monthly" | "yearly" | null | undefined,
): string {
  if (billingInterval !== "yearly" || plan.priceYearly == null) return plan.billingPriceLabel;
  return `€${plan.priceYearly.toLocaleString("en-US")}/yr`;
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
