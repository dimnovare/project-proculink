import { pageMetadata } from "@/lib/seo";
import Link from "next/link";
import { LegalH2, LegalPage } from "@/components/marketing/LegalPage";
import { LEGAL_ENTITY, PRODUCT_OPERATOR_NOTICE } from "@/lib/legal-entity";
import { DOCUMENT_PLANS, DOCUMENT_PLAN_IDS, LEGACY_PAID_PLANS, OVERAGE_PER_ORDER_EUR, PLAN_BY_ID, TRIAL_DAYS, type Plan } from "@/lib/plans";

export const metadata = pageMetadata({
  path: "/terms",
  title: "Terms of Service — ProcuLink",
  description:
    "The terms governing business use of ProcuLink, the platform for reading, checking and sending on business documents, and how they sit alongside the Acceptable Use Policy and Privacy Policy.",
});

/*
 * FOUNDER DECISION + ESTONIAN COUNSEL — this page was revised from an advisor's pilot review
 * (2026-11). It is a commercial draft, not legal advice. Sections 7 (liability) and 9
 * (termination and refunds) are PROPOSALS: the shape is the one the review asked for, the
 * commercial choices inside them are the founder's, and counsel should check the final
 * wording against Estonian law (the Law of Obligations Act limits what a cap can exclude).
 */

const planItem = (p: Plan) => (
  <li key={p.id}>
    <strong>{p.name}</strong>:{" "}
    {p.id === "pilot"
      ? `${TRIAL_DAYS}-day free trial — includes ${p.orderLimit} documents total, ${p.flowLimit} flows. On expiry, accounts become read-only. No Stripe card required.`
      : p.priceMonthly == null
        ? "Custom pricing. Contact us."
        : `€${p.priceMonthly.toLocaleString("en-IE")}/month — includes ${p.orderLimit?.toLocaleString("en-IE")} ${DOCUMENT_PLAN_IDS.includes(p.id) ? "documents" : "orders"}/month, ${p.supplierLimit ?? (p.flowLimit == null ? "unlimited" : p.flowLimit)} ${p.supplierLimit != null ? "suppliers" : "flows"}${p.supplierLimit == null ? `, then €${p.overageEur?.toFixed(2)} per extra document` : ""}.`}
  </li>
);

