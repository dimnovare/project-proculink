import { pageMetadata } from "@/lib/seo";
import Link from "next/link";
import { LEGAL_ENTITY, PRODUCT_OPERATOR_NOTICE } from "@/lib/legal-entity";
import { DOCUMENT_PLANS, DOCUMENT_PLAN_IDS, LEGACY_PAID_PLANS, OVERAGE_PER_ORDER_EUR, PLAN_BY_ID } from "@/lib/plans";
import { LegalPageLinks } from "@/components/marketing/LegalPageLinks";

export const metadata = pageMetadata({
  path: "/terms",
  title: "Terms of Service — ProcuLink",
  description:
    "The terms governing business use of ProcuLink, the platform for purchase orders and other business documents, and how they sit alongside the Acceptable Use Policy and Privacy Policy.",
});

/*
 * FOUNDER DECISION + ESTONIAN COUNSEL — this page was revised from an advisor's pilot review
 * (2026-11). It is a commercial draft, not legal advice. Sections 7 (liability) and 9
 * (termination and refunds) are PROPOSALS: the shape is the one the review asked for, the
 * commercial choices inside them are the founder's, and counsel should check the final
 * wording against Estonian law (the Law of Obligations Act limits what a cap can exclude).
 */

const S = {
  page:    { maxWidth: 720, margin: "0 auto", padding: "56px 32px 80px" },
  h1:      { fontFamily: "'Bricolage Grotesque', Inter, sans-serif", fontSize: "clamp(28px, 4vw, 40px)", fontWeight: 700, letterSpacing: "-0.025em", color: "#0B1A2F", marginBottom: 8 },
  updated: { fontSize: 13, color: "var(--ink-faint)", marginBottom: 40 },
  h2:      { fontFamily: "'Bricolage Grotesque', Inter, sans-serif", fontSize: 20, fontWeight: 600, color: "#0B1A2F", margin: "40px 0 12px", letterSpacing: "-0.015em" },
  p:       { fontSize: 14.5, lineHeight: 1.75, color: "#3D4A5C", marginBottom: 14 },
  li:      { fontSize: 14.5, lineHeight: 1.75, color: "#3D4A5C", marginBottom: 6 },
};

