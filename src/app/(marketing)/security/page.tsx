import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Security — ProcuLink",
  description: "How ProcuLink is designed to protect your purchase order data.",
};

// Green accent (brand token): primary #28C55E, hover/deep #1DAF50, soft tint #DCFCE7.
const GREEN = "#28C55E";
const GREEN_DEEP = "#1DAF50";
// Sampled from the 1920 design render: the card top-edge reads as a deeper,
// muted forest green (#2E8E3A), not the bright brand green. The icon glyphs
// stay on the deep brand green so the mint tiles still read on-brand.
const GREEN_EDGE = "#2E8E3A";
// Primary action colour on this page is buyer-blue (sampled ~#2A70CC → token #1E66C9),
// not green: the "Request security docs" CTA is blue in the design.
const BUYER_BLUE = "#1E66C9";

const PROPERTIES = [
  {
    label: "Encryption everywhere",
    detail:
      "AES-GCM at rest and TLS 1.3 in transit. Supplier delivery credentials are stored in an isolated secrets vault, never in application logs.",
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke={GREEN_DEEP} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="8" width="14" height="9" rx="2" />
        <path d="M5 8V5.5a4 4 0 0 1 8 0V8" />
        <circle cx="9" cy="12.5" r="1.2" fill={GREEN_DEEP} stroke="none" />
      </svg>
    ),
  },
  {
    label: "EU data residency",
    detail:
      "All order data is processed and stored in the EU (Frankfurt). No data leaves the region without an explicit, contracted subprocessor agreement.",
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke={GREEN_DEEP} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="9" cy="9" r="7" />
        <path d="M2 9h14M9 2c2.5 2.5 2.5 11.5 0 14M9 2c-2.5 2.5-2.5 11.5 0 14" />
      </svg>
    ),
  },
  {
    label: "Append-only audit trail",
    detail:
      "Every parse, edit, validation and delivery attempt is recorded immutably. Export the full delivery log for any order at any time.",
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke={GREEN_DEEP} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="9" cy="9" r="7" />
        <path d="M9 5v4l2.5 2.5" />
      </svg>
    ),
  },
  {
    label: "Validation before delivery",
    detail:
      "Per-supplier rules block malformed orders before they ever reach a supplier endpoint — wrong currency, missing fields, unresolved codes.",
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke={GREEN_DEEP} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2.5" y="2.5" width="13" height="13" rx="2.5" />
        <path d="M5.5 9.2l2.2 2.2 4.8-5" />
      </svg>
    ),
  },
  {
    label: "Access control",
    detail:
      "Role-based access, SSO via SAML/OIDC on Scale, and scoped API keys you can revoke instantly. Sessions are short-lived by default.",
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke={GREEN_DEEP} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="9" cy="6" r="3.2" />
        <path d="M3 15.5c0-3 2.7-5.2 6-5.2s6 2.2 6 5.2" />
      </svg>
    ),
  },
  {
    label: "Responsible AI",
    detail:
      "Mapping suggestions never auto-apply without a confidence score and source. Your data is never used to train third-party models.",
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke={GREEN_DEEP} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9.5 2 4 10h4l-.5 6L13 8H9z" />
      </svg>
    ),
  },
];

const COMPLIANCE_ROWS: [string, string][] = [
  ["SOC 2 Type II", "In progress · report Q4 2026"],
  ["GDPR", "Compliant · DPA available"],
  ["ISO 27001", "Roadmap · 2027"],
  ["Pen testing", "Annual third-party tests"],
];

const SUBPROCESSOR_ROWS: [string, string][] = [
  ["Amazon Web Services", "Hosting & storage (eu-central-1)"],
  ["OpenAI / Azure OpenAI", "Mapping suggestions (EU endpoint, no training)"],
  ["Stripe", "Billing & payments"],
  ["Resend", "Transactional email"],
];

function ListCard({ rows }: { rows: [string, string][] }) {
  return (
    <div
      style={{
        background: "#FFFFFF",
        border: "1px solid #E2E6EE",
        borderRadius: 12,
        boxShadow: "0 1px 2px rgba(11,26,47,0.04)",
        overflow: "hidden",
      }}
    >
      {rows.map(([label, note], i) => (
        <div
          key={label}
          className="px-4 sm:px-5"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 14,
            paddingTop: 15,
            paddingBottom: 15,
            borderTop: i === 0 ? "none" : "1px solid #EDF0F5",
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 600, color: "#0B1A2F", letterSpacing: "-0.01em", flexShrink: 0 }}>
            {label}
          </span>
          <span style={{ fontSize: 13, color: "#56627A", textAlign: "right", minWidth: 0 }}>{note}</span>
        </div>
      ))}
    </div>
  );
}