export default function TermsPage() {
  return (
    // FOUNDER DECISION: set this date to the day the page is published.
    <LegalPage title="Terms of Service" updated="Last updated: 27 November 2026 · This revision takes effect on 14 December 2026" path="/terms">

      {/*
        2026-11-27 polish (structure from a review of comparable EU B2B SaaS terms). The summary
        restates the sections below and adds nothing; the last sentence says so. Counsel to check.
      */}
      <LegalH2>In short</LegalH2>
      <ul>
        <li>ProcuLink is for businesses. It is not offered to consumers.</li>
        <li>You own your documents and the data in them. We use them only to provide the service, and we do not use them to train AI models.</li>
        <li>Automatic reading can be wrong. Check a document and the file made from it before you rely on them. When you send a document, you are its issuer.</li>
        <li>A paid plan renews each month or year until you cancel it in Settings › Billing. It then runs to the end of the period you paid for.</li>
        <li>When a subscription ends, new documents are no longer accepted. Your workspace stays readable, and nothing is deleted automatically.</li>
        <li>Each party&apos;s liability is capped at the greater of 12 months&apos; fees and EUR 5,000.</li>
        <li>We email you at least 14 days before a material change to these Terms. Estonian law applies.</li>
      </ul>
      <p>
        This summary helps you find your way. The numbered sections below are the Terms.
      </p>

      <LegalH2>1. Agreement</LegalH2>
      <p>
        By accessing or using ProcuLink you agree to be bound by these Terms of Service.
        {" "}{PRODUCT_OPERATOR_NOTICE} &quot;You&quot; means the business or organisation
        accessing the service, including a sole trader. If you are accepting on behalf of an
        organisation, you represent that you have authority to bind that organisation.
      </p>
      <p>
        ProcuLink is for business and professional use only. It is not offered to consumers,
        and by using it you confirm that you are acting for the purposes of your trade,
        business or profession.
      </p>

      <LegalH2>2. Service description</LegalH2>
      <p>
        ProcuLink is a B2B platform for business documents such as invoices, purchase orders
        and delivery notes. We receive a document, read its contents, check them, turn them into
        the file format you choose, and deliver that file where you tell us. We reserve the right
        to modify or discontinue features with reasonable notice.
      </p>
      <p>
        We do not guarantee that the service will be uninterrupted or error-free. No specific
        uptime or availability service level applies unless one is agreed with you separately
        in writing. Support is by email at{" "}
        <a href="mailto:support@proculink.eu">support@proculink.eu</a>, Monday to Friday. We aim
        to reply within one business day, but this is an aim, not a guaranteed response time.
      </p>
      {/*
        FOUNDER DECISION (2026-11-17). Until 16 November this section carried a disclaimer for
        invoices only ("offered as they are"). It went when invoices stopped being early
        access, and nothing replaced it, although every document is read automatically. This
        paragraph says so for all documents and applies from publication. Counsel to check
        the wording.
      */}
      <p>
        ProcuLink reads documents automatically, and automatic reading can be wrong. It marks
        what it could not read with confidence and what does not pass its checks, but it does
        not replace your own review. You are responsible for checking a document, and the file
        made from it, before you rely on them, including where you have set a flow to send
        documents on without a person checking them first.
      </p>
      {/*
        FOUNDER DECISION (2026-11-25). Plan 33 adds a file for, and an optional send to, a public
        authority's e-invoicing system. This paragraph and the last one in section 10 record
        that the customer is the issuer. Counsel (Estonian, and ideally a Polish tax adviser)
        should check both before production use.
      */}
      <p>
        Some file types and destinations make files for, or send files to, systems run by public
        authorities, such as national e-invoicing systems, or by e-invoicing providers and
        networks you choose, such as a Peppol access point. When you use them, you are the issuer
        of the document. You remain responsible for its content, for checking it before it is
        issued or sent, for the accounts you hold with those systems and providers, for the
        tokens, keys and other credentials you give us and for keeping them valid, and for
        meeting your own legal and tax obligations. ProcuLink provides the software and its
        checks and acts only on your instructions. A file is sent to such a system only through
        a destination you set up with your own account and credentials. For KSeF&apos;s live
        system, a person in your organisation must confirm each invoice before it is sent. Our
        checks reduce mistakes but do not guarantee that a document is correct or complete, or
        that the authority, provider or receiver will accept it. Passing them is not tax or
        legal advice. ProcuLink is not certified or approved by any tax authority or
        e-invoicing network.
      </p>
      {/* FOUNDER DECISION (2026-11-26): optional early-access sentence, approved with T1. Counsel to check. */}
      <p>
        Features we offer as early access may change or be withdrawn. We will tell you before
        we switch one off for your workspace.
      </p>

      {/*
        FOUNDER DECISION (2026-11-26): services the customer connects (AI assistants, e-invoicing
        providers). Counsel to check. Was "2a"; renumbered 2026-11-27 — no other page cites a
        Terms section number (checked with git grep), and this revision is not yet in effect.
      */}
      <LegalH2>3. Services you connect</LegalH2>
      <p>
        You can connect services you hold your own account with, such as an AI assistant or an
        e-invoicing provider. They are not our subprocessors. What you send to them, or let them
        read from ProcuLink, is handled under your agreement with them. Anything done in
        ProcuLink with a key you created or a sign-in you approved counts as done by you. Keep
        keys safe, and revoke a key you no longer use in Settings, under For developers.
      </p>

      {/* 2026-11-27: account duties, a clause every reviewed provider has. security@ is the
          inbox /security publishes. Counsel to check. */}
      <LegalH2>4. Your account and users</LegalH2>
      <p>
        You decide who in your organisation can use your workspace, and you are responsible for
        what they do in it. Give us accurate details when you sign up and keep them up to date.
        Keep sign-ins private: each person uses their own. If you think someone has used your
        account without permission, tell us at once at{" "}
        <a href="mailto:security@proculink.eu">security@proculink.eu</a>.
      </p>

      <LegalH2>5. Acceptable use</LegalH2>
      <p>
        Your use of ProcuLink is subject to the{" "}
        <Link href="/aup">Acceptable Use Policy</Link>, which is
        incorporated into these Terms by reference. The Acceptable Use Policy describes the
        permitted and prohibited categories of use, including the prohibition of malicious
        uploads, illegal goods, credential sharing, reverse engineering, and abuse of Service
        availability.
      </p>

      <LegalH2>6. Your data</LegalH2>
      <p>
        You own the documents you send us and the data in them. By uploading content, you
        grant ProcuLink a limited, non-exclusive licence to process your data solely as
        necessary to provide the service. We do not claim ownership over your document
        content, line items, or supplier and customer relationships. We do not use the content
        of your documents to train AI or machine-learning models. Where your documents or
        workspace records contain personal data, we process it as your processor under the{" "}
        <Link href="/dpa">Data Processing Addendum</Link>.
      </p>
      {/* 2026-11-27: AI disclosure in the Terms, matching /privacy "Turning AI off" and the
          OpenAI row of src/lib/subprocessors.ts. Counsel to check. */}
      <p>
        To read some documents we use an AI provider, named in the{" "}
        <Link href="/subprocessors">list of subprocessors</Link>. If you do not want your
        documents sent to it, ask us and we will turn AI reading off for your organisation, as
        described in the <Link href="/privacy">Privacy Policy</Link>. How we protect your data
        is described on the <Link href="/security">Security</Link> page.
      </p>

      {/* 2026-11-27: mutual confidentiality, a clause most reviewed providers carry. Counsel to
          check the scope and whether a survival period should be added. */}
      <LegalH2>7. Confidentiality</LegalH2>
      <p>
        Each party keeps the other&apos;s non-public information confidential and uses it only
        for this agreement. Your documents, workspace data and credentials are your confidential
        information. This does not cover information that is already public, that the receiving
        party already had or developed on its own, or that the law or a court requires it to
        disclose.
      </p>

      <LegalH2>8. Subscription and billing</LegalH2>
      {/* Plan numbers come from src/lib/plans.ts (the shared frontend ladder,
          aligned with backend PlanConstants) so the Terms can never drift. */}
      <ul>
        {[PLAN_BY_ID.pilot, ...DOCUMENT_PLANS, PLAN_BY_ID.enterprise].map(planItem)}
      </ul>
      <p>Earlier plans, kept for existing subscriptions and no longer offered:</p>
      <ul>
        {LEGACY_PAID_PLANS.map(planItem)}
      </ul>
      {/* 2026-11-27: the one long sentence split into a list. Same rules, same derived numbers. */}
      <p>How the included volume works:</p>
      <ul>
        <li>On paid plans the monthly volume listed above is a soft allowance, not a hard cap: processing is never blocked when you exceed it.</li>
        <li>Documents above the included volume are billed automatically at the end of the billing period, at the per-document rate listed for your plan above (€{OVERAGE_PER_ORDER_EUR.toFixed(2)} per order or document on the earlier plans).</li>
        <li>That overage is capped: your monthly total never exceeds the list price of the cheapest higher self-serve plan on the same ladder that covers your usage. Above the top self-serve plan&apos;s included volume on that ladder, you pay that plan&apos;s price plus its rate for each extra document or order.</li>
        <li>The Trial allowance is a hard limit (expired trials become read-only) and does not accrue overage.</li>
        <li>A document counts once ProcuLink has read it. A file of up to 10 pages is one document; a longer file counts once for every 10 pages. Sample documents never count.</li>
      </ul>
      {/* 2026-11-27: renewal and failed payment added. Both are what the product does: Stripe
          subscriptions renew until cancelled, and a past_due account stops accepting new
          documents (CLAUDE.md §11.5, AccountStatusConstants.PastDue). */}
      <p>
        Subscriptions are billed monthly or annually via Stripe, and renew automatically at the
        end of each billing period until they are cancelled. If a payment fails, we may pause
        the processing of new documents until it is paid; your workspace stays readable.
        Refunds are covered in section 11. We will provide 30 days&apos; notice to active
        subscribers before changing pricing.
      </p>
      <p>
        If your subscription ends — by cancellation, downgrade, or termination — we reserve
        the right to invoice any usage-based overage accrued since your last invoice, metered
        per calendar month at the rates above with the same per-month cap. For monthly
        subscriptions we currently waive this final-period overage as a courtesy; for annual
        subscriptions, accrued overage across the subscription year may be invoiced on
        termination.
      </p>

      <LegalH2>9. Intellectual property</LegalH2>
      <p>
        The ProcuLink software, design, documentation, and brand are owned by{" "}
        {LEGAL_ENTITY.legalName}. You may not copy, modify, distribute, sell, or sublicence any
        part of the software or platform. Your feedback may be used by us to improve the
        service without obligation to you.
      </p>

      {/*
        FOUNDER DECISION + COUNSEL. The previous cap was "the fees paid by you in the three
        months preceding the claim": during a free Pilot that is EUR 0, and for software that
        carries purchase orders to suppliers the review called it unusually one-sided. This is
        a balanced proposal, not a settled term:
          • mutual cap — the greater of 12 months' fees and a fixed floor, so a Pilot or a
            new customer is not capped at zero. Founder set the floor at EUR 5,000
            (2026-11-04);
          • carve-outs for what Estonian law does not let a cap exclude (intent and gross
            negligence — counsel to confirm against the Law of Obligations Act) and for fees
            due; founder decided (2026-11-04) there is no separate data-protection cap — one
            cap covers every claim;
          • "data loss" was removed from the excluded heads of loss, so a loss of customer
            data caused by our breach is recoverable up to the cap rather than excluded.
      */}
      <LegalH2>10. Limitation of liability</LegalH2>
      <p>
        Nothing in these Terms limits or excludes liability that cannot be limited or excluded
        under applicable law, including liability for intentional breach or gross negligence.
      </p>
      <p>
        Subject to that, each party&apos;s total liability arising out of or in connection with
        these Terms and the service is limited to the greater of (a) the fees paid and payable
        by you for the service in the 12 months before the event giving rise to the claim, and
        (b) EUR 5,000. This limit does not apply to your obligation to pay fees that are due.
        Neither party is liable for indirect or consequential loss, or for loss of profit,
        revenue or business opportunity.
      </p>
      {/* FOUNDER DECISION (2026-11-25), plan 33: see the note in section 2. Counsel should check it. */}
      <p>
        Subject to the first paragraph of this section, we are not liable for the content of a
        document you issue or send through the service, for taxes, interest or penalties
        relating to it, or for the acts, decisions or availability of a public authority&apos;s
        system or of a third-party service you connect, such as an e-invoicing provider or an AI
        assistant, except to the extent that the loss is caused by our breach of these Terms.
      </p>

      {/*
        FOUNDER DECISION + COUNSEL. The previous text said "Either party may terminate at any
        time" and "No refunds are provided for partial periods", which left a customer whose
        contract WE ended, through no fault of theirs, with no refund of a prepaid annual fee.
        The proposal separates the four cases. Choices left to the founder:
          • the notice we give when we end the agreement without the customer's fault
            ("reasonable advance written notice" — set a number if wanted);
          • the cure period for a breach ("a reasonable period" — set a number if wanted);
          • no refund on customer cancellation, including annual plans part-way through.
        Facts this relies on, checked: cancelling ends processing on every ingest path and the
        workspace stays readable (BillingSection / §11.5 of CLAUDE.md); nothing deletes data on
        termination (see /privacy). NOT checked: that the Stripe customer portal is set to cancel
        at the END of the billing period — confirm that in the Stripe dashboard before
        publishing the first bullet.
        The objection-to-a-subprocessor case matches /subprocessors ("terminate without further
        fees for the unused remainder"), made explicit as a pro-rata refund.
      */}
      <LegalH2>11. Suspension, termination and refunds</LegalH2>
      <ul>
        <li><strong>If you cancel.</strong> You can cancel a paid subscription at any time from Settings › Billing. It stays active until the end of the billing period you have already paid for, and then ends. Fees for that period are not refunded, and an annual plan cancelled part-way through its year is not refunded for the remaining months, except where the law requires otherwise.</li>
        <li><strong>If we end the agreement because you breached it.</strong> We may suspend access immediately where a breach puts the service, other customers or third parties at risk, including a breach of the Acceptable Use Policy. We may terminate for a material breach that you have not remedied within a reasonable period after we tell you about it in writing, or straight away if it cannot be remedied. Prepaid fees are not refunded in this case.</li>
        <li><strong>If we end the agreement without any fault on your side</strong> — for example, because we stop offering the service — we give you reasonable advance written notice and refund the prepaid fees for the period after termination, pro rata.</li>
        <li><strong>If you end the agreement because we breached it</strong>, or because you object to a new subprocessor and we cannot resolve the objection, we refund the prepaid fees for the period after termination, pro rata.</li>
      </ul>
      {/* 2026-11-27: "you can still sign in and download" added; it is what /privacy "How long
          we keep data" already states and what BillingSection shows a paused workspace. */}
      <p>
        When a subscription ends, new documents are no longer accepted. Nothing is deleted
        automatically: you can still sign in and view or download what you have processed.
        What happens to your data, and how to have it deleted, is described in the{" "}
        <Link href="/privacy">Privacy Policy</Link>.
      </p>

      <LegalH2>12. Changes to these Terms</LegalH2>
      <p>
        We may update these Terms from time to time. For material changes, we will notify
        active account holders by email at least 14 days before the changes take effect.
        If you do not agree with a change, you can cancel before it takes effect.
        Continued use after the effective date constitutes acceptance of the revised Terms.
      </p>

      {/* 2026-11-27: the documents that make up the agreement, and how notices reach you.
          Precedence of the DPA on personal data is the common pattern; counsel to confirm. */}
      <LegalH2>13. General</LegalH2>
      <p>
        These Terms, the <Link href="/aup">Acceptable Use Policy</Link> and the{" "}
        <Link href="/dpa">Data Processing Addendum</Link> together make up the agreement between
        you and us, unless we have signed a separate agreement with you. If these Terms and the
        Data Processing Addendum differ on personal data, the Data Processing Addendum applies.
        We send notices by email to the address on your account; you can send
        notices to <a href="mailto:legal@proculink.eu">legal@proculink.eu</a>. If a court finds
        part of these Terms invalid, the rest still applies.
      </p>

      <LegalH2>14. Governing law</LegalH2>
      <p>
        These Terms are governed by the laws of the Republic of Estonia. Any disputes
        arising from these Terms or your use of ProcuLink are subject to the exclusive
        jurisdiction of the courts of Estonia, except where mandatory law requires otherwise.
      </p>

      <LegalH2>Contact</LegalH2>
      <p>
        Legal enquiries: <a href="mailto:legal@proculink.eu">legal@proculink.eu</a>
        <br />
        General support: <a href="mailto:support@proculink.eu">support@proculink.eu</a>
      </p>
    </LegalPage>
  );
}
