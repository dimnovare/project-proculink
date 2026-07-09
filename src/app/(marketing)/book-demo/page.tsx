import type { Metadata } from "next";
import { BookDemoForm } from "@/components/marketing/BookDemoForm";

export function generateMetadata(): Metadata {
  return {
    title: "Book a demo — ProcuLink",
    description:
      "Request a 30-minute walkthrough of ProcuLink on your own sample order — we'll reply within 1 business day to schedule.",
  };
}

const S = {
  page:  { maxWidth: 720, margin: "0 auto", padding: "56px 32px 80px" },
  badge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    height: 26,
    padding: "0 12px",
    borderRadius: 13,
    background: "var(--brand-blue-soft)",
    color: "var(--brand-blue-deep)",
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.07em",
    textTransform: "uppercase" as const,
    marginBottom: 16,
  },
  h1:    { fontFamily: "'Bricolage Grotesque', Inter, sans-serif", fontSize: "clamp(28px, 4vw, 40px)", fontWeight: 700, letterSpacing: "-0.025em", color: "#0B1A2F", marginBottom: 10 },
  intro: { fontSize: 15.5, lineHeight: 1.7, color: "#56627A", marginBottom: 28, maxWidth: 560 },
  card:  {
    background: "#F6F7FA",
    border: "1px solid #E2E6EE",
    borderLeft: "3px solid #2E8E3A",
    borderRadius: 8,
    padding: "18px 22px",
    marginBottom: 28,
  },
  cardTitle: { fontFamily: "'Bricolage Grotesque', Inter, sans-serif", fontSize: 15, fontWeight: 600, color: "#0B1A2F", marginBottom: 10 },
  li:    { fontSize: 14, lineHeight: 1.7, color: "#3D4A5C", marginBottom: 6 },
};

export default function BookDemoPage() {
  return (
    <div style={S.page}>
      <span style={S.badge}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--brand-blue)", display: "inline-block" }} />
        Live demo
      </span>
      <h1 style={S.h1}>Book a demo</h1>
      <p style={S.intro}>
        A 30-minute walkthrough of your order flow — we&apos;ll show it on your own
        sample order, not a canned deck. Tell us a little about how orders reach
        you today and we&apos;ll reply within 1 business day to schedule.
      </p>

      <div style={S.card}>
        <p style={S.cardTitle}>What to expect</p>
        <ul style={{ paddingLeft: 20, margin: 0 }}>
          <li style={S.li}>
            <strong>Bring a real order</strong> — a PDF, spreadsheet, or EDI file you handle
            today. We&apos;ll parse and map it live during the call.
          </li>
          <li style={S.li}>
            <strong>See your output</strong> — the order transformed into the format your
            counterparty needs, ready to deliver.
          </li>
          <li style={S.li}>
            <strong>No obligation</strong> — you&apos;ll leave knowing whether ProcuLink fits
            your flow, either way.
          </li>
        </ul>
      </div>

      <BookDemoForm />
    </div>
  );
}
