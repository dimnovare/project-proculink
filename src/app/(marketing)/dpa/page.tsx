import { pageMetadata } from "@/lib/seo";
import Link from "next/link";
import { LEGAL_ENTITY, LEGAL_ENTITY_REFERENCE } from "@/lib/legal-entity";
import { LegalPageLinks } from "@/components/marketing/LegalPageLinks";

export const metadata = pageMetadata({
  path: "/dpa",
  title: "Data Processing Addendum — ProcuLink",
  description:
    "The GDPR Article 28 Data Processing Addendum for ProcuLink customers: controller and processor roles, categories of data and data subjects, sub-processors, and the security measures we commit to.",
  ogDescription:
    "GDPR Article 28 Data Processing Addendum for ProcuLink customers — roles, data categories, sub-processors, and security measures.",
});

const S = {
  page:    { maxWidth: 760, margin: "0 auto", padding: "56px 32px 80px" },
  h1:      { fontFamily: "'Bricolage Grotesque', Inter, sans-serif", fontSize: "clamp(28px, 4vw, 40px)", fontWeight: 700, letterSpacing: "-0.025em", color: "#0B1A2F", marginBottom: 8 },
  updated: { fontSize: 13, color: "var(--ink-faint)", marginBottom: 40 },
  intro:   { fontSize: 15.5, lineHeight: 1.7, color: "#56627A", marginBottom: 40 },
  h2:      { fontFamily: "'Bricolage Grotesque', Inter, sans-serif", fontSize: 20, fontWeight: 600, color: "#0B1A2F", margin: "40px 0 12px", letterSpacing: "-0.015em" },
  h3:      { fontFamily: "'Bricolage Grotesque', Inter, sans-serif", fontSize: 16, fontWeight: 600, color: "#0B1A2F", margin: "24px 0 8px" },
  p:       { fontSize: 14.5, lineHeight: 1.75, color: "#3D4A5C", marginBottom: 14 },
  li:      { fontSize: 14.5, lineHeight: 1.75, color: "#3D4A5C", marginBottom: 6 },
  callout: { background: "#F6F7FA", border: "1px solid #E2E6EE", borderLeft: "3px solid #2E8E3A", borderRadius: 8, padding: "16px 18px", margin: "16px 0 24px", fontSize: 13.5, lineHeight: 1.6, color: "#3D4A5C" },
};

