"use client";

// Conformance panel (Group V8) — standards conformance report for one order's
// would-be OUTBOUND document. Calls GET /api/orders/{id}/conformance?format=…,
// which transforms the order to the named standard IN MEMORY (non-mutating) and
// validates the bytes against the named profile (cXML 1.2 / UBL 2.1 / X12 850).
//
// Read-only. Failing Error-severity checks read in the alert-red family so a
// real blocker is visually prominent. A "Download report" button pulls the
// backend's Markdown variant (?download=md), authenticated.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useQueriesEnabled } from "@/hooks/useQueriesEnabled";
import {
  getConformanceReport,
  downloadConformanceReport,
  type ConformanceFormat,
  type ConformanceCheck,
  ApiHttpError,
} from "@/lib/api-client";
import { UnifiedStatusBadge } from "@/components/bridge/UnifiedStatusBadge";

const FORMATS: Array<{ id: ConformanceFormat; label: string }> = [
  { id: "cxml", label: "cXML 1.2" },
  { id: "ubl", label: "UBL 2.1" },
  { id: "x12", label: "X12 850" },
];

// Severity → swatch. Error reads alert-red; Warning amber; Info blue-grey.
const SEV_STYLE: Record<string, { bg: string; fg: string }> = {
  Error: { bg: "var(--danger-soft)", fg: "var(--danger)" },
  Warning: { bg: "var(--amber-soft)", fg: "var(--amber-text)" },
  Info: { bg: "var(--brand-blue-soft)", fg: "var(--brand-blue-deep)" },
};

function SeverityPill({ severity }: { severity: string }) {
  const s = SEV_STYLE[severity] ?? { bg: "var(--surface-2)", fg: "var(--ink-muted)" };
  return (
    <span
      className="inline-flex items-center rounded-[4px] px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.04em]"
      style={{ background: s.bg, color: s.fg }}
    >
      {severity}
    </span>
  );
}

