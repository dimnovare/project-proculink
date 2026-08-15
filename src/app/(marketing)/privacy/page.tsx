import { pageMetadata } from "@/lib/seo";
import Link from "next/link";
import { LEGAL_ENTITY, PRODUCT_OPERATOR_NOTICE } from "@/lib/legal-entity";
import { SUBPROCESSORS } from "@/lib/subprocessors";
import { TableScroller } from "@/components/marketing/TableScroller";

export const metadata = pageMetadata({
  path: "/privacy",
  title: "Privacy Policy — ProcuLink",
  description:
    "What ProcuLink collects — account, order, usage, billing, email configuration and delivery credentials — how each is used, and how it is stored and protected.",
  ogDescription: "What data ProcuLink collects, how it is used, and how it is stored and protected.",
});

const S = {
  page:    { maxWidth: 720, margin: "0 auto", padding: "56px 32px 80px" },
  h1:      { fontFamily: "'Bricolage Grotesque', Inter, sans-serif", fontSize: "clamp(28px, 4vw, 40px)", fontWeight: 700, letterSpacing: "-0.025em", color: "#0B1A2F", marginBottom: 8 },
  updated: { fontSize: 13, color: "var(--ink-faint)", marginBottom: 40 },
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
      <p style={S.updated}>Last updated: 11 June 2026</p>

      <h2 style={S.h2}>Who we are</h2>
      <p style={S.p}>
        {PRODUCT_OPERATOR_NOTICE} In this policy, &quot;ProcuLink&quot;, &quot;we&quot;,
        &quot;us&quot;, and &quot;our&quot; refer to {LEGAL_ENTITY.legalName} as operator
        of the ProcuLink procurement automation platform at proculink.eu.
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
        <li style={S.li}>To improve the product via aggregated, pseudonymous product analytics.</li>
        <li style={S.li}>To comply with legal obligations, including tax records for invoiced subscriptions.</li>
      </ul>
      <p style={S.p}>We do not sell your data to third parties. We do not use your order content to train AI models.</p>

      {/*
        This section had one list under the heading "Data storage and residency", led by
        "Your data is stored in EU-region or EU-compliant infrastructure", and it named six
        providers. The three US providers that actually receive ORDER CONTENT — OpenAI,
        Stripe and Postmark — were all absent, on the one page whose job is to say where
        data goes. The omission mattered more than the wording did: a reader checking
        residency read a complete-looking list and could not have learned that the purchase
        order we email to their supplier is carried by a US provider.

        Split into STORED and PROCESSED, because they are different questions and one list
        cannot answer both. Every vendor below also appears in the full subprocessor table
        further down this page, which is generated from src/lib/subprocessors.ts — this list
        is organised by function rather than by vendor, so it is kept by hand and must be
        checked against that table whenever the list changes.
      */}
      {/*
        The lead-in is a plain enumeration, NOT an aggregate residency claim. Two reasons,
        both found by refuting an earlier draft:

          • It used to read "Your data is stored in EU-region or EU-compliant infrastructure",
            and the first correction shortened that to "…are stored in EU-region
            infrastructure". Dropping the disjunct made an UNSOURCED claim stronger with no
            new evidence, which is the exact failure that got FE #42 refuted. The per-vendor
            location strings below are inherited unchanged and are still unsourced for
            Railway, Neon and R2 — inheriting them is arguable, sharpening them is not.
          • The lead-in did not describe its own list anyway: Railway is compute, Sentry is
            error telemetry, and the Vercel bullet explicitly says order files do NOT pass
            through it. A sentence claiming the whole list is order storage was wrong about
            three of its five entries.
      */}
      <h2 style={S.h2}>Data storage and residency</h2>
      <p style={S.p}>These providers hold your order files, the database, and the API that serves them:</p>
      <ul style={{ paddingLeft: 20, marginBottom: 14 }}>
        <li style={S.li}><strong>File storage</strong>: Cloudflare R2 (EU-region bucket)</li>
        <li style={S.li}><strong>Database</strong>: PostgreSQL hosted on Neon (EU region)</li>
        <li style={S.li}><strong>API hosting</strong>: Railway (EU region)</li>
        <li style={S.li}><strong>Error monitoring</strong>: Sentry (EU region instance)</li>
        <li style={S.li}><strong>Frontend</strong>: Vercel (global CDN — order files do not pass through it)</li>
      </ul>
      <p style={S.p}>
        Some processing happens outside the EEA, under Standard Contractual Clauses. These
        providers are not a rare exception — they sit on the normal path an order takes:
      </p>
      <ul style={{ paddingLeft: 20, marginBottom: 14 }}>
        <li style={S.li}><strong>Authentication</strong>: Clerk (US-based, EU data residency available on request)</li>
        {/* NOT "self-hosted mode" — that phrasing was removed from /security in this same
            pass because nothing runs on customer infrastructure. Two pages describing the
            same flag two different ways is how the Postmark inbound/outbound defect got in. */}
        <li style={S.li}><strong>AI document extraction and mapping suggestions</strong>: OpenAI (US) — receives purchase-order content, unless we have turned AI extraction off for your organisation</li>
        <li style={S.li}><strong>Payments</strong>: Stripe (US, EU establishment) — billing data only, no order content</li>
        <li style={S.li}><strong>Email in and out</strong>: Postmark (US) — carries orders emailed to your ProcuLink address, and the purchase orders we email to your suppliers, as attachments</li>
      </ul>
      <p style={S.p}>
        Where your data is stored and the route it travels to reach your supplier are two
        different questions. The outbound network path is chosen by our hosting provider and
        is not pinned to a region by us, so we cannot tell you today which country an
        outbound delivery leaves from. The{" "}
        <Link href="/security" style={{ color: "var(--brand-green-deep)", textDecoration: "underline" }}>Security</Link>{" "}
        page explains this in full.
      </p>

      <h2 style={S.h2}>Data retention</h2>
      <ul style={{ paddingLeft: 20, marginBottom: 14 }}>
        <li style={S.li}>Active account data is retained while your account is active.</li>
        <li style={S.li}>Order files and output artifacts are retained for the life of the account by default. We delete order data on written request, and automated retention windows are on our roadmap.</li>
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
        <a href="mailto:privacy@proculink.eu" style={{ color: "var(--brand-green-deep)", textDecoration: "underline" }}>privacy@proculink.eu</a>.
        We aim to respond within 30 days.
      </p>

      <h2 style={S.h2}>Cookies</h2>
      <p style={S.p}>
        We use only functional cookies (authentication session, CSRF protection) and analytics
        cookies (product usage — pseudonymous). We do not use advertising or cross-site tracking cookies.
      </p>

      <h2 style={S.h2}>Subprocessors</h2>
      <p style={S.p}>
        The authoritative list of subprocessors is maintained at{" "}
        <Link href="/subprocessors" style={{ color: "var(--brand-green-deep)", textDecoration: "underline" }}>/subprocessors</Link>{" "}
        with a 30-day change-notification commitment. The current snapshot:
      </p>
      {/* This table needs 350px of min-content and the page's content box is 311px
          at a 375px viewport — it used to push the whole document sideways. See
          TableScroller for why the columns are scrolled rather than dropped. */}
      <TableScroller label="Subprocessors">
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Processor</th>
              <th style={S.th}>Purpose</th>
              <th style={S.th}>Location</th>
            </tr>
          </thead>
          <tbody>
            {SUBPROCESSORS.map((s) => (
              <tr key={s.name}>
                <td style={S.td}>{s.name}</td>
                <td style={S.td}>{s.purpose}</td>
                <td style={S.td}>{s.location}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroller>

      <h2 style={S.h2}>Contact and DPO</h2>
      <p style={S.p}>
        For privacy questions or to exercise your rights:{" "}
        <a href="mailto:privacy@proculink.eu" style={{ color: "var(--brand-green-deep)", textDecoration: "underline" }}>privacy@proculink.eu</a>
        <br />
        General support: <a href="mailto:support@proculink.eu" style={{ color: "var(--brand-green-deep)", textDecoration: "underline" }}>support@proculink.eu</a>
        <br />
        Registered address: {LEGAL_ENTITY.legalName}, {LEGAL_ENTITY.registeredAddress}
      </p>

      <p style={{ ...S.p, marginTop: 40, paddingTop: 24, borderTop: "1px solid #E2E6EE" }}>
        <Link href="/terms" style={{ color: "var(--brand-green-deep)", marginRight: 16 }}>Terms of Service</Link>
        <Link href="/security" style={{ color: "var(--brand-green-deep)", marginRight: 16 }}>Security</Link>
        <Link href="/support" style={{ color: "var(--brand-green-deep)" }}>Support</Link>
      </p>
    </div>
  );
}
