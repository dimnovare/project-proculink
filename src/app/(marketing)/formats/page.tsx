import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Formats & methods — ProcuLink",
  description:
    "Every way ProcuLink can import and deliver purchase orders, and every format it reads and produces — each tagged Supported, Configurable, On request, or Planned. Don't see yours? We likely support it or can add it.",
};

// ── Status vocabulary ──────────────────────────────────────────────────────────
// Honest by design: nothing is "Supported" unless it works in production today.
type StatusKey = "live" | "configurable" | "onRequest" | "planned";

const STATUS: Record<StatusKey, { label: string; fg: string; bg: string; desc: string }> = {
  live:         { label: "Supported",    fg: "#1F6F2A", bg: "#E2F1E2", desc: "Works today — set it up yourself in the app." },
  configurable: { label: "Configurable", fg: "#0F4FA8", bg: "#E3EDFB", desc: "Works today; we switch it on with you in a quick setup." },
  onRequest:    { label: "On request",   fg: "#C97A14", bg: "#FAEFD6", desc: "Not built yet, but straightforward — we'll add it for your rollout." },
  planned:      { label: "Planned",      fg: "#56627A", bg: "#EEF1F6", desc: "On the roadmap." },
};

interface Row { name: string; status: StatusKey; note: string }

const IMPORT_METHODS: Row[] = [
  { name: "Manual upload (drag-and-drop / browse)", status: "live", note: "Drop a file straight into the app." },
  { name: "REST API", status: "live", note: "POST orders as JSON with an API key — Zapier, Make, or your own code." },
  { name: "Email inbox polling (IMAP)", status: "live", note: "We poll your mailbox for order attachments. Integration plan." },
  { name: "SFTP folder pull", status: "live", note: "Point us at an SFTP folder; we import new files. Integration plan." },
  { name: "S3 / R2 bucket pull", status: "live", note: "Watch a bucket prefix for order files. Integration plan." },
  { name: "Hosted inbound email address", status: "configurable", note: "Forward orders to your orders@… address; we set up the receiving domain." },
  { name: "AS2 / PEPPOL network receive", status: "onRequest", note: "Through a certified access-point partner." },
];

const IMPORT_FORMATS: Row[] = [
  { name: "CSV", status: "live", note: "Delimiters and common column aliases auto-detected." },
  { name: "Excel (XLSX)", status: "live", note: "First worksheet, header row." },
  { name: "PDF (text-based)", status: "live", note: "Native text extraction." },
  { name: "PDF (scanned / image)", status: "configurable", note: "OCR — we enable a document-AI provider for your account." },
  { name: "cXML 1.2", status: "live", note: "OrderRequest documents." },
  { name: "UBL 2.1 / Peppol BIS", status: "live", note: "Order documents." },
  { name: "EDIFACT ORDERS", status: "live", note: "D96A / D01B." },
  { name: "ANSI X12 850", status: "live", note: "004010 / 005010." },
  { name: "JSON", status: "live", note: "Via the REST API order shape." },
];

const DELIVERY_METHODS: Row[] = [
  { name: "HTTPS webhook (POST / PUT)", status: "live", note: "Auth: API key, bearer, basic, or OAuth2 fetch-token." },
  { name: "SFTP", status: "live", note: "Password or private-key." },
  { name: "FTPS", status: "live", note: "Explicit TLS." },
  { name: "Email (SMTP)", status: "live", note: "The order is sent as an attachment." },
  { name: "Erply (ERP connector)", status: "live", note: "" },
  { name: "Directo (ERP connector)", status: "live", note: "" },
  { name: "More ERP connectors", status: "onRequest", note: "Fortnox, Visma, e-conomic, Dynamics 365 BC, NetSuite, SAP…" },
  { name: "AS2 / AS4 / PEPPOL access point", status: "onRequest", note: "Through a certified partner." },
];

const OUTPUT_FORMATS: Row[] = [
  { name: "CSV", status: "live", note: "Configurable columns." },
  { name: "XML (generic)", status: "live", note: "" },
  { name: "cXML 1.2", status: "live", note: "" },
  { name: "UBL 2.1 / Peppol BIS", status: "live", note: "" },
  { name: "ANSI X12 850", status: "live", note: "" },
  { name: "JSON", status: "live", note: "" },
  { name: "EDIFACT ORDERS", status: "onRequest", note: "Outbound EDIFACT transformer on request." },
];

const INK = "#0B1A2F";
const MUTED = "#56627A";
const LINE = "#E2E6EE";

