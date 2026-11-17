import { pageMetadata } from "@/lib/seo";
import Link from "next/link";
import { LEGAL_ENTITY, LEGAL_ENTITY_REFERENCE } from "@/lib/legal-entity";
import { Card } from "@/components/bridge/layout/Card";
import { LegalH2, LegalPage } from "@/components/marketing/LegalPage";

export const metadata = pageMetadata({
  path: "/dpa",
  title: "Data Processing Addendum — ProcuLink",
  description:
    "The GDPR Article 28 Data Processing Addendum for ProcuLink customers: controller and processor roles, categories of data and data subjects, sub-processors, and the security measures we commit to.",
  ogDescription:
    "GDPR Article 28 Data Processing Addendum for ProcuLink customers — roles, data categories, sub-processors, and security measures.",
});

export default function DpaPage() {
  return (
    // FOUNDER DECISION: set the effective month when this version is published. Revised from
    // an advisor's pilot review (2026-11): roles, breach notice, termination, Annex I/II.
    <LegalPage title="Data Processing Addendum" updated="Effective: November 2026 · Version 1.4" path="/dpa">
      <p>
        This Data Processing Addendum (&quot;DPA&quot;) forms part of the agreement between{" "}
        {LEGAL_ENTITY.legalName}, operator of the ProcuLink service (the &quot;Processor&quot;),
        and the customer organisation (the &quot;Controller&quot;)
        for the processing of personal data under the EU General Data Protection
        Regulation 2016/679 (&quot;GDPR&quot;).
      </p>

      <Card className="mb-6">
        <strong>For customers who need a counter-signed DPA:</strong> email{" "}
        <a href="mailto:legal@proculink.eu">legal@proculink.eu</a>{" "}
        with your organisation&apos;s legal name and the contact for signature. That inbox
        reaches us directly. Counter-signing is done by hand rather than by a signing desk, so
        treat the turnaround as a target and not a service level: we aim to return a
        counter-signed PDF within 5 business days, and if a request will take longer we will
        say so when we acknowledge it.
      </Card>

      <LegalH2>1. Definitions</LegalH2>
      <p>
        Capitalised terms used but not defined here have the meaning given in the GDPR.
        &quot;Service&quot; means the ProcuLink platform for business documents such as invoices,
        purchase orders and delivery notes, as described in
        the <Link href="/terms">Terms of Service</Link>.
      </p>

      <LegalH2>2. Roles and scope</LegalH2>
      <p>
        This DPA covers the personal data contained in the documents the Controller submits to
        the Service, in the files the Service makes from them, and in the records the
        Controller keeps in the Service. For that
        data the Controller determines the purposes and means of processing, and ProcuLink acts
        as processor: it processes the data only on the Controller&apos;s documented
        instructions as set out in this DPA and the Terms of Service.
      </p>
      <p>
        ProcuLink is itself the controller for the personal data it needs to run the customer
        relationship — website visits, user accounts and sign-in, billing and invoicing
        records, its own product analytics, error monitoring and security logs, and
        correspondence. That data is described in the{" "}
        <Link href="/privacy">Privacy Policy</Link>{" "}
        and is not covered by this DPA.
      </p>

      <LegalH2>3. Processor obligations (GDPR Art. 28)</LegalH2>
      <ul>
        <li>Process personal data only on documented instructions from the Controller.</li>
        <li>Ensure persons authorised to process personal data are under a duty of confidentiality.</li>
        <li>Implement the technical and organisational measures described in <strong>Annex II</strong>.</li>
        <li>Use sub-processors only as listed in <strong>Annex III</strong>, and publish any addition or replacement — with the date it takes effect — at least 30 days before it starts processing Controller data.</li>
        <li>Assist the Controller in responding to data-subject rights requests under GDPR Chapter III.</li>
        {/* "within 72 hours" was the CONTROLLER's own deadline to the authority (Art. 33(1))
            borrowed as the processor's — which, if used in full, leaves the Controller no time
            to make its own assessment. Art. 33(2) asks a processor for "without undue delay".
            FOUNDER DECISION: whether to add a contractual maximum; if one is added it must be
            well under 72 hours, so the Controller still has time for its own assessment. */}
        <li>Notify the Controller without undue delay after becoming aware of a personal data breach affecting the Controller&apos;s data, and give the Controller the information it needs to assess the breach and to meet its own obligations under GDPR Articles 33 and 34 — as soon as that information is available, in stages if necessary.</li>
        {/* Art. 28(3)(g): delete or return "at the choice of the controller". There is no
            automatic deletion at the end of the agreement (see /privacy "How long we keep
            data"), so the choice is exercised by request. FOUNDER DECISION: a defined
            post-termination deletion period, once a job exists to keep it. */}
        <li>After the agreement ends, delete the Controller personal data or keep it available for the Controller to download, at the Controller&apos;s choice, on the Controller&apos;s written request — unless EU or Member State law requires it to be kept. Data is not deleted automatically when the agreement ends; deletion is carried out on request as described in the <Link href="/privacy">Privacy Policy</Link>.</li>
        <li>Make available the information necessary to demonstrate compliance with GDPR Art. 28(3).</li>
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
      <LegalH2>4. International transfers</LegalH2>
      <p>
        Sub-processors are listed, with their locations, on the{" "}
        <Link href="/subprocessors">Subprocessors</Link>{" "}
        page. Some of them process Controller personal data outside the EEA: authentication,
        AI document extraction and mapping suggestions, payments, and email in both
        directions — including the files the Service emails out on the Controller&apos;s
        instruction — are handled from the United States. Where any sub-processor processes Controller personal data outside
        the EEA, the relevant Standard Contractual Clauses (Commission Implementing
        Decision 2021/914) apply.
      </p>

      <LegalH2>5. Audits</LegalH2>
      <p>
        On reasonable written request and no more than once per calendar year, ProcuLink will
        provide the Controller with a summary of its security and compliance controls. Onsite
        audits are not provided as standard; mutual non-disclosure terms apply to any audit
        information shared.
      </p>

      <LegalH2>Annex I — Parties and processing details</LegalH2>
      <h3>Controller</h3>
      <p>The customer organisation that accepts the Terms of Service.</p>

      <h3>Processor</h3>
      <p>
        {LEGAL_ENTITY_REFERENCE} · Contact:{" "}
        <a href="mailto:legal@proculink.eu">legal@proculink.eu</a>
      </p>

      <h3>Categories of data subjects</h3>
      <p>
        Employees and authorised users of the Controller; people named in the documents the
        Controller submits, such as contacts at its suppliers and customers; people who send
        documents to the Controller&apos;s ProcuLink address by email; and people in the
        records the Controller keeps in the Service.
      </p>

      {/* "Account data" and "usage data" moved OUT of this list: §2 now says ProcuLink is the
          controller for those (Privacy Policy). Users' names and emails stay in where they are
          recorded against workspace activity, because that is part of the Controller's
          workspace. The Service takes any business document (2026-11-17), so the list names
          what such documents typically carry and does not stop at one kind. Counsel to check
          this split. */}
      <h3>Categories of personal data</h3>
      <p>
        The content of submitted documents, whatever personal data they contain: typically
        contact names, email addresses, phone numbers and postal addresses, and bank account
        details such as IBAN and payment references. The email address a document was sent
        from. Records the Controller keeps in the Service. Names and work email addresses of
        the Controller&apos;s users where they are recorded against workspace activity — for
        example, who checked, changed or sent a document. Credentials the Controller
        configures for delivering and collecting documents.
      </p>

      <h3>Purpose and duration</h3>
      <p>
        Processing is for the provision of the Service. It runs for the term of the agreement
        and afterwards until the Controller personal data is deleted, as described in section 3
        and the <Link href="/privacy">Privacy Policy</Link>.
      </p>

      <LegalH2>Annex II — Technical and organisational measures</LegalH2>
      <ul>
        <li><strong>Encryption in transit</strong>: TLS 1.2+ for all client and inter-service traffic.</li>
        <li><strong>Encryption at rest</strong>: AES-256-GCM authenticated encryption for the credentials the Controller stores for collecting and delivering documents. Cloudflare R2 server-side encryption for stored document files.</li>
        <li><strong>Access control</strong>: Clerk-issued JWT authentication, organisation-scoped session isolation, every database query bound to the authenticated organisation id.</li>
        <li><strong>Logging and monitoring</strong>: Sentry error monitoring (EU region), with secrets removed from error reports; structured backend logging; a record of what happened to each document and of changes made in the workspace.</li>
        {/* Was "Daily automated PostgreSQL backups with point-in-time recovery". Neon does not
            take daily backups; it keeps a continuous point-in-time history for a restore window
            set by the plan, and nothing in either repo takes a separate backup (no pg_dump job,
            no backup workflow). FOUNDER DECISION: read the restore window off the Neon
            dashboard and state it here if wanted. */}
        <li><strong>Backups</strong>: The database provider keeps a continuous point-in-time history of the PostgreSQL database, so it can be restored to an earlier moment within a rolling recovery window. Data deleted from the database drops out of that history once it is older than the window; no separate long-term backup copies are kept.</li>
        <li><strong>Personnel</strong>: All personnel with access to production data are under written confidentiality obligations.</li>
        {/* Was "Documented breach-notification process; target 72-hour Controller
            notification". No breach runbook exists in either repo, so "documented" was a claim
            nothing backed, and 72 hours is the wrong deadline (see section 3).
            FOUNDER DECISION: write the incident/breach runbook; then "documented" can return. */}
        <li><strong>Incident response</strong>: On becoming aware of a personal-data breach, we notify the Controller without undue delay and share what we know as it becomes available, as set out in section 3.</li>
        <li><strong>Sub-processor management</strong>: additions and replacements are published with their effective date at least 30 days in advance (see Annex III).</li>
      </ul>

      <LegalH2>Annex III — Authorised sub-processors</LegalH2>
      <p>
        The current list of authorised sub-processors is maintained at{" "}
        <Link href="/subprocessors">/subprocessors</Link>.
        That page is the notice channel for this Annex: it carries the date the list last
        changed, any planned addition or replacement, the date that notice was published, and
        the date it takes effect. The Controller may raise an objection to a planned
        sub-processor within 14 days of the published notice date, in writing to{" "}
        <a href="mailto:legal@proculink.eu">legal@proculink.eu</a>.
      </p>
    </LegalPage>
  );
}
