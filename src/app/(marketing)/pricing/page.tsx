"use client";

import Link from "next/link";
import { useState } from "react";
import { PLANS, SETUP_FEE_NOTE } from "@/lib/plans";

// ─────────────────────────────────────────────────────────────────────────────
// Pricing page. Cards are derived from the shared plan ladder (src/lib/plans.ts)
// so prices, order limits, and feature lists can never drift from billing/ROI.
// Operations is the featured ("Most popular") plan; the green accent is the
// project brand accent (#28C55E / hover #1DAF50 / soft #DCFCE7).
// ─────────────────────────────────────────────────────────────────────────────

const GREEN = "#28C55E";
const GREEN_DEEP = "#1DAF50";
const GREEN_SOFT = "#DCFCE7";
const NAVY = "#0B1A2F";
const INK = "#0B1A2F";
const INK_MUTED = "#56627A";
const INK_FAINT = "#8A93A5";
const BORDER = "#E2E6EE";
const SURFACE_GRAY = "#F6F7FA";
const DISPLAY = "'Bricolage Grotesque', Inter, sans-serif";

// Operations is the highlighted card in the reference design.
const FEATURED_ID = "operations";

// Small contextual line shown directly under each price (matches the design's
// "+ one-time setup" / "No card required" / "Annual contract" sub-line). Copy
// is kept consistent with SETUP_FEE_NOTE — we do NOT invent a specific euro
// figure here, since the onboarding fee is per-supplier and waived for design
// partners.
const SETUP_NOTE: Record<string, string> = {
  pilot: "No card required",
  growth: "No setup fee",
  operations: "Founder-led setup",
  integration: "Founder-led setup",
  distributor: "Founder-led setup",
  enterprise: "Annual contract",
};

