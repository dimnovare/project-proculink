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

/**
 * The two evidence classes, labelled exactly as the downloadable Markdown labels them
 * (`ConformanceModels.ToMarkdown` → `EvidenceLabel`). The same report is read here and
 * forwarded as a file from the button below; two vocabularies for one distinction is how
 * the panel and the file came to disagree in the first place.
 */
const EVIDENCE_LABEL = {
  ExternalArtifact: "Published schema",
  SelfCheck: "Self-check",
} as const;

/**
 * A row's evidence class, or `null` when the server said nothing this build understands.
 *
 * `null` renders as NO label anywhere. Deliberately not "Self-check": a value this build
 * does not recognise is a class the backend added after this shipped, and labelling a
 * stronger artifact with the weaker word is the same under-claim in a new place. And
 * obviously not "Published schema" — an unrecognised value falling through to the
 * favourable reading is the defect this repo repeats most.
 */
function evidenceLabel(c: ConformanceCheck): string | null {
  return c.evidence === "ExternalArtifact" || c.evidence === "SelfCheck"
    ? EVIDENCE_LABEL[c.evidence]
    : null;
}

/**
 * Which formats are checked against a machine-readable grammar ProcuLink did not author,
 * and what to call it.
 *
 * A MIRROR OF THE BACKEND, and named as one. The fact lives in
 * `ProcuLink.Transform/Conformance/*ProfileChecker.cs`: today only `UblProfileChecker`
 * emits an `ExternalArtifact` row — `ubl.xsd`, validated by `UblSchemaValidator` against
 * the vendored, unmodified OASIS UBL 2.1 Order-2 XSD in `Conformance/Schemas/ubl-2.1/`
 * (provenance + SHA-256 in its `PROVENANCE.md`). cXML and X12 have no vendored grammar,
 * so every one of their checks is ours.
 *
 * It is only the FALLBACK. `scopeNote()` prefers the wire whenever the wire says anything,
 * because a hand-maintained mirror of a backend fact drifts — and in this repo it drifts
 * the under-claiming way, which is exactly the sentence this replaced.
 */
const VENDORED_SCHEMA_BY_FORMAT: Record<string, string> = {
  ubl: "the OASIS UBL 2.1 Order schema",
};

/**
 * What this report is worth, said where the verdict is shown — and said per format.
 *
 * The sentence here used to be one blanket claim for all three formats: "Not a full schema
 * validation, and not a certification". It was false in both directions at once. Too harsh,
 * because `ubl.xsd` really is validated against a standards-body artifact, and denying it
 * gave away the one verdict in the report a third party produced — UBL content models are
 * ordered `xsd:sequence`es, so that check catches a document with every mandatory element
 * present but two of them transposed, which every presence check below passes. Too
 * generous, because for cXML and X12 nothing is vendored at all and several checks assert a
 * constant our own transformer just wrote, so a PASS restates our output back to us.
 *
 * Matches the two evidence classes the downloadable Markdown now prints per row.
 */
function scopeNote(format: string, checks: ConformanceCheck[]): string {
  const labels = checks.map(evidenceLabel).filter((l): l is string => l !== null);
  const named = VENDORED_SCHEMA_BY_FORMAT[format] ?? null;

  // The wire overrules the constant in BOTH directions: it can reveal a published-schema
  // check for a format this app has no name for, and it can withdraw one for a format this
  // app still lists. The constant answers only for a server with no `evidence` field.
  const external = labels.filter((l) => l === EVIDENCE_LABEL.ExternalArtifact).length;
  const schemaName =
    labels.length > 0
      ? external > 0
        ? named ?? "a published schema"
        : null
      : named;

  if (!schemaName) {
    return (
      "Every check here is ProcuLink's own reading of the profile — presence and cardinality " +
      "of its mandatory elements — and some assert values our own transformer writes, so " +
      "passing them is not independent evidence. No published schema for this format is " +
      "vendored into ProcuLink, and this is not a certification — confirm with your supplier " +
      "or access point before you rely on it."
    );
  }

  const lead = external > 1 ? `${external} checks are` : "One check is";
  return (
    `Two kinds of check. ${lead} validated against ${schemaName} vendored into ProcuLink — ` +
    "element order, cardinality and datatypes, which a presence check cannot see. The rest " +
    "are ProcuLink's own reading of the profile, and some assert values our own transformer " +
    "writes, so passing them is not independent evidence. Neither is a certification — " +
    "confirm with your supplier or access point before you rely on it."
  );
}

/** Per-row evidence class. Rendered only where the server supplied one. */
function EvidenceTag({ label }: { label: string }) {
  const external = label === EVIDENCE_LABEL.ExternalArtifact;
  return (
    <span
      className="inline-flex items-center rounded-[4px] px-2 py-0.5 text-[10.5px] font-semibold whitespace-nowrap"
      style={{
        background: external ? "var(--brand-blue-soft)" : "var(--surface-2)",
        color: external ? "var(--brand-blue-deep)" : "var(--ink-muted)",
      }}
    >
      {label}
    </span>
  );
}

