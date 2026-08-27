import { pageMetadata } from "@/lib/seo";
import Link from "next/link";
import { LEGAL_ENTITY, PRODUCT_OPERATOR_NOTICE } from "@/lib/legal-entity";
import { OVERAGE_PER_ORDER_EUR, PLANS } from "@/lib/plans";
import { LegalPageLinks } from "@/components/marketing/LegalPageLinks";

export const metadata = pageMetadata({
  path: "/terms",
  title: "Terms of Service — ProcuLink",
  description:
    "The terms governing your use of the ProcuLink purchase-order automation platform, and how they sit alongside the Acceptable Use Policy and Privacy Policy.",
});

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
      <p style={S.updated}>Last updated: 11 June 2026</p>

      <h2 style={S.h2}>1. Agreement</h2>
      <p style={S.p}>
        By accessing or using ProcuLink you agree to be bound by these Terms of Service.
        {" "}{PRODUCT_OPERATOR_NOTICE} &quot;You&quot; means the organisation or individual
        accessing the service. If you are accepting on behalf of an organisation, you
        represent that you have authority to bind that organisation.
      </p>

      <h2 style={S.h2}>2. Service description</h2>
      <p style={S.p}>
        ProcuLink is a B2B procurement automation platform. We provide purchase order
        parsing, field mapping, format transformation, and supplier delivery services.
        We reserve the right to modify or discontinue features with reasonable notice.
        We do not guarantee uninterrupted availability, but we maintain a commercially
        reasonable uptime standard.
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
        You own your purchase order data. By uploading content, you grant ProcuLink a
        limited, non-exclusive licence to process your data solely as necessary to
        provide the service. We do not claim ownership over your PO content, line items,
        or supplier relationships. We do not use your order content to train AI or
        machine-learning models.
      </p>

      <h2 style={S.h2}>5. Subscription and billing</h2>
      {/* Plan numbers come from src/lib/plans.ts (the shared frontend ladder,
          aligned with backend PlanConstants) so the Terms can never drift. */}
      <ul style={{ paddingLeft: 20, marginBottom: 14 }}>
        {PLANS.filter((p) => !p.hidden).map((p) => (
          <li key={p.id} style={S.li}>
            <strong>{p.name}</strong>:{" "}
            {p.id === "pilot"
              ? `14-day free trial — includes ${p.orderLimit} orders total, ${p.supplierLimit} supplier. On expiry, accounts become read-only. No Stripe card required.`
              : p.priceMonthly == null
                ? "Custom pricing. Contact us."
                : `€${p.priceMonthly.toLocaleString("en-IE")}/month — includes ${p.orderLimit?.toLocaleString("en-IE")} orders/month, ${p.supplierLimit} suppliers.`}
          </li>
        ))}
      </ul>
      <p style={S.p}>
        Paid plans include the monthly order volume listed above as a soft allowance, not a
        hard cap: order processing is never blocked when you exceed it. Orders processed above
        the included volume are billed automatically at €{OVERAGE_PER_ORDER_EUR.toFixed(2)} per
        additional order at the end of the billing period, and the metered overage is capped so
        your monthly total never exceeds the list price of the cheapest higher self-serve plan
        that covers your usage. The Pilot trial allowance is a hard limit (expired trials become
        read-only) and does not accrue overage.
      </p>
      <p style={S.p}>
        Subscriptions are billed monthly or annually via Stripe. No refunds are provided for
        partial periods, except where required by applicable law. We will provide 30 days&apos;
        notice to active subscribers before changing pricing.
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

      <h2 style={S.h2}>7. Limitation of liability</h2>
      <p style={S.p}>
        To the maximum extent permitted by applicable law, ProcuLink&apos;s total liability
        for any claim arising from your use of the service is limited to the fees paid
        by you in the three months preceding the claim. We are not liable for indirect,
        incidental, special, or consequential damages, including but not limited to loss
        of profit, data loss, or business interruption.
      </p>

      <h2 style={S.h2}>8. Governing law</h2>
      <p style={S.p}>
        These Terms are governed by the laws of the Republic of Estonia. Any disputes
        arising from these Terms or your use of ProcuLink are subject to the exclusive
        jurisdiction of the courts of Estonia, unless mandatory consumer-protection laws
        in your jurisdiction require otherwise.
      </p>

      <h2 style={S.h2}>9. Termination</h2>
      <p style={S.p}>
        Either party may terminate at any time. On termination, your access to the
        service ends. We will retain your data for the period described in our{" "}
        <Link href="/privacy" style={{ color: "#1E6D29", textDecoration: "underline" }}>Privacy Policy</Link>, after
        which it will be deleted. We may suspend access immediately if we detect material
        breach of these Terms.
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
