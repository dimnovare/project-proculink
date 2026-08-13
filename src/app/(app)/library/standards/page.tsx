"use client";

// Standards reference — canonical cross-format field table.
// Every canonical PO field, mapped across cXML / UBL / EDIFACT / X12 / Peppol BIS.
// Standards visibility is always-on (product rule), never gated behind a mode.
// Data is the real typed catalog (FIELD_STANDARDS) from src/lib/standards/catalog.ts.
//
// Pixel-ported from the locked design source (claude-proculink-2 screen-rules.jsx
// StandardsScreen). It uses the design-token metrics directly so it reads exactly
// like the reference render: a full-width ("wide") work area, a single white card,
// a `.tbl`-style table (10.5px uppercase headers, 12.5px sticky canonical-field
// column, 11px mono reference cells, all in --ink-muted), and a quiet
// "Request a format" footer.
//
// Column ORDER + LABELS are defined locally (REF_COLUMNS below) so this screen
// can present cXML-first with versioned headers WITHOUT mutating the shared
// catalog's STANDARD_REF_COLUMNS (which the StandardsFieldPopover also consumes).

import { useState } from "react";
import { FIELD_STANDARDS } from "@/lib/standards/catalog";
import { requiresPlan } from "@/lib/gatedCapabilities";
import { EmptyState } from "@/components/bridge/EmptyState";
import { PageShell } from "@/components/bridge/layout/PageShell";
import { PageHeader } from "@/components/bridge/layout/PageHeader";
import { Card } from "@/components/bridge/layout/Card";
// The column table and the two filters that split it live in ./refColumns, so a test can
// read them: a Next.js page module may not carry arbitrary named exports, and duplicating
// the table into a test is the shape that produced the defect below in the first place.
import {
  EMITTED_COLUMNS,
  GATED_EMITTED_COLUMNS,
  READ_ONLY_COLUMNS,
  REF_COLUMNS,
  gateFor,
} from "./refColumns";

const EMITTED_LABELS = EMITTED_COLUMNS.map((c) => c.label);
const READ_ONLY_LABELS = READ_ONLY_COLUMNS.map((c) => c.label);

/**
 * The formats ProcuLink can build but will not build on every plan — `"cXML 1.2 is
 * Operations plan and up"`.
 *
 * The direction line used to be derived from `transform === "supported"` alone, so it read
 * "ProcuLink produces cXML 1.2, UBL 2.1 and X12." flat — an honest TECHNICAL filter carrying
 * no commercial one, on a page that names no tier anywhere else. cXML output is refused
 * below Operations, so that sentence offered a Growth org a capability the API declines.
 *
 * Both halves derive: which formats are gated from `GATED_STANDARD_OUTPUT`, and the tier
 * name from `requiresPlan()` reading the mirrored gate table. Re-tiering cXML changes this
 * sentence without anybody editing this file — six help pages naming a tier by hand is the
 * defect one level up, and the reason `requiresPlan()` exists.
 */
const GATED_EMITTED_CLAUSES = GATED_EMITTED_COLUMNS.map(
  (c) => `${c.label} is ${requiresPlan(gateFor(c.catalogId)!)}`,
);

/** "a, b and c" — a sentence, not a join, because this renders as prose. */
const asList = (items: readonly string[]): string =>
  items.length < 2 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

