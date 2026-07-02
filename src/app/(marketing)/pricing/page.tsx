"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  ANNUAL_BILLING_ENABLED,
  OVERAGE_PER_ORDER_EUR,
  PLANS,
  PLAN_BY_ID,
  SETUP_FEE_NOTE,
  planEffectiveMonthlyCost,
  recommendPlanByOrders,
  yearlyMonthlyEquivalent,
  yearlySavePercent,
} from "@/lib/plans";

// ─────────────────────────────────────────────────────────────────────────────
// Pricing page — pixel-exact port of the Claude Design source (app/Pricing.html).
//
// The design realises every surface through the locked "design system" classes
// (.hero / .section / .pricing-grid / .price-card / .billing-toggle / .faq-item /
// .btn). Those marketing-scoped classes are NOT present in this app's globals.css
// (which we must not edit), so the same visual contract is reproduced here with
// inline styles driven by the design CSS variables — every colour resolves to a
// token (var(--brand-blue) #1E66C9 buyer/primary, var(--brand-green) #2E8E3A
// supplier, navy chrome, ink/border surfaces). No raw hexes are invented and the
// old #28C55E green is never used.
//
// Differences from the static design that are intentional and required:
//   • Real plan ladder + prices come from src/lib/plans.ts (6 tiers), not the
//     demo tiers baked into the HTML — so pricing can never drift from billing.
//   • Plain product copy only (no "bridge"/"dock"/"crossing" vocabulary).
//   • The Operations tier is the featured ("Most popular") anchor card: buyer-blue
//     border + soft blue glow + centred blue→green gradient badge + blue CTA,
//     exactly matching the design's .price-card.featured + .price-badge.
//
// CHOICE-OVERLOAD REDUCTION (UX#1):
//   The 6-tier ladder is no longer shown as one flat 6-card wall. Instead the page
//   leads with the ROI/volume recommender (reusing recommendPlanByOrders — the
//   same helper the landing-page ROICalculator uses) and shows FOUR primary
//   decisions above the fold:
//     1. Pilot       (free trial)
//     2. Growth      (the €149 first paid step — hiding it made the cheapest
//                     paid entry invisible at 1080p without a click)
//     3. Operations  (the €399 ICP anchor, "Most popular")
//     4. Enterprise  (contact sales)
//   The remaining tiers (Integration, Distributor) live behind a
//   "See all tiers / compare plans" disclosure so every tier — and every
//   CHECKOUT_PLAN_ID — stays reachable, while only four cards compete for
//   attention by default.
// ─────────────────────────────────────────────────────────────────────────────

const FEATURED_ID = "operations";

// Above-the-fold primary decisions, in display order. Everything else
// (Integration, Distributor) is reachable behind the "See all tiers" disclosure.
const PRIMARY_IDS = ["pilot", "growth", "operations", "enterprise"] as const;

// Small contextual line under each price (design's "+ one-time setup" /
// "No card required" / "Annual contract" sub-line). Kept consistent with
// SETUP_FEE_NOTE — self-serve plans include light setup at no extra cost; the
// per-supplier onboarding fee applies only to Enterprise / complex setups.
const SETUP_NOTE: Record<string, string> = {
  pilot: "No card required",
  growth: "Setup included",
  operations: "Setup included",
  integration: "Setup included",
  distributor: "Setup included",
  enterprise: "Custom onboarding",
};

const ALL_TIERS = PLANS.filter((p) => !p.hidden).map((p) => ({
  id: p.id,
  name: p.name,
  price: p.priceLabel,
  sub: p.priceCadence,
  setupNote: SETUP_NOTE[p.id] ?? "",
  desc: p.blurb,
  features: p.features,
  cta: p.cta.label,
  href: p.cta.href,
  /** Plans whose price is a real recurring monthly amount get a "/mo" tag. */
  isMonthly: p.orderLimitIsMonthly && p.priceMonthly != null && p.priceMonthly > 0,
  priceMonthly: p.priceMonthly,
  /** Live Stripe annual price billed once per year. Shown when annual billing
   *  is enabled (ANNUAL_BILLING_ENABLED) — see plans.ts. */
  priceYearly: p.priceYearly,
  yearlyMonthlyEq: yearlyMonthlyEquivalent(p),
  savePercent: yearlySavePercent(p),
  orderLimit: p.orderLimit,
  featured: p.id === FEATURED_ID,
}));

