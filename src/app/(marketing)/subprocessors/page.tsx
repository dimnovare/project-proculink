import { pageMetadata } from "@/lib/seo";
import Link from "next/link";
import {
  SUBPROCESSORS,
  SUBPROCESSORS_UPDATED,
  SUBPROCESSOR_PLANNED_CHANGES,
} from "@/lib/subprocessors";

export const metadata = pageMetadata({
  path: "/subprocessors",
  title: "Subprocessors — ProcuLink",
  description:
    "The current list of ProcuLink subprocessors and what each one processes, any planned change and its effective date, and how to object to a new subprocessor.",
});

const S = {
  page:    { maxWidth: 760, margin: "0 auto", padding: "56px 32px 80px" },
  h1:      { fontFamily: "'Bricolage Grotesque', Inter, sans-serif", fontSize: "clamp(28px, 4vw, 40px)", fontWeight: 700, letterSpacing: "-0.025em", color: "#0B1A2F", marginBottom: 8 },
  updated: { fontSize: 13, color: "var(--ink-faint)", marginBottom: 40 },
  intro:   { fontSize: 15.5, lineHeight: 1.7, color: "#56627A", marginBottom: 40 },
  h2:      { fontFamily: "'Bricolage Grotesque', Inter, sans-serif", fontSize: 20, fontWeight: 600, color: "#0B1A2F", margin: "40px 0 12px", letterSpacing: "-0.015em" },
  p:       { fontSize: 14.5, lineHeight: 1.75, color: "#3D4A5C", marginBottom: 14 },
  table:   { width: "100%", borderCollapse: "collapse" as const, fontSize: 13.5, marginBottom: 20 },
  th:      { textAlign: "left" as const, padding: "10px 12px", background: "#F6F7FA", borderBottom: "1px solid #E2E6EE", color: "#0B1A2F", fontWeight: 600 },
  td:      { padding: "10px 12px", borderBottom: "1px solid #F1F3F7", color: "#3D4A5C", verticalAlign: "top" as const },
  callout: { background: "#F6F7FA", border: "1px solid #E2E6EE", borderLeft: "3px solid #2E8E3A", borderRadius: 8, padding: "16px 18px", margin: "24px 0", fontSize: 13.5, lineHeight: 1.6, color: "#3D4A5C" },
};

// The subprocessor list itself lives in src/lib/subprocessors.ts — the single
// source shared with /security and /privacy so the lists can never diverge.

export default function SubprocessorsPage() {
  return (
    <div style={S.page}>
      <h1 style={S.h1}>Subprocessors</h1>
      <p style={S.updated}>
        Subprocessor list last changed: {SUBPROCESSORS_UPDATED} · Page version 1.2 (24 July 2026)
      </p>

      <p style={S.intro}>
        ProcuLink uses the following subprocessors to deliver the Service. Each subprocessor
        is bound by a written data-processing agreement aligned with the requirements of
        GDPR Article 28.
      </p>

      <h2 style={S.h2}>Current subprocessors</h2>
      <table style={S.table}>
        <thead>
          <tr>
            <th style={S.th}>Subprocessor</th>
            <th style={S.th}>Purpose</th>
            <th style={S.th}>Location</th>
            <th style={S.th}>Contract</th>
          </tr>
        </thead>
        <tbody>
          {SUBPROCESSORS.map((s) => (
            <tr key={s.name}>
              <td style={{ ...S.td, fontWeight: 600, color: "#0B1A2F" }}>{s.name}</td>
              <td style={S.td}>{s.purpose}</td>
              <td style={S.td}>{s.location}</td>
              <td style={S.td}>{s.contract}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 style={S.h2}>Planned changes</h2>
      {SUBPROCESSOR_PLANNED_CHANGES.length === 0 ? (
        <p style={S.p}>
          No subprocessor additions or replacements are currently planned. Anything pending
          appears here, with its effective date, before it starts processing customer data.
        </p>
      ) : (
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Subprocessor</th>
              <th style={S.th}>Purpose</th>
              <th style={S.th}>Change</th>
              <th style={S.th}>Notice published</th>
              <th style={S.th}>Effective</th>
            </tr>
          </thead>
          <tbody>
            {SUBPROCESSOR_PLANNED_CHANGES.map((c) => (
              <tr key={c.name}>
                <td style={{ ...S.td, fontWeight: 600, color: "#0B1A2F" }}>{c.name}</td>
                <td style={S.td}>{c.purpose}</td>
                <td style={S.td}>{c.change}</td>
                <td style={S.td}>{c.noticePublished}</td>
                <td style={{ ...S.td, fontWeight: 600, color: "#0B1A2F" }}>{c.effective}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div style={S.callout}>
        <strong>30 days&apos; advance notice, published here.</strong> Before a new or
        replacement subprocessor starts processing customer data, it is published under
        Planned changes above — with the date it takes effect — at least 30 days beforehand.
        This page is the source of truth for that commitment: the list carries the date it
        last changed, and a pending change carries the date its notice went up, so you can
        check the 30 days rather than take our word for it.
      </div>

      <h2 style={S.h2}>How to object</h2>
      <p style={S.p}>
        Customers who object to a planned subprocessor have 14 days from the notice date shown
        above to raise the objection in writing, to{" "}
        <a href="mailto:legal@proculink.eu" style={{ color: "#1E6D29", textDecoration: "underline" }}>legal@proculink.eu</a>.
        Where the objection cannot be resolved, the customer may terminate the subscription
        without further fees for the unused remainder of the term.
      </p>
      <p style={S.p}>
        We do not operate a notification mailing list — the notice is the dated publication on
        this page, which means it does not depend on anyone remembering to send it. Customers
        who need the notice delivered to a named contact can have that written into their
        agreement; email the address above.
      </p>

      <p style={{ ...S.p, marginTop: 40, paddingTop: 24, borderTop: "1px solid #E2E6EE" }}>
        <Link href="/dpa" style={{ color: "#1E6D29", marginRight: 16 }}>Data Processing Addendum</Link>
        <Link href="/privacy" style={{ color: "#1E6D29", marginRight: 16 }}>Privacy Policy</Link>
        <Link href="/security" style={{ color: "#1E6D29" }}>Security</Link>
      </p>
    </div>
  );
}