export default function StandardsPage() {
  const [q, setQ] = useState("");

  const query = q.trim().toLowerCase();
  const rows = FIELD_STANDARDS.filter((f) => {
    if (!query) return true;
    if (f.label.toLowerCase().includes(query)) return true;
    if (f.canonicalField.toLowerCase().includes(query)) return true;
    return REF_COLUMNS.some(({ key }) => (f[key] ?? "").toLowerCase().includes(query));
  });

  // Field search input — rendered in the PageHeader actions slot.
  const searchInput = (
    <label
      className="flex h-10 w-full items-center gap-2 sm:h-8 sm:w-[240px]"
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        padding: "0 11px",
      }}
    >
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden
        style={{ flexShrink: 0 }}
      >
        <circle cx="11" cy="11" r="7" stroke="var(--ink-faint)" strokeWidth="2" />
        <path
          d="m20 20-3.5-3.5"
          stroke="var(--ink-faint)"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search fields or paths…"
        aria-label="Search fields or paths"
        className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none"
        style={{ color: "var(--ink)" }}
      />
    </label>
  );

  return (
    <PageShell variant="wide">
      {/* titleHidden: the topbar hub tab "Standards" already names this page
          ("Standards reference" only re-announced it; sr-only h1 kept). The
          descriptive subtitle is dropped; the search input stays. */}
      <PageHeader
        titleHidden
        title="Format reference"
        actions={searchInput}
      />

      {/* Progressive-disclosure "which format?" helper. Reference guidance about the
          standards themselves. The old version of this comment claimed "all five are real
          supported output formats, so this is honest orientation, not a capability claim" —
          which was how the Peppol BIS bullet below stayed put. EDIFACT has no outbound
          transformer and Peppol BIS conformance is not offered, so the bullets orient the
          reader toward a standard WITHOUT asserting we emit a conformant document in it.
          Collapsed by default so it never crowds the locked table layout. */}
      <details className="mb-3 group">
        <summary
          className="inline-flex cursor-pointer list-none items-center gap-1.5 text-[12px] font-medium select-none"
          style={{ color: "var(--ink-muted)" }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden className="transition-transform group-open:rotate-90" style={{ flexShrink: 0 }}>
            <path d="m9 6 6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Not sure which format to use?
        </summary>
        <div
          className="mt-2 max-w-[680px] rounded-[var(--radius-md)] px-3.5 py-3 text-[12px] leading-relaxed"
          style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--ink-muted)" }}
        >
          <ul className="space-y-1.5">
            {/* The tier is DERIVED, not typed. This bullet sits in a chooser whose other
                options are on every plan, so listing cXML beside them with no tier reads as
                "pick this one" to a Growth org whose delivery config the API then refuses. */}
            <li><strong style={{ color: "var(--ink)" }}>cXML 1.2</strong> — punchout &amp; marketplace orders (Ariba, Coupa and similar procurement platforms). {requiresPlan("cxml")}.</li>
            <li><strong style={{ color: "var(--ink)" }}>UBL 2.1</strong> — European e-procurement and public-sector networks. Peppol runs on UBL, so this is the document to pick; ProcuLink does not check its output against Peppol BIS business rules.</li>
            {/* This list answers "which format to use?" and ends "ask your supplier which they
                accept" — so it is an OUTPUT chooser, and every bullet in it reads as a format you
                can pick. UBL already carried its caveat; EDIFACT carried none, while three of the
                four options around it are formats we really emit. */}
            <li><strong style={{ color: "var(--ink)" }}>EDIFACT</strong> — long-established European and global EDI (retail, automotive, logistics). ProcuLink reads EDIFACT <span style={{ fontFamily: "var(--font-mono)" }}>ORDERS</span> messages, but does not generate them, so it is not a format you can send a supplier today.</li>
            <li><strong style={{ color: "var(--ink)" }}>X12</strong> — North American EDI (ANSI ASC X12 850 purchase order).</li>
          </ul>
          <p className="mt-2.5" style={{ color: "var(--ink-faint)" }}>
            Not sure? Ask your supplier which they accept — it&rsquo;s usually on their order or onboarding spec.
          </p>
        </div>
      </details>

      {/* Direction line — always visible, unlike the collapsed disclosure above.
          /help/output-templates points at this screen as "the always-current version" of the
          output-support table, so a reader arrives here expecting it to say what ProcuLink can
          send. A matrix of five formats with no direction marker answered that question wrongly
          by implication. Both halves are derived from the catalog, so neither can go stale. */}
      {READ_ONLY_LABELS.length > 0 && (
        <p className="mb-2 max-w-[680px] text-[11.5px] leading-relaxed" style={{ color: "var(--ink-muted)" }}>
          These are field names across each standard, not a list of what ProcuLink sends.
          ProcuLink produces {asList(EMITTED_LABELS)}.{" "}
          {/* "Produces" answered can-we-build-it and stopped there. On a page that names no
              tier anywhere else, a format listed with no qualifier reads as included on
              every plan — and cXML output is refused below Operations. */}
          {GATED_EMITTED_CLAUSES.length > 0 && <>{asList(GATED_EMITTED_CLAUSES)}. </>}
          {asList(READ_ONLY_LABELS)}{" "}
          {READ_ONLY_LABELS.length === 1 ? "is" : "are"} read only — the column is here so you can
          match a field name with your trading partner, not because ProcuLink can emit it.
        </p>
      )}

      {/* Mobile-only swipe hint — the matrix h-scrolls but truncated cells give no
          cue on a phone. Hidden on sm+ where all columns fit. */}
      <p className="mb-2 flex items-center gap-1 text-[11.5px] sm:hidden" style={{ color: "var(--ink-faint)" }}>
        Swipe the table sideways to see every format
        <span aria-hidden>→</span>
      </p>

      {/* Single white card — table scrolls horizontally with a sticky first column so
          the canonical field stays anchored while the reference codes scroll.
          `flush` is required: the table is edge-to-edge and must have zero internal
          padding. `radius` keeps this card's original --radius-md corner (Card's own
          default is --radius-lg). */}
      <Card flush radius="var(--radius-md)" className="relative overflow-hidden">
        {/* Right-edge fade — mobile-only visual cue that more columns lie off-screen.
            Sits above the scroll area but is click-through (pointer-events-none) so it
            never blocks scrolling/hover. Hidden on sm+ where the table fits. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 z-20 w-10 sm:hidden"
          style={{ background: "linear-gradient(to left, var(--surface), transparent)" }}
        />
        <div
          className="overflow-x-auto"
          tabIndex={0}
          role="region"
          aria-label="Standards mapping matrix — scroll horizontally to see every format"
        >
          {/* min-width forces horizontal scroll on narrow viewports */}
          <table className="w-full min-w-[760px] border-collapse">
            <thead>
              <tr>
                <th
                  scope="col"
                  className="sticky left-0 z-10 px-3 py-[9px] text-left text-[10.5px] font-semibold uppercase tracking-[0.05em]"
                  style={{
                    color: "var(--ink-faint)",
                    background: "var(--surface)",
                    borderBottom: "1px solid var(--border)",
                    minWidth: 180,
                    whiteSpace: "nowrap",
                  }}
                >
                  ProcuLink field
                </th>
                {REF_COLUMNS.map(({ key, label }) => (
                  <th
                    key={key}
                    scope="col"
                    className="px-3 py-[9px] text-left text-[10.5px] font-semibold uppercase tracking-[0.05em]"
                    style={{
                      color: "var(--ink-faint)",
                      borderBottom: "1px solid var(--border)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((f, i) => (
                <tr
                  key={f.canonicalField}
                  className="group"
                  style={{ borderBottom: i === rows.length - 1 ? "none" : "1px solid var(--border)" }}
                >
                  <td
                    className="sticky left-0 z-10 px-3 py-[11px] align-middle"
                    style={{ background: "var(--surface)" }}
                  >
                    <div
                      className="text-[12.5px] font-semibold leading-snug"
                      style={{ color: "var(--ink)" }}
                    >
                      {f.label}
                    </div>
                    <div
                      className="text-[10.5px] leading-snug"
                      style={{ fontFamily: "var(--font-mono)", color: "var(--ink-faint)" }}
                    >
                      {f.canonicalField}
                    </div>
                  </td>
                  {REF_COLUMNS.map(({ key }) => (
                    <td
                      key={key}
                      className="px-3 py-[11px] align-middle text-[11px] leading-snug transition-colors group-hover:bg-[var(--surface-2)]"
                      style={{
                        fontFamily: "var(--font-mono)",
                        color: "var(--ink-muted)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {f[key] ?? "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {rows.length === 0 && (
          FIELD_STANDARDS.length === 0 ? (
            <EmptyState
              title="No standards catalog"
              sub="The field reference isn't available. Reload the page, and if it stays empty, contact support."
            />
          ) : (
            <EmptyState compact title="No fields match" sub={`Nothing for "${q}".`} />
          )
        )}
      </Card>

      {/* Request-a-format footer — quiet faint prompt + ghost link (design) */}
      <div className="mt-[14px] flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-[11.5px]" style={{ color: "var(--ink-faint)" }}>
          Need a standard we don&rsquo;t list?
        </span>
        <a
          href="/support"
          className="inline-flex h-8 min-h-[32px] items-center gap-[6px] rounded-[var(--radius)] px-[10px] text-[11.5px] font-semibold transition-colors hover:bg-[var(--surface-2)]"
          style={{ color: "var(--ink-muted)" }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
            <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.8" />
            <path d="m3.5 6.5 8.5 6 8.5-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          Request a format
        </a>
      </div>
    </PageShell>
  );
}