function PassMark({ passed }: { passed: boolean }) {
  return passed ? (
    <span
      aria-label="Passed"
      className="inline-flex items-center gap-1 text-[12px] font-semibold"
      style={{ color: "var(--brand-green-deep)" }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 6 9 17l-5-5" /></svg>
      Pass
    </span>
  ) : (
    <span
      aria-label="Failed"
      className="inline-flex items-center gap-1 text-[12px] font-semibold"
      style={{ color: "var(--danger)" }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
      Fail
    </span>
  );
}

/** A failing Error-severity check is the load-bearing blocker — highlight its row. */
function isBlocking(c: ConformanceCheck): boolean {
  return !c.passed && c.severity === "Error";
}

export function ConformancePanel({ orderId, supplierName, defaultFormat }: {
  orderId: string;
  supplierName?: string;
  /** Initial format selection — the supplier's configured output format when it
   *  has a named profile (cxml/ubl/x12). Falls back to cXML only when unknown. */
  defaultFormat?: ConformanceFormat;
}) {
  const [format, setFormat] = useState<ConformanceFormat>(defaultFormat ?? "cxml");
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const queryEnabled = useQueriesEnabled();

  const { data: report, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["conformance", orderId, format],
    queryFn: () => getConformanceReport(orderId, format),
    enabled: queryEnabled,
    retry: 1,
    staleTime: 30_000,
  });

  // A disabled query reports undefined data with isLoading=true; treat not-yet-ready
  // as loading, never as an error (known repo gotcha).
  const showLoading = !queryEnabled || (isLoading && report === undefined);

  // 400 = no named profile / unresolvable format; 422 = unresolved lines.
  const httpStatus = error instanceof ApiHttpError ? error.status : null;
  const errorBody =
    error instanceof ApiHttpError && error.body && typeof error.body === "object"
      ? (error.body as { error?: string; detail?: string })
      : null;

  async function handleDownload() {
    setDownloading(true);
    setDownloadError(null);
    try {
      const blob = await downloadConformanceReport(orderId, format);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `conformance-${orderId}-${format}.md`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setDownloadError(e instanceof Error ? e.message : "Download failed.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Format selector + intent */}
      <div className="flex flex-col gap-3">
        <p className="text-[12.5px] leading-relaxed" style={{ color: "var(--ink-muted)" }}>
          Checks the document ProcuLink would generate{supplierName ? <> for <span className="font-semibold" style={{ color: "var(--ink)" }}>{supplierName}</span></> : null} against
          the chosen standard&apos;s named profile — before it is sent. Read-only: nothing is delivered or changed.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-[8px] p-0.5" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }} role="tablist" aria-label="Check against standard">
            {FORMATS.map((f) => {
              const active = f.id === format;
              return (
                <button
                  key={f.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setFormat(f.id)}
                  className="rounded-[6px] px-3 h-[32px] text-[12.5px] font-semibold transition-colors"
                  style={{
                    background: active ? "var(--surface)" : "transparent",
                    color: active ? "var(--ink)" : "var(--ink-muted)",
                    boxShadow: active ? "0 1px 2px rgba(16,24,40,0.10)" : "none",
                    cursor: "pointer",
                  }}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => refetch()}
            className="rounded-[7px] px-3 h-[32px] text-[12px] font-medium transition-colors"
            style={{ border: "1px solid var(--border)", background: "var(--surface)", color: "var(--ink-muted)", cursor: "pointer" }}
          >
            {isFetching ? "↻ Checking…" : "↻ Re-check"}
          </button>
        </div>
      </div>

      {/* Loading */}
      {showLoading && (
        <div className="grid gap-2">
          <div className="h-16 rounded-[10px] animate-pulse" style={{ background: "var(--surface-2)" }} />
          <div className="h-40 rounded-[10px] animate-pulse" style={{ background: "var(--surface-2)" }} />
        </div>
      )}

      {/* Error — distinguish a 400/422 "expected" message from a transport failure */}
      {!showLoading && isError && (
        <div className="rounded-[10px] p-4" style={{ border: "1px solid var(--border)", borderLeft: "3px solid var(--danger)", background: "var(--surface)" }}>
          <div className="text-[13px] font-semibold mb-1" style={{ color: "var(--ink)" }}>
            {httpStatus === 400
              ? "No standards profile for this format"
              : httpStatus === 422
                ? "Resolve the order first"
                : "Couldn't run the standards check"}
          </div>
          <p className="text-[12.5px] leading-relaxed mb-3" style={{ color: "var(--ink-muted)" }}>
            {errorBody?.error
              ? errorBody.error
              : httpStatus === 404
                ? "This order was not found."
                : "The standards check didn't respond. Your order is safe — this is usually transient."}
            {errorBody?.detail ? <span className="block mt-1" style={{ color: "var(--ink-faint)" }}>{errorBody.detail}</span> : null}
          </p>
          <button
            type="button"
            onClick={() => refetch()}
            className="rounded-[7px] px-3 h-[32px] text-[12px] font-semibold"
            style={{ border: "1px solid var(--border)", background: "var(--surface)", color: "var(--ink)", cursor: "pointer" }}
          >
            ↻ Retry
          </button>
        </div>
      )}

      {/* Report */}
      {!showLoading && !isError && report && (
        <>
          {/* Summary */}
          <div
            className="flex flex-col gap-3 rounded-[10px] p-4 sm:flex-row sm:items-center sm:justify-between"
            style={{
              border: "1px solid var(--border)",
              borderLeft: `3px solid ${report.overallPass ? "var(--brand-green)" : "var(--danger)"}`,
              background: "var(--surface)",
            }}
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <UnifiedStatusBadge status={report.overallPass ? "delivered" : "rejected"} size="md" />
                <span className="text-[13px] font-semibold" style={{ color: "var(--ink)" }}>
                  {report.overallPass ? "Matches the standard" : "Doesn't match the standard"}
                </span>
              </div>
              <p className="mt-1.5 text-[12px]" style={{ color: "var(--ink-muted)" }}>
                {report.profileName} · v{report.profileVersion}
              </p>
              <p className="mt-0.5 text-[12px]" style={{ color: "var(--ink-faint)" }}>
                {report.errorCount} error{report.errorCount === 1 ? "" : "s"} · {report.warningCount} warning{report.warningCount === 1 ? "" : "s"} · {report.checks.length} checks
              </p>
              {/*
                What a pass means, said where the pass is shown. "Matches the standard" above sits
                beside a green badge, and the checks behind it are presence and cardinality only —
                not a schema validation and not a certification. Saying so here is the difference
                between a useful pre-flight and a conformance claim the product cannot back.
              */}
              <p className="mt-1.5 text-[11.5px]" style={{ color: "var(--ink-faint)" }}>
                Checks the mandatory elements and cardinalities of this profile. Not a full schema
                validation, and not a certification — validate with your supplier or access point
                before you rely on it.
              </p>
            </div>
            <div className="flex flex-col items-start gap-1 sm:items-end">
              <button
                type="button"
                onClick={handleDownload}
                disabled={downloading}
                className="inline-flex items-center gap-1.5 rounded-[8px] px-3.5 h-[36px] text-[12.5px] font-semibold transition-colors"
                style={{ border: "1px solid var(--border)", background: "var(--surface)", color: "var(--ink)", cursor: downloading ? "default" : "pointer", opacity: downloading ? 0.65 : 1 }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 10l5 5 5-5" /><path d="M12 15V3" /></svg>
                {downloading ? "Preparing…" : "Download report"}
              </button>
              {downloadError && (
                <span className="text-[11px]" style={{ color: "var(--danger)" }}>{downloadError}</span>
              )}
            </div>
          </div>

          {/* Checks — desktop table */}
          <div
            className="hidden overflow-x-auto rounded-[10px] md:block"
            style={{ border: "1px solid var(--border)", background: "var(--surface)" }}
          >
            <table className="w-full border-collapse" style={{ minWidth: 640, fontSize: 12.5 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  {["Result", "Severity", "Code", "Message", "Profile reference"].map((h) => (
                    <th key={h} className="px-4 py-2.5 text-left text-[10.5px] font-semibold uppercase tracking-[0.05em]" style={{ color: "var(--ink-faint)", whiteSpace: "nowrap" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.checks.map((c, i) => {
                  const blocking = isBlocking(c);
                  return (
                    <tr
                      key={c.code + i}
                      style={{
                        borderBottom: i < report.checks.length - 1 ? "1px solid #F0F2F6" : undefined,
                        background: blocking ? "var(--danger-soft)" : "transparent",
                      }}
                    >
                      <td className="px-4 py-3" style={{ whiteSpace: "nowrap" }}><PassMark passed={c.passed} /></td>
                      <td className="px-4 py-3"><SeverityPill severity={c.severity} /></td>
                      <td className="px-4 py-3 font-mono text-[11.5px]" style={{ color: "var(--ink)", whiteSpace: "nowrap" }}>{c.code}</td>
                      <td className="px-4 py-3" style={{ color: blocking ? "var(--danger)" : "var(--ink)" }}>{c.message}</td>
                      <td className="px-4 py-3 font-mono text-[11.5px]" style={{ color: "var(--ink-muted)" }}>{c.profileRef}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Checks — mobile cards */}
          <div className="flex flex-col gap-2 md:hidden">
            {report.checks.map((c, i) => {
              const blocking = isBlocking(c);
              return (
                <div
                  key={c.code + i}
                  className="rounded-[10px] p-3.5"
                  style={{
                    border: `1px solid ${blocking ? "var(--danger)" : "var(--border)"}`,
                    background: blocking ? "var(--danger-soft)" : "var(--surface)",
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <PassMark passed={c.passed} />
                    <SeverityPill severity={c.severity} />
                  </div>
                  <p className="mt-2 text-[12.5px] leading-snug" style={{ color: blocking ? "var(--danger)" : "var(--ink)" }}>{c.message}</p>
                  <div className="mt-2 grid gap-0.5 pt-2 text-[11px]" style={{ borderTop: "1px solid #F0F2F6" }}>
                    <span className="font-mono" style={{ color: "var(--ink-faint)" }}>{c.code}</span>
                    <span className="font-mono" style={{ color: "var(--ink-muted)" }}>{c.profileRef}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

export default ConformancePanel;
