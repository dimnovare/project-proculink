"use client";

// Standards reference — canonical cross-format field table.
// Every canonical PO field, mapped across cXML / UBL / EDIFACT / X12 / Peppol BIS.
// Standards visibility is always-on (product rule), never gated behind a mode.
// Data is the real typed catalog (FIELD_STANDARDS) from src/lib/standards/catalog.ts.
//
// Column ORDER + LABELS are defined locally (REF_COLUMNS below) so this screen
// can present cXML-first with versioned headers WITHOUT mutating the shared
// catalog's STANDARD_REF_COLUMNS (which the StandardsFieldPopover also consumes).

import { useState } from "react";
import { FIELD_STANDARDS, type CanonicalFieldStandards } from "@/lib/standards/catalog";

// ── Local presentation order — cXML first, versioned labels (design spec) ──────
// key is a field on CanonicalFieldStandards; `tone` picks the cell ink so XML
// element-path columns and short EDI/business-term code columns read distinctly,
// exactly as in the locked design render.
type RefKey = keyof Pick<
  CanonicalFieldStandards,
  "cxml" | "ubl" | "edifact" | "x12" | "peppolBis"
>;

const REF_COLUMNS: ReadonlyArray<{ key: RefKey; label: string; tone: "path" | "code" }> = [
  { key: "cxml", label: "cXML 1.2", tone: "path" },
  { key: "ubl", label: "UBL 2.1", tone: "path" },
  { key: "edifact", label: "EDIFACT", tone: "code" },
  { key: "x12", label: "X12", tone: "code" },
  { key: "peppolBis", label: "Peppol BIS", tone: "code" },
];

// ── Exact hexes sampled from the design render (2026-05-30) ────────────────────
const PAGE_BG = "#F6F7FA";
const CARD = "#FFFFFF";
const CARD_BORDER = "#E2E6EE"; // sampled — same hairline as row dividers / search box
const ROW_BORDER = "#E2E6EE"; // sampled inter-row divider
const HEAD_BORDER = "#E2E6EE"; // sampled header underline
const INK = "#0B1A2F"; // field label + page title
const INK_SUB = "#58637C"; // subtitle
const HEAD_LABEL = "#8A93A5"; // uppercase column headers
const SUBLABEL = "#9099AB"; // mono canonical-field id under the label
const PATH_TONE = "#5E6884"; // muted slate-blue — cXML / UBL element paths
const CODE_TONE = "#6E6790"; // muted indigo-violet — EDIFACT / X12 / Peppol codes
const EMPTY_TONE = "#C6CDDA"; // em-dash for an unmapped cell
const FOOTER_GREY = "#8F97A9";
const FOOTER_LINK = "#58627C"; // "Request a format" — slate, NOT green

