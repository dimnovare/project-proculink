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
import { FIELD_STANDARDS, type CanonicalFieldStandards } from "@/lib/standards/catalog";
import { EmptyState } from "@/components/bridge/EmptyState";
import { PageShell } from "@/components/bridge/layout/PageShell";
import { PageHeader } from "@/components/bridge/layout/PageHeader";

// ── Local presentation order — cXML first, versioned labels (design spec) ──────
// key is a field on CanonicalFieldStandards. The header labels here are the exact
// columnheader strings the design render shows (and the e2e contract asserts):
// "cXML 1.2", "UBL 2.1", "EDIFACT", "X12", "Peppol BIS".
type RefKey = keyof Pick<
  CanonicalFieldStandards,
  "cxml" | "ubl" | "edifact" | "x12" | "peppolBis"
>;

const REF_COLUMNS: ReadonlyArray<{ key: RefKey; label: string }> = [
  { key: "cxml", label: "cXML 1.2" },
  { key: "ubl", label: "UBL 2.1" },
  { key: "edifact", label: "EDIFACT" },
  { key: "x12", label: "X12" },
  { key: "peppolBis", label: "Peppol BIS" },
];

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
      <PageHeader
        title="Standards reference"
        sub="How every order field maps across formats — always visible, never hidden"
        actions={searchInput}
      />

      {/* Progressive-disclosure "which format?" helper. Reference guidance about the
          standards themselves — all five are real supported output formats, so this is
          honest orientation, not a capability claim. Collapsed by default so it never
          crowds the locked table layout. */}
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
            <li><strong style={{ color: "var(--ink)" }}>cXML 1.2</strong> — punchout &amp; marketplace orders (Ariba, Coupa and similar procurement platforms).</li>
            <li><strong style={{ color: "var(--ink)" }}>UBL 2.1 / Peppol BIS</strong> — European e-procurement and public-sector networks (Peppol is common for EU government buyers).</li>
            <li><strong style={{ color: "var(--ink)" }}>EDIFACT</strong> — long-established European and global EDI (retail, automotive, logistics).</li>
            <li><strong style={{ color: "var(--ink)" }}>X12</strong> — North American EDI (ANSI ASC X12 850 purchase order).</li>
          </ul>
          <p className="mt-2.5" style={{ color: "var(--ink-faint)" }}>
            Not sure? Ask your supplier which they accept — it&rsquo;s usually on their order or onboarding spec.
          </p>
        </div>
      </details>

      {/* Mobile-only swipe hint — the matrix h-scrolls but truncated cells give no
          cue on a phone. Hidden on sm+ where all columns fit. */}
      <p className="mb-2 flex items-center gap-1 text-[11.5px] sm:hidden" style={{ color: "var(--ink-faint)" }}>
        Swipe the table sideways to see every format
        <span aria-hidden>→</span>
      </p>

      {/* Single white card — table scrolls horizontally with a sticky first column so
          the canonical field stays anchored while the reference codes scroll.
          <Card> is not used here because the table requires zero internal padding for
          its edge-to-edge layout; the Card primitive always applies a fixed pad value.
          The div is already fully token-clean (surface/border/radius-md). */}
      <div
        className="relative overflow-hidden"
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-md)",
          boxShadow: "var(--shadow-card)",
        }}
      >
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
                  Canonical field
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
              sub="The canonical field reference isn't available. Reload the page, and if it stays empty, contact support."
            />
          ) : (
            <EmptyState compact title="No fields match" sub={`Nothing for "${q}".`} />
          )
        )}
      </div>

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
