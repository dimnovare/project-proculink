import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy — ProcuLink",
  description: "How ProcuLink collects, stores, and protects your data.",
};

const S = {
  page:    { maxWidth: 720, margin: "0 auto", padding: "56px 32px 80px" },
  h1:      { fontFamily: "'Bricolage Grotesque', Inter, sans-serif", fontSize: "clamp(28px, 4vw, 40px)", fontWeight: 700, letterSpacing: "-0.025em", color: "#0B1A2F", marginBottom: 8 },
  updated: { fontSize: 13, color: "#8A93A5", marginBottom: 40 },
  h2:      { fontFamily: "'Bricolage Grotesque', Inter, sans-serif", fontSize: 20, fontWeight: 600, color: "#0B1A2F", margin: "40px 0 12px", letterSpacing: "-0.015em" },
  p:       { fontSize: 14.5, lineHeight: 1.75, color: "#3D4A5C", marginBottom: 14 },
  li:      { fontSize: 14.5, lineHeight: 1.75, color: "#3D4A5C", marginBottom: 6 },
  table:   { width: "100%", borderCollapse: "collapse" as const, fontSize: 13.5, marginBottom: 20 },
  th:      { textAlign: "left" as const, padding: "8px 12px", background: "#F6F7FA", borderBottom: "1px solid #E2E6EE", color: "#0B1A2F", fontWeight: 600 },
  td:      { padding: "8px 12px", borderBottom: "1px solid #F1F3F7", color: "#3D4A5C" },
};

