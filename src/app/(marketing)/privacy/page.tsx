import { pageMetadata } from "@/lib/seo";
import Link from "next/link";
import { LEGAL_ENTITY, PRODUCT_OPERATOR_NOTICE } from "@/lib/legal-entity";
import { SUBPROCESSORS } from "@/lib/subprocessors";
import { TableScroller } from "@/components/marketing/TableScroller";
import { LegalH2, LegalPage } from "@/components/marketing/LegalPage";

export const metadata = pageMetadata({
  path: "/privacy",
  title: "Privacy Policy — ProcuLink",
  description:
    "What ProcuLink collects — account, document, usage and billing data, and connection details — how each is used, how long it is kept, and how it is protected.",
  ogDescription: "What data ProcuLink collects, how it is used, and how it is stored and protected.",
});

export default function PrivacyPage() {
  return (
    // FOUNDER DECISION: set this date to the day the page is published.
    <LegalPage title="Privacy Policy" updated="Last updated: 17 November 2026" path="/privacy">

      <LegalH2>Who we are</LegalH2>
      <p>
        {PRODUCT_OPERATOR_NOTICE} In this policy, &quot;ProcuLink&quot;, &quot;we&quot;,
        &quot;us&quot;, and &quot;our&quot; refer to {LEGAL_ENTITY.legalName} as operator
        of the ProcuLink platform at proculink.eu, which processes business documents such as
        invoices, purchase orders and delivery notes for businesses. ProcuLink is a service for business and
        professional use; it is not offered to consumers.
      </p>

      {/*
        Controller vs processor, stated once and early, because the rest of the page reads
        differently depending on which side of the line a piece of data is on. "Normally" is
        deliberate: a customer can ask us to use workspace data for something of our own (a
        support investigation they did not request, say), and that is a question for counsel,
        not a sentence this page should settle by omission.
      */}
      <LegalH2>Our role: controller or processor</LegalH2>
      <p>
        <strong>We are the controller</strong> for the personal data we need to run ProcuLink
        as a business: visits to this website, the accounts of the people who sign in, billing
        and invoicing records, our own product analytics and error monitoring, security logs,
        and the messages you send us. This policy describes that data.
      </p>
      <p>
        <strong>We are normally a processor</strong> for the personal data inside the documents
        our customers send us and the files we make from them, and in the records they keep in
        their workspace. Our customer decides why that data is
        processed; we process it on their instructions, under the{" "}
        <Link href="/dpa">Data Processing Addendum</Link>.
        If your details reached us that way — for example, you are a contact named on an
        invoice — the organisation that sent the document is the controller, and
        requests about that data are best made to them. If you contact us instead, we pass the
        request on and help them answer it.
      </p>

      <LegalH2>What data we collect</LegalH2>
      <ul>
        <li><strong>Account data</strong> — name, work email, organisation name, collected via Clerk authentication on sign-up.</li>
        <li><strong>Document data</strong> — the documents you send us, such as invoices, purchase orders and delivery notes; the data we read from them; and the files we generate from them. When a document reaches us by email we also keep the address it was sent from, and the text of the message if it has no attachment we can read. These documents can carry personal data: contact names, email addresses, phone numbers and postal addresses, and bank account details such as IBAN and payment references.</li>
        <li><strong>Workspace records</strong> — the flows, destinations and lookup lists you set up, and a record of who checked, changed or sent each document.</li>
        <li><strong>Usage data</strong> — page views, feature interactions, error events, collected via product analytics.</li>
        <li><strong>Billing data</strong> — subscription plan and status, handled by Stripe. We never store your card numbers or payment credentials.</li>
        <li><strong>Connection details</strong> — the addresses and credentials you give us for collecting documents from your systems and delivering files to them, such as a mailbox, a file server, a storage bucket or a web address. Credentials are encrypted at rest.</li>
      </ul>

      {/*
        Legal bases, one per purpose, for the data where we are CONTROLLER only. Document
        content is processed on the customer's instructions (DPA), so it has no basis of ours
        to list here — listing one would contradict the role section above.

        The two analytics legs have different bases ON PURPOSE, because they are different
        mechanisms: the browser SDK only loads after the cookie banner records
        "analytics-allowed" (src/lib/analytics.ts), while the backend records server-side
        events (a workspace created, billing changes; checked 2026-11-17) that no banner
        gates. Claiming consent for both would be false for the second.

        Counsel to check the wording of each basis; the mapping itself is the conventional one.
      */}
      <LegalH2>How we use your data, and our legal basis</LegalH2>
      <p>
        For the data we control, each use and the GDPR legal basis we rely on for it:
      </p>
      <ul>
        <li><strong>Running your account and the service</strong> — signing you in, operating your organisation&apos;s workspace, and support. Basis: performance of our contract with your organisation (Art. 6(1)(b)), and, for the people your organisation adds as users, our legitimate interest in providing the service they use for work (Art. 6(1)(f)).</li>
        <li><strong>Service emails</strong> — such as notifications about your documents, billing receipts and notices about your account. Basis: performance of our contract (Art. 6(1)(b)).</li>
        <li><strong>Billing, invoicing and tax records</strong>. Basis: performance of our contract (Art. 6(1)(b)), and our legal obligation to keep accounting records (Art. 6(1)(c)).</li>
        <li><strong>Keeping the service secure and working</strong> — error monitoring, security and access logs, and preventing abuse. Basis: our legitimate interest in a secure, reliable service (Art. 6(1)(f)).</li>
        <li><strong>Product analytics in your browser</strong> — only if you accept analytics cookies in the cookie banner. Basis: your consent (Art. 6(1)(a)). You can withdraw it at any time: clear this site&apos;s cookies and stored data in your browser, and the banner asks again.</li>
        <li><strong>Pseudonymous service events</strong> recorded by our servers — for example, that a workspace was created or changed plan. Basis: our legitimate interest in understanding how the product is used, so we can improve it (Art. 6(1)(f)).</li>
        <li><strong>Answering enquiries and demo requests</strong>. Basis: our legitimate interest in responding to you, or steps you asked for before entering a contract (Art. 6(1)(f) and 6(1)(b)).</li>
        <li><strong>Meeting legal obligations and handling legal claims</strong>. Basis: legal obligation (Art. 6(1)(c)) and our legitimate interest in establishing or defending legal claims (Art. 6(1)(f)).</li>
      </ul>
      <p>
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
      <LegalH2>Data storage and residency</LegalH2>
      <p>These providers hold your document files, the database, and the API that serves them:</p>
      <ul>
        <li><strong>File storage</strong>: Cloudflare R2 (EU-region bucket)</li>
        <li><strong>Database</strong>: PostgreSQL hosted on Neon (EU region)</li>
        <li><strong>API hosting</strong>: Railway (EU region)</li>
        <li><strong>Error monitoring</strong>: Sentry (EU region instance)</li>
        <li><strong>Frontend</strong>: Vercel (global CDN — document files do not pass through it)</li>
      </ul>
      <p>
        Some processing happens outside the EEA, under Standard Contractual Clauses. These
        providers are not a rare exception — they sit on the normal path a document takes:
      </p>
      <ul>
        <li><strong>Authentication</strong>: Clerk (US-based, EU data residency available on request)</li>
        {/* NOT "self-hosted mode" — that phrasing was removed from /security in this same
            pass because nothing runs on customer infrastructure. Two pages describing the
            same flag two different ways is how the Postmark inbound/outbound defect got in. */}
        <li><strong>AI document extraction and mapping suggestions</strong>: OpenAI (US) — receives the content of your documents, unless we have turned AI extraction off for your organisation</li>
        <li><strong>Payments</strong>: Stripe (US, EU establishment) — billing data only, no document content</li>
        <li><strong>Email in and out</strong>: Postmark (US) — carries documents emailed to your ProcuLink address, and the files we email to the recipients you set, as attachments</li>
      </ul>
      {/*
        The no-AI mode, made operational. It is Organisation.SelfHostedOcr: honoured at every
        OpenAI call site (extraction, mapping suggestions, schema inference, inbound email) and
        it fails safe — but it has NO write site in the product, no endpoint and no settings
        screen. So this paragraph says exactly how a customer gets it (ask) and what changes
        (no AI steps; what our own readers cannot read is not read), and repeats /security's
        "does not change where your files are stored". Do not describe a switch here until one
        exists; do not attach it to a plan (legalCommitments.test.tsx pins both).
      */}
      <p>
        <strong>Turning AI off.</strong> If you do not want your documents sent to OpenAI, email{" "}
        <a href="mailto:support@proculink.eu">support@proculink.eu</a>{" "}
        and we will turn AI extraction off for your organisation and tell you when it is done.
        It is not a setting in the product; we switch it on our side. With it off, nothing from
        your documents reaches OpenAI: only our own readers are used, documents they cannot
        read are not read, and AI suggestions are not offered. It
        does not change where your files are stored.
      </p>
      <p>
        Where your data is stored and the route it travels to reach its destination are two
        different questions. The outbound network path is chosen by our hosting provider and
        is not pinned to a region by us, so we cannot tell you today which country an
        outbound delivery leaves from. The{" "}
        <Link href="/security">Security</Link>{" "}
        page explains this in full.
      </p>

      {/*
        Every line here was re-derived from the backend (origin/main, 2026-11-17):

          • Documents, the data read from them and the files made from them have NO automatic
            age limit: no job deletes them. They go only when the workspace is deleted.
          • The history rows (what happened to each document, and changes in the workspace)
            are deleted at 180 days: DataRetention is enabled on the Worker (read 2026-11-17).
          • The 12-month "sender domain" line described the older order path only and was
            removed. The address an emailed document came from is kept with the document
            (listed under "What data we collect").

        FOUNDER DECISION: automatic deletion after account closure. There is no closure
        trigger, so nothing is deleted when a subscription ends; this section says so. If you
        want "deleted N days after closure", that needs a job built first — do not write the
        number until it exists.
        FOUNDER DECISION: confirm the database provider's restore window for our plan and, if
        wanted, print it in the backups line.
      */}
      <LegalH2>How long we keep data</LegalH2>
      <ul>
        <li><strong>Workspace data</strong> — the documents you send us, the data we read from them, the files we generate, and your flows and settings — is kept for as long as your account exists. There is no automatic age limit on it today.</li>
        <li><strong>After a subscription ends or a Trial expires</strong>, nothing is deleted automatically. Your workspace stays readable, so you can sign in and view or download what you have processed for as long as it exists. There is no fixed export window: it stays until you ask us to delete it — see &quot;Deleting your data&quot; below.</li>
        <li><strong>History</strong> — the record of what happened to each document, and of changes made in the workspace — is deleted automatically once it is 180 days old. The documents themselves stay.</li>
        <li><strong>Your sign-in account</strong> is held by our authentication provider while your account exists, and is removed when you ask us to delete your account.</li>
        <li><strong>Billing and tax records</strong> are kept for as long as accounting law requires, including after an account is deleted.</li>
        <li><strong>Backups.</strong> Our database provider keeps a rolling point-in-time history of the database so it can be recovered after a failure. Deleted data drops out of that history automatically once it is older than the provider&apos;s recovery window. We keep no separate long-term backup copies, and we do not restore deleted data from backups.</li>
      </ul>

      <LegalH2>Your rights under GDPR</LegalH2>
      <p>As an EU/EEA data subject you have the right to:</p>
      <ul>
        <li><strong>Access</strong> the personal data we hold about you</li>
        <li><strong>Rectification</strong> of inaccurate data</li>
        <li><strong>Erasure</strong> (&quot;right to be forgotten&quot;) where no overriding legal basis exists</li>
        <li><strong>Data portability</strong> — receive your data in a structured, machine-readable format</li>
        <li><strong>Objection</strong> to processing based on legitimate interests</li>
        <li><strong>Restriction</strong> of processing where accuracy is contested or objection is pending</li>
        <li><strong>Withdraw consent</strong> where we rely on it, without affecting processing that happened before</li>
      </ul>
      <p>
        To exercise any of these rights, email{" "}
        <a href="mailto:privacy@proculink.eu">privacy@proculink.eu</a>.
        We respond within one month, which is the period the GDPR sets. If a request is
        complex we may extend that by up to two further months, and we will tell you inside
        the first month if we need to. For data we hold as a processor, see &quot;Our role&quot;
        above: we pass the request to the organisation that controls it.
      </p>
      <p>
        You also have the right to complain to a data protection supervisory authority. Ours is
        the Estonian Data Protection Inspectorate (Andmekaitse Inspektsioon, www.aki.ee); you
        can also complain to the authority in the EU or EEA country where you live or work, or
        where you think the problem happened. You do not have to contact us first.
      </p>

      <LegalH2>Deleting your data</LegalH2>
      <p>
        To have documents deleted, email{" "}
        <a href="mailto:privacy@proculink.eu">privacy@proculink.eu</a>{" "}
        from the address on your account and tell us what to delete: particular documents,
        everything received before a date, or the whole workspace. We check that the address
        belongs to the workspace you name, and we confirm the scope with you in writing before
        anything is deleted. Deletion is carried out by us rather than from a button in the
        product, and it cannot be undone.
      </p>
      <p><strong>What gets deleted</strong></p>
      <ul>
        <li>The document you sent us, as held in our file storage.</li>
        <li>The data we read from it, including the names, addresses and contact details it carried.</li>
        <li>The files we generated from it.</li>
        <li>The record of what happened to it.</li>
      </ul>
      <p><strong>What we keep, and why</strong></p>
      <ul>
        <li><strong>A short record that the deletion took place</strong> — the date, who carried it out and what it covered. It holds none of your document content. We keep it because we have to be able to demonstrate what we did and when, which is what GDPR Article 5(2) asks of us.</li>
        <li><strong>Workspace settings</strong> — your flows, destinations, lookup lists and stored credentials, and the note of which files we have already collected from your own systems, so that they are not collected again. Deleting documents leaves these in place and the workspace keeps working. Ask us if you want them removed as well.</li>
        <li><strong>Billing and tax records</strong> — kept for as long as accounting law requires us to keep them.</li>
        <li><strong>Backup copies</strong> — until they age out of our database provider&apos;s recovery window, as described under &quot;How long we keep data&quot;. We do not restore deleted data from a backup.</li>
      </ul>
      {/* Checked against the backend 2026-11-17: deletion is run by staff, and for a single
          document, for a workspace that has paid, and for sign-in accounts, part of it is
          done by hand. So this section promises the result and a period, not a button.
          FOUNDER DECISION: build the missing parts, or keep doing them by hand on request. */}
      <p>
        Two things sit outside this. Your sign-in account is held by our authentication
        provider, and deleting documents does not remove it — ask us and we will. And a file
        we have already sent on is in the recipient&apos;s systems from that point on, which we
        have no way to reach.
      </p>
      <p>
        <strong>Closing your account.</strong> Ending a subscription does not close the account
        or delete anything. To close it and have the workspace deleted — documents, the data
        read from them, the files generated from them, settings, and your users&apos; sign-in
        accounts — email{" "}
        <a href="mailto:privacy@proculink.eu">privacy@proculink.eu</a>{" "}
        from an address on the account. We confirm the request with you in writing and complete
        it within 30 days of that confirmation. Billing and tax records are kept as described
        above, and so is a short record that the deletion took place.
      </p>

      <LegalH2>Google accounts you connect</LegalH2>
      <p>
        If a workspace admin connects a Google account so that a flow can send files to Google
        Drive or add rows to Google Sheets:
      </p>
      <ul>
        <li><strong>What we access.</strong> The account&apos;s email address, and only the Drive folders, files and spreadsheets you choose in Google&apos;s file picker or that ProcuLink creates. We cannot see any other file in your Google Drive.</li>
        <li><strong>How we use it.</strong> Only to deliver the documents your flows produce to the folder or spreadsheet you chose, and to show which account is connected. Before we add a file, we check whether ProcuLink already put a file with the same name in that folder, so a re-send replaces it instead of making a copy. Before we add rows, we read the spreadsheet&apos;s tab names and its first row, so a repeated header row is not added again.</li>
        <li><strong>What we store.</strong> The account&apos;s email address and an encrypted token issued by Google that lets ProcuLink reach the items you chose. We do not keep copies of anything we read from your Google account.</li>
        <li><strong>Sharing.</strong> We do not share data from your Google account with anyone. We do not use it for advertising, and we do not use it to train AI models.</li>
        <li><strong>Removing access.</strong> Disconnect the account in ProcuLink, and we delete its token at once. If a destination still uses the account, remove or change that destination first. You can also remove ProcuLink from your Google account&apos;s third-party access at any time. Deleting your workspace deletes the connection too.</li>
      </ul>
      <p>
        ProcuLink&apos;s use and transfer to any other app of information received from Google APIs
        will adhere to the{" "}
        <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>,
        including the Limited Use requirements.
      </p>

      <LegalH2>Cookies</LegalH2>
      <p>
        We use only functional cookies (authentication session, CSRF protection) and analytics
        cookies (product usage — pseudonymous). Analytics cookies are set only if you accept
        them in the cookie banner. We do not use advertising or cross-site tracking cookies.
      </p>

      <LegalH2>Subprocessors</LegalH2>
      <p>
        The authoritative list of subprocessors is maintained at{" "}
        <Link href="/subprocessors">/subprocessors</Link>{" "}
        with a 30-day change-notification commitment. The current snapshot:
      </p>
      {/* This table needs 350px of min-content and the page's content box is 311px
          at a 375px viewport — it used to push the whole document sideways. See
          TableScroller for why the columns are scrolled rather than dropped. */}
      <TableScroller label="Subprocessors">
        <table>
          <thead>
            <tr>
              <th>Processor</th>
              <th>Purpose</th>
              <th>Location</th>
            </tr>
          </thead>
          <tbody>
            {SUBPROCESSORS.map((s) => (
              <tr key={s.name}>
                <td>{s.name}</td>
                <td>{s.purpose}</td>
                <td>{s.location}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroller>

      {/* Was "Contact and DPO". No data protection officer is named anywhere, so the heading
          implied an appointment the page never backs. FOUNDER DECISION: if a DPO is formally
          appointed, name the role and contact here and notify AKI as GDPR Art. 37(7) requires. */}
      <LegalH2>Privacy contact</LegalH2>
      <p>
        For privacy questions or to exercise your rights:{" "}
        <a href="mailto:privacy@proculink.eu">privacy@proculink.eu</a>
        <br />
        General support: <a href="mailto:support@proculink.eu">support@proculink.eu</a>
        <br />
        Registered address: {LEGAL_ENTITY.legalName}, {LEGAL_ENTITY.registeredAddress}
      </p>
    </LegalPage>
  );
}
