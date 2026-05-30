import Link from "next/link";
import { PLANS, SETUP_FEE_NOTE } from "@/lib/plans";

// Pricing cards are derived from the shared plan ladder (src/lib/plans.ts) so
// prices, order limits, and feature lists can never drift from billing/ROI.
const TIERS = PLANS.map((p) => ({
  name: p.name,
  price: p.priceLabel,
  sub: p.priceCadence,
  desc: p.blurb,
  color: p.color,
  highlight: p.highlight,
  features: p.features,
  cta: p.cta.label,
  href: p.cta.href,
}));

const FAQ = [
  {
    q: "Is Pilot a free plan?",
    a: "No. Pilot is a 14-day proof-of-value trial with 20 orders and one supplier flow. After it ends, the workspace stays readable but new processing pauses until upgrade.",
  },
  {
    q: "What counts as an order?",
    a: "One uploaded buyer purchase order that ProcuLink parses, validates, maps, transforms, or prepares for delivery.",
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

export default function PricingPage() {
  return (
    <div style={{ background: "#FFFFFF" }}>
      <section style={{ background: "#F6F7FA", padding: "64px 32px 42px", textAlign: "center", borderBottom: "1px solid #E2E6EE" }}>
        <div style={{ maxWidth: 760, margin: "0 auto" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, border: "1px solid #D6DDE8", borderRadius: 999, padding: "5px 10px", background: "#FFFFFF", color: "#56627A", fontSize: 12, fontWeight: 700, marginBottom: 18 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#2E8E3A" }} />
            Pilot to Enterprise
          </div>
          <h1
            style={{
              fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
              fontSize: "clamp(32px, 5vw, 58px)",
              fontWeight: 750,
              letterSpacing: 0,
              color: "#0B1A2F",
              marginBottom: 14,
              lineHeight: 1.02,
            }}
          >
            Pricing for outbound purchase orders.
          </h1>
          <p style={{ fontSize: 15.5, color: "#56627A", maxWidth: 520, margin: "0 auto", lineHeight: 1.6 }}>
            Start with a proof-of-value Pilot. Move into recurring order processing when the supplier flow is proven.
          </p>
        </div>
      </section>

      <section style={{ padding: "40px 32px 72px", maxWidth: 1240, margin: "0 auto" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
            gap: 16,
            alignItems: "stretch",
          }}
        >
          {TIERS.map((tier) => (
            <article
              key={tier.name}
              style={{
                background: "#FFFFFF",
                border: `1px solid ${tier.highlight ? tier.color : "#E2E6EE"}`,
                borderTop: `3px solid ${tier.color}`,
                borderRadius: 8,
                padding: "24px 20px",
                display: "flex",
                flexDirection: "column",
                minHeight: 430,
                boxShadow: tier.highlight ? "0 10px 30px rgba(30,102,201,0.12)" : "0 1px 4px rgba(11,26,47,0.05)",
                position: "relative",
              }}
            >
              {tier.highlight && (
                <span style={{ alignSelf: "flex-start", marginBottom: 14, borderRadius: 999, background: "#E3EDFB", color: "#1E66C9", padding: "4px 9px", fontSize: 10.5, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                  First production plan
                </span>
              )}

              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: tier.color, marginBottom: 12 }}>
                {tier.name}
              </div>

              <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 8 }}>
                <span style={{ fontFamily: "'Bricolage Grotesque', Inter, sans-serif", fontSize: 38, fontWeight: 750, letterSpacing: 0, color: "#0B1A2F", lineHeight: 1 }}>
                  {tier.price}
                </span>
                <span style={{ fontSize: 12.5, color: "#8A93A5" }}>{tier.sub}</span>
              </div>

              <p style={{ minHeight: 64, fontSize: 13, color: "#56627A", marginBottom: 20, lineHeight: 1.55 }}>
                {tier.desc}
              </p>

              <Link
                href={tier.href}
                style={{
                  display: "block",
                  borderRadius: 7,
                  padding: "10px 12px",
                  textAlign: "center",
                  fontSize: 13,
                  fontWeight: 800,
                  textDecoration: "none",
                  marginBottom: 22,
                  background: tier.highlight ? "linear-gradient(90deg, #1E66C9, #2E8E3A)" : "#F6F7FA",
                  color: tier.highlight ? "#FFFFFF" : "#0B1A2F",
                  border: tier.highlight ? "none" : "1px solid #E2E6EE",
                }}
              >
                {tier.cta}
              </Link>

              <div style={{ height: 1, background: "#F0F2F6", marginBottom: 18 }} />

              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 9 }}>
                {tier.features.map((feature) => (
                  <li key={feature} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12.5, color: "#56627A", lineHeight: 1.45 }}>
                    <span style={{ color: "#2E8E3A", flexShrink: 0, fontWeight: 800 }}>✓</span>
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
        <p style={{ maxWidth: 820, margin: "26px auto 0", textAlign: "center", fontSize: 12.5, color: "#8A93A5", lineHeight: 1.6 }}>
          {SETUP_FEE_NOTE}
        </p>
      </section>

      <section style={{ padding: "56px 32px", maxWidth: 760, margin: "0 auto", borderTop: "1px solid #E2E6EE" }}>
        <h2 style={{ fontFamily: "'Bricolage Grotesque', Inter, sans-serif", fontSize: 28, fontWeight: 750, letterSpacing: 0, color: "#0B1A2F", marginBottom: 32, textAlign: "center" }}>
          Frequently asked
        </h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {FAQ.map((item) => (
            <div key={item.q} style={{ borderBottom: "1px solid #F0F2F6", paddingBottom: 22 }}>
              <h3 style={{ fontSize: 15, fontWeight: 750, color: "#0B1A2F", marginBottom: 8 }}>
                {item.q}
              </h3>
              <p style={{ fontSize: 13.5, color: "#56627A", lineHeight: 1.65, margin: 0 }}>{item.a}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
