"use client";

import Link from "next/link";
import { useState } from "react";
import { PLANS, SETUP_FEE_NOTE } from "@/lib/plans";

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
//   • The Operations tier is the featured ("Most popular") card: buyer-blue
//     border + soft blue glow + centred blue→green gradient badge + blue CTA,
//     exactly matching the design's .price-card.featured + .price-badge.
// ─────────────────────────────────────────────────────────────────────────────

const FEATURED_ID = "operations";

// Small contextual line under each price (design's "+ one-time setup" /
// "No card required" / "Annual contract" sub-line). Kept consistent with
// SETUP_FEE_NOTE — no invented euro figure, since onboarding is per-supplier
// and waived for design partners.
const SETUP_NOTE: Record<string, string> = {
  pilot: "No card required",
  growth: "No setup fee",
  operations: "Founder-led setup",
  integration: "Founder-led setup",
  distributor: "Founder-led setup",
  enterprise: "Annual contract",
};

const TIERS = PLANS.filter((p) => !p.hidden).map((p) => ({
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
  featured: p.id === FEATURED_ID,
}));

const FAQ: Array<[string, string]> = [
  [
    "What counts as an order?",
    "One buyer purchase order that ProcuLink processes end to end — from inbound parse to a delivered supplier document. Re-deliveries of the same order don't count again.",
  ],
  [
    "What happens after the Pilot?",
    "Nothing breaks. Your suppliers and mappings stay configured; you simply pick a plan when you're ready to keep processing orders past the 20-order trial.",
  ],
  [
    "Do you charge for failed orders?",
    "No. An order only counts once it's successfully delivered. Validation failures and retries are free.",
  ],
  [
    "Can I change plans later?",
    "Yes — up or down, any time. We prorate the difference and your saved mappings and rules carry over untouched.",
  ],
  [
    "Where is my data stored?",
    "All order data is stored in the EU (Frankfurt) and encrypted with AES-GCM at rest. See the Security page for the full posture.",
  ],
];

type Billing = "monthly" | "yearly";

// Annual billing applies a 17% discount to the listed monthly price.
const YEARLY_DISCOUNT = 0.17;

export default function PricingPage() {
  const [billing, setBilling] = useState<Billing>("monthly");
  const yearly = billing === "yearly";

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
            Start with a proof-of-value Pilot. Setup fees are one-time and include hands-on
            mapping help. No per-seat pricing, no integration project.
          </p>

          {/* Billing cadence toggle — the design's .billing-toggle pill */}
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
                Yearly · save 17%
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* ── Pricing cards (mirrors .section + .pricing-grid) ─────────────── */}
      <section className="plk-section" style={{ paddingTop: 48 }}>
        <div className="plk-wrap">
          <div className="plk-pricing-grid">
            {TIERS.map((tier) => {
              const featured = tier.featured;

              // Annual display: 17% off the monthly price, shown per-month.
              const showYearly = yearly && tier.isMonthly && tier.priceMonthly;
              const yearlyMonthly = tier.priceMonthly
                ? Math.round(tier.priceMonthly * (1 - YEARLY_DISCOUNT))
                : null;
              const bigPrice = showYearly ? `€${yearlyMonthly}` : tier.price;
              const priceTag = tier.isMonthly;

              return (
                <article
                  key={tier.id}
                  className={featured ? "plk-price-card featured" : "plk-price-card"}
                >
                  {featured && <span className="plk-price-badge">Most popular</span>}

                  <div className="plk-tier">{tier.name}</div>
                  <div className="plk-tier-sub">{tier.desc}</div>

                  <div className="plk-price">
                    {bigPrice}
                    {priceTag && <small>/mo</small>}
                  </div>
                  <div className="plk-price-note">
                    {tier.isMonthly
                      ? showYearly
                        ? "billed yearly"
                        : tier.setupNote
                      : tier.setupNote}
                  </div>

                  <Link
                    href={tier.href}
                    className={featured ? "plk-btn plk-btn-blue" : "plk-btn plk-btn-secondary"}
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
            })}
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
// (≤1100px → 3 cols, ≤760px → 1 col) so the 6-tier ladder never overflows.
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
.plk-toggle-wrap { margin-top: 26px; display: flex; justify-content: center; }

/* Billing toggle (design .billing-toggle) */
.plk-billing-toggle { display: inline-flex; background: var(--surface-2); border-radius: var(--radius); padding: 3px; gap: 2px; }
.plk-billing-toggle button {
  border: none; background: none; padding: 7px 16px; border-radius: 5px;
  font-size: 13px; font-weight: 600; color: var(--ink-muted); cursor: pointer;
  transition: background var(--duration-fast), color var(--duration-fast), box-shadow var(--duration-fast);
}
.plk-billing-toggle button.on { background: var(--surface); color: var(--ink); box-shadow: var(--shadow-card); }

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

/* Pricing grid + card (design .pricing-grid / .price-card) */
.plk-pricing-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; align-items: start; }
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
}
@media (max-width: 560px) {
  .plk-wrap { padding: 0 18px; }
  .plk-hero-inner { padding: 44px 18px 48px; }
  .plk-section { padding: 56px 0; }
  .plk-cta-row .plk-btn { width: 100%; }
}
`;
