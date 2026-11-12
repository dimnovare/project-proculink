import { pageMetadata } from "@/lib/seo";
import Link from "next/link";
import { LEGAL_ENTITY, PRODUCT_OPERATOR_NOTICE } from "@/lib/legal-entity";
import { SUBPROCESSORS } from "@/lib/subprocessors";
import { TableScroller } from "@/components/marketing/TableScroller";
import { LegalPageLinks } from "@/components/marketing/LegalPageLinks";

export const metadata = pageMetadata({
  path: "/privacy",
  title: "Privacy Policy — ProcuLink",
  description:
    "What ProcuLink collects — account, document, usage, billing, email configuration and delivery credentials — how each is used, how long it is kept, and how it is protected.",
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
      {/* FOUNDER DECISION: set this date to the day the page is published. */}
      <p style={S.updated}>Last updated: 12 November 2026</p>

      <h2 style={S.h2}>Who we are</h2>
      <p style={S.p}>
        {PRODUCT_OPERATOR_NOTICE} In this policy, &quot;ProcuLink&quot;, &quot;we&quot;,
        &quot;us&quot;, and &quot;our&quot; refer to {LEGAL_ENTITY.legalName} as operator
        of the ProcuLink platform at proculink.eu, which processes business documents such as
        purchase orders and invoices for businesses. ProcuLink is a service for business and
        professional use; it is not offered to consumers.
      </p>

      {/*
        Controller vs processor, stated once and early, because the rest of the page reads
        differently depending on which side of the line a piece of data is on. "Normally" is
        deliberate: a customer can ask us to use workspace data for something of our own (a
        support investigation they did not request, say), and that is a question for counsel,
        not a sentence this page should settle by omission.
      */}
      <h2 style={S.h2}>Our role: controller or processor</h2>
      <p style={S.p}>
        <strong>We are the controller</strong> for the personal data we need to run ProcuLink
        as a business: visits to this website, the accounts of the people who sign in, billing
        and invoicing records, our own product analytics and error monitoring, security logs,
        and the messages you send us. This policy describes that data.
      </p>
      <p style={S.p}>
        <strong>We are normally a processor</strong> for the personal data inside the documents
        our customers send us — purchase orders and invoices — and in the supplier, buyer and
        contact records they keep in their workspace. Our customer decides why that data is
        processed; we process it on their instructions, under the{" "}
        <Link href="/dpa" style={{ color: "var(--brand-green-deep)", textDecoration: "underline" }}>Data Processing Addendum</Link>.
        If your details reached us that way — for example, you are a contact named on a
        purchase order — the organisation that sent the document is the controller, and
        requests about that data are best made to them. If you contact us instead, we pass the
        request on and help them answer it.
      </p>

      <h2 style={S.h2}>What data we collect</h2>
      <ul style={{ paddingLeft: 20, marginBottom: 14 }}>
        <li style={S.li}><strong>Account data</strong> — name, work email, organisation name, collected via Clerk authentication on sign-up.</li>
        <li style={S.li}><strong>Document data</strong> — the purchase orders you send us, and invoices while invoices are in early access; the order and invoice data we extract from them; and the output files we generate. These documents can carry personal data: contact names, email addresses, phone numbers and delivery addresses, and on invoices also bank account details such as IBAN and payment references.</li>
        <li style={S.li}><strong>Workspace records</strong> — the suppliers, buyers and contacts you set up, with their names, email addresses and delivery settings.</li>
        <li style={S.li}><strong>Usage data</strong> — page views, feature interactions, error events, collected via product analytics.</li>
        <li style={S.li}><strong>Billing data</strong> — subscription plan and status, handled by Stripe. We never store your card numbers or payment credentials.</li>
        <li style={S.li}><strong>Email configuration</strong> — IMAP server credentials (host, port, username, password) for email ingestion features. Passwords are encrypted at rest using AES-256-GCM authenticated encryption.</li>
        <li style={S.li}><strong>Delivery credentials</strong> — webhook URLs and authentication tokens for supplier delivery configurations, encrypted at rest.</li>
      </ul>

      {/*
        Legal bases, one per purpose, for the data where we are CONTROLLER only. Document
        content is processed on the customer's instructions (DPA), so it has no basis of ours
        to list here — listing one would contradict the role section above.

        The two analytics legs have different bases ON PURPOSE, because they are different
        mechanisms: the browser SDK only loads after the cookie banner records
        "analytics-allowed" (src/lib/analytics.ts), while the backend's PostHogAnalyticsService
        records server-side events (supplier created, order parsed/delivered, plan changes) that
        no banner gates. Claiming consent for both would be false for the second.

        Counsel to check the wording of each basis; the mapping itself is the conventional one.
      */}
      <h2 style={S.h2}>How we use your data, and our legal basis</h2>
      <p style={S.p}>
        For the data we control, each use and the GDPR legal basis we rely on for it:
      </p>
      <ul style={{ paddingLeft: 20, marginBottom: 14 }}>
        <li style={S.li}><strong>Running your account and the service</strong> — signing you in, operating your organisation&apos;s workspace, and support. Basis: performance of our contract with your organisation (Art. 6(1)(b)), and, for the people your organisation adds as users, our legitimate interest in providing the service they use for work (Art. 6(1)(f)).</li>
        <li style={S.li}><strong>Service emails</strong> — such as order status notifications, billing receipts and notices about your account. Basis: performance of our contract (Art. 6(1)(b)).</li>
        <li style={S.li}><strong>Billing, invoicing and tax records</strong>. Basis: performance of our contract (Art. 6(1)(b)), and our legal obligation to keep accounting records (Art. 6(1)(c)).</li>
        <li style={S.li}><strong>Keeping the service secure and working</strong> — error monitoring, security and access logs, and preventing abuse. Basis: our legitimate interest in a secure, reliable service (Art. 6(1)(f)).</li>
        <li style={S.li}><strong>Product analytics in your browser</strong> — only if you accept analytics cookies in the cookie banner. Basis: your consent (Art. 6(1)(a)). You can withdraw it at any time: clear this site&apos;s cookies and stored data in your browser, and the banner asks again.</li>
        <li style={S.li}><strong>Pseudonymous service events</strong> recorded by our servers — for example, that a workspace added a supplier, processed an order or changed plan. Basis: our legitimate interest in understanding how the product is used, so we can improve it (Art. 6(1)(f)).</li>
        <li style={S.li}><strong>Answering enquiries and demo requests</strong>. Basis: our legitimate interest in responding to you, or steps you asked for before entering a contract (Art. 6(1)(f) and 6(1)(b)).</li>
        <li style={S.li}><strong>Meeting legal obligations and handling legal claims</strong>. Basis: legal obligation (Art. 6(1)(c)) and our legitimate interest in establishing or defending legal claims (Art. 6(1)(f)).</li>
      </ul>
      <p style={S.p}>
        Where we rely on legitimate interests, you can object, as described under &quot;Your
        rights&quot; below. We do not sell your data to third parties. We do not use the content
        of your documents to train AI models.
      </p>

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
      <p style={S.p}>These providers hold your document files, the database, and the API that serves them:</p>
      <ul style={{ paddingLeft: 20, marginBottom: 14 }}>
        <li style={S.li}><strong>File storage</strong>: Cloudflare R2 (EU-region bucket)</li>
        <li style={S.li}><strong>Database</strong>: PostgreSQL hosted on Neon (EU region)</li>
        <li style={S.li}><strong>API hosting</strong>: Railway (EU region)</li>
        <li style={S.li}><strong>Error monitoring</strong>: Sentry (EU region instance)</li>
        <li style={S.li}><strong>Frontend</strong>: Vercel (global CDN — document files do not pass through it)</li>
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
      {/*
        The no-AI mode, made operational. It is Organisation.SelfHostedOcr: honoured at every
        OpenAI call site (extraction, mapping suggestions, schema inference, inbound email) and
        it fails safe — but it has NO write site in the product, no endpoint and no settings
        screen. So this paragraph says exactly how a customer gets it (ask) and what changes
        (no AI steps, manual entry for what our parsers cannot read), and repeats /security's
        "does not change where your files are stored". Do not describe a switch here until one
        exists; do not attach it to a plan (legalCommitments.test.tsx pins both).
      */}
      <p style={S.p}>
        <strong>Turning AI off.</strong> If you do not want your documents sent to OpenAI, email{" "}
        <a href="mailto:support@proculink.eu" style={{ color: "var(--brand-green-deep)", textDecoration: "underline" }}>support@proculink.eu</a>{" "}
        and we will turn AI extraction off for your organisation and tell you when it is done.
        It is not a setting in the product; we switch it on our side. With it off, nothing about
        your orders reaches OpenAI: our own parsers read your documents, anything they cannot
        read is left for you to enter by hand, and AI mapping suggestions are not offered. It
        does not change where your files are stored.
      </p>
      <p style={S.p}>
        Where your data is stored and the route it travels to reach your supplier are two
        different questions. The outbound network path is chosen by our hosting provider and
        is not pinned to a region by us, so we cannot tell you today which country an
        outbound delivery leaves from. The{" "}
        <Link href="/security" style={{ color: "var(--brand-green-deep)", textDecoration: "underline" }}>Security</Link>{" "}
        page explains this in full.
      </p>

      {/*
        Every line here was re-derived from the backend (origin/main, 2026-11-04). What it
        replaced made two claims the product does not keep:

          • "Audit log entries are retained for the life of the account." FALSE in production.
            DataRetentionService is enabled on the Worker (DataRetention__Enabled=true) with the
            default windows in DataRetentionOptions: audit_events, po_passport_events,
            delivery_attempts (finished orders only) and resolved/ignored order_exceptions are
            deleted at 180 days; inbound_sender_domain is scrubbed at 365 days.
          • "A shorter automatic window can be set ... so that stored order files are removed."
            The per-workspace window (organisations.retention_days, set from /admin) exists, but
            BlobRetentionOptions.DryRun defaults to TRUE and nothing on the Worker sets
            Retention__DryRun, so the sweep only writes "would delete" rows. No file is removed.

        FOUNDER DECISION: automatic deletion after account closure. There is no closure trigger
        anywhere (no Clerk webhook, no subscription-end job), so nothing is deleted when a
        subscription ends; this section says so. If you want "deleted N days after closure",
        that needs a job built first — do not write the number until it exists.
        FOUNDER DECISION: arm the per-workspace file window (set Retention__DryRun=false on the
        Worker) and only then restore a sentence offering it.
        FOUNDER DECISION: confirm Neon's restore window for our plan from the Neon dashboard and,
        if wanted, print it in the backups line.
      */}
      <h2 style={S.h2}>How long we keep data</h2>
      <ul style={{ paddingLeft: 20, marginBottom: 14 }}>
        <li style={S.li}><strong>Workspace data</strong> — the documents you send us, the data we extract from them, the output files we generate, and your suppliers, mappings and settings — is kept for as long as your account exists. There is no automatic age limit on it today.</li>
        <li style={S.li}><strong>After a subscription ends or a Trial expires</strong>, nothing is deleted automatically. Your workspace stays readable, so you can sign in and view or download what you have processed for as long as it exists. There is no fixed export window: it stays until you ask us to delete it — see &quot;Deleting your data&quot; below.</li>
        <li style={S.li}><strong>Activity records</strong> — each order&apos;s processing timeline, the record of delivery attempts once an order is finished, resolved review flags, and the workspace audit log — are deleted automatically once they are 180 days old.</li>
        <li style={S.li}><strong>The sender domain</strong> we note when an order is emailed to your ProcuLink address, used to suggest which supplier it belongs to, is cleared after 12 months. The order itself stays.</li>
        <li style={S.li}><strong>Your sign-in account</strong> is held by our authentication provider while your account exists, and is removed when you ask us to delete your account.</li>
        <li style={S.li}><strong>Billing and tax records</strong> are kept for as long as accounting law requires, including after an account is deleted.</li>
        <li style={S.li}><strong>Backups.</strong> Our database provider keeps a rolling point-in-time history of the database so it can be recovered after a failure. Deleted data drops out of that history automatically once it is older than the provider&apos;s recovery window. We keep no separate long-term backup copies, and we do not restore deleted data from backups.</li>
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
        <li style={S.li}><strong>Withdraw consent</strong> where we rely on it, without affecting processing that happened before</li>
      </ul>
      <p style={S.p}>
        To exercise any of these rights, email{" "}
        <a href="mailto:privacy@proculink.eu" style={{ color: "var(--brand-green-deep)", textDecoration: "underline" }}>privacy@proculink.eu</a>.
        We respond within one month, which is the period the GDPR sets. If a request is
        complex we may extend that by up to two further months, and we will tell you inside
        the first month if we need to. For data we hold as a processor, see &quot;Our role&quot;
        above: we pass the request to the organisation that controls it.
      </p>
      <p style={S.p}>
        You also have the right to complain to a data protection supervisory authority. Ours is
        the Estonian Data Protection Inspectorate (Andmekaitse Inspektsioon, www.aki.ee); you
        can also complain to the authority in the EU or EEA country where you live or work, or
        where you think the problem happened. You do not have to contact us first.
      </p>

      <h2 style={S.h2}>Deleting your data</h2>
      <p style={S.p}>
        To have order data deleted, email{" "}
        <a href="mailto:privacy@proculink.eu" style={{ color: "var(--brand-green-deep)", textDecoration: "underline" }}>privacy@proculink.eu</a>{" "}
        from the address on your account and tell us which orders — a list of PO numbers, a
        number prefix, or a date range. We check that the address belongs to the workspace you
        name, and we confirm the scope with you in writing before anything is deleted. Deletion
        is run by us rather than from a button in the product, and it cannot be undone.
      </p>
      <p style={S.p}><strong>What gets deleted</strong></p>
      <ul style={{ paddingLeft: 20, marginBottom: 14 }}>
        <li style={S.li}>The document you sent us, as held in our file storage.</li>
        <li style={S.li}>The order content we extracted from it — line items, quantities, prices, and the names, addresses and contact details captured from the document.</li>
        <li style={S.li}>The output files we generated for your supplier.</li>
        <li style={S.li}>The processing and delivery history for those orders, and the mapping decisions recorded against them.</li>
      </ul>
      <p style={S.p}><strong>What we keep, and why</strong></p>
      <ul style={{ paddingLeft: 20, marginBottom: 14 }}>
        {/* FOUNDER DECISION: the per-order erase receipt (admin.order.erased /
            admin.orders.bulk_erased) is an audit_events row, and the 180-day prune in
            DataRetentionService does not exempt it — so the receipt itself goes at 180 days.
            Either accept that (this line says so) or exempt erase receipts from the prune in
            the backend, then change this line to the longer period. */}
        <li style={S.li}><strong>A note that the deletion happened</strong> — the date, who ran it, and how much it covered. It holds none of your order content. We keep it because we have to be able to demonstrate what we did and when, which is what GDPR Article 5(2) asks of us. It sits in the workspace audit log, so it is itself deleted once it is 180 days old.</li>
        <li style={S.li}><strong>Workspace configuration</strong> — suppliers, buyers, mappings, validation rules, output templates, and delivery settings with their stored credentials. These are settings rather than order content, so deleting orders leaves them in place and the workspace keeps working. Ask us if you want them removed as well; we do that by hand.</li>
        <li style={S.li}><strong>Billing and tax records</strong> — kept for as long as accounting law requires us to keep them.</li>
        <li style={S.li}><strong>A marker for orders collected from your own systems</strong> — where we picked a file up from your SFTP server or S3 bucket, we keep a note that the file was already handled, with its link to the deleted order cut. The file itself stays yours and we never remove it. Without that marker your file would simply be collected again and turned into a new order.</li>
        <li style={S.li}><strong>Backup copies</strong> — until they age out of our database provider&apos;s recovery window, as described under &quot;How long we keep data&quot;. We do not restore deleted order data from a backup.</li>
      </ul>
      {/* Invoices have NO erasure path on backend main: DataErasureService covers orders
          only, and the operator runbook (docs/ops/2026-08-18-gdpr-erasure-runbook.md §1)
          says invoices and their R2 blobs must be escalated. So this paragraph does not
          offer invoice deletion; it promises an answer, which is all we can deliver.
          FOUNDER DECISION: build invoice erasure before invoices leave early access. */}
      <p style={S.p}>
        Three things sit outside this. Invoices uploaded while invoices are in early access are
        not covered by this process yet: if your request includes invoices, say so and we will
        tell you in writing what we can remove. Your sign-in account is held by our
        authentication provider, and deleting order data does not remove it — ask us and we
        will. And a purchase order we have already sent to your supplier is in your
        supplier&apos;s systems from that point on, which we have no way to reach.
      </p>
      {/* FOUNDER DECISION: whole-account deletion. On backend main there is NO code path that
          deletes an Organisation row (runbook §1), so "we delete the workspace" can today only
          be done as bulk order erase + removing settings by hand, and leaves the organisation
          record and any invoices behind. Backend PR 265 (org erase, admin-only) closes that and
          is NOT merged. Merge PR 265 before publishing this paragraph, or soften it. The 30 days
          is inherited from the previous version of this page, not new. Note PR 265 writes its
          receipt to platform_audit_events, which the 180-day prune does not touch — so a
          whole-workspace receipt is kept with no end date; state its period once decided. */}
      <p style={S.p}>
        <strong>Closing your account.</strong> Ending a subscription does not close the account
        or delete anything. To close it and have the workspace deleted — documents, extracted
        data, output files, settings, and your users&apos; sign-in accounts — email{" "}
        <a href="mailto:privacy@proculink.eu" style={{ color: "var(--brand-green-deep)", textDecoration: "underline" }}>privacy@proculink.eu</a>{" "}
        from an address on the account. We confirm the request with you in writing and complete
        it within 30 days of that confirmation. Billing and tax records are kept as described
        above, and so is a short record that the deletion took place.
      </p>

      <h2 style={S.h2}>Cookies</h2>
      <p style={S.p}>
        We use only functional cookies (authentication session, CSRF protection) and analytics
        cookies (product usage — pseudonymous). Analytics cookies are set only if you accept
        them in the cookie banner. We do not use advertising or cross-site tracking cookies.
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

      {/* Was "Contact and DPO". No data protection officer is named anywhere, so the heading
          implied an appointment the page never backs. FOUNDER DECISION: if a DPO is formally
          appointed, name the role and contact here and notify AKI as GDPR Art. 37(7) requires. */}
      <h2 style={S.h2}>Privacy contact</h2>
      <p style={S.p}>
        For privacy questions or to exercise your rights:{" "}
        <a href="mailto:privacy@proculink.eu" style={{ color: "var(--brand-green-deep)", textDecoration: "underline" }}>privacy@proculink.eu</a>
        <br />
        General support: <a href="mailto:support@proculink.eu" style={{ color: "var(--brand-green-deep)", textDecoration: "underline" }}>support@proculink.eu</a>
        <br />
        Registered address: {LEGAL_ENTITY.legalName}, {LEGAL_ENTITY.registeredAddress}
      </p>

      <LegalPageLinks
        links={[
          ["Terms of Service", "/terms"],
          ["Security", "/security"],
          ["Support", "/support"],
        ]}
      />
    </div>
  );
}
