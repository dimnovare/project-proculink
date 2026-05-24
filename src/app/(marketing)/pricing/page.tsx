import Link from "next/link";

// ─── Tier data ────────────────────────────────────────────────────────────────

const TIERS = [
  {
    name: "Starter",
    price: "Free",
    sub: "forever",
    desc: "For teams evaluating B2B order automation.",
    color: "#56627A",
    border: "#E2E6EE",
    bg: "#FFFFFF",
    highlight: false,
    features: [
      "Up to 100 crossings / month",
      "PDF + XLSX + CSV extraction",
      "2 buyer docks · 2 supplier docks",
      "Manual review workflow",
      "Standard validation rules",
      "7-day crossings log",
      "Email support",
    ],
    cta: "Start for free",
    ctaHref: "/sign-up",
    ctaStyle: {
      background: "#0B1A2F",
      color: "#FFFFFF",
      border: "none",
    },
  },
  {
    name: "Growth",
    price: "€49",
    sub: "per month",
    desc: "For operations teams running live order flows.",
    color: "#1E66C9",
    border: "#1E66C9",
    bg: "#FFFFFF",
    highlight: true,
    features: [
      "Unlimited crossings",
      "All formats incl. EDI, cXML, API, Email",
      "Unlimited docks",
      "Auto-process mode",
      "Custom validation rules",
      "AI-assisted mapping (500 suggestions/mo)",
      "Crossings log · full audit trail",
      "CSV import/export",
      "Priority email support",
    ],
    cta: "Start Growth trial",
    ctaHref: "/sign-up",
    ctaStyle: {
      background: "linear-gradient(90deg, #1E66C9, #2E8E3A)",
      color: "#FFFFFF",
      border: "none",
    },
  },
  {
    name: "Enterprise",
    price: "Custom",
    sub: "contact us",
    desc: "For large operations with custom integration needs.",
    color: "#2E8E3A",
    border: "#E2E6EE",
    bg: "#FFFFFF",
    highlight: false,
    features: [
      "Everything in Growth",
      "Dedicated bridge infrastructure",
      "ERP connectors (SAP, Oracle, MS Dynamics)",
      "Email polling integration",
      "Custom SLA (99.99% uptime)",
      "Bulk mapping import",
      "SSO / SAML",
      "Dedicated account manager",
      "On-site onboarding",
    ],
    cta: "Contact sales",
    ctaHref: "mailto:sales@proculink.com",
    ctaStyle: {
      background: "#F6F7FA",
      color: "#0B1A2F",
      border: "1px solid #E2E6EE",
    },
  },
];

