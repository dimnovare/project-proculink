"use client";

// Standards reference — canonical cross-format field table.
// Every canonical PO field, mapped across UBL / Peppol BIS / EDIFACT / X12 / cXML.
// Standards visibility is always-on (product rule), never gated behind a mode.
// Data is the real typed catalog (FIELD_STANDARDS + STANDARD_REF_COLUMNS).

import { useState } from "react";
import { FIELD_STANDARDS, STANDARD_REF_COLUMNS } from "@/lib/standards/catalog";

export default function StandardsPage() {
  const [q, setQ] = useState("");

  const query = q.trim().toLowerCase();
  const rows = FIELD_STANDARDS.filter((f) => {
    if (!query) return true;
    if (f.label.toLowerCase().includes(query)) return true;
    if (f.canonicalField.toLowerCase().includes(query)) return true;
    return STANDARD_REF_COLUMNS.some(({ key }) =>
      (f[key] ?? "").toLowerCase().includes(query),
    );
  });

  // Two-tone column treatment (matches the design): XML element-path columns
  // (UBL / Peppol BIS / cXML) read in a muted green-slate that echoes the brand
  // accent; the short EDI code columns (EDIFACT / X12) stay neutral slate.
  const PATH_COLUMNS = new Set(["ubl", "peppolBis", "cxml"]);
  const PATH_TONE = "#3E7D5C"; // muted green-slate — brand-green desaturated for body text
  const CODE_TONE = "#56627A"; // neutral slate
  const EMPTY_TONE = "#C6CDDA";

  return (
    <div style={{ background: "#F6F7FA", minHeight: "100%" }}>
      <div className="mx-auto w-full max-w-[1480px] px-5 pb-12 pt-8 sm:px-8 lg:px-10">
        {/* Page header — floats on the page surface, no card / no divider */}
        <header className="flex flex-col items-start gap-4 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
          <div>
            <h1
              className="text-[30px] font-semibold leading-[1.1] tracking-[-0.022em]"
              style={{ fontFamily: "'Bricolage Grotesque', Inter, sans-serif", color: "#0B1A2F" }}
            >
              Standards reference
            </h1>
            <p className="mt-1.5 text-[13px]" style={{ color: "#56627A" }}>
              How every canonical field maps across formats — always visible, never hidden
            </p>
          </div>

          {/* Field search */}
          <div
            className="flex w-full items-center gap-2 sm:w-[280px]"
            style={{
              background: "#FFFFFF",
              border: "1px solid #E2E6EE",
              borderRadius: 8,
              padding: "0 12px",
              height: 36,
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
              className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-[#8A93A5]"
              style={{ color: "#0B1A2F" }}
            />
          </div>
        </header>

        {/* Standards table — single white card, subtle border + shadow */}
        <div
          className="mt-6 overflow-hidden rounded-[10px]"
          style={{ background: "#FFFFFF", border: "1px solid #E6E9F0", boxShadow: "0 1px 2px rgba(11,26,47,0.04)" }}
        >
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr style={{ borderBottom: "1px solid #ECEEF3" }}>
                  <th
                    className="sticky left-0 px-5 py-3 text-left text-[10.5px] font-semibold uppercase tracking-[0.07em]"
                    style={{ color: "#9AA3B2", background: "#FFFFFF", minWidth: 210 }}
                  >
                    Canonical field
                  </th>
                  {STANDARD_REF_COLUMNS.map(({ key, label }) => (
                    <th
                      key={key}
                      className="px-5 py-3 text-left text-[10.5px] font-semibold uppercase tracking-[0.07em]"
                      style={{ color: "#9AA3B2", whiteSpace: "nowrap" }}
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((f) => (
                  <tr
                    key={f.canonicalField}
                    className="group transition-colors"
                    style={{ borderBottom: "1px solid #F1F3F7" }}
                  >
                    <td
                      className="sticky left-0 px-5 py-3.5 align-top group-hover:bg-[#FAFBFC]"
                      style={{ background: "#FFFFFF" }}
                    >
                      <div className="text-[13px] font-semibold leading-snug" style={{ color: "#0B1A2F" }}>
                        {f.label}
                      </div>
                      <div
                        className="mt-0.5 text-[10.5px] leading-snug"
                        style={{ fontFamily: "'JetBrains Mono', monospace", color: "#9AA3B2" }}
                      >
                        {f.canonicalField}
                      </div>
                    </td>
                    {STANDARD_REF_COLUMNS.map(({ key }) => (
                      <td
                        key={key}
                        className="px-5 py-3.5 align-top text-[11.5px] leading-snug group-hover:bg-[#FAFBFC]"
                        style={{
                          fontFamily: "'JetBrains Mono', monospace",
                          color: f[key]
                            ? PATH_COLUMNS.has(key)
                              ? PATH_TONE
                              : CODE_TONE
                            : EMPTY_TONE,
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
              <p className="text-[13px] font-semibold" style={{ color: "#0B1A2F" }}>No fields match</p>
              <p className="mt-1 text-[12px]" style={{ color: "#56627A" }}>Nothing for &ldquo;{q}&rdquo;.</p>
            </div>
          )}
        </div>

        {/* Request-a-format footer */}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <span className="text-[12px]" style={{ color: "#8A93A5" }}>
            Need a standard we don&rsquo;t list?
          </span>
          <a
            href="/support"
            className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold transition-colors hover:opacity-80"
            style={{ color: "var(--brand-green, #28C55E)" }}
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
