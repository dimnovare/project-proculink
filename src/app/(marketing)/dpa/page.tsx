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
      {/* FOUNDER DECISION: set the effective month when this version is published. Revised from
          an advisor's pilot review (2026-11): roles, breach notice, termination, Annex I/II. */}
      <p style={S.updated}>Effective: November 2026 · Version 1.3</p>

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
        &quot;Service&quot; means the ProcuLink platform for business documents such as purchase
        orders and invoices, as described in
        the <Link href="/terms" style={{ color: "#1E6D29", textDecoration: "underline" }}>Terms of Service</Link>.
      </p>

      <h2 style={S.h2}>2. Roles and scope</h2>
      <p style={S.p}>
        This DPA covers the personal data contained in the documents the Controller submits to
        the Service — purchase orders, and invoices while invoices are in early access — and in
        the supplier, buyer and contact records the Controller keeps in the Service. For that
        data the Controller determines the purposes and means of processing, and ProcuLink acts
        as processor: it processes the data only on the Controller&apos;s documented
        instructions as set out in this DPA and the Terms of Service.
      </p>
      <p style={S.p}>
        ProcuLink is itself the controller for the personal data it needs to run the customer
        relationship — website visits, user accounts and sign-in, billing and invoicing
        records, its own product analytics, error monitoring and security logs, and
        correspondence. That data is described in the{" "}
        <Link href="/privacy" style={{ color: "var(--brand-green-deep)", textDecoration: "underline" }}>Privacy Policy</Link>{" "}
        and is not covered by this DPA.
      </p>

      <h2 style={S.h2}>3. Processor obligations (GDPR Art. 28)</h2>
      <ul style={{ paddingLeft: 20, marginBottom: 14 }}>
        <li style={S.li}>Process personal data only on documented instructions from the Controller.</li>
        <li style={S.li}>Ensure persons authorised to process personal data are under a duty of confidentiality.</li>
        <li style={S.li}>Implement the technical and organisational measures described in <strong>Annex II</strong>.</li>
        <li style={S.li}>Use sub-processors only as listed in <strong>Annex III</strong>, and publish any addition or replacement — with the date it takes effect — at least 30 days before it starts processing Controller data.</li>
        <li style={S.li}>Assist the Controller in responding to data-subject rights requests under GDPR Chapter III.</li>
        {/* "within 72 hours" was the CONTROLLER's own deadline to the authority (Art. 33(1))
            borrowed as the processor's — which, if used in full, leaves the Controller no time
            to make its own assessment. Art. 33(2) asks a processor for "without undue delay".
            FOUNDER DECISION: whether to add a contractual maximum; if one is added it must be
            well under 72 hours, so the Controller still has time for its own assessment. */}
        <li style={S.li}>Notify the Controller without undue delay after becoming aware of a personal data breach affecting the Controller&apos;s data, and give the Controller the information it needs to assess the breach and to meet its own obligations under GDPR Articles 33 and 34 — as soon as that information is available, in stages if necessary.</li>
        {/* Art. 28(3)(g): delete or return "at the choice of the controller". There is no
            automatic deletion at the end of the agreement (see /privacy "How long we keep
            data"), so the choice is exercised by request. FOUNDER DECISION: a defined
            post-termination deletion period, once a job exists to keep it. */}
        <li style={S.li}>After the agreement ends, delete the Controller personal data or keep it available for the Controller to download, at the Controller&apos;s choice, on the Controller&apos;s written request — unless EU or Member State law requires it to be kept. Data is not deleted automatically when the agreement ends; deletion is carried out on request as described in the <Link href="/privacy" style={{ color: "#1E6D29", textDecoration: "underline" }}>Privacy Policy</Link>.</li>
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
      <p style={S.p}>
        Employees and authorised users of the Controller; contacts at the Controller&apos;s
        suppliers, buyers and customers who are named in documents (such as purchase orders and
        invoices) submitted by the Controller, or in the records the Controller keeps in the
        Service.
      </p>

      {/* "Account data" and "usage data" moved OUT of this list: §2 now says ProcuLink is the
          controller for those (Privacy Policy). Users' names and emails stay in where they are
          recorded against workspace activity, because that is part of the Controller's
          workspace. Invoices are read today (UBL upload, early access), so what an invoice can
          carry is listed. Counsel to check this split. */}
      <h3 style={S.h3}>Categories of personal data</h3>
      <p style={S.p}>
        The content of submitted documents: on purchase orders, contact names, email addresses,
        phone numbers and postal and delivery addresses of the Controller&apos;s suppliers,
        buyers and customers; on invoices, the same contact details for suppliers and vendors,
        plus bank account details such as IBAN and payment references. Supplier, buyer and
        contact records the Controller keeps in the Service. Names and work email addresses of
        the Controller&apos;s users where they are recorded against workspace activity — for
        example, who approved or sent an order. Credentials the Controller configures for
        delivering and collecting documents.
      </p>

      <h3 style={S.h3}>Purpose and duration</h3>
      <p style={S.p}>
        Processing is for the provision of the Service. It runs for the term of the agreement
        and afterwards until the Controller personal data is deleted, as described in section 3
        and the <Link href="/privacy" style={{ color: "#1E6D29", textDecoration: "underline" }}>Privacy Policy</Link>.
      </p>

      <h2 style={S.h2}>Annex II — Technical and organisational measures</h2>
      <ul style={{ paddingLeft: 20, marginBottom: 14 }}>
        <li style={S.li}><strong>Encryption in transit</strong>: TLS 1.2+ for all client and inter-service traffic.</li>
        <li style={S.li}><strong>Encryption at rest</strong>: AES-256-GCM authenticated encryption for delivery credentials and IMAP passwords. Cloudflare R2 server-side encryption for stored document files.</li>
        <li style={S.li}><strong>Access control</strong>: Clerk-issued JWT authentication, organisation-scoped session isolation, every database query bound to the authenticated organisation id.</li>
        <li style={S.li}><strong>Logging and monitoring</strong>: Sentry error monitoring (EU region) without PII leakage; structured backend logging; audit trail for status transitions, delivery attempts, and mapping changes.</li>
        {/* Was "Daily automated PostgreSQL backups with point-in-time recovery". Neon does not
            take daily backups; it keeps a continuous point-in-time history for a restore window
            set by the plan, and nothing in either repo takes a separate backup (no pg_dump job,
            no backup workflow). FOUNDER DECISION: read the restore window off the Neon
            dashboard and state it here if wanted. */}
        <li style={S.li}><strong>Backups</strong>: The database provider keeps a continuous point-in-time history of the PostgreSQL database, so it can be restored to an earlier moment within a rolling recovery window. Data deleted from the database drops out of that history once it is older than the window; no separate long-term backup copies are kept.</li>
        <li style={S.li}><strong>Personnel</strong>: All personnel with access to production data are under written confidentiality obligations.</li>
        {/* Was "Documented breach-notification process; target 72-hour Controller
            notification". No breach runbook exists in either repo, so "documented" was a claim
            nothing backed, and 72 hours is the wrong deadline (see section 3).
            FOUNDER DECISION: write the incident/breach runbook; then "documented" can return. */}
        <li style={S.li}><strong>Incident response</strong>: On becoming aware of a personal-data breach, we notify the Controller without undue delay and share what we know as it becomes available, as set out in section 3.</li>
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