export default function PrivacyPage() {
  return (
    <div style={S.page}>
      <h1 style={S.h1}>Privacy Policy</h1>
      <p style={S.updated}>Last updated: May 2026</p>

      <h2 style={S.h2}>Who we are</h2>
      <p style={S.p}>
        ProcuLink OÜ (&quot;ProcuLink&quot;, &quot;we&quot;, &quot;us&quot;, &quot;our&quot;) operates the ProcuLink procurement
        automation platform at proculink.eu. Company registration: 17477775. Registered
        address: Katusepapi 6, Tallinn, Estonia.
      </p>

      <h2 style={S.h2}>What data we collect</h2>
      <ul style={{ paddingLeft: 20, marginBottom: 14 }}>
        <li style={S.li}><strong>Account data</strong> — name, work email, organisation name, collected via Clerk authentication on sign-up.</li>
        <li style={S.li}><strong>Order data</strong> — purchase order files you upload, canonical order data derived from those files, mapped and transformed output files.</li>
        <li style={S.li}><strong>Usage data</strong> — page views, feature interactions, error events, collected via product analytics.</li>
        <li style={S.li}><strong>Billing data</strong> — subscription plan and status, handled by Stripe. We never store your card numbers or payment credentials.</li>
        <li style={S.li}><strong>Email configuration</strong> — IMAP server credentials (host, port, username, password) for email ingestion features. Passwords are encrypted at rest using AES-256-GCM authenticated encryption.</li>
        <li style={S.li}><strong>Delivery credentials</strong> — webhook URLs and authentication tokens for supplier delivery configurations, encrypted at rest.</li>
      </ul>

      <h2 style={S.h2}>How we use your data</h2>
      <ul style={{ paddingLeft: 20, marginBottom: 14 }}>
        <li style={S.li}>To provide the ProcuLink service: parse, map, transform, and deliver your purchase orders.</li>
        <li style={S.li}>To send transactional emails such as order status notifications and billing receipts.</li>
        <li style={S.li}>To improve the product via aggregated, anonymised analytics.</li>
        <li style={S.li}>To comply with legal obligations, including tax records for invoiced subscriptions.</li>
      </ul>
      <p style={S.p}>We do not sell your data to third parties. We do not use your order content to train AI models.</p>

      <h2 style={S.h2}>Data storage and residency</h2>
      <p style={S.p}>Your data is stored in EU-region or EU-compliant infrastructure:</p>
      <ul style={{ paddingLeft: 20, marginBottom: 14 }}>
        <li style={S.li}><strong>Authentication</strong>: Clerk (US-based, EU data residency available on request)</li>
        <li style={S.li}><strong>File storage</strong>: Cloudflare R2 (EU-region bucket)</li>
        <li style={S.li}><strong>Database</strong>: PostgreSQL hosted on Railway (EU region)</li>
        <li style={S.li}><strong>Error monitoring</strong>: Sentry (EU region instance)</li>
        <li style={S.li}><strong>Frontend</strong>: Vercel (global CDN, source data stays in EU)</li>
      </ul>

      <h2 style={S.h2}>Data retention</h2>
      <ul style={{ paddingLeft: 20, marginBottom: 14 }}>
        <li style={S.li}>Active account data is retained while your account is active.</li>
        <li style={S.li}>Order files and output artifacts are retained for 90 days after order creation, then deleted from object storage.</li>
        <li style={S.li}>Account and billing data is deleted within 30 days of account closure on written request.</li>
        <li style={S.li}>Audit log entries are retained for the life of the account.</li>
      </ul>

      <h2 style={S.h2}>Your rights under GDPR</h2>
      <p style={S.p}>As an EU/EEA data subject you have the right to:</p>
      <ul style={{ paddingLeft: 20, marginBottom: 14 }}>
        <li style={S.li}><strong>Access</strong> the personal data we hold about you</li>
        <li style={S.li}><strong>Rectification</strong> of inaccurate data</li>
        <li style={S.li}><strong>Erasure</strong> (&quot;right to be forgotten&quot;) where no overriding legal basis exists</li>
        <li style={S.li}><strong>Data portability</strong> — receive your data in a structured, machine-readable format</li>
        <li style={S.li}><strong>Objection</strong> to processing based on legitimate interests</li>
        <li style={S.li}><strong>Restriction</strong> of processing where accuracy is contested or objection is pending</li>
      </ul>
      <p style={S.p}>
        To exercise any of these rights, email{" "}
        <a href="mailto:privacy@proculink.eu" style={{ color: "#2E8E3A" }}>privacy@proculink.eu</a>.
        We aim to respond within 30 days.
      </p>

      <h2 style={S.h2}>Cookies</h2>
      <p style={S.p}>
        We use only functional cookies (authentication session, CSRF protection) and analytics
        cookies (product usage — anonymised). We do not use advertising or cross-site tracking cookies.
      </p>

      <h2 style={S.h2}>Subprocessors</h2>
      <p style={S.p}>
        The authoritative list of subprocessors is maintained at{" "}
        <Link href="/subprocessors" style={{ color: "#2E8E3A" }}>/subprocessors</Link>{" "}
        with a 30-day change-notification commitment. The current snapshot:
      </p>
      <table style={S.table}>
        <thead>
          <tr>
            <th style={S.th}>Processor</th>
            <th style={S.th}>Purpose</th>
            <th style={S.th}>Location</th>
          </tr>
        </thead>
        <tbody>
          {[
            ["Clerk",         "Authentication and session management",  "US / EU"],
            ["Stripe",        "Payment processing and subscriptions",   "US"],
            ["Railway",       "API hosting and database",               "EU"],
            ["Cloudflare R2", "Order file and artifact storage",        "EU"],
            ["Vercel",        "Frontend hosting",                       "Global CDN"],
            ["Sentry",        "Error monitoring and diagnostics",       "EU"],
          ].map(([proc, purpose, loc]) => (
            <tr key={proc}>
              <td style={S.td}>{proc}</td>
              <td style={S.td}>{purpose}</td>
              <td style={S.td}>{loc}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 style={S.h2}>Contact and DPO</h2>
      <p style={S.p}>
        For privacy questions or to exercise your rights:{" "}
        <a href="mailto:privacy@proculink.eu" style={{ color: "#2E8E3A" }}>privacy@proculink.eu</a>
        <br />
        General support: <a href="mailto:support@proculink.eu" style={{ color: "#2E8E3A" }}>support@proculink.eu</a>
        <br />
        Registered address: ProcuLink OÜ, Katusepapi 6, Tallinn, Estonia
      </p>

      <p style={{ ...S.p, marginTop: 40, paddingTop: 24, borderTop: "1px solid #E2E6EE" }}>
        <Link href="/terms" style={{ color: "#2E8E3A", marginRight: 16 }}>Terms of Service</Link>
        <Link href="/security" style={{ color: "#2E8E3A", marginRight: 16 }}>Security</Link>
        <Link href="/support" style={{ color: "#2E8E3A" }}>Support</Link>
      </p>
    </div>
  );
}
