import { pageMetadata } from "@/lib/seo";
import Link from "next/link";

export const metadata = pageMetadata({
  path: "/customers",
  title: "Customers — ProcuLink",
  description:
    "Procurement teams using ProcuLink to deliver purchase orders to their suppliers, and what our early pilots run through it.",
});

const S = {
  page:   { maxWidth: 880, margin: "0 auto", padding: "72px 32px 80px" },
  h1:     { fontFamily: "'Bricolage Grotesque', Inter, sans-serif", fontSize: "clamp(30px, 4vw, 46px)", fontWeight: 700, letterSpacing: "-0.025em", color: "#0B1A2F", marginBottom: 12 },
  sub:    { fontSize: 16, color: "#56627A", lineHeight: 1.6, marginBottom: 48, maxWidth: 600 },
  grid:   { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 18 },
  card:   { background: "#FFFFFF", border: "1px solid #E2E6EE", borderRadius: 12, padding: 22, boxShadow: "0 4px 14px rgba(11,26,47,0.04)" },
  badge:  { display: "inline-block", padding: "3px 9px", background: "#F6F7FA", border: "1px solid #E2E6EE", borderRadius: 999, fontSize: 11, fontWeight: 600, color: "#56627A", letterSpacing: "0.04em", textTransform: "uppercase" as const, marginBottom: 14 },
  cardTitle: { fontFamily: "'Bricolage Grotesque', Inter, sans-serif", fontSize: 17, fontWeight: 600, color: "#0B1A2F", margin: "0 0 10px" },
  cardBlurb: { fontSize: 13.5, color: "#56627A", margin: 0, lineHeight: 1.6 },
  cta:    { display: "inline-block", marginTop: 56, background: "#0B1A2F", color: "#fff", textDecoration: "none", padding: "12px 22px", borderRadius: 8, fontWeight: 600, fontSize: 14 },
};

export default function CustomersPage() {
  return (
    <div style={S.page}>
      <h1 style={S.h1}>Procurement teams using ProcuLink.</h1>
      <p style={S.sub}>
        We&apos;re in early pilots with B2B procurement teams across Estonia and the EU. Public case studies will appear here as pilots conclude.
      </p>

      <div style={S.grid}>
        <article style={S.card}>
          <span style={S.badge}>Coming soon — anonymised pilot</span>
          <h2 style={S.cardTitle}>Mid-market wholesaler · ~120 POs/month</h2>
          <p style={S.cardBlurb}>
            Replaces manual reformatting of CSV purchase orders for five rotating suppliers. Pilot scoped to a single buyer team.
          </p>
        </article>

        <article style={S.card}>
          <span style={S.badge}>Coming soon — anonymised pilot</span>
          <h2 style={S.cardTitle}>Industrial distributor · ~500 POs/month</h2>
          <p style={S.cardBlurb}>
            HTTP webhook delivery into a partner ERP, with PO field mapping handled per-supplier and IMAP ingestion as a fallback.
          </p>
        </article>
      </div>

      <Link href="/pricing" style={S.cta}>See pricing →</Link>
    </div>
  );
}
