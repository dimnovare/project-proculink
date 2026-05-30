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

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden" style={{ background: "#F6F7FA" }}>
      {/* Page header */}
      <div
        className="flex flex-col items-start gap-3 px-4 py-4 sm:px-6 sm:flex-row sm:items-end sm:gap-4 flex-shrink-0"
        style={{ borderBottom: "1px solid #E2E6EE", background: "#FFFFFF" }}
      >
        <div>
          <h1
            className="text-[26px] font-semibold tracking-[-0.02em]"
            style={{ fontFamily: "'Bricolage Grotesque', Inter, sans-serif", color: "#0B1A2F" }}
          >
            Standards reference
          </h1>
          <p className="text-[13px] mt-1" style={{ color: "#56627A" }}>
            How every canonical field maps across formats — always visible, never hidden
          </p>
        </div>
        {/* Field search */}
        <div
          className="flex w-full items-center gap-2 sm:ml-auto sm:w-[260px]"
          style={{ background: "#FFFFFF", border: "1px solid #E2E6EE", borderRadius: 6, padding: "0 11px", height: 32 }}
        >
          <span style={{ color: "#8A93A5", fontSize: 13 }}>⌕</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search fields or paths…"
            className="flex-1 bg-transparent text-[12.5px] outline-none"
            style={{ color: "#0B1A2F" }}
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-5">
        <div
          className="rounded-[8px] overflow-hidden"
          style={{ background: "#FFFFFF", border: "1px solid #E2E6EE", boxShadow: "0 1px 3px rgba(11,26,47,0.04)" }}
        >
          <div className="overflow-x-auto">
            <table className="w-full border-collapse" style={{ fontSize: 12.5 }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #E2E6EE" }}>
                  <th
                    className="px-4 py-2.5 text-left text-[10.5px] font-semibold uppercase tracking-[0.06em] sticky left-0"
                    style={{ color: "#8A93A5", background: "#FFFFFF", minWidth: 200 }}
                  >
                    Canonical field
                  </th>
                  {STANDARD_REF_COLUMNS.map(({ key, label }) => (
                    <th
                      key={key}
                      className="px-4 py-2.5 text-left text-[10.5px] font-semibold uppercase tracking-[0.06em]"
                      style={{ color: "#8A93A5", whiteSpace: "nowrap" }}
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((f) => (
                  <tr key={f.canonicalField} style={{ borderBottom: "1px solid #F0F2F6" }}>
                    <td className="px-4 py-3 sticky left-0" style={{ background: "#FFFFFF" }}>
                      <div className="font-semibold text-[12.5px]" style={{ color: "#0B1A2F" }}>
                        {f.label}
                      </div>
                      <div
                        className="text-[10.5px]"
                        style={{ fontFamily: "'JetBrains Mono', monospace", color: "#8A93A5" }}
                      >
                        {f.canonicalField}
                        <span className="ml-1.5" style={{ color: "#C6CDDA" }}>· {f.scope}</span>
                      </div>
                    </td>
                    {STANDARD_REF_COLUMNS.map(({ key }) => (
                      <td
                        key={key}
                        className="px-4 py-3 text-[11px]"
                        style={{ fontFamily: "'JetBrains Mono', monospace", color: f[key] ? "#56627A" : "#C6CDDA", whiteSpace: "nowrap" }}
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
            <div className="px-4 py-10 text-center">
              <p className="text-[13px] font-semibold" style={{ color: "#0B1A2F" }}>No fields match</p>
              <p className="text-[12px] mt-1" style={{ color: "#56627A" }}>Nothing for &ldquo;{q}&rdquo;.</p>
            </div>
          )}
        </div>

        {/* Request-a-format footer */}
        <div className="flex items-center gap-3 mt-4">
          <span className="text-[11.5px]" style={{ color: "#8A93A5" }}>
            Need a standard we don&rsquo;t list?
          </span>
          <a
            href="/support"
            className="inline-flex items-center gap-1.5 rounded-[6px] px-2.5 text-[12px] font-medium"
            style={{ height: 27, border: "1px solid #E2E6EE", background: "#FFFFFF", color: "#1E66C9" }}
          >
            ✉ Request a format
          </a>
        </div>
      </div>
    </div>
  );
}
