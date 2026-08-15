import { pageMetadata } from "@/lib/seo";
import "./print.css";
import { LEGAL_ENTITY, LEGAL_ENTITY_REFERENCE } from "@/lib/legal-entity";
import { requiresPlan } from "@/lib/gatedCapabilities";
import { OVERAGE_PER_ORDER_EUR, PLANS } from "@/lib/plans";

export const metadata = pageMetadata({
  path: "/one-pager",
  title: "ProcuLink — one-pager",
  description:
    "Print-friendly one-page overview of ProcuLink for procurement teams: what it does, how an order moves through it, and what each plan includes.",
});

const S = {
  brand:   { fontFamily: "'Bricolage Grotesque', Inter, sans-serif", fontSize: 22, fontWeight: 700, color: "#0B1A2F", marginBottom: 24, letterSpacing: "-0.02em" },
  h1:      { fontFamily: "'Bricolage Grotesque', Inter, sans-serif", fontSize: 30, fontWeight: 700, color: "#0B1A2F", margin: "0 0 10px", letterSpacing: "-0.02em" },
  lead:    { fontSize: 15, color: "#3D4A5C", lineHeight: 1.5, margin: "0 0 28px", maxWidth: 640 },
  h2:      { fontFamily: "'Bricolage Grotesque', Inter, sans-serif", fontSize: 14, fontWeight: 700, color: "#0B1A2F", textTransform: "uppercase" as const, letterSpacing: "0.05em", margin: "0 0 8px" },
  p:       { fontSize: 13.5, color: "#3D4A5C", lineHeight: 1.55, margin: "0 0 10px" },
  threeCol:{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 22, margin: "16px 0 28px" },
  step:    { padding: 12, background: "#F6F7FA", border: "1px solid #E2E6EE", borderRadius: 8 },
  stepN:   { fontFamily: "'Bricolage Grotesque', Inter, sans-serif", fontSize: 18, fontWeight: 700, color: "#2E8E3A" },
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
        SFTP, or email.
      </p>

      <h2 style={S.h2}>How it works</h2>
      <div style={S.threeCol}>
        {[
          // The IMAP half of this line named no tier for five releases. Manual upload is on every
          // plan; every automatic intake route — inbound email, IMAP, SFTP and S3 — is gated, and
          // on a printed sheet there is nowhere to click to find that out.
          { n: "1", t: "Import", d: `Upload CSV / XLSX / PDF on any plan, or let ProcuLink poll an IMAP mailbox — inbound email, IMAP, SFTP and S3 intake are ${requiresPlan("emailIngestion", "sftpIngestion", "s3Ingestion")}.` },
          // This sheet is print collateral: it travels detached from the site, so a reader
          // cannot click through to /formats or /pricing to discover that two of the things
          // listed here are gated. cXML output gates at Operations and the Erply/Directo ERP
          // adapters at Enterprise, so both say so on the page itself. The tier names are
          // derived from the mirrored gate table, never typed.
          { n: "2", t: "Map + transform", d: `Per-supplier field + item-code mapping with AI suggestions. Output to CSV, XML, JSON — cXML on ${requiresPlan("cxml")}.` },
          { n: "3", t: "Deliver", d: `HTTP webhook on ${requiresPlan("webhookDelivery")}; SFTP/FTPS, email and download on every plan. Erply and Directo ERP adapters on ${requiresPlan("erpConnectors")}. Per-order audit trail and delivery status.` },
        ].map((s) => (
          <div key={s.n} style={S.step}>
            <div style={S.stepN}>0{s.n}</div>
            <p style={S.stepT}>{s.t}</p>
            <p style={S.stepD}>{s.d}</p>
          </div>
        ))}
      </div>

      <h2 style={S.h2}>Pricing</h2>
      {/* Rows are built from src/lib/plans.ts (the shared plan ladder, aligned
          with backend PlanConstants) so this one-pager can never go stale. */}
      <table style={S.table}>
        <thead><tr><th style={S.th}>Plan</th><th style={S.th}>Price</th><th style={S.th}>Orders / month</th><th style={S.th}>Suppliers</th></tr></thead>
        <tbody>
          {PLANS.filter((p) => !p.hidden).map((p) => (
            <tr key={p.id}>
              <td style={S.td}>{p.name}</td>
              <td style={S.td}>
                {p.id === "pilot"
                  ? "Free, 14 days"
                  : p.priceMonthly == null
                    ? `Custom, ${p.priceCadence}`
                    : `€${p.priceMonthly.toLocaleString("en-IE")}/mo`}
              </td>
              <td style={S.td}>
                {p.orderLimit == null
                  ? "Custom"
                  : p.orderLimitIsMonthly
                    ? p.orderLimit.toLocaleString("en-IE")
                    : `${p.orderLimit} total`}
              </td>
              <td style={S.td}>{p.supplierLimit == null ? "Custom" : p.supplierLimit}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ ...S.p, marginTop: -14, fontSize: 12 }}>
        Paid plans never block at the included volume — additional orders bill automatically at
        €{OVERAGE_PER_ORDER_EUR.toFixed(2)}/order.
      </p>

      {/*
        This section was the bare fragment "EU-region infrastructure." — the exact
        unqualified claim retracted from /security on 2026-07-30, surviving here
        because the retraction was applied page by page. It is the worst place for
        it to survive: this page is print/PDF sales collateral, so it travels
        DETACHED from the site and a reader cannot click through to the
        qualification. Whatever this page says has to stand on its own.
      */}
      <h2 style={S.h2}>Trust + security</h2>
      <p style={S.p}>
        Order files and the database behind them are EU-region. Sign-in, AI extraction, payments and
        email — in both directions, including the purchase orders we email to your suppliers — run on
        named US subprocessors under standard contractual clauses. AES-256-GCM for delivery
        credentials and IMAP passwords. Org-scoped query isolation.
        GDPR-aligned DPA available at <strong>proculink.eu/dpa</strong>. Every subprocessor, with its
        location, at <strong>proculink.eu/subprocessors</strong>.
      </p>

      <div style={S.contact}>
        {LEGAL_ENTITY.productName} is a product of {LEGAL_ENTITY_REFERENCE}.<br />
        hello@proculink.eu · support@proculink.eu · proculink.eu
      </div>
    </div>
  );
}
