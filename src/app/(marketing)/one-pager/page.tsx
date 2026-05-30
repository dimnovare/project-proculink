import type { Metadata } from "next";
import "./print.css";

export const metadata: Metadata = {
  title: "ProcuLink — one-pager",
  description: "Print-friendly one-page overview of ProcuLink for procurement teams.",
};

const S = {
  brand:   { fontFamily: "'Bricolage Grotesque', Inter, sans-serif", fontSize: 22, fontWeight: 700, color: "#0B1A2F", marginBottom: 24, letterSpacing: "-0.02em" },
  h1:      { fontFamily: "'Bricolage Grotesque', Inter, sans-serif", fontSize: 30, fontWeight: 700, color: "#0B1A2F", margin: "0 0 10px", letterSpacing: "-0.02em" },
  lead:    { fontSize: 15, color: "#3D4A5C", lineHeight: 1.5, margin: "0 0 28px", maxWidth: 640 },
  h2:      { fontFamily: "'Bricolage Grotesque', Inter, sans-serif", fontSize: 14, fontWeight: 700, color: "#0B1A2F", textTransform: "uppercase" as const, letterSpacing: "0.05em", margin: "0 0 8px" },
  p:       { fontSize: 13.5, color: "#3D4A5C", lineHeight: 1.55, margin: "0 0 10px" },
  threeCol:{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 22, margin: "16px 0 28px" },
  step:    { padding: 12, background: "#F6F7FA", border: "1px solid #E2E6EE", borderRadius: 8 },
  stepN:   { fontFamily: "'Bricolage Grotesque', Inter, sans-serif", fontSize: 18, fontWeight: 700, color: "#1E66C9" },
  stepT:   { fontSize: 13, fontWeight: 600, color: "#0B1A2F", margin: "4px 0 4px" },
  stepD:   { fontSize: 12, color: "#56627A", lineHeight: 1.5, margin: 0 },
  table:   { width: "100%", borderCollapse: "collapse" as const, fontSize: 12.5, marginBottom: 24 },
  th:      { textAlign: "left" as const, padding: "8px 10px", background: "#F6F7FA", borderBottom: "1px solid #E2E6EE", color: "#0B1A2F", fontWeight: 600 },
  td:      { padding: "8px 10px", borderBottom: "1px solid #F1F3F7", color: "#3D4A5C" },
  contact: { fontSize: 12, color: "#56627A", marginTop: 12, borderTop: "1px solid #E2E6EE", paddingTop: 12 },
};

export default function OnePagerPage() {
  return (
    <div className="proculink-one-pager-root">
      <p style={S.brand}>ProcuLink</p>

      <h1 style={S.h1}>Stop reformatting purchase orders. Start delivering them.</h1>
      <p style={S.lead}>
        ProcuLink is B2B outbound procurement automation for buyer teams. We import the
        POs you send, validate them, map fields and item codes per supplier, transform
        to the format each supplier requires, and deliver them automatically over HTTP,
        ERP, or email.
      </p>

      <h2 style={S.h2}>How it works</h2>
      <div style={S.threeCol}>
        {[
          { n: "1", t: "Import", d: "Upload CSV / XLSX / PDF, or let ProcuLink poll an IMAP mailbox." },
          { n: "2", t: "Map + transform", d: "Per-supplier field + item-code mapping with AI suggestions. Output to CSV, XML, cXML, JSON." },
          { n: "3", t: "Deliver", d: "HTTP webhook, Erply, Directo, or download. Full audit trail and delivery status." },
        ].map((s) => (
          <div key={s.n} style={S.step}>
            <div style={S.stepN}>0{s.n}</div>
            <p style={S.stepT}>{s.t}</p>
            <p style={S.stepD}>{s.d}</p>
          </div>
        ))}
      </div>

      <h2 style={S.h2}>Pricing</h2>
      <table style={S.table}>
        <thead><tr><th style={S.th}>Plan</th><th style={S.th}>Price</th><th style={S.th}>Orders / month</th><th style={S.th}>Suppliers</th></tr></thead>
        <tbody>
          <tr><td style={S.td}>Pilot</td><td style={S.td}>Free, 14 days</td><td style={S.td}>20 total</td><td style={S.td}>1</td></tr>
          <tr><td style={S.td}>Growth</td><td style={S.td}>€149/mo</td><td style={S.td}>150</td><td style={S.td}>5</td></tr>
          <tr><td style={S.td}>Operations</td><td style={S.td}>€399/mo</td><td style={S.td}>500</td><td style={S.td}>10</td></tr>
          <tr><td style={S.td}>Integration</td><td style={S.td}>€999/mo</td><td style={S.td}>1,000</td><td style={S.td}>20</td></tr>
          <tr><td style={S.td}>Enterprise</td><td style={S.td}>From €2,500/mo</td><td style={S.td}>Custom</td><td style={S.td}>Custom</td></tr>
        </tbody>
      </table>

      <h2 style={S.h2}>Trust + security</h2>
      <p style={S.p}>
        EU-region infrastructure. AES-256-GCM for delivery credentials and IMAP passwords. Org-scoped query isolation.
        GDPR-aligned DPA available at <strong>proculink.com/dpa</strong>. Subprocessors at <strong>proculink.com/subprocessors</strong>.
      </p>

      <div style={S.contact}>
        ProcuLink OÜ · Registration 17477775 · Katusepapi 6, Tallinn, Estonia<br />
        hello@proculink.com · support@proculink.com · proculink.com
      </div>
    </div>
  );
}
