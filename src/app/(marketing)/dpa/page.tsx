import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Data Processing Addendum — ProcuLink",
  description: "GDPR Article 28 Data Processing Addendum for ProcuLink customers.",
};

const S = {
  page:    { maxWidth: 760, margin: "0 auto", padding: "56px 32px 80px" },
  h1:      { fontFamily: "'Bricolage Grotesque', Inter, sans-serif", fontSize: "clamp(28px, 4vw, 40px)", fontWeight: 700, letterSpacing: "-0.025em", color: "#0B1A2F", marginBottom: 8 },
  updated: { fontSize: 13, color: "#8A93A5", marginBottom: 40 },
  intro:   { fontSize: 15.5, lineHeight: 1.7, color: "#56627A", marginBottom: 40 },
  h2:      { fontFamily: "'Bricolage Grotesque', Inter, sans-serif", fontSize: 20, fontWeight: 600, color: "#0B1A2F", margin: "40px 0 12px", letterSpacing: "-0.015em" },
  h3:      { fontFamily: "'Bricolage Grotesque', Inter, sans-serif", fontSize: 16, fontWeight: 600, color: "#0B1A2F", margin: "24px 0 8px" },
  p:       { fontSize: 14.5, lineHeight: 1.75, color: "#3D4A5C", marginBottom: 14 },
  li:      { fontSize: 14.5, lineHeight: 1.75, color: "#3D4A5C", marginBottom: 6 },
  callout: { background: "#F6F7FA", border: "1px solid #E2E6EE", borderLeft: "3px solid #28C55E", borderRadius: 8, padding: "16px 18px", margin: "16px 0 24px", fontSize: 13.5, lineHeight: 1.6, color: "#3D4A5C" },
};