// Uniform advertised annual discount, DERIVED from the plan ladder (all paid
// tiers currently share the same ~17% annual discount; if a per-tier Stripe
// yearly price ever diverges, the per-card save-% still renders its own).
const TOGGLE_SAVE_PERCENT = yearlySavePercent(PLAN_BY_ID.growth);

type Tier = (typeof ALL_TIERS)[number];

const TIER_BY_ID: Record<string, Tier> = ALL_TIERS.reduce(
  (acc, t) => {
    acc[t.id] = t;
    return acc;
  },
  {} as Record<string, Tier>,
);

const PRIMARY_TIERS = PRIMARY_IDS.map((id) => TIER_BY_ID[id]).filter(Boolean);
const SECONDARY_TIERS = ALL_TIERS.filter(
  (t) => !PRIMARY_IDS.includes(t.id as (typeof PRIMARY_IDS)[number]),
);

const FAQ: Array<[string, string]> = [
  [
    "What counts as an order?",
    "One buyer purchase order that enters processing in ProcuLink. Each order counts once, at intake; retries and re-deliveries of the same order don't count again, and sample orders never count toward your allowance.",
  ],
  [
    "What happens after the Pilot?",
    "Nothing breaks. Your suppliers and mappings stay configured; you simply pick a plan when you're ready to keep processing orders past the 20-order trial.",
  ],
  [
    "Do you charge for failed orders?",
    "An order counts when it enters processing, whether or not delivery later fails. Retries and re-deliveries of the same order are free, and sample orders are always free.",
  ],
  [
    "What if I go over my monthly orders?",
    "Nothing blocks. Orders above your plan's monthly allowance are billed automatically at €0.50 per order at the end of the billing period — and the overage is capped so you never pay more than the price of the next plan that covers your volume.",
  ],
  [
    "Can I change plans later?",
    "Yes — up or down, any time. We prorate the difference and your saved mappings and rules carry over untouched.",
  ],
  [
    "Where is my data stored?",
    "All order data is stored and processed in the EU and encrypted with AES-GCM at rest. See the Security page for the full posture.",
  ],
];