const TIERS = PLANS.map((p) => ({
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

const FAQ = [
  {
    q: "Is Pilot a free plan?",
    a: "No. Pilot is a 14-day proof-of-value trial with 20 orders and one supplier flow. After it ends, the workspace stays readable but new processing pauses until upgrade.",
  },
  {
    q: "What counts as an order?",
    a: "One uploaded buyer purchase order that ProcuLink parses, validates, maps, transforms, or prepares to send to the supplier.",
  },
  {
    q: "Which plans use Stripe Checkout?",
    a: "Growth, Operations, Integration, and Distributor are self-service Stripe subscriptions. Enterprise is handled manually.",
  },
  {
    q: "Can suppliers and order volume be customized?",
    a: "Yes, on Enterprise. That tier is for custom supplier networks, ERP connectors, SLAs, and supplier-specific transformation rules.",
  },
];

type Billing = "monthly" | "yearly";

// Annual billing applies a 17% discount to the listed monthly price.
const YEARLY_DISCOUNT = 0.17;

export default function PricingPage() {
  const [billing, setBilling] = useState<Billing>("monthly");

  return (
    <div style={{ background: "#FFFFFF" }}>
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section
        style={{
          background:
            "radial-gradient(120% 140% at 78% 0%, rgba(40,197,94,0.16) 0%, rgba(40,197,94,0) 46%), linear-gradient(180deg, #0B1A2F 0%, #0C1E36 100%)",
          padding: "72px 32px 60px",
          textAlign: "center",
        }}
      >
        <div style={{ maxWidth: 760, margin: "0 auto" }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              fontSize: 11.5,
              fontWeight: 800,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: GREEN,
              marginBottom: 22,
            }}
          >
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: GREEN }} />
            Pricing
          </div>

          <h1
            style={{
              fontFamily: DISPLAY,
              fontSize: "clamp(34px, 5.4vw, 60px)",
              fontWeight: 700,
              letterSpacing: "-0.025em",
              color: "#FFFFFF",
              margin: 0,
              lineHeight: 1.05,
            }}
          >
            Pricing for outbound
            <br />
            purchase orders.
          </h1>

          <p
            style={{
              fontSize: 16,
              color: "#A9B7CC",
              maxWidth: 560,
              margin: "18px auto 0",
              lineHeight: 1.6,
            }}
          >
            Start with a proof-of-value Pilot. Setup fees are one-time and include hands-on
            mapping help. No per-seat pricing, no integration project.
          </p>

          {/* Billing cadence toggle */}
          <div
            role="group"
            aria-label="Billing period"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              marginTop: 30,
              padding: 4,
              borderRadius: 999,
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.12)",
            }}
          >
            {(
              [
                { key: "monthly", label: "Monthly" },
                { key: "yearly", label: "Yearly · save 17%" },
              ] as const
            ).map((opt) => {
              const active = billing === opt.key;
              return (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setBilling(opt.key)}
                  aria-pressed={active}
                  style={{
                    border: "none",
                    cursor: "pointer",
                    borderRadius: 999,
                    padding: "8px 18px",
                    fontSize: 13,
                    fontWeight: 700,
                    transition: "background 150ms, color 150ms",
                    background: active ? "#FFFFFF" : "transparent",
                    color: active ? NAVY : "#C5D2E4",
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Pricing cards ────────────────────────────────────────────────── */}
      <section style={{ padding: "52px 24px 60px", maxWidth: 1320, margin: "0 auto" }}>
        <div
          style={{
            display: "grid",
            // One clean row of equal cards on desktop (6 tiers → ~190px each at
            // max width); auto-fit degrades to 5 / 4 / … on narrower viewports
            // and stacks on mobile.
            gridTemplateColumns: "repeat(auto-fit, minmax(184px, 1fr))",
            gap: 14,
            alignItems: "stretch",
          }}
        >
          {TIERS.map((tier) => {
            const featured = tier.featured;

            // Annual display: 17% off the monthly price, shown per-month.
            const showYearly = billing === "yearly" && tier.isMonthly && tier.priceMonthly;
            const yearlyMonthly = tier.priceMonthly
              ? Math.round(tier.priceMonthly * (1 - YEARLY_DISCOUNT))
              : null;
            const bigPrice = showYearly ? `€${yearlyMonthly}` : tier.price;
            const priceTag = tier.isMonthly ? "/mo" : "";

            return (
              <article
                key={tier.id}
                style={{
                  position: "relative",
                  background: "#FFFFFF",
                  border: featured ? `1.5px solid ${GREEN}` : `1px solid ${BORDER}`,
                  borderRadius: 14,
                  padding: featured ? "30px 18px 24px" : "26px 18px 24px",
                  display: "flex",
                  flexDirection: "column",
                  boxShadow: featured
                    ? "0 18px 44px rgba(40,197,94,0.18)"
                    : "0 1px 3px rgba(11,26,47,0.05)",
                  zIndex: featured ? 1 : 0,
                  transition: "border-color 150ms, box-shadow 150ms",
                }}
                onMouseEnter={(e) => {
                  if (featured) return;
                  const el = e.currentTarget as HTMLElement;
                  el.style.borderColor = "rgba(40,197,94,0.45)";
                  el.style.boxShadow = "0 8px 22px rgba(11,26,47,0.08)";
                }}
                onMouseLeave={(e) => {
                  if (featured) return;
                  const el = e.currentTarget as HTMLElement;
                  el.style.borderColor = BORDER;
                  el.style.boxShadow = "0 1px 3px rgba(11,26,47,0.05)";
                }}
              >
                {featured && (
                  <span
                    style={{
                      position: "absolute",
                      top: -13,
                      left: "50%",
                      transform: "translateX(-50%)",
                      whiteSpace: "nowrap",
                      borderRadius: 999,
                      background: GREEN,
                      color: "#FFFFFF",
                      padding: "5px 14px",
                      fontSize: 10.5,
                      fontWeight: 800,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      boxShadow: "0 4px 12px rgba(40,197,94,0.4)",
                    }}
                  >
                    Most popular
                  </span>
                )}

                {/* Name + blurb */}
                <h3
                  style={{
                    fontFamily: DISPLAY,
                    fontSize: 20,
                    fontWeight: 700,
                    letterSpacing: "-0.015em",
                    color: INK,
                    margin: 0,
                  }}
                >
                  {tier.name}
                </h3>
                <p
                  style={{
                    minHeight: 50,
                    fontSize: 12.5,
                    color: INK_MUTED,
                    margin: "7px 0 0",
                    lineHeight: 1.45,
                  }}
                >
                  {tier.desc}
                </p>

                {/* Price */}
                <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 16 }}>
                  <span
                    style={{
                      fontFamily: DISPLAY,
                      fontSize: 44,
                      fontWeight: 700,
                      letterSpacing: "-0.03em",
                      color: INK,
                      lineHeight: 1,
                    }}
                  >
                    {bigPrice}
                  </span>
                  {priceTag && (
                    <span style={{ fontSize: 14, fontWeight: 600, color: INK_FAINT }}>
                      {priceTag}
                    </span>
                  )}
                </div>
                {/* Cadence + setup context (two small lines, as in the design) */}
                <div
                  style={{
                    fontSize: 11.5,
                    color: INK_FAINT,
                    marginTop: 7,
                    minHeight: 16,
                  }}
                >
                  {tier.isMonthly
                    ? showYearly
                      ? "billed yearly"
                      : tier.sub
                    : tier.sub}
                </div>
                {tier.setupNote && (
                  <div
                    style={{
                      fontSize: 11.5,
                      fontWeight: 600,
                      color: INK_MUTED,
                      marginTop: 4,
                    }}
                  >
                    {tier.setupNote}
                  </div>
                )}

                {/* CTA */}
                <Link
                  href={tier.href}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 6,
                    borderRadius: 9,
                    padding: "10px 12px",
                    fontSize: 12.5,
                    fontWeight: 700,
                    textDecoration: "none",
                    marginTop: 18,
                    background: featured ? GREEN : "#FFFFFF",
                    color: featured ? "#FFFFFF" : INK,
                    border: featured ? `1px solid ${GREEN}` : `1px solid ${BORDER}`,
                    boxShadow: featured ? "0 6px 16px rgba(40,197,94,0.3)" : "none",
                    transition: "background 150ms, border-color 150ms, color 150ms",
                  }}
                  onMouseEnter={(e) => {
                    const el = e.currentTarget as HTMLAnchorElement;
                    if (featured) {
                      el.style.background = GREEN_DEEP;
                      el.style.borderColor = GREEN_DEEP;
                    } else {
                      el.style.borderColor = GREEN;
                      el.style.color = GREEN_DEEP;
                    }
                  }}
                  onMouseLeave={(e) => {
                    const el = e.currentTarget as HTMLAnchorElement;
                    if (featured) {
                      el.style.background = GREEN;
                      el.style.borderColor = GREEN;
                    } else {
                      el.style.borderColor = BORDER;
                      el.style.color = INK;
                    }
                  }}
                >
                  {tier.cta} <span aria-hidden>→</span>
                </Link>

                {/* Features — whitespace separation only (no divider rule), to
                    match the design's clean card body. */}
                <ul
                  style={{
                    listStyle: "none",
                    padding: 0,
                    margin: "20px 0 0",
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                  }}
                >
                  {tier.features.map((feature) => (
                    <li
                      key={feature}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 8,
                        fontSize: 12.5,
                        color: INK_MUTED,
                        lineHeight: 1.4,
                      }}
                    >
                      <CheckIcon />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              </article>
            );
          })}
        </div>

        <p
          style={{
            maxWidth: 880,
            margin: "32px auto 0",
            textAlign: "center",
            fontSize: 12.5,
            color: INK_FAINT,
            lineHeight: 1.6,
          }}
        >
          {SETUP_FEE_NOTE}
        </p>
        <p
          style={{
            maxWidth: 880,
            margin: "10px auto 0",
            textAlign: "center",
            fontSize: 12.5,
            color: INK_FAINT,
            lineHeight: 1.6,
          }}
        >
          All plans include EU data residency, AES-GCM encryption, and a full audit trail per order.
        </p>
      </section>

      {/* ── FAQ ──────────────────────────────────────────────────────────── */}
      <section style={{ background: SURFACE_GRAY, borderTop: `1px solid ${BORDER}`, padding: "72px 24px" }}>
        <div style={{ maxWidth: 820, margin: "0 auto", textAlign: "center" }}>
          <span
            style={{
              display: "inline-block",
              borderRadius: 999,
              background: GREEN_SOFT,
              color: GREEN_DEEP,
              padding: "5px 12px",
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
            }}
          >
            FAQ
          </span>
          <h2
            style={{
              fontFamily: DISPLAY,
              fontSize: "clamp(28px, 4vw, 40px)",
              fontWeight: 700,
              letterSpacing: "-0.025em",
              color: INK,
              margin: "18px 0 0",
            }}
          >
            Frequently asked
          </h2>
        </div>

        <div style={{ maxWidth: 820, margin: "40px auto 0", display: "flex", flexDirection: "column" }}>
          {FAQ.map((item) => (
            <FaqRow key={item.q} q={item.q} a={item.a} />
          ))}
        </div>
      </section>

      {/* ── "Not sure which plan fits?" CTA band ────────────────────────── */}
      <section
        style={{
          background:
            "radial-gradient(120% 140% at 22% 0%, rgba(40,197,94,0.14) 0%, rgba(40,197,94,0) 48%), #0B1A2F",
          padding: "80px 24px",
          textAlign: "center",
        }}
      >
        <h2
          style={{
            fontFamily: DISPLAY,
            fontSize: "clamp(28px, 4vw, 42px)",
            fontWeight: 700,
            letterSpacing: "-0.025em",
            color: "#FFFFFF",
            margin: 0,
          }}
        >
          Not sure which plan fits?
        </h2>
        <p style={{ fontSize: 15.5, color: "#A9B7CC", maxWidth: 460, margin: "16px auto 0", lineHeight: 1.6 }}>
          Use the ROI calculator on the home page, or start the free Pilot and decide later.
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap", marginTop: 32 }}>
          <Link
            href="/sign-up"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              borderRadius: 9,
              padding: "12px 26px",
              fontSize: 14,
              fontWeight: 700,
              background: GREEN,
              color: "#FFFFFF",
              textDecoration: "none",
              boxShadow: "0 8px 22px rgba(40,197,94,0.35)",
              transition: "background 150ms",
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.background = GREEN_DEEP; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.background = GREEN; }}
          >
            Start free Pilot <span aria-hidden>→</span>
          </Link>
          <Link
            href="/"
            style={{
              display: "inline-flex",
              alignItems: "center",
              borderRadius: 9,
              padding: "12px 26px",
              fontSize: 14,
              fontWeight: 700,
              background: "rgba(255,255,255,0.06)",
              color: "#FFFFFF",
              textDecoration: "none",
              border: "1px solid rgba(255,255,255,0.18)",
              transition: "background 150ms",
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.background = "rgba(255,255,255,0.12)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.background = "rgba(255,255,255,0.06)"; }}
          >
            Open ROI calculator
          </Link>
        </div>
      </section>
    </div>
  );
}

// ─── Small components ─────────────────────────────────────────────────────────

function CheckIcon() {
  // Flat green check glyph (matches the design's lightweight feature checks
  // rather than a tinted circular badge).
  return (
    <svg
      aria-hidden
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      style={{ flexShrink: 0, marginTop: 2 }}
    >
      <path
        d="M3 8.5l3 3 7-7"
        stroke={GREEN_DEEP}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FaqRow({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ borderBottom: "1px solid #E6E9F0" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          background: "transparent",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          padding: "20px 4px",
        }}
      >
        <span style={{ fontSize: 15, fontWeight: 700, color: INK }}>{q}</span>
        <span
          aria-hidden
          style={{
            flexShrink: 0,
            color: INK_FAINT,
            fontSize: 13,
            transition: "transform 200ms",
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
          }}
        >
          ▾
        </span>
      </button>
      {open && (
        <p style={{ fontSize: 13.5, color: INK_MUTED, lineHeight: 1.65, margin: 0, padding: "0 4px 22px" }}>
          {a}
        </p>
      )}
    </div>
  );
}