function Badge({ status }: { status: StatusKey }) {
  const s = STATUS[status];
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold"
      style={{ background: s.bg, color: s.fg }}
    >
      {s.label}
    </span>
  );
}

function Section({ title, subtitle, rows }: { title: string; subtitle: string; rows: Row[] }) {
  return (
    <section className="mt-10">
      <h2 className="text-[18px] font-semibold" style={{ color: INK, fontFamily: "'Bricolage Grotesque', Inter, sans-serif" }}>{title}</h2>
      <p className="mt-1 text-[13.5px]" style={{ color: MUTED }}>{subtitle}</p>
      <div className="mt-4 overflow-hidden rounded-[10px]" style={{ border: `1px solid ${LINE}` }}>
        {rows.map((r, i) => (
          <div
            key={r.name}
            className="flex flex-col gap-1.5 px-4 py-3 sm:flex-row sm:items-center sm:gap-4"
            style={{ borderTop: i === 0 ? "none" : `1px solid ${LINE}`, background: "#FFFFFF" }}
          >
            <div className="flex items-center gap-3 sm:w-[320px] sm:shrink-0">
              <Badge status={r.status} />
              <span className="text-[13.5px] font-medium" style={{ color: INK }}>{r.name}</span>
            </div>
            {r.note && <span className="text-[12.5px]" style={{ color: MUTED }}>{r.note}</span>}
          </div>
        ))}
      </div>
    </section>
  );
}

export default function FormatsPage() {
  return (
    <main className="mx-auto max-w-[860px] px-5 py-12 sm:py-16">
      <p className="text-[12px] font-semibold uppercase tracking-[0.08em]" style={{ color: "#6F4FCE" }}>Capabilities</p>
      <h1 className="mt-2 text-[30px] font-semibold leading-tight sm:text-[36px]" style={{ color: INK, fontFamily: "'Bricolage Grotesque', Inter, sans-serif", letterSpacing: "-0.02em" }}>
        Every format and method, in one place
      </h1>
      <p className="mt-3 text-[15px] leading-relaxed" style={{ color: MUTED }}>
        ProcuLink takes orders in however your buyers send them and delivers them in exactly the
        format and channel each supplier needs. Here's the full picture — and we keep it honest:
        nothing is marked <strong style={{ color: "#1F6F2A" }}>Supported</strong> unless it works in
        production today. <strong style={{ color: INK }}>Don't see yours? It's very likely Configurable
        or On request — <Link href="/support" style={{ color: "#0F4FA8" }}>just ask</Link>.</strong>
      </p>

      {/* Legend */}
      <div className="mt-6 grid gap-2 rounded-[10px] p-4 sm:grid-cols-2" style={{ border: `1px solid ${LINE}`, background: "#FBFCFE" }}>
        {(Object.keys(STATUS) as StatusKey[]).map((k) => (
          <div key={k} className="flex items-start gap-2.5">
            <Badge status={k} />
            <span className="text-[12.5px]" style={{ color: MUTED }}>{STATUS[k].desc}</span>
          </div>
        ))}
      </div>

      <Section title="Get data in — methods" subtitle="How orders reach ProcuLink." rows={IMPORT_METHODS} />
      <Section title="Get data in — formats we read" subtitle="What an incoming order file can be." rows={IMPORT_FORMATS} />
      <Section title="Get data out — delivery channels" subtitle="How the finished order reaches each supplier." rows={DELIVERY_METHODS} />
      <Section title="Get data out — formats we produce" subtitle="What we transform each order into. Set per supplier." rows={OUTPUT_FORMATS} />

      {/* CTA */}
      <div className="mt-12 rounded-[12px] px-6 py-7 text-center" style={{ background: "#0B1A2F" }}>
        <h2 className="text-[20px] font-semibold" style={{ color: "#FFFFFF", fontFamily: "'Bricolage Grotesque', Inter, sans-serif" }}>
          Don't see your format or method?
        </h2>
        <p className="mx-auto mt-2 max-w-[520px] text-[14px]" style={{ color: "#9DB2CE" }}>
          Tell us your supplier's requirement. Most formats and channels are already supported or a
          quick configuration away.
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
          <Link href="/support" className="rounded-[7px] px-5 py-2.5 text-[14px] font-semibold" style={{ background: "#2E8E3A", color: "#FFFFFF" }}>
            Ask about your format
          </Link>
          <Link href="/sign-up" className="rounded-[7px] px-5 py-2.5 text-[14px] font-semibold" style={{ background: "transparent", color: "#FFFFFF", border: "1px solid #2B3F5E" }}>
            Start free
          </Link>
        </div>
      </div>
    </main>
  );
}