export default function StandardsPage() {
  const [q, setQ] = useState("");

  const query = q.trim().toLowerCase();
  const rows = FIELD_STANDARDS.filter((f) => {
    if (!query) return true;
    if (f.label.toLowerCase().includes(query)) return true;
    if (f.canonicalField.toLowerCase().includes(query)) return true;
    return REF_COLUMNS.some(({ key }) => (f[key] ?? "").toLowerCase().includes(query));
  });

  return (
    <div style={{ background: PAGE_BG, minHeight: "100%" }}>
      <div className="mx-auto w-full max-w-[1480px] px-4 pb-12 pt-6 sm:px-8 sm:pt-8 lg:px-10">
        {/* Page header — floats on the page surface, no card / no divider */}
        <header className="flex flex-col items-start gap-4 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
          <div className="min-w-0">
            <h1
              className="text-[26px] font-semibold leading-[1.08] tracking-[-0.022em] sm:text-[30px]"
              style={{ fontFamily: "'Bricolage Grotesque', Inter, sans-serif", color: INK }}
            >
              Standards reference
            </h1>
            <p className="mt-1.5 text-[13px] leading-snug" style={{ color: INK_SUB }}>
              How every canonical field maps across formats — always visible, never hidden
            </p>
          </div>

          {/* Field search */}
          <label
            className="flex h-10 w-full items-center gap-2 sm:h-9 sm:w-[280px]"
            style={{
              background: CARD,
              border: `1px solid #E2E6EE`,
              borderRadius: 8,
              padding: "0 12px",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden style={{ flexShrink: 0 }}>
              <circle cx="11" cy="11" r="7" stroke="#8A93A5" strokeWidth="2" />
              <path d="m20 20-3.5-3.5" stroke="#8A93A5" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search fields or paths…"
              aria-label="Search fields or paths"
              className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-[#8A93A5]"
              style={{ color: INK }}
            />
          </label>
        </header>

        {/* Standards table — single white card, subtle border + shadow.
            On mobile the table scrolls horizontally with a sticky first column;
            from sm: it lays out full-width with no scroll. */}
        <div
          className="mt-5 overflow-hidden rounded-[10px] sm:mt-6"
          style={{ background: CARD, border: `1px solid ${CARD_BORDER}`, boxShadow: "0 1px 2px rgba(11,26,47,0.04)" }}
        >
          <div className="overflow-x-auto">
            {/* min-width forces horizontal scroll on narrow viewports; the sticky
                first column keeps the canonical field anchored while codes scroll. */}
            <table className="w-full min-w-[760px] border-collapse">
              <thead>
                <tr style={{ borderBottom: `1px solid ${HEAD_BORDER}` }}>
                  <th
                    className="sticky left-0 z-10 px-4 py-3 text-left text-[10.5px] font-semibold uppercase tracking-[0.07em] sm:px-5"
                    style={{ color: HEAD_LABEL, background: CARD, minWidth: 192 }}
                  >
                    Canonical field
                  </th>
                  {REF_COLUMNS.map(({ key, label }) => (
                    <th
                      key={key}
                      className="px-4 py-3 text-left text-[10.5px] font-semibold uppercase tracking-[0.07em] sm:px-5"
                      style={{ color: HEAD_LABEL, whiteSpace: "nowrap" }}
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((f) => (
                  <tr key={f.canonicalField} className="group" style={{ borderBottom: `1px solid ${ROW_BORDER}` }}>
                    <td
                      className="sticky left-0 z-10 px-4 py-3.5 align-top transition-colors group-hover:bg-[#FAFBFC] sm:px-5"
                      style={{ background: CARD }}
                    >
                      <div className="text-[13px] font-semibold leading-snug" style={{ color: INK }}>
                        {f.label}
                      </div>
                      <div
                        className="mt-0.5 text-[10.5px] leading-snug"
                        style={{ fontFamily: "'JetBrains Mono', monospace", color: SUBLABEL }}
                      >
                        {f.canonicalField}
                      </div>
                    </td>
                    {REF_COLUMNS.map(({ key, tone }) => (
                      <td
                        key={key}
                        className="px-4 py-3.5 align-top text-[11.5px] leading-snug transition-colors group-hover:bg-[#FAFBFC] sm:px-5"
                        style={{
                          fontFamily: "'JetBrains Mono', monospace",
                          color: f[key] ? (tone === "path" ? PATH_TONE : CODE_TONE) : EMPTY_TONE,
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
            <div className="px-5 py-12 text-center">
              <p className="text-[13px] font-semibold" style={{ color: INK }}>
                No fields match
              </p>
              <p className="mt-1 text-[12px]" style={{ color: INK_SUB }}>
                Nothing for &ldquo;{q}&rdquo;.
              </p>
            </div>
          )}
        </div>

        {/* Request-a-format footer */}
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-[12px]" style={{ color: FOOTER_GREY }}>
            Need a standard we don&rsquo;t list?
          </span>
          <a
            href="/support"
            className="inline-flex min-h-[28px] items-center gap-1.5 text-[12.5px] font-semibold transition-opacity hover:opacity-70"
            style={{ color: FOOTER_LINK }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
              <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.8" />
              <path d="m3.5 6.5 8.5 6 8.5-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            Request a format
          </a>
        </div>
      </div>
    </div>
  );
}
