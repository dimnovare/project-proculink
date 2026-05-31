import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Changelog — ProcuLink",
  description:
    "A record of every improvement shipped to ProcuLink — new features, integrations, and platform changes.",
  openGraph: {
    title: "Changelog — ProcuLink",
    description:
      "A record of every improvement shipped to ProcuLink — new features, integrations, and platform changes.",
    url: "https://proculink.com/changelog",
  },
};

const ENTRIES = [
  {
    version: "v1.4",
    date: "May 2026",
    latest: true,
    items: [
      "Production UI polish across all screens — mobile-first responsive layouts, empty states, and interaction feedback",
      "IMAP email polling — Integration+ plans now auto-ingest purchase orders from designated mailboxes",
      "ERP connector adapters for Erply and Directo — deliver POs directly to your ERP",
      "Inbound invoices and advance shipping notices — receive and approve supplier documents in one place",
    ],
  },
  {
    version: "v1.3",
    date: "April 2026",
    latest: false,
    items: [
      "PDF ingestion — text-based PDF purchase orders now accepted alongside CSV and XLSX",
      "AI mapping suggestions — unresolved line items now show AI-suggested supplier codes with confidence scores",
    ],
  },
  {
    version: "v1.2",
    date: "March 2026",
    latest: false,
    items: [
      "Supplier delivery configuration — HTTP delivery with test-fire, encrypted credentials, retry logic",
      "PO field mapping engine — custom per-supplier CSV column mapping with visual editor",
      "Webhooks — register HTTP endpoints to receive real-time delivery events",
    ],
  },
  {
    version: "v1.1",
    date: "February 2026",
    latest: false,
    items: [
      "Stripe billing — Growth, Operations, and Integration plans with self-serve Checkout and Portal",
      "Audit log — full event history for every order",
      "Connectors page — overview of all active delivery channels",
    ],
  },
  {
    version: "v1.0",
    date: "January 2026",
    latest: false,
    items: [
      "Initial release: parse → validate → review → transform → deliver workflow",
      "Supplier library, item mappings, validation rules, output templates",
      "Multi-tenant with Clerk auth, EF Core + Postgres",
    ],
  },
];

export default function ChangelogPage() {
  return (
    <div style={{ background: "#FFFFFF" }}>
      {/* Hero */}
      <section
        style={{
          background: "#F6F7FA",
          padding: "64px 32px 48px",
          textAlign: "center",
          borderBottom: "1px solid #E2E6EE",
        }}
      >
        <div style={{ maxWidth: 680, margin: "0 auto" }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              border: "1px solid #D6DDE8",
              borderRadius: 999,
              padding: "5px 10px",
              background: "#FFFFFF",
              color: "#56627A",
              fontSize: 12,
              fontWeight: 700,
              marginBottom: 20,
            }}
          >
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#28C55E", display: "inline-block" }} />
            v1.4 — Latest
          </div>
          <h1
            style={{
              fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
              fontSize: "clamp(32px, 5vw, 52px)",
              fontWeight: 750,
              color: "#0B1A2F",
              marginBottom: 14,
              lineHeight: 1.05,
            }}
          >
            Changelog
          </h1>
          <p style={{ fontSize: 16, color: "#56627A", maxWidth: 460, margin: "0 auto", lineHeight: 1.6 }}>
            What&apos;s new in ProcuLink — features, integrations, and platform improvements.
          </p>
        </div>
      </section>

      {/* Entries */}
      <section style={{ padding: "64px 32px 96px" }}>
        <div style={{ maxWidth: 760, margin: "0 auto", display: "flex", flexDirection: "column", gap: 0 }}>
          {ENTRIES.map((entry, i) => (
            <article
              key={entry.version}
              style={{
                display: "grid",
                gridTemplateColumns: "clamp(100px, 20%, 140px) 1fr",
                gap: "0 clamp(16px, 4vw, 40px)",
                paddingBottom: 48,
              }}
            >
              {/* Left — version label + timeline */}
              <div style={{ paddingTop: 4, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 6, position: "relative" }}>
                <span
                  style={{
                    display: "inline-block",
                    background: entry.latest ? "#28C55E" : "#0B1A2F",
                    color: "#FFFFFF",
                    fontSize: 11,
                    fontWeight: 800,
                    letterSpacing: "0.06em",
                    padding: "4px 10px",
                    borderRadius: 5,
                  }}
                >
                  {entry.version}
                </span>
                {entry.latest && (
                  <span
                    style={{
                      display: "inline-block",
                      background: "#E2F1E2",
                      color: "#1E6D29",
                      fontSize: 10,
                      fontWeight: 700,
                      padding: "2px 7px",
                      borderRadius: 4,
                    }}
                  >
                    Latest
                  </span>
                )}
                <span style={{ fontSize: 12, color: "#8A93A5", fontWeight: 500, marginTop: 2 }}>
                  {entry.date}
                </span>
                {/* Timeline connector */}
                {i < ENTRIES.length - 1 && (
                  <div
                    style={{
                      position: "absolute",
                      top: 60,
                      left: 19,
                      width: 1,
                      bottom: -48,
                      background: "#E2E6EE",
                    }}
                  />
                )}
              </div>

              {/* Right — feature card */}
              <div
                style={{
                  background: "#FFFFFF",
                  border: "1px solid #E2E6EE",
                  borderLeft: `3px solid ${entry.latest ? "#28C55E" : "#C6CDDA"}`,
                  borderRadius: 8,
                  padding: "20px 24px",
                  boxShadow: "0 1px 4px rgba(11,26,47,0.05)",
                }}
              >
                <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 12 }}>
                  {entry.items.map((item, j) => (
                    <li
                      key={j}
                      style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 14, color: "#2D3A4A", lineHeight: 1.6 }}
                    >
                      <span
                        style={{ width: 6, height: 6, borderRadius: "50%", background: entry.latest ? "#28C55E" : "#8A93A5", flexShrink: 0, marginTop: 8, display: "inline-block" }}
                      />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </article>
          ))}
        </div>

        {/* CTA */}
        <div
          style={{
            maxWidth: 760,
            margin: "0 auto",
            marginTop: 24,
            paddingTop: 40,
            borderTop: "1px solid #E2E6EE",
            textAlign: "center",
          }}
        >
          <p style={{ fontSize: 14, color: "#8A93A5", marginBottom: 20 }}>
            Ready to automate your purchase orders?
          </p>
          <Link
            href="/sign-up"
            style={{
              display: "inline-flex",
              alignItems: "center",
              borderRadius: 8,
              padding: "11px 28px",
              fontSize: 14,
              fontWeight: 700,
              background: "#0B1A2F",
              color: "#FFFFFF",
              textDecoration: "none",
            }}
          >
            Get started free →
          </Link>
        </div>
      </section>
    </div>
  );
}