export default function PricingPage() {
  // Monthly/Annual toggle — annual billing is LIVE (offer⇔works). Selecting a
  // yearly plan calls createCheckoutSession(plan, "yearly"), which the backend
  // maps to the plan's live Stripe `*YearlyPriceId`, so the Checkout resolves a
  // real price. ANNUAL_BILLING_ENABLED stays as an env-overridable kill switch
  // (set NEXT_PUBLIC_ANNUAL_BILLING_ENABLED=false to hide the toggle) but
  // defaults ON — see plans.ts.
  const [billing, setBilling] = useState<"monthly" | "yearly">("monthly");
  // Only treat the selection as yearly when annual is enabled (kill-switch safe).
  const yearly = ANNUAL_BILLING_ENABLED && billing === "yearly";

  // Volume recommender — reuses the SAME helper the landing-page ROICalculator
  // uses (recommendPlanByOrders), so the pricing page and ROI calculator can
  // never recommend different tiers for the same volume. The recommendation is
  // COST-OPTIMAL: flat price + €0.50/order overage, cheapest effective cost.
  const [orders, setOrders] = useState(200);
  const recommended = useMemo(() => recommendPlanByOrders(orders), [orders]);
  const recommendedId = recommended.id;
  const recommendedCost = useMemo(
    () => planEffectiveMonthlyCost(recommended, orders),
    [recommended, orders],
  );

  // If the recommended tier lives behind the disclosure, surface it by default
  // so the recommendation is always actionable without a second click.
  const recommendedIsSecondary = SECONDARY_TIERS.some((t) => t.id === recommendedId);
  const [showAll, setShowAll] = useState(false);
  const tiersExpanded = showAll || recommendedIsSecondary;

  return (
    <div style={{ background: "var(--surface)", color: "var(--ink)" }}>
      <style>{PRICING_CSS}</style>

      {/* ── Hero (navy chrome, blue + green radials — mirrors .hero) ──────── */}
      <header className="plk-hero">
        <div className="plk-hero-inner">
          <span className="plk-eyebrow">
            <span className="plk-eyebrow-dot" />
            Pricing
          </span>

          <h1 className="plk-h1">Pay for orders processed, nothing else</h1>

          <p className="plk-sub">
            Tell us your order volume and we&apos;ll point you at the right plan. Self-serve plans
            include light setup at no extra cost. No per-seat pricing, no integration project.
          </p>

          {/* Volume recommender — leads with the ROI helper's recommendation */}
          <div className="plk-reco">
            <label className="plk-reco-label" htmlFor="plk-orders">
              How many purchase orders do you send per month?
            </label>
            <div className="plk-reco-input-row">
              <input
                id="plk-orders"
                className="plk-reco-input"
                type="range"
                min={10}
                max={5000}
                step={10}
                value={orders}
                onChange={(e) => setOrders(Number(e.target.value))}
                aria-label="Purchase orders per month"
                aria-describedby="plk-reco-readout"
              />
              <span className="plk-reco-count" id="plk-reco-readout" aria-live="polite">
                {orders.toLocaleString()}
                <small> POs/mo</small>
              </span>
            </div>
            <div className="plk-reco-out" role="status">
              <span className="plk-reco-out-label">Recommended plan</span>
              <strong className="plk-reco-out-plan">{recommended.name}</strong>
              <span className="plk-reco-out-price">
                {recommended.isCustom
                  ? "Custom"
                  : recommended.priceMonthly === 0
                    ? "Free"
                    : recommendedCost && recommendedCost.overageOrders > 0
                      ? `≈ €${Math.round(recommendedCost.total).toLocaleString("en-IE")}/mo (${recommended.priceLabel} + €${Math.round(recommendedCost.overageEur).toLocaleString("en-IE")} overage)`
                      : `${recommended.priceLabel}/mo`}
              </span>
              <Link
                href={recommended.isCustom ? recommended.cta.href : "/sign-up"}
                className="plk-btn plk-btn-blue plk-reco-cta"
              >
                {recommended.isCustom ? "Contact sales" : `Start with ${recommended.name}`}{" "}
                <span aria-hidden>→</span>
              </Link>
            </div>
          </div>

        </div>
      </header>

      {/* ── Primary pricing cards (3 above the fold) ─────────────────────── */}
      <section className="plk-section" style={{ paddingTop: 48 }}>
        <div className="plk-wrap">
          {/* Billing cadence toggle — the design's .billing-toggle pill.
              Rendered when annual billing is enabled (ANNUAL_BILLING_ENABLED,
              default ON). Annual routes to the plan's live Stripe yearly price,
              so the toggle never offers a Checkout that can't resolve. The flag
              stays as an env kill switch to hide the toggle if annual is paused. */}
          {ANNUAL_BILLING_ENABLED && (
            <div className="plk-toggle-wrap">
              <div className="plk-billing-toggle" role="group" aria-label="Billing period">
                <button
                  type="button"
                  className={!yearly ? "on" : ""}
                  aria-pressed={!yearly}
                  onClick={() => setBilling("monthly")}
                >
                  Monthly
                </button>
                <button
                  type="button"
                  className={yearly ? "on" : ""}
                  aria-pressed={yearly}
                  onClick={() => setBilling("yearly")}
                >
                  Annual{TOGGLE_SAVE_PERCENT != null ? ` · save ${TOGGLE_SAVE_PERCENT}%` : ""}
                </button>
              </div>
            </div>
          )}

          <div className="plk-pricing-grid plk-primary-grid">
            {PRIMARY_TIERS.map((tier) => (
              <PriceCard key={tier.id} tier={tier} yearly={yearly} recommended={tier.id === recommendedId} />
            ))}
          </div>

          {/* ── See all tiers / compare plans disclosure ──────────────────── */}
          <div className="plk-disclosure">
            <button
              type="button"
              className="plk-disclosure-btn"
              aria-expanded={tiersExpanded}
              aria-controls="plk-all-tiers"
              onClick={() => setShowAll((v) => !v)}
              disabled={recommendedIsSecondary}
            >
              {tiersExpanded ? "Hide other tiers" : "See all tiers · compare plans"}
              {!recommendedIsSecondary && (
                <svg
                  aria-hidden
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  style={{
                    transform: tiersExpanded ? "rotate(180deg)" : "none",
                    transition: "transform 250ms var(--ease-out)",
                  }}
                >
                  <path
                    d="M6 9l6 6 6-6"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </button>
            {recommendedIsSecondary && (
              <span className="plk-disclosure-hint">
                Showing {recommended.name} below because it fits your volume.
              </span>
            )}
          </div>

          {/* Secondary tiers stay in the DOM (SSR-crawlable + valid aria-controls
              target) and collapse via [hidden] when not expanded, so search
              engines and no-JS visitors still see Integration/Distributor
              while only four cards compete for attention by default. */}
          <div
            id="plk-all-tiers"
            className="plk-pricing-grid plk-secondary-grid"
            hidden={!tiersExpanded}
          >
            {SECONDARY_TIERS.map((tier) => (
              <PriceCard key={tier.id} tier={tier} yearly={yearly} recommended={tier.id === recommendedId} />
            ))}
          </div>

          <p className="plk-fine">{SETUP_FEE_NOTE}</p>
          <p className="plk-fine" style={{ marginTop: 10 }}>
            All plans include EU data residency, AES-GCM encryption, and a full audit trail per
            order.
          </p>
        </div>
      </section>

      {/* ── FAQ (mirrors .section.tint + .faq-item) ─────────────────────── */}
      <section className="plk-section tint">
        <div className="plk-wrap narrow">
          <div className="plk-section-head">
            <span className="plk-section-eyebrow">FAQ</span>
            <h2 className="plk-section-title">Questions, answered</h2>
          </div>
          <div>
            {FAQ.map(([q, a]) => (
              <FaqItem key={q} q={q} a={a} />
            ))}
          </div>
        </div>
      </section>

      {/* ── Closing CTA band (mirrors .section.navy) ────────────────────── */}
      <section className="plk-section navy" style={{ textAlign: "center" }}>
        <div className="plk-wrap narrow">
          <h2 className="plk-section-title" style={{ color: "#fff" }}>
            Not sure which plan fits?
          </h2>
          <p className="plk-section-sub">
            Use the ROI calculator on the home page, or start the free Pilot and decide later.
          </p>
          <div className="plk-cta-row">
            <Link href="/sign-up" className="plk-btn plk-btn-blue lg">
              Start free Pilot <span aria-hidden>→</span>
            </Link>
            <Link href="/#roi" className="plk-btn plk-btn-outline lg">
              Open ROI calculator
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

// ─── Small components ─────────────────────────────────────────────────────────

function PriceCard({ tier, yearly, recommended }: { tier: Tier; yearly: boolean; recommended: boolean }) {
  const featured = tier.featured;

  // Annual display: the plan's live Stripe yearly price (plans.ts single
  // source), shown as a monthly equivalent with the billed-annually total +
  // derived save-% underneath. Tiers without an annual price (Pilot, Enterprise)
  // render their normal monthly/custom card.
  const showYearly = yearly && tier.isMonthly && tier.priceYearly != null && tier.yearlyMonthlyEq != null;
  const bigPrice = showYearly ? `€${tier.yearlyMonthlyEq!.toLocaleString("en-IE")}` : tier.price;
  const priceTag = tier.isMonthly;

  // A card is visually emphasised when it is the static anchor (featured =
  // Operations) OR when the volume recommender currently points at it.
  const emphasised = featured || recommended;
  const cardClass = emphasised ? "plk-price-card featured" : "plk-price-card";

  // Badge text: the recommender wins over the static "Most popular" label so the
  // user's own volume answer is always reflected on the card it points at.
  const badge = recommended ? "Recommended for you" : featured ? "Most popular" : null;

  return (
    <article className={cardClass}>
      {badge && <span className="plk-price-badge">{badge}</span>}

      <div className="plk-tier">{tier.name}</div>
      <div className="plk-tier-sub">{tier.desc}</div>

      <div className="plk-price">
        {bigPrice}
        {priceTag && <small>/mo</small>}
      </div>
      <div className="plk-price-note">
        {showYearly
          ? `billed annually (€${tier.priceYearly!.toLocaleString("en-IE")}/yr)${tier.savePercent != null ? ` · save ${tier.savePercent}%` : ""}`
          : tier.setupNote}
      </div>
      {/* Overage visibility (offer⇔works): paid plans never block at the
          allowance — extra orders meter at €0.50/order. */}
      {tier.isMonthly && tier.orderLimit != null && (
        <div className="plk-overage-note">
          {tier.orderLimit.toLocaleString("en-IE")} orders/mo included · then €
          {OVERAGE_PER_ORDER_EUR.toFixed(2)}/order, never blocked
        </div>
      )}

      <Link
        href={tier.href}
        className={emphasised ? "plk-btn plk-btn-blue" : "plk-btn plk-btn-secondary"}
      >
        {tier.cta} <span aria-hidden>→</span>
      </Link>

      <ul className="plk-feats">
        {tier.features.map((feature) => (
          <li key={feature}>
            <CheckIcon />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}

function CheckIcon() {
  // Flat brand-green check glyph — matches the design's lightweight feature
  // checks (Icon name="check" color var(--brand-green)).
  return (
    <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" fill="none" className="plk-check">
      <path
        d="M3 8.5l3 3 7-7"
        stroke="var(--brand-green)"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="plk-faq-item">
      <button type="button" className="plk-faq-q" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {q}
        <svg
          aria-hidden
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          style={{
            flexShrink: 0,
            transform: open ? "rotate(180deg)" : "none",
            transition: "transform 250ms var(--ease-out)",
          }}
        >
          <path
            d="M6 9l6 6 6-6"
            stroke="var(--ink-faint)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <div
        className="plk-faq-a"
        style={{
          maxHeight: open ? 240 : 0,
          paddingBottom: open ? 18 : 0,
          transition: "max-height 300ms var(--ease-out), padding 300ms var(--ease-out)",
        }}
      >
        {a}
      </div>
    </div>
  );
}

// ─── Page-scoped CSS — reproduces the design's marketing classes + responsive ──
// Mobile-first. Mirrors marketing.css .hero / .section / .pricing-grid /
// .price-card / .billing-toggle / .faq-item, including the design breakpoints
// (≤1100px → 2 cols, ≤760px → 1 col). The primary grid is now 3 cards, so the
// 3-col layout fits comfortably; secondary tiers reuse the same grid when shown.
const PRICING_CSS = `
.plk-section { padding: 84px 0; }
.plk-section.tint { background: var(--bg); }
.plk-section.navy { background: var(--navy); color: #fff; }
.plk-wrap { max-width: 1280px; margin: 0 auto; padding: 0 32px; }
.plk-wrap.narrow { max-width: 920px; }

/* Hero */
.plk-hero {
  position: relative; overflow: hidden;
  background: var(--navy); color: #fff;
}
.plk-hero::before {
  content: ""; position: absolute; inset: 0; pointer-events: none;
  background:
    radial-gradient(800px 420px at 50% -8%, rgba(30,102,201,0.22), transparent 60%),
    radial-gradient(620px 380px at 84% 18%, rgba(46,142,58,0.16), transparent 60%);
}
.plk-hero-inner { position: relative; max-width: 1180px; margin: 0 auto; padding: 64px 32px 56px; text-align: center; }
.plk-eyebrow {
  display: inline-flex; align-items: center; gap: 7px;
  height: 28px; padding: 0 13px; border-radius: 14px;
  background: var(--navy-surface); border: 1px solid var(--navy-border);
  font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--navy-text);
}
.plk-eyebrow-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--brand-blue); box-shadow: 0 0 0 3px rgba(30,102,201,0.25); }
.plk-h1 {
  font-family: var(--font-display); font-weight: 700;
  font-size: clamp(34px, 5vw, 52px); line-height: 1.05; letter-spacing: -0.035em;
  margin: 20px auto 0; max-width: 18ch; text-wrap: balance; color: #fff;
}
.plk-sub { color: var(--navy-text); font-size: clamp(15px, 1.6vw, 18px); line-height: 1.6; max-width: 56ch; margin: 18px auto 0; text-wrap: pretty; }

/* Volume recommender (leads with the ROI helper's recommendation) */
.plk-reco {
  margin: 30px auto 0; max-width: 620px; text-align: left;
  background: var(--navy-surface); border: 1px solid var(--navy-border);
  border-radius: var(--radius-lg); padding: 22px 24px;
}
.plk-reco-label { display: block; font-size: 13.5px; font-weight: 600; color: #fff; margin-bottom: 14px; }
.plk-reco-input-row { display: flex; align-items: center; gap: 16px; }
.plk-reco-input { flex: 1; height: 28px; accent-color: var(--brand-blue); cursor: pointer; touch-action: none; }
.plk-reco-count {
  font-family: var(--font-mono, 'JetBrains Mono', ui-monospace, monospace);
  font-size: 16px; font-weight: 700; color: #fff; white-space: nowrap; min-width: 132px; text-align: right;
}
.plk-reco-count small { font-size: 11px; font-weight: 500; color: var(--navy-text); font-family: var(--font-sans); }
.plk-reco-out {
  display: flex; align-items: center; flex-wrap: wrap; gap: 10px 14px;
  margin-top: 18px; padding-top: 18px; border-top: 1px solid var(--navy-border);
}
.plk-reco-out-label { font-size: 10.5px; font-weight: 700; letter-spacing: 0.07em; text-transform: uppercase; color: var(--navy-text); }
.plk-reco-out-plan { font-family: var(--font-display); font-size: 20px; font-weight: 700; letter-spacing: -0.02em; color: #fff; }
.plk-reco-out-price { font-size: 14px; font-weight: 600; color: var(--navy-text); }
.plk-reco-cta { width: auto; margin-top: 0; margin-left: auto; }

/* Section head + eyebrow (design .section-head / .section-eyebrow / .section-title) */
.plk-section-head { text-align: center; max-width: 620px; margin: 0 auto 30px; }
.plk-section-eyebrow {
  display: inline-flex; align-items: center; gap: 7px; height: 26px; padding: 0 12px; border-radius: 13px;
  background: var(--brand-blue-soft); color: var(--brand-blue-deep);
  font-size: 11px; font-weight: 700; letter-spacing: 0.07em; text-transform: uppercase; margin-bottom: 16px;
}
.plk-section-title { font-family: var(--font-display); font-size: clamp(28px, 3.6vw, 40px); font-weight: 700; letter-spacing: -0.03em; line-height: 1.1; margin: 0; text-wrap: balance; }
.plk-section.navy .plk-section-eyebrow { background: var(--navy-surface); color: var(--navy-text); border: 1px solid var(--navy-border); }
.plk-section-sub { color: var(--navy-text); font-size: 16px; line-height: 1.6; margin: 14px auto 0; max-width: 460px; text-wrap: pretty; }

/* Billing toggle (design .billing-toggle) */
.plk-toggle-wrap { margin-bottom: 26px; display: flex; justify-content: center; }
.plk-billing-toggle { display: inline-flex; background: var(--surface-2); border-radius: var(--radius); padding: 3px; gap: 2px; }
.plk-billing-toggle button {
  border: none; background: none; padding: 7px 16px; border-radius: 5px;
  font-size: 13px; font-weight: 600; color: var(--ink-muted); cursor: pointer;
  transition: background var(--duration-fast), color var(--duration-fast), box-shadow var(--duration-fast);
}
.plk-billing-toggle button.on { background: var(--surface); color: var(--ink); box-shadow: var(--shadow-card); }

/* Pricing grid + card (design .pricing-grid / .price-card) */
.plk-pricing-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; align-items: start; }
/* Primary row carries FOUR cards (Pilot / Growth / Operations / Enterprise) so
   the cheapest paid step is above the fold at 1080p. The later @media rules
   share its specificity and come after it in source, so the 2-col (≤1100px)
   and 1-col (≤760px) collapses still win. */
.plk-primary-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
/* [hidden] must beat the explicit display:grid above so the collapsed secondary
   tier panel is truly removed from layout while staying in the DOM. */
.plk-pricing-grid[hidden] { display: none; }
.plk-secondary-grid { margin-top: 22px; }
.plk-price-card {
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg);
  padding: 22px 18px; position: relative; display: flex; flex-direction: column;
  transition: border-color var(--duration-fast), box-shadow var(--duration-fast), transform var(--duration-fast);
}
.plk-price-card:not(.featured):hover { border-color: var(--border-strong); box-shadow: var(--shadow-pop); transform: translateY(-2px); }
.plk-price-card.featured {
  border-color: var(--brand-blue);
  box-shadow: 0 0 0 1px var(--brand-blue), var(--shadow-pop);
  z-index: 1;
}
.plk-price-badge {
  position: absolute; top: -11px; left: 50%; transform: translateX(-50%);
  background: var(--gradient-bridge-deck); color: #fff;
  font-size: 10.5px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
  padding: 4px 12px; border-radius: 11px; white-space: nowrap;
}
.plk-tier { font-family: var(--font-display); font-size: 20px; font-weight: 700; letter-spacing: -0.015em; color: var(--ink); }
.plk-tier-sub { color: var(--ink-muted); font-size: 13px; min-height: 38px; line-height: 1.45; margin-top: 4px; }
.plk-price { font-family: var(--font-display); font-size: 40px; font-weight: 700; letter-spacing: -0.035em; margin: 14px 0 2px; color: var(--ink); line-height: 1; }
.plk-price small { font-size: 14px; color: var(--ink-muted); font-family: var(--font-sans); font-weight: 500; letter-spacing: 0; }
.plk-price-note { font-size: 12px; color: var(--ink-faint); min-height: 18px; }
.plk-overage-note { font-size: 11.5px; color: var(--ink-muted); margin-top: 4px; line-height: 1.45; }

/* See-all-tiers disclosure */
.plk-disclosure { display: flex; flex-direction: column; align-items: center; gap: 8px; margin-top: 28px; }
.plk-disclosure-btn {
  display: inline-flex; align-items: center; gap: 8px;
  height: 38px; padding: 0 18px; border-radius: var(--radius);
  background: var(--surface); color: var(--brand-blue-deep);
  border: 1px solid var(--border-strong);
  font-size: 13px; font-weight: 600; cursor: pointer;
  transition: background var(--duration-fast), border-color var(--duration-fast), color var(--duration-fast);
}
.plk-disclosure-btn:hover:not(:disabled) { background: var(--surface-2); border-color: var(--brand-blue); }
.plk-disclosure-btn:disabled { opacity: 0.55; cursor: default; }
.plk-disclosure-hint { font-size: 12.5px; color: var(--ink-muted); }

/* Card CTA (design .btn / .btn-blue / .btn-secondary) */
.plk-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 7px;
  height: 38px; padding: 0 14px; border-radius: var(--radius);
  font-size: 12.5px; font-weight: 600; letter-spacing: -0.005em;
  border: 1px solid transparent; white-space: nowrap; text-decoration: none; width: 100%; margin-top: 18px;
  transition: background var(--duration-fast), border-color var(--duration-fast), color var(--duration-fast), transform var(--duration-fast);
}
.plk-btn:active { transform: translateY(0.5px); }
.plk-btn.lg { height: 42px; padding: 0 22px; font-size: 13.5px; width: auto; margin-top: 0; }
.plk-btn-blue { background: var(--brand-blue); color: #fff; }
.plk-btn-blue:hover { background: var(--brand-blue-deep); }
.plk-btn-secondary { background: var(--surface); color: var(--ink); border-color: var(--border-strong); }
.plk-btn-secondary:hover { background: var(--surface-2); border-color: var(--border-strong); }
.plk-btn-outline { background: transparent; color: #fff; border-color: var(--navy-border); }
.plk-btn-outline:hover { background: var(--navy-surface); }

/* Feature list (design .price-feats) */
.plk-feats { list-style: none; padding: 0; margin: 20px 0 0; display: flex; flex-direction: column; gap: 11px; flex: 1; }
.plk-feats li { display: flex; gap: 9px; align-items: flex-start; font-size: 13px; color: var(--ink); line-height: 1.4; }
.plk-check { margin-top: 1px; flex-shrink: 0; }

.plk-fine { text-align: center; font-size: 12px; color: var(--ink-faint); line-height: 1.6; max-width: 880px; margin: 24px auto 0; }

/* FAQ (design .faq-item / .faq-q / .faq-a) */
.plk-faq-item { border-bottom: 1px solid var(--border); }
.plk-faq-q {
  width: 100%; text-align: left; background: none; border: none; padding: 18px 0;
  display: flex; justify-content: space-between; align-items: center; gap: 16px;
  font-size: 15px; font-weight: 600; color: var(--ink); cursor: pointer; min-height: 44px;
}
.plk-faq-a { overflow: hidden; color: var(--ink-muted); font-size: 14px; line-height: 1.6; }

/* Closing CTA row (design .row.center.gap-3) */
.plk-cta-row { display: flex; align-items: center; justify-content: center; gap: 12px; margin-top: 26px; flex-wrap: wrap; }

/* ── Responsive (mirrors marketing.css pricing breakpoints) ─────────────── */
@media (max-width: 1100px) {
  .plk-pricing-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 760px) {
  .plk-pricing-grid { grid-template-columns: 1fr; }
  .plk-reco-cta { margin-left: 0; width: 100%; }
}
@media (max-width: 560px) {
  .plk-wrap { padding: 0 18px; }
  .plk-hero-inner { padding: 44px 18px 48px; }
  .plk-section { padding: 56px 0; }
  .plk-cta-row .plk-btn { width: 100%; }
  .plk-reco { padding: 18px 16px; }
}
`;
