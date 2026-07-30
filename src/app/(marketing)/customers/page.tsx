import { pageMetadata } from "@/lib/seo";
import Link from "next/link";

// ─────────────────────────────────────────────────────────────────────────────
// This page is deliberately empty of case studies.
//
// It previously shipped two "Coming soon — anonymised pilot" cards describing a
// mid-market wholesaler at ~120 POs/month and an industrial distributor at
// ~500 POs/month. Neither engagement exists. Anonymising a profile hides an
// identity; it does not make an invented one true, so the cards were a
// fabrication with a privacy alibi.
//
// The replacement rule: nothing goes on this page until a real customer agrees
// to be named, on a date, with numbers they have signed off on. Until then the
// honest offer is verifiable capability — /formats and /security — instead of
// social proof nobody can check.
// ─────────────────────────────────────────────────────────────────────────────

export const metadata = pageMetadata({
  path: "/customers",
  title: "Customer references — ProcuLink",
  description:
    "We have no public customer references yet. What you can check instead: the formats and channels ProcuLink actually supports, and where your data is stored and processed.",
});

const S = {
  page:     { maxWidth: 880, margin: "0 auto", padding: "72px 32px 80px" },
  h1:       { fontFamily: "'Bricolage Grotesque', Inter, sans-serif", fontSize: "clamp(30px, 4vw, 46px)", fontWeight: 700, letterSpacing: "-0.025em", color: "#0B1A2F", marginBottom: 14, textWrap: "balance" as const },
  sub:      { fontSize: 16, color: "#56627A", lineHeight: 1.65, marginBottom: 40, maxWidth: 620 },
  panel:    { background: "#F6F7FA", border: "1px solid #E2E6EE", borderLeft: "3px solid #2E8E3A", borderRadius: 10, padding: "20px 22px", marginBottom: 48 },
  panelH:   { fontFamily: "'Bricolage Grotesque', Inter, sans-serif", fontSize: 15, fontWeight: 600, color: "#0B1A2F", margin: "0 0 8px" },
  panelP:   { fontSize: 14, color: "#3D4A5C", lineHeight: 1.7, margin: 0 },
  h2:       { fontFamily: "'Bricolage Grotesque', Inter, sans-serif", fontSize: 20, fontWeight: 600, letterSpacing: "-0.015em", color: "#0B1A2F", margin: "0 0 16px" },
  grid:     { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 18 },
  card:     { display: "block", background: "#FFFFFF", border: "1px solid #E2E6EE", borderRadius: 12, padding: 22, boxShadow: "0 4px 14px rgba(11,26,47,0.04)", textDecoration: "none" },
  cardTitle:{ fontFamily: "'Bricolage Grotesque', Inter, sans-serif", fontSize: 16, fontWeight: 600, color: "#0B1A2F", margin: "0 0 8px" },
  cardBlurb:{ fontSize: 13.5, color: "#56627A", margin: 0, lineHeight: 1.6 },
  cta:      { display: "inline-block", marginTop: 48, background: "#0B1A2F", color: "#fff", textDecoration: "none", padding: "12px 22px", border: "1px solid transparent", borderRadius: 8, fontWeight: 600, fontSize: 14 },
  ctaAlt:   { display: "inline-block", marginTop: 48, marginLeft: 12, color: "#0B1A2F", textDecoration: "none", padding: "12px 22px", border: "1px solid #E2E6EE", borderRadius: 8, fontWeight: 600, fontSize: 14 },
};

const CHECKABLE: Array<{ href: string; title: string; blurb: string }> = [
  {
    href: "/formats",
    title: "Formats and channels",
    blurb: "Every file format we read, every format we produce, and every way we can deliver an order — with the ones that are not finished marked as unfinished.",
  },
  {
    href: "/security",
    title: "Security and data handling",
    blurb: "Where your order files and database live, which subprocessors touch them, and which certifications we do not hold yet.",
  },
  {
    href: "/pricing",
    title: "Pricing",
    blurb: "Every plan, what happens when you go over the included volume, and what the setup fee covers. No quote required to see a number.",
  },
];

export default function CustomersPage() {
  return (
    <div style={S.page}>
      <h1 style={S.h1}>No public customer references yet.</h1>
      <p style={S.sub}>
        When a customer agrees to be named, their story will appear here — with a date, a real
        company, and numbers they have approved. Until then this page stays empty on purpose.
      </p>

      <div style={S.panel}>
        <p style={S.panelH}>Why it is empty</p>
        <p style={S.panelP}>
          ProcuLink went live in June 2026. We could fill this page with anonymous profiles —
          &ldquo;a mid-sized wholesaler, roughly 120 purchase orders a month&rdquo; — and you would
          have no way to check a word of it. People who buy procurement software have read enough
          of those. We would rather show you what the product does and let you try it on your own
          orders.
        </p>
      </div>

      <h2 style={S.h2}>What you can check instead</h2>
      <div style={S.grid}>
        {CHECKABLE.map((c) => (
          <Link key={c.href} href={c.href} style={S.card}>
            <h3 style={S.cardTitle}>{c.title}</h3>
            <p style={S.cardBlurb}>{c.blurb}</p>
          </Link>
        ))}
      </div>

      <Link href="/sign-up" style={S.cta}>Start free →</Link>
      <Link href="/book-demo" style={S.ctaAlt}>Book a demo</Link>
    </div>
  );
}