export default function TermsPage() {
  return (
    <div style={S.page}>
      <h1 style={S.h1}>Terms of Service</h1>
      {/* FOUNDER DECISION: set this date to the day the page is published. */}
      <p style={S.updated}>Last updated: 12 November 2026</p>

      <h2 style={S.h2}>1. Agreement</h2>
      <p style={S.p}>
        By accessing or using ProcuLink you agree to be bound by these Terms of Service.
        {" "}{PRODUCT_OPERATOR_NOTICE} &quot;You&quot; means the business or organisation
        accessing the service, including a sole trader. If you are accepting on behalf of an
        organisation, you represent that you have authority to bind that organisation.
      </p>
      <p style={S.p}>
        ProcuLink is for business and professional use only. It is not offered to consumers,
        and by using it you confirm that you are acting for the purposes of your trade,
        business or profession.
      </p>

      <h2 style={S.h2}>2. Service description</h2>
      <p style={S.p}>
        ProcuLink is a B2B platform for business documents such as purchase orders and
        invoices. For purchase orders we provide parsing, field mapping, format transformation,
        and supplier delivery. Invoice reading and conversion are in early access: they are
        offered as they are, with fewer features, and may change or be withdrawn. We reserve
        the right to modify or discontinue features with reasonable notice.
      </p>
      <p style={S.p}>
        We do not guarantee that the service will be uninterrupted or error-free. No specific
        uptime or availability service level applies unless one is agreed with you separately
        in writing.
      </p>

      <h2 style={S.h2}>3. Acceptable use</h2>
      <p style={S.p}>
        Your use of ProcuLink is subject to the{" "}
        <Link href="/aup" style={{ color: "#1E6D29", textDecoration: "underline" }}>Acceptable Use Policy</Link>, which is
        incorporated into these Terms by reference. The Acceptable Use Policy describes the
        permitted and prohibited categories of use, including the prohibition of malicious
        uploads, illegal goods, credential sharing, reverse engineering, and abuse of Service
        availability.
      </p>

      <h2 style={S.h2}>4. Data ownership</h2>
      <p style={S.p}>
        You own the documents you send us and the data in them. By uploading content, you
        grant ProcuLink a limited, non-exclusive licence to process your data solely as
        necessary to provide the service. We do not claim ownership over your document
        content, line items, or supplier and customer relationships. We do not use the content
        of your documents to train AI or machine-learning models. Where your documents or
        workspace records contain personal data, we process it as your processor under the{" "}
        <Link href="/dpa" style={{ color: "var(--brand-green-deep)", textDecoration: "underline" }}>Data Processing Addendum</Link>.
      </p>

      <h2 style={S.h2}>5. Subscription and billing</h2>
      {/* Plan numbers come from src/lib/plans.ts (the shared frontend ladder,
          aligned with backend PlanConstants) so the Terms can never drift. */}
      <ul style={{ paddingLeft: 20, marginBottom: 14 }}>
        {[PLAN_BY_ID.pilot, ...DOCUMENT_PLANS, ...LEGACY_PAID_PLANS, PLAN_BY_ID.enterprise].map((p) => (
          <li key={p.id} style={S.li}>
            <strong>{p.name}</strong>:{" "}
            {p.id === "pilot"
              ? `14-day free trial — includes ${p.orderLimit} documents total, ${p.flowLimit} flows. On expiry, accounts become read-only. No Stripe card required.`
              : p.priceMonthly == null
                ? "Custom pricing. Contact us."
                : `€${p.priceMonthly.toLocaleString("en-IE")}/month — includes ${p.orderLimit?.toLocaleString("en-IE")} ${DOCUMENT_PLAN_IDS.includes(p.id) ? "documents" : "orders"}/month, ${p.supplierLimit ?? (p.flowLimit == null ? "unlimited" : p.flowLimit)} ${p.supplierLimit != null ? "suppliers" : "flows"}${p.supplierLimit == null ? `, then €${p.overageEur?.toFixed(2)} per extra document` : ""}.`}
          </li>
        ))}
      </ul>
      <p style={S.p}>
        Paid plans include the monthly volume listed above as a soft allowance, not a hard cap:
        processing is never blocked when you exceed it. Documents above the included volume are
        billed automatically at the per-document rate listed for your plan above (€{OVERAGE_PER_ORDER_EUR.toFixed(2)}
        per order or document on the earlier plans) at the end of the billing period, and the metered
        overage is capped so your monthly total never exceeds the list price of the cheapest
        higher self-serve plan on the same ladder that covers your usage; above the top
        self-serve plan&apos;s included volume on that ladder, you pay that plan&apos;s price plus its
        rate for each extra document or order. The Trial allowance is
        a hard limit (expired trials become read-only) and does not accrue overage. A document
        counts once ProcuLink has read it. A file of up to 10 pages is one document; a longer
        file counts once for every 10 pages. Sample documents never count.
      </p>
      <p style={S.p}>
        Subscriptions are billed monthly or annually via Stripe. Refunds are covered in
        section 9. We will provide 30 days&apos; notice to active subscribers before changing
        pricing.
      </p>
      <p style={S.p}>
        If your subscription ends — by cancellation, downgrade, or termination — we reserve
        the right to invoice any usage-based overage accrued since your last invoice, metered
        per calendar month at the rates above with the same per-month cap. For monthly
        subscriptions we currently waive this final-period overage as a courtesy; for annual
        subscriptions, accrued overage across the subscription year may be invoiced on
        termination.
      </p>

      <h2 style={S.h2}>6. Intellectual property</h2>
      <p style={S.p}>
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
      <h2 style={S.h2}>7. Limitation of liability</h2>
      <p style={S.p}>
        Nothing in these Terms limits or excludes liability that cannot be limited or excluded
        under applicable law, including liability for intentional breach or gross negligence.
      </p>
      <p style={S.p}>
        Subject to that, each party&apos;s total liability arising out of or in connection with
        these Terms and the service is limited to the greater of (a) the fees paid and payable
        by you for the service in the 12 months before the event giving rise to the claim, and
        (b) EUR 5,000. This limit does not apply to your obligation to pay fees that are due.
        Neither party is liable for indirect or consequential loss, or for loss of profit,
        revenue or business opportunity.
      </p>

      <h2 style={S.h2}>8. Governing law</h2>
      <p style={S.p}>
        These Terms are governed by the laws of the Republic of Estonia. Any disputes
        arising from these Terms or your use of ProcuLink are subject to the exclusive
        jurisdiction of the courts of Estonia, except where mandatory law requires otherwise.
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
      <h2 style={S.h2}>9. Termination and refunds</h2>
      <ul style={{ paddingLeft: 20, marginBottom: 14 }}>
        <li style={S.li}><strong>If you cancel.</strong> You can cancel a paid subscription at any time from Settings › Billing. It stays active until the end of the billing period you have already paid for, and then ends. Fees for that period are not refunded, and an annual plan cancelled part-way through its year is not refunded for the remaining months, except where the law requires otherwise.</li>
        <li style={S.li}><strong>If we end the agreement because you breached it.</strong> We may suspend access immediately where a breach puts the service, other customers or third parties at risk, including a breach of the Acceptable Use Policy. We may terminate for a material breach that you have not remedied within a reasonable period after we tell you about it in writing, or straight away if it cannot be remedied. Prepaid fees are not refunded in this case.</li>
        <li style={S.li}><strong>If we end the agreement without any fault on your side</strong> — for example, because we stop offering the service — we give you reasonable advance written notice and refund the prepaid fees for the period after termination, pro rata.</li>
        <li style={S.li}><strong>If you end the agreement because we breached it</strong>, or because you object to a new subprocessor and we cannot resolve the objection, we refund the prepaid fees for the period after termination, pro rata.</li>
      </ul>
      <p style={S.p}>
        When a subscription ends, new orders are no longer accepted. Nothing is deleted
        automatically: what happens to your data, and how to have it deleted, is described in
        the{" "}
        <Link href="/privacy" style={{ color: "#1E6D29", textDecoration: "underline" }}>Privacy Policy</Link>.
      </p>

      <h2 style={S.h2}>10. Changes to these Terms</h2>
      <p style={S.p}>
        We may update these Terms from time to time. For material changes, we will notify
        active account holders by email at least 14 days before the changes take effect.
        Continued use after the effective date constitutes acceptance of the revised Terms.
      </p>

      <h2 style={S.h2}>Contact</h2>
      <p style={S.p}>
        Legal enquiries: <a href="mailto:legal@proculink.eu" style={{ color: "#1E6D29", textDecoration: "underline" }}>legal@proculink.eu</a>
        <br />
        General support: <a href="mailto:support@proculink.eu" style={{ color: "#1E6D29", textDecoration: "underline" }}>support@proculink.eu</a>
      </p>

      <LegalPageLinks
        links={[
          ["Privacy Policy", "/privacy"],
          ["Security", "/security"],
          ["Support", "/support"],
        ]}
      />
    </div>
  );
}
