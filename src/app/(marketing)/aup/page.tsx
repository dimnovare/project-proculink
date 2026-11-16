import { pageMetadata } from "@/lib/seo";
import Link from "next/link";
import { LegalH2, LegalPage } from "@/components/marketing/LegalPage";

export const metadata = pageMetadata({
  path: "/aup",
  title: "Acceptable Use Policy — ProcuLink",
  description:
    "What ProcuLink may and may not be used for: permitted use, prohibited use, how to report abuse, and how the policy is enforced.",
});

export default function AupPage() {
  return (
    // FOUNDER DECISION: set the effective month when this version is published.
    <LegalPage title="Acceptable Use Policy" updated="Effective: November 2026 · Version 1.1" path="/aup">
      <p>
        This Acceptable Use Policy supplements the{" "}
        <Link href="/terms">Terms of Service</Link> and applies to
        all use of the ProcuLink platform.
      </p>

      <LegalH2>Permitted use</LegalH2>
      <p>
        ProcuLink may be used by businesses and organisations, for business purposes only, to
        automate legitimate workflows around business documents: receiving, reading, checking,
        transforming and delivering documents such as invoices, purchase orders and delivery
        notes to the systems, suppliers and service providers you choose.
      </p>

      <LegalH2>Prohibited use</LegalH2>
      <p>You must not use ProcuLink to:</p>
      <ul>
        <li>Process orders or invoices for goods or services that are illegal in the supplier&apos;s or buyer&apos;s jurisdiction.</li>
        <li>Upload malware, exploits, or files crafted to attack ProcuLink, suppliers, or other tenants.</li>
        <li>Attempt to bypass authentication, organisation isolation, or rate limits.</li>
        <li>Reverse engineer, decompile, or extract proprietary algorithms or models.</li>
        <li>Send unsolicited bulk messages or use delivery destinations to spam recipients.</li>
        <li>Process the personal data of natural persons unrelated to procurement or invoicing (for example, marketing email lists).</li>
        <li>Share account credentials, sublicense access, or resell the Service without a written agreement.</li>
        <li>Operate workloads that materially degrade Service availability for other customers.</li>
      </ul>

      <LegalH2>Reporting abuse</LegalH2>
      <p>
        To report abuse of the ProcuLink platform, email{" "}
        <a href="mailto:abuse@proculink.eu">abuse@proculink.eu</a>.
        Include the affected organisation, supplier, or delivery destination, and a description
        of the issue. We will respond within 2 business days.
      </p>

      <LegalH2>Enforcement</LegalH2>
      <p>
        We may suspend or terminate access for violations of this policy, with or without
        notice depending on severity. Where suspension is preventive (for example, an active
        attack), we will document and notify the responsible account contact promptly.
      </p>
    </LegalPage>
  );
}
