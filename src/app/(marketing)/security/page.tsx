import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Security — ProcuLink",
  description: "How ProcuLink is designed to protect your purchase order data.",
};

const S = {
  page:    { maxWidth: 720, margin: "0 auto", padding: "56px 32px 80px" },
  h1:      { fontFamily: "'Bricolage Grotesque', Inter, sans-serif", fontSize: "clamp(28px, 4vw, 40px)", fontWeight: 700, letterSpacing: "-0.025em", color: "#0B1A2F", marginBottom: 8 },
  intro:   { fontSize: 15.5, lineHeight: 1.7, color: "#56627A", marginBottom: 40, maxWidth: 560 },
  h2:      { fontFamily: "'Bricolage Grotesque', Inter, sans-serif", fontSize: 20, fontWeight: 600, color: "#0B1A2F", margin: "44px 0 12px", letterSpacing: "-0.015em" },
  p:       { fontSize: 14.5, lineHeight: 1.75, color: "#3D4A5C", marginBottom: 14 },
  li:      { fontSize: 14.5, lineHeight: 1.75, color: "#3D4A5C", marginBottom: 6 },
  card:    {
    background: "#FFFFFF",
    border: "1px solid #E2E6EE",
    borderRadius: 10,
    padding: "20px 20px 18px",
    boxShadow: "0 1px 3px rgba(11,26,47,0.04)",
  },
};

const PROPERTIES = [
  {
    label: "Encryption",
    color: "#1E66C9",
    bg: "#E3EDFB",
    detail: "TLS 1.2+ in transit. AES-256-GCM authenticated encryption for delivery credentials and email passwords at rest. Cloudflare R2 server-side encryption for stored files.",
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="#1E66C9" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="8" width="14" height="9" rx="2" />
        <path d="M5 8V5.5a4 4 0 0 1 8 0V8" />
        <circle cx="9" cy="12.5" r="1.2" fill="#1E66C9" stroke="none" />
      </svg>
    ),
  },
  {
    label: "Authentication",
    color: "#2E8E3A",
    bg: "#E2F1E2",
    detail: "Powered by Clerk — industry-standard authentication with MFA support. API access is JWT-authenticated with short-lived tokens. Organisation-based session isolation.",
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="#2E8E3A" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="9" cy="6" r="3.5" />
        <path d="M2.5 16c0-3.314 2.91-6 6.5-6s6.5 2.686 6.5 6" />
        <path d="M12 13l1.5 1.5L16 12" />
      </svg>
    ),
  },
  {
    label: "Data Isolation",
    color: "#0F4FA8",
    bg: "#E3EDFB",
    detail: "Every database query in ProcuLink is scoped to the authenticated organisation. No query can return data belonging to a different organisation. Cross-tenant access is not possible.",
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="#0F4FA8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="2" width="6" height="6" rx="1.5" />
        <rect x="10" y="2" width="6" height="6" rx="1.5" />
        <rect x="2" y="10" width="6" height="6" rx="1.5" />
        <rect x="10" y="10" width="6" height="6" rx="1.5" />
      </svg>
    ),
  },
  {
    label: "Audit Trail",
    color: "#C97A14",
    bg: "#FAEFD6",
    detail: "All order status transitions, delivery attempts, mapping changes, and resolve events are logged with timestamps. Audit records are retained for the life of the account.",
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="#C97A14" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 4h10a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
        <path d="M6 8h6M6 11h4" />
      </svg>
    ),
  },
];

export default function SecurityPage() {
  return (
    <div style={S.page}>
      <h1 style={S.h1}>Security</h1>
      <p style={S.intro}>
        ProcuLink is designed for B2B procurement teams handling commercially sensitive
        purchase orders. Here&apos;s how we&apos;re built to protect your data.
      </p>

      {/* Property cards 2×2 */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 16,
          marginBottom: 16,
        }}
      >
        {PROPERTIES.map((prop) => (
          <div key={prop.label} style={{ ...S.card, borderLeft: `3px solid ${prop.color}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 7,
                  background: prop.bg,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                {prop.icon}
              </div>
              <span
                style={{
                  fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
                  fontSize: 14,
                  fontWeight: 600,
                  color: "#0B1A2F",
                  letterSpacing: "-0.01em",
                }}
              >
                {prop.label}
              </span>
            </div>
            <p style={{ fontSize: 13, lineHeight: 1.65, color: "#56627A", margin: 0 }}>
              {prop.detail}
            </p>
          </div>
        ))}
      </div>

      <h2 style={S.h2}>Infrastructure</h2>
      <ul style={{ paddingLeft: 20, marginBottom: 14 }}>
        <li style={S.li}><strong>API</strong>: Hosted on Railway, EU region, with automated scaling and health checks.</li>
        <li style={S.li}><strong>Database</strong>: PostgreSQL on Railway with automated daily backups and point-in-time recovery.</li>
        <li style={S.li}><strong>File storage</strong>: Cloudflare R2, EU-region bucket, with server-side encryption. Files are accessed via short-lived signed URLs.</li>
        <li style={S.li}><strong>Frontend</strong>: Hosted on Vercel with global CDN. Source data never passes through CDN edge nodes.</li>
        <li style={S.li}><strong>Credentials</strong>: No delivery credentials, IMAP passwords, or API keys are stored in plaintext anywhere in the system.</li>
      </ul>

      <h2 style={S.h2}>Responsible disclosure</h2>
      <p style={S.p}>
        If you discover a security vulnerability in ProcuLink, please report it to{" "}
        <a href="mailto:security@proculink.com" style={{ color: "#1E66C9" }}>security@proculink.com</a>{" "}
        with a description of the issue and steps to reproduce. We aim to respond within
        48 hours and to address critical issues within 7 days. We appreciate responsible
        disclosure and will not pursue legal action for good-faith security research.
      </p>

      <h2 style={S.h2}>Compliance</h2>
      <p style={S.p}>
        ProcuLink processes personal data in accordance with the EU General Data Protection
        Regulation (GDPR). See our{" "}
        <Link href="/privacy" style={{ color: "#1E66C9" }}>Privacy Policy</Link> for full
        details on data processing, subprocessors, retention, and your rights as a data subject.
      </p>

      <p style={{ ...S.p, marginTop: 40, paddingTop: 24, borderTop: "1px solid #E2E6EE" }}>
        <Link href="/privacy" style={{ color: "#1E66C9", marginRight: 16 }}>Privacy Policy</Link>
        <Link href="/terms" style={{ color: "#1E66C9", marginRight: 16 }}>Terms of Service</Link>
        <Link href="/support" style={{ color: "#1E66C9" }}>Support</Link>
      </p>
    </div>
  );
}