const FAQ = [
  {
    q: "What counts as a crossing?",
    a: "One crossing = one purchase order document fully processed end-to-end: extracted, mapped, validated, and delivered to the supplier.",
  },
  {
    q: "Can I upgrade or downgrade at any time?",
    a: "Yes. Changes take effect at the start of the next billing cycle. Moving from Growth back to Starter will restrict you to the 100 crossing/month limit.",
  },
  {
    q: "What formats does the AI extraction support?",
    a: "PDF (scanned and digital), XLSX/CSV, EDI (X12 850), cXML, plain-text emails, and REST API payloads. More formats on request.",
  },
  {
    q: "Is there a minimum contract for Enterprise?",
    a: "Enterprise agreements are annual. Contact our team for a custom quote based on your volume and integration requirements.",
  },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PricingPage() {
  return (
    <div style={{ background: "#FFFFFF" }}>
      {/* Hero + Tiers — single continuous section, no big gap */}
      <section style={{ background: "#F6F7FA", padding: "64px 32px 0", textAlign: "center" }}>
        <h1
          style={{
            fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
            fontSize: "clamp(28px, 4vw, 48px)",
            fontWeight: 700,
            letterSpacing: "-0.03em",
            color: "#0B1A2F",
            marginBottom: 12,
          }}
        >
          Simple, honest pricing
        </h1>
        <p style={{ fontSize: 15.5, color: "#56627A", maxWidth: 360, margin: "0 auto 48px", lineHeight: 1.55 }}>
          Start free. Scale when you need to.<br />No per-seat nonsense.
        </p>
      </section>

      {/* Tiers */}
      <section style={{ padding: "0 32px 64px", maxWidth: 1080, margin: "0 auto" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 20,
            alignItems: "start",
          }}
        >
          {TIERS.map((tier) => (
            <div
              key={tier.name}
              style={{
                background: tier.bg,
                border: `2px solid ${tier.highlight ? tier.border : "#E2E6EE"}`,
                borderRadius: 12,
                padding: "32px 28px",
                display: "flex",
                flexDirection: "column",
                boxShadow: tier.highlight
                  ? "0 4px 24px rgba(30,102,201,0.14)"
                  : "0 1px 4px rgba(11,26,47,0.05)",
                position: "relative",
              }}
            >
              {tier.highlight && (
                <div
                  style={{
                    position: "absolute",
                    top: -12,
                    left: "50%",
                    transform: "translateX(-50%)",
                    background: "linear-gradient(90deg, #1E66C9, #2E8E3A)",
                    color: "#FFFFFF",
                    fontSize: 10.5,
                    fontWeight: 700,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    padding: "3px 14px",
                    borderRadius: 99,
                    whiteSpace: "nowrap",
                  }}
                >
                  Most popular
                </div>
              )}

              {/* Name */}
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: tier.color,
                  marginBottom: 12,
                }}
              >
                {tier.name}
              </div>

              {/* Price */}
              <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 8 }}>
                <span
                  style={{
                    fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
                    fontSize: 42,
                    fontWeight: 700,
                    letterSpacing: "-0.03em",
                    color: "#0B1A2F",
                    lineHeight: 1,
                  }}
                >
                  {tier.price}
                </span>
                <span style={{ fontSize: 13, color: "#8A93A5" }}>{tier.sub}</span>
              </div>

              <p style={{ fontSize: 13.5, color: "#56627A", marginBottom: 28, lineHeight: 1.55 }}>
                {tier.desc}
              </p>

              {/* CTA */}
              <Link
                href={tier.ctaHref}
                style={{
                  display: "block",
                  borderRadius: 8,
                  padding: "11px 0",
                  textAlign: "center",
                  fontSize: 13.5,
                  fontWeight: 600,
                  textDecoration: "none",
                  marginBottom: 28,
                  ...tier.ctaStyle,
                }}
              >
                {tier.cta}
              </Link>

              {/* Divider */}
              <div style={{ height: 1, background: "#F0F2F6", marginBottom: 20 }} />

              {/* Features */}
              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10 }}>
                {tier.features.map((f, i) => (
                  <li
                    key={i}
                    style={{ display: "flex", alignItems: "flex-start", gap: 9, fontSize: 13 }}
                  >
                    <span style={{ color: "#2E8E3A", flexShrink: 0, fontWeight: 700, marginTop: 1 }}>
                      ✓
                    </span>
                    <span style={{ color: "#56627A", lineHeight: 1.45 }}>{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section
        style={{
          padding: "64px 32px",
          maxWidth: 720,
          margin: "0 auto",
          borderTop: "1px solid #E2E6EE",
        }}
      >
        <h2
          style={{
            fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
            fontSize: 28,
            fontWeight: 700,
            letterSpacing: "-0.02em",
            color: "#0B1A2F",
            marginBottom: 36,
            textAlign: "center",
          }}
        >
          Frequently asked
        </h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          {FAQ.map((item, i) => (
            <div key={i} style={{ borderBottom: "1px solid #F0F2F6", paddingBottom: 24 }}>
              <h3
                style={{
                  fontSize: 15,
                  fontWeight: 600,
                  color: "#0B1A2F",
                  marginBottom: 8,
                }}
              >
                {item.q}
              </h3>
              <p style={{ fontSize: 13.5, color: "#56627A", lineHeight: 1.65 }}>{item.a}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
