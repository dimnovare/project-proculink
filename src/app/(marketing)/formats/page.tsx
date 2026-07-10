import type { Metadata } from "next";
import Link from "next/link";
import {
  IMPORT_METHODS,
  IMPORT_FORMATS,
  DELIVERY_METHODS,
  OUTPUT_FORMATS,
  type FormatRow as Row,
  type StatusKey,
} from "@/lib/marketing/format-catalog";

export const metadata: Metadata = {
  title: "Formats & methods — ProcuLink",
  description:
    "Every way ProcuLink can import and deliver purchase orders, and every format it reads and produces — each tagged Supported, Configurable, On request, or Planned. Don't see yours? We likely support it or can add it.",
  alternates: { canonical: "/formats" },
  openGraph: {
    title: "Formats & methods — ProcuLink",
    description:
      "Every import/delivery method and every PO format ProcuLink reads and produces — honestly tagged Supported / Configurable / On request / Planned.",
    url: "/formats",
  },
};

// ── Status vocabulary (display map) ─────────────────────────────────────────────
// The row data + catalog-derived statuses live in @/lib/marketing/format-catalog
// so the landing-page hero counts derive from the same source and can't drift.
// This map is display-only (label + colours + legend copy) and stays page-scoped.
// Honest by design: nothing is "Supported" unless it works in production today.
const STATUS: Record<StatusKey, { label: string; fg: string; bg: string; desc: string }> = {
  live:         { label: "Supported",    fg: "#1F6F2A", bg: "#E2F1E2", desc: "Works today — set it up yourself in the app." },
  configurable: { label: "Configurable", fg: "#0F4FA8", bg: "#E3EDFB", desc: "Works today; we switch it on with you in a quick setup." },
  onRequest:    { label: "On request",   fg: "#C97A14", bg: "#FAEFD6", desc: "Not built yet, but straightforward — we'll add it for your rollout." },
  planned:      { label: "Planned",      fg: "#56627A", bg: "#EEF1F6", desc: "On the roadmap." },
};

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
          <Link href="/support" className="rounded-[7px] px-5 py-2.5 text-[14px] font-semibold" style={{ background: "#297F34", color: "#FFFFFF" }}>
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