/**
 * The conformance verdict — deliberately NOT `<UnifiedStatusBadge>`.
 *
 * This pill used to be
 *   `<UnifiedStatusBadge status={report.overallPass ? "delivered" : "rejected"} />`
 * and UnifiedStatusBadge's vocabulary is the ORDER LIFECYCLE. So a read-only
 * pre-flight check printed the word **"Delivered"** four lines under this panel's
 * own "Read-only: nothing is delivered or changed." — and **"Supplier rejected"**
 * on fail, naming a counterparty decision that no counterparty had made. Nothing
 * was delivered and no supplier saw the document; the only thing that happened is
 * that a profile's mandatory elements were counted.
 *
 * A check result is not a lifecycle state, so it must not borrow the lifecycle's
 * words. It says what it is. Do not reach for a status badge here again: if this
 * needs a second tone one day, add it to THIS component, not to STATUS_META.
 *
 * Tones reuse the same token pairs the badge used, so the contrast ratios that
 * were audited for those pairs still hold (green-deep on green-soft, danger on
 * danger-soft). No fractional opacity — the composite is the token value.
 */
function VerdictPill({ passed }: { passed: boolean }) {
  const tone = passed
    ? { bg: "var(--brand-green-soft)", fg: "var(--brand-green-deep)" }
    : { bg: "var(--danger-soft)", fg: "var(--danger)" };
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full h-6 px-2.5 text-[12px] font-semibold whitespace-nowrap"
      style={{ background: tone.bg, color: tone.fg }}
    >
      <span
        aria-hidden
        className="w-[6px] h-[6px] rounded-full flex-shrink-0"
        style={{ background: "currentColor" }}
      />
      {passed ? "Checks passed" : "Checks failed"}
    </span>
  );
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

  // The evidence column exists only when the server labelled at least one row. A server that
  // predates the field gets the table it has always had, rather than a column this app filled
  // in by pattern-matching check codes.
  const showEvidence = (report?.checks ?? []).some((c) => evidenceLabel(c) !== null);

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
                <VerdictPill passed={report.overallPass} />
                {/*
                  Says what was CHECKED, not what was proven. It stays deliberately modest even
                  for UBL, where `ubl.xsd` really does validate against the vendored OASIS schema:
                  a grammar is not a business-rule engine and not a certification, and no format's
                  report can tell anyone the document "matches the standard". What the UBL check
                  IS worth is stated by scopeNote() a few lines down, which is the right altitude
                  for it — this line is the headline over ALL the checks, most of which are ours.

                  (This comment used to end "no vendored schema exists in this repo to make that
                  claim true for any format". True of THIS repo and false about the product: the
                  XSD is vendored in the backend and the verdict crosses the wire. A rationale
                  scoped to the wrong repo is how a real check came to be denied on screen.)

                  "Matches the standard" is named in gatedCapabilityClaims.test.ts as part of the
                  Peppol defect itself: the emitter declared BIS conformance, the checker asserted
                  the two ids the emitter had just written, and this line rendered the circle as a
                  verdict under a green badge. The emitter and the checker were fixed; the sentence
                  they fed was left behind, which is the half of a claim that reaches the operator.
                */}
                <span className="text-[13px] font-semibold" style={{ color: "var(--ink)" }}>
                  {report.overallPass ? "Required elements present" : "Required elements missing or invalid"}
                </span>
              </div>
              <p className="mt-1.5 text-[12px]" style={{ color: "var(--ink-muted)" }}>
                {report.profileName} · v{report.profileVersion}
              </p>
              <p className="mt-0.5 text-[12px]" style={{ color: "var(--ink-faint)" }}>
                {report.errorCount} error{report.errorCount === 1 ? "" : "s"} · {report.warningCount} warning{report.warningCount === 1 ? "" : "s"} · {report.checks.length} checks
              </p>
              {/*
                What a pass means, said where the pass is shown, and split by evidence class —
                see scopeNote(). One sentence for all three formats could only be wrong for two
                of them: it denied the vendored-schema check UBL really runs, while excusing the
                cXML/X12 checks that assert our own emitter's constants.
              */}
              <p className="mt-1.5 text-[11.5px]" style={{ color: "var(--ink-faint)" }}>
                {scopeNote(report.format, report.checks)}
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
            data-testid="conformance-checks-table"
            className="hidden overflow-x-auto rounded-[10px] md:block"
            style={{ border: "1px solid var(--border)", background: "var(--surface)" }}
          >
            <table className="w-full border-collapse" style={{ minWidth: showEvidence ? 760 : 640, fontSize: 12.5 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  {["Result", ...(showEvidence ? ["Evidence"] : []), "Severity", "Code", "Message", "Profile reference"].map((h) => (
                    <th key={h} className="px-4 py-2.5 text-left text-[10.5px] font-semibold uppercase tracking-[0.05em]" style={{ color: "var(--ink-faint)", whiteSpace: "nowrap" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.checks.map((c, i) => {
                  const blocking = isBlocking(c);
                  const evidence = evidenceLabel(c);
                  return (
                    <tr
                      key={c.code + i}
                      style={{
                        borderBottom: i < report.checks.length - 1 ? "1px solid #F0F2F6" : undefined,
                        background: blocking ? "var(--danger-soft)" : "transparent",
                      }}
                    >
                      <td className="px-4 py-3" style={{ whiteSpace: "nowrap" }}><PassMark passed={c.passed} /></td>
                      {showEvidence && (
                        <td className="px-4 py-3">{evidence ? <EvidenceTag label={evidence} /> : null}</td>
                      )}
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
          <div data-testid="conformance-checks-cards" className="flex flex-col gap-2 md:hidden">
            {report.checks.map((c, i) => {
              const blocking = isBlocking(c);
              const evidence = evidenceLabel(c);
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
                  <div className="mt-2 grid gap-1 pt-2 text-[11px]" style={{ borderTop: "1px solid #F0F2F6" }}>
                    {evidence ? (
                      <span><EvidenceTag label={evidence} /></span>
                    ) : null}
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
