import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Acceptable Use Policy — ProcuLink",
  description: "How ProcuLink may and may not be used.",
};

const S = {
  page:    { maxWidth: 720, margin: "0 auto", padding: "56px 32px 80px" },
  h1:      { fontFamily: "'Bricolage Grotesque', Inter, sans-serif", fontSize: "clamp(28px, 4vw, 40px)", fontWeight: 700, letterSpacing: "-0.025em", color: "#0B1A2F", marginBottom: 8 },
  updated: { fontSize: 13, color: "#8A93A5", marginBottom: 40 },
  intro:   { fontSize: 15.5, lineHeight: 1.7, color: "#56627A", marginBottom: 40 },
  h2:      { fontFamily: "'Bricolage Grotesque', Inter, sans-serif", fontSize: 20, fontWeight: 600, color: "#0B1A2F", margin: "40px 0 12px", letterSpacing: "-0.015em" },
  p:       { fontSize: 14.5, lineHeight: 1.75, color: "#3D4A5C", marginBottom: 14 },
  li:      { fontSize: 14.5, lineHeight: 1.75, color: "#3D4A5C", marginBottom: 6 },
};

export default function AupPage() {
  return (
    <div style={S.page}>
      <h1 style={S.h1}>Acceptable Use Policy</h1>
      <p style={S.updated}>Effective: May 2026 · Version 1.0</p>

      <p style={S.intro}>
        This Acceptable Use Policy supplements the{" "}
        <Link href="/terms" style={{ color: "#1E66C9" }}>Terms of Service</Link> and applies to
        all use of the ProcuLink platform.
      </p>

      <h2 style={S.h2}>Permitted use</h2>
      <p style={S.p}>
        ProcuLink may be used by businesses and organisations for the purpose of automating
        legitimate procurement workflows: receiving, parsing, mapping, validating,
        transforming, and delivering purchase orders to suppliers and service providers.
      </p>

      <h2 style={S.h2}>Prohibited use</h2>
      <p style={S.p}>You must not use ProcuLink to:</p>
      <ul style={{ paddingLeft: 20, marginBottom: 14 }}>
        <li style={S.li}>Process orders for goods or services that are illegal in the supplier&apos;s or buyer&apos;s jurisdiction.</li>
        <li style={S.li}>Upload malware, exploits, or files crafted to attack ProcuLink, suppliers, or other tenants.</li>
        <li style={S.li}>Attempt to bypass authentication, organisation isolation, or rate limits.</li>
        <li style={S.li}>Reverse engineer, decompile, or extract proprietary algorithms or models.</li>
        <li style={S.li}>Send unsolicited bulk messages or use delivery destinations to spam recipients.</li>
        <li style={S.li}>Process the personal data of natural persons unrelated to procurement (for example, marketing email lists).</li>
        <li style={S.li}>Share account credentials, sublicense access, or resell the Service without a written agreement.</li>
        <li style={S.li}>Operate workloads that materially degrade Service availability for other customers.</li>
      </ul>

      <h2 style={S.h2}>Reporting abuse</h2>
      <p style={S.p}>
        To report abuse of the ProcuLink platform, email{" "}
        <a href="mailto:abuse@proculink.com" style={{ color: "#1E66C9" }}>abuse@proculink.com</a>.
        Include the affected organisation, supplier, or delivery destination, and a description
        of the issue. We will respond within 2 business days.
      </p>

      <h2 style={S.h2}>Enforcement</h2>
      <p style={S.p}>
        We may suspend or terminate access for violations of this policy, with or without
        notice depending on severity. Where suspension is preventive (for example, an active
        attack), we will document and notify the responsible account contact promptly.
      </p>

      <p style={{ ...S.p, marginTop: 40, paddingTop: 24, borderTop: "1px solid #E2E6EE" }}>
        <Link href="/terms" style={{ color: "#1E66C9", marginRight: 16 }}>Terms of Service</Link>
        <Link href="/privacy" style={{ color: "#1E66C9", marginRight: 16 }}>Privacy Policy</Link>
        <Link href="/security" style={{ color: "#1E66C9" }}>Security</Link>
      </p>
    </div>
  );
}