export default function SecurityPage() {
  return (
    <div style={{ background: "#FFFFFF" }}>
      {/* Navy hero */}
      <section
        className="px-5 sm:px-8 py-16 sm:py-20"
        style={{
          // Sampled: center-top radial lift (#13314E) behind the headline + a
          // faint green-teal bloom in the upper-right corner, over the navy base.
          background:
            "radial-gradient(70% 80% at 92% -8%, rgba(40,197,94,0.10) 0%, rgba(40,197,94,0) 58%), radial-gradient(120% 90% at 50% -10%, #13314E 0%, rgba(19,49,78,0) 60%), linear-gradient(165deg, #0B1A2F 0%, #0E2236 55%, #0A1B30 100%)",
          textAlign: "center",
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            // Sampled from the design: an outlined pill (hairline border +
            // ~3% white fill over navy) with a green dot and cool steel text —
            // not green text.
            padding: "6px 13px 6px 11px",
            borderRadius: 999,
            border: "1px solid rgba(159,180,210,0.18)",
            background: "rgba(255,255,255,0.03)",
            fontSize: 11.5,
            fontWeight: 700,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "#C5D2E4",
            marginBottom: 20,
          }}
        >
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: GREEN }} />
          Security &amp; trust
        </span>
        <h1
          style={{
            fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
            fontSize: "clamp(34px, 5vw, 56px)",
            fontWeight: 700,
            letterSpacing: "-0.035em",
            color: "#FFFFFF",
            marginBottom: 18,
            lineHeight: 1.04,
          }}
        >
          Built for orders
          <br />
          you can&apos;t afford
          <br />
          to get wrong
        </h1>
        <p style={{ fontSize: 16, lineHeight: 1.6, color: "#C5D2E4", maxWidth: 560, margin: "0 auto" }}>
          ProcuLink sits between your buyers and suppliers. We treat that position —
          and your data — with the seriousness it deserves.
        </p>
      </section>

      {/* Property cards — 6 posture cards, 3-up grid with green top edge */}
      <section
        className="px-5 sm:px-8 pt-14 pb-12 sm:pt-[84px] sm:pb-14"
        style={{ background: "#FFFFFF" }}
      >
        <div style={{ maxWidth: 1160, margin: "0 auto" }}>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6">
            {PROPERTIES.map((prop) => (
              <div
                key={prop.label}
                style={{
                  background: "#FFFFFF",
                  border: "1px solid #E2E6EE",
                  borderTop: `3px solid ${GREEN_EDGE}`,
                  borderRadius: 12,
                  padding: "26px 24px 24px",
                  boxShadow: "0 1px 3px rgba(11,26,47,0.04)",
                }}
              >
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 9,
                    // Sampled mint tile from the render (~#E4F3E8) — a touch deeper
                    // than the previous value so the chip reads refined, not washed out.
                    background: "#E4F3E8",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: 18,
                  }}
                >
                  {prop.icon}
                </div>
                <h3
                  style={{
                    fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
                    fontSize: 17,
                    fontWeight: 600,
                    color: "#0B1A2F",
                    letterSpacing: "-0.015em",
                    margin: "0 0 10px",
                  }}
                >
                  {prop.label}
                </h3>
                <p style={{ fontSize: 14, lineHeight: 1.65, color: "#56627A", margin: 0 }}>
                  {prop.detail}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Compliance + Subprocessors — two-column list cards */}
      <section
        className="px-5 sm:px-8 py-14 sm:py-16"
        style={{ background: "#F6F7FA", borderTop: "1px solid #E2E6EE" }}
      >
        <div
          className="grid grid-cols-1 lg:grid-cols-2 gap-10 sm:gap-10"
          style={{ maxWidth: 1080, margin: "0 auto" }}
        >
          <div>
            <h2
              style={{
                fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
                fontSize: 22,
                fontWeight: 700,
                color: "#0B1A2F",
                letterSpacing: "-0.02em",
                margin: "0 0 18px",
              }}
            >
              Compliance
            </h2>
            <ListCard rows={COMPLIANCE_ROWS} />
          </div>
          <div>
            <h2
              style={{
                fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
                fontSize: 22,
                fontWeight: 700,
                color: "#0B1A2F",
                letterSpacing: "-0.02em",
                margin: "0 0 18px",
              }}
            >
              Subprocessors
            </h2>
            <ListCard rows={SUBPROCESSOR_ROWS} />
          </div>
        </div>
      </section>

      {/* Navy CTA band */}
      <section
        className="px-5 sm:px-8 py-16 sm:py-[72px]"
        style={{ background: "#0B1A2F", textAlign: "center" }}
      >
        <h2
          style={{
            fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
            fontSize: "clamp(26px, 3.5vw, 38px)",
            fontWeight: 700,
            letterSpacing: "-0.025em",
            color: "#FFFFFF",
            marginBottom: 14,
          }}
        >
          Need our security package?
        </h2>
        <p style={{ fontSize: 15.5, lineHeight: 1.6, color: "#C5D2E4", maxWidth: 520, margin: "0 auto 32px" }}>
          We&apos;ll share our SOC 2 progress, DPA, pen-test summary and
          architecture overview under NDA.
        </p>
        <div className="flex flex-col sm:flex-row flex-wrap gap-3 justify-center items-stretch sm:items-center">
          <a
            href="mailto:security@proculink.com?subject=Security%20package%20request"
            className="justify-center"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              borderRadius: 9,
              padding: "13px 26px",
              fontSize: 14.5,
              fontWeight: 600,
              // Sampled: primary action is buyer-blue (#1E66C9), not green.
              background: BUYER_BLUE,
              color: "#FFFFFF",
              textDecoration: "none",
            }}
          >
            Request security docs <span aria-hidden>→</span>
          </a>
          <Link
            href="/sign-up"
            className="justify-center"
            style={{
              display: "inline-flex",
              alignItems: "center",
              borderRadius: 9,
              padding: "13px 26px",
              fontSize: 14.5,
              fontWeight: 600,
              // Sampled: secondary is a solid dark-navy fill (#1D2D41) with a
              // hairline border, not a transparent outline button.
              background: "#1D2D41",
              color: "#FFFFFF",
              border: "1px solid #2A3A52",
              textDecoration: "none",
            }}
          >
            Start free
          </Link>
        </div>
      </section>
    </div>
  );
}