export default function DpaPage() {
  return (
    <div style={S.page}>
      <h1 style={S.h1}>Data Processing Addendum</h1>
      <p style={S.updated}>Effective: July 2026 · Version 1.2</p>

      <p style={S.intro}>
        This Data Processing Addendum (&quot;DPA&quot;) forms part of the agreement between{" "}
        {LEGAL_ENTITY.legalName}, operator of the ProcuLink service (the &quot;Processor&quot;),
        and the customer organisation (the &quot;Controller&quot;)
        for the processing of personal data under the EU General Data Protection
        Regulation 2016/679 (&quot;GDPR&quot;).
      </p>

      <div style={S.callout}>
        <strong>For customers who need a counter-signed DPA:</strong> email{" "}
        <a href="mailto:legal@proculink.eu" style={{ color: "#1E6D29", textDecoration: "underline" }}>legal@proculink.eu</a>{" "}
        with your organisation&apos;s legal name and the contact for signature. That inbox
        reaches us directly. Counter-signing is done by hand rather than by a signing desk, so
        treat the turnaround as a target and not a service level: we aim to return a
        counter-signed PDF within 5 business days, and if a request will take longer we will
        say so when we acknowledge it.
      </div>

      <h2 style={S.h2}>1. Definitions</h2>
      <p style={S.p}>
        Capitalised terms used but not defined here have the meaning given in the GDPR.
        &quot;Service&quot; means the ProcuLink procurement automation platform as described in
        the <Link href="/terms" style={{ color: "#1E6D29", textDecoration: "underline" }}>Terms of Service</Link>.
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
        <li style={S.li}>Use sub-processors only as listed in <strong>Annex III</strong>, and publish any addition or replacement — with the date it takes effect — at least 30 days before it starts processing Controller data.</li>
        <li style={S.li}>Assist the Controller in responding to data-subject rights requests under GDPR Chapter III.</li>
        <li style={S.li}>Notify the Controller without undue delay (within 72 hours of awareness) of any personal data breach affecting the Controller&apos;s data.</li>
        <li style={S.li}>On termination, delete or return all Controller personal data within the retention windows in the <Link href="/privacy" style={{ color: "#1E6D29", textDecoration: "underline" }}>Privacy Policy</Link>.</li>
        <li style={S.li}>Make available the information necessary to demonstrate compliance with GDPR Art. 28(3).</li>
      </ul>

      {/*
        This clause used to open "All Controller personal data is processed in EU-region or
        EU-compliant infrastructure". Two defects, in a contract:

          • "All ... processed in EU-region" is false. Sub-processors in the United States
            receive Controller personal data as a matter of routine, not as an exception:
            OpenAI receives purchase-order content (no base-URL override exists at any call
            site, so traffic reaches api.openai.com), and Postmark carries the outbound
            purchase order itself as an email attachment over api.postmarkapp.com.
          • "EU-compliant infrastructure" is not a defined term in the GDPR or anywhere in
            this document, so it carried the false half of the sentence past a careful
            reader. A transfer outside the EEA is lawful under SCCs — which is what the
            second sentence already said correctly, and still says.

        The clause now states the transfers plainly and then applies the SCCs. An undisclosed
        transfer is the compliance problem; a disclosed one under Art. 46 safeguards is not.

        TWO THINGS THIS CLAUSE MUST KEEP, both found by refuting an earlier draft of it:

          • The SCC sentence stays a UNIVERSAL conditional — "where ANY sub-processor
            processes Controller personal data outside the EEA". A first attempt ended
            "…apply to those transfers", whose antecedent is the four categories named just
            above it. That silently dropped Art. 46 cover from Vercel, Sentry, PostHog,
            Cloudflare and Railway, and from any sub-processor added later — while §3 of this
            same document promises 30 days' notice of exactly such additions. Narrowing a
            self-executing safeguard into a closed list is a real reduction in a customer's
            protection, and it is invisible unless you read for it.

          • It asserts NO storage region. That first attempt opened "Controller personal data
            is stored in EU-region infrastructure", importing a frame from /security that
            does not survive the move: /security is about ORDER data, this document is about
            PERSONAL data, which is broader. Clerk holds account name, work email and
            organisation (Annex I, below) and /subprocessors puts Clerk in the US with EU
            residency "available" — not enabled. Stripe holds billing identity in the US;
            Postmark holds message content in the US. And under GDPR Art. 4(2) storage IS
            processing, so the sentence also contradicted the one after it. The clause now
            does the job a transfers clause exists to do and leaves residency to the pages
            that discuss it.
      */}
      <h2 style={S.h2}>4. International transfers</h2>
      <p style={S.p}>
        Sub-processors are listed, with their locations, on the{" "}
        <Link href="/subprocessors" style={{ color: "#1E6D29", textDecoration: "underline" }}>Subprocessors</Link>{" "}
        page. Some of them process Controller personal data outside the EEA: authentication,
        AI document extraction and mapping suggestions, payments, and email in both
        directions — including the outbound purchase order itself — are handled from the
        United States. Where any sub-processor processes Controller personal data outside
        the EEA, the relevant Standard Contractual Clauses (Commission Implementing
        Decision 2021/914) apply.
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
        {LEGAL_ENTITY_REFERENCE} · Contact:{" "}
        <a href="mailto:legal@proculink.eu" style={{ color: "#1E6D29", textDecoration: "underline" }}>legal@proculink.eu</a>
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
        plus the retention windows described in the <Link href="/privacy" style={{ color: "#1E6D29", textDecoration: "underline" }}>Privacy Policy</Link>.
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
        <li style={S.li}><strong>Sub-processor management</strong>: additions and replacements are published with their effective date at least 30 days in advance (see Annex III).</li>
      </ul>

      <h2 style={S.h2}>Annex III — Authorised sub-processors</h2>
      <p style={S.p}>
        The current list of authorised sub-processors is maintained at{" "}
        <Link href="/subprocessors" style={{ color: "#1E6D29", textDecoration: "underline" }}>/subprocessors</Link>.
        That page is the notice channel for this Annex: it carries the date the list last
        changed, any planned addition or replacement, the date that notice was published, and
        the date it takes effect. The Controller may raise an objection to a planned
        sub-processor within 14 days of the published notice date, in writing to{" "}
        <a href="mailto:legal@proculink.eu" style={{ color: "#1E6D29", textDecoration: "underline" }}>legal@proculink.eu</a>.
      </p>

      <LegalPageLinks
        links={[
          ["Privacy Policy", "/privacy"],
          ["Terms of Service", "/terms"],
          ["Subprocessors", "/subprocessors"],
          ["Security", "/security"],
        ]}
      />
    </div>
  );
}
