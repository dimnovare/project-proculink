import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Security — ProcuLink",
  description: "How ProcuLink is designed to protect your purchase order data.",
};

// Green accent (brand token): primary #28C55E, hover/deep #1DAF50, soft tint #DCFCE7.
const GREEN = "#28C55E";
const GREEN_DEEP = "#1DAF50";

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
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            padding: "16px 20px",
            borderTop: i === 0 ? "none" : "1px solid #EDF0F5",
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 600, color: "#0B1A2F", letterSpacing: "-0.01em" }}>{label}</span>
          <span style={{ fontSize: 13, color: "#56627A", textAlign: "right" }}>{note}</span>
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
        className="px-4 sm:px-8"
        style={{
          background:
            "radial-gradient(120% 90% at 50% -10%, #13314E 0%, rgba(19,49,78,0) 60%), linear-gradient(165deg, #0B1A2F 0%, #0E2236 55%, #0A1B30 100%)",
          padding: "80px 32px 72px",
          textAlign: "center",
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            fontSize: 11.5,
            fontWeight: 700,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "#9FE9BC",
            marginBottom: 18,
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
        className="px-4 sm:px-8"
        style={{ background: "#FFFFFF", padding: "64px 32px 56px" }}
      >
        <div style={{ maxWidth: 1160, margin: "0 auto" }}>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {PROPERTIES.map((prop) => (
              <div
                key={prop.label}
                style={{
                  background: "#FFFFFF",
                  border: "1px solid #E2E6EE",
                  borderTop: `3px solid ${GREEN}`,
                  borderRadius: 12,
                  padding: "28px 26px 26px",
                  boxShadow: "0 1px 3px rgba(11,26,47,0.04)",
                }}
              >
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 9,
                    // Design uses a very pale mint tile (~#EFF8F1), softer than the
                    // brand soft tint, so the icon chip reads refined, not stickered.
                    background: "#EDF7F0",
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
        className="px-4 sm:px-8"
        style={{ background: "#F6F7FA", padding: "64px 32px", borderTop: "1px solid #E2E6EE" }}
      >
        <div
          style={{
            maxWidth: 1080,
            margin: "0 auto",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
            gap: 40,
          }}
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

        <p
          style={{
            maxWidth: 1080,
            margin: "40px auto 0",
            fontSize: 13.5,
            lineHeight: 1.7,
            color: "#56627A",
            textAlign: "center",
          }}
        >
          ProcuLink processes personal data in accordance with the EU GDPR. See our{" "}
          <Link href="/privacy" style={{ color: GREEN_DEEP, fontWeight: 600 }}>Privacy Policy</Link> and{" "}
          <Link href="/subprocessors" style={{ color: GREEN_DEEP, fontWeight: 600 }}>Subprocessors</Link>{" "}
          for full details. To report a vulnerability, email{" "}
          <a href="mailto:security@proculink.com" style={{ color: GREEN_DEEP, fontWeight: 600 }}>security@proculink.com</a>{" "}
          — we respond within 48 hours.
        </p>
      </section>

      {/* Navy CTA band */}
      <section
        className="px-4 sm:px-8"
        style={{ background: "#0B1A2F", padding: "72px 32px", textAlign: "center" }}
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
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "center" }}>
          <a
            href="mailto:security@proculink.com?subject=Security%20package%20request"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              borderRadius: 9,
              padding: "13px 26px",
              fontSize: 14.5,
              fontWeight: 600,
              background: GREEN,
              color: "#06210F",
              textDecoration: "none",
            }}
          >
            Request security docs <span aria-hidden>→</span>
          </a>
          <Link
            href="/sign-up"
            style={{
              display: "inline-flex",
              alignItems: "center",
              borderRadius: 9,
              padding: "13px 26px",
              fontSize: 14.5,
              fontWeight: 600,
              background: "transparent",
              color: "#FFFFFF",
              border: "1px solid rgba(255,255,255,0.22)",
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