export default function DpaPage() {
  return (
    <div style={S.page}>
      <h1 style={S.h1}>Data Processing Addendum</h1>
      <p style={S.updated}>Effective: May 2026 · Version 1.0</p>

      <p style={S.intro}>
        This Data Processing Addendum (&quot;DPA&quot;) forms part of the agreement between
        ProcuLink OÜ (the &quot;Processor&quot;) and the customer organisation (the &quot;Controller&quot;)
        for the processing of personal data under the EU General Data Protection
        Regulation 2016/679 (&quot;GDPR&quot;).
      </p>

      <div style={S.callout}>
        <strong>For customers who need a counter-signed DPA:</strong> Email{" "}
        <a href="mailto:legal@proculink.com" style={{ color: "#28C55E" }}>legal@proculink.com</a>{" "}
        and include your organisation legal name and contact for signature. We will return
        a counter-signed PDF within 5 business days.
      </div>

      <h2 style={S.h2}>1. Definitions</h2>
      <p style={S.p}>
        Capitalised terms used but not defined here have the meaning given in the GDPR.
        &quot;Service&quot; means the ProcuLink procurement automation platform as described in
        the <Link href="/terms" style={{ color: "#28C55E" }}>Terms of Service</Link>.
      </p>

      <h2 style={S.h2}>2. Roles and scope</h2>
      <p style={S.p}>
        The Controller determines the purposes and means of processing personal data
        submitted to the Service. ProcuLink processes personal data on the Controller&apos;s
        documented instructions as set out in this DPA and the Terms of Service.
      </p>

      <h2 style={S.h2}>3. Processor obligations (GDPR Art. 28)</h2>
      <ul style={{ paddingLeft: 20, marginBottom: 14 }}>
        <li style={S.li}>Process personal data only on documented instructions from the Controller.</li>
        <li style={S.li}>Ensure persons authorised to process personal data are under a duty of confidentiality.</li>
        <li style={S.li}>Implement the technical and organisational measures described in <strong>Annex II</strong>.</li>
        <li style={S.li}>Use sub-processors only as listed in <strong>Annex III</strong> and provide 30 days&apos; prior written notice of additions or replacements.</li>
        <li style={S.li}>Assist the Controller in responding to data-subject rights requests under GDPR Chapter III.</li>
        <li style={S.li}>Notify the Controller without undue delay (within 72 hours of awareness) of any personal data breach affecting the Controller&apos;s data.</li>
        <li style={S.li}>On termination, delete or return all Controller personal data within the retention windows in the <Link href="/privacy" style={{ color: "#28C55E" }}>Privacy Policy</Link>.</li>
        <li style={S.li}>Make available the information necessary to demonstrate compliance with GDPR Art. 28(3).</li>
      </ul>

      <h2 style={S.h2}>4. International transfers</h2>
      <p style={S.p}>
        All Controller personal data is processed in EU-region or EU-compliant infrastructure
        as described in the <Link href="/subprocessors" style={{ color: "#28C55E" }}>Subprocessors</Link>{" "}
        page. Where any sub-processor processes data outside the EEA, the relevant Standard
        Contractual Clauses (Commission Implementing Decision 2021/914) apply.
      </p>

      <h2 style={S.h2}>5. Audits</h2>
      <p style={S.p}>
        On reasonable written request and no more than once per calendar year, ProcuLink will
        provide the Controller with a summary of its security and compliance controls. Onsite
        audits are not provided as standard; mutual non-disclosure terms apply to any audit
        information shared.
      </p>

      <h2 style={S.h2}>Annex I — Parties and processing details</h2>
      <h3 style={S.h3}>Controller</h3>
      <p style={S.p}>The customer organisation that accepts the Terms of Service.</p>

      <h3 style={S.h3}>Processor</h3>
      <p style={S.p}>
        ProcuLink OÜ · Registration 17477775 · Katusepapi 6, Tallinn, Estonia · Contact:{" "}
        <a href="mailto:legal@proculink.com" style={{ color: "#28C55E" }}>legal@proculink.com</a>
      </p>

      <h3 style={S.h3}>Categories of data subjects</h3>
      <p style={S.p}>Employees and authorised users of the Controller; suppliers identified in purchase orders submitted by the Controller.</p>

      <h3 style={S.h3}>Categories of personal data</h3>
      <p style={S.p}>
        Account data (name, work email, organisation), purchase-order content (which may include
        contact names and emails for the Controller&apos;s suppliers), authentication tokens,
        and usage data.
      </p>

      <h3 style={S.h3}>Purpose and duration</h3>
      <p style={S.p}>
        Processing is for the provision of the Service and runs for the term of the agreement
        plus the retention windows described in the <Link href="/privacy" style={{ color: "#28C55E" }}>Privacy Policy</Link>.
      </p>

      <h2 style={S.h2}>Annex II — Technical and organisational measures</h2>
      <ul style={{ paddingLeft: 20, marginBottom: 14 }}>
        <li style={S.li}><strong>Encryption in transit</strong>: TLS 1.2+ for all client and inter-service traffic.</li>
        <li style={S.li}><strong>Encryption at rest</strong>: AES-256-GCM authenticated encryption for delivery credentials and IMAP passwords. Cloudflare R2 server-side encryption for stored order files.</li>
        <li style={S.li}><strong>Access control</strong>: Clerk-issued JWT authentication, organisation-scoped session isolation, every database query bound to the authenticated organisation id.</li>
        <li style={S.li}><strong>Logging and monitoring</strong>: Sentry error monitoring (EU region) without PII leakage; structured backend logging; audit trail for status transitions, delivery attempts, and mapping changes.</li>
        <li style={S.li}><strong>Backups</strong>: Daily automated PostgreSQL backups with point-in-time recovery.</li>
        <li style={S.li}><strong>Personnel</strong>: All personnel with access to production data are under written confidentiality obligations.</li>
        <li style={S.li}><strong>Incident response</strong>: Documented breach-notification process; target 72-hour Controller notification on confirmed personal-data breach.</li>
        <li style={S.li}><strong>Sub-processor management</strong>: 30 days&apos; prior written notice for additions or replacements (see Annex III).</li>
      </ul>

      <h2 style={S.h2}>Annex III — Authorised sub-processors</h2>
      <p style={S.p}>
        The current list of authorised sub-processors is maintained at{" "}
        <Link href="/subprocessors" style={{ color: "#28C55E" }}>/subprocessors</Link>. The
        Controller may subscribe to change notifications by emailing{" "}
        <a href="mailto:privacy@proculink.com" style={{ color: "#28C55E" }}>privacy@proculink.com</a>{" "}
        with the subject line &quot;Subprocessor notifications&quot;.
      </p>

      <p style={{ ...S.p, marginTop: 40, paddingTop: 24, borderTop: "1px solid #E2E6EE" }}>
        <Link href="/privacy" style={{ color: "#28C55E", marginRight: 16 }}>Privacy Policy</Link>
        <Link href="/terms" style={{ color: "#28C55E", marginRight: 16 }}>Terms of Service</Link>
        <Link href="/subprocessors" style={{ color: "#28C55E", marginRight: 16 }}>Subprocessors</Link>
        <Link href="/security" style={{ color: "#28C55E" }}>Security</Link>
      </p>
    </div>
  );
}
