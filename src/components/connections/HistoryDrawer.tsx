"use client";

// HistoryDrawer — WS-8. The connection's primary surface stays simple
// (Live summary · Edit mapping · Make live). Every SECONDARY / power action —
// version history, run-checks + evidence, restore an older version, discard a
// draft, replay against historical orders, and the read-only configuration
// summary — lives behind a single right-side slide-over opened from one quiet
// "History & advanced" trigger.
//
// This component owns NO mutation logic. It relocates the TRIGGERS for the
// existing affordances; every handler (test / publish / restore / discard) and
// every piece of state (evidence, busy, confirm) is owned by ConnectionDetail
// and passed in. The drawer reuses ReplayPanel verbatim. Pattern matches
// HelpSlideover (scrim + outside-click + Esc + aria-modal + var(--tap-min)),
// adds a focus-trap and focus-restore for the modal surface.

import { useRef } from "react";
import { useDialogA11y } from "@/hooks/useDialogA11y";
import { Button } from "@/components/bridge/DSPrimitives";
import { RevisionStatusBadge } from "@/components/connections/RevisionStatusBadge";
import { ReplayPanel } from "@/components/connections/ReplayPanel";
import { formatDateTime } from "@/lib/format-date";
import type { ConnectionRevisionSummary } from "@/lib/api/types";
// Test-pack evidence shape. This file used to re-declare it — "mirrored from
// ConnectionDetail (kept structurally compatible so the same object flows straight
// through)" — and the second copy is exactly how `parseLeg` came to be invisible:
// the type it was mirrored from did not have one either, so there was nothing for
// the drop to disagree with. One declaration now, in ./testPackSummary, checked
// against the C# record by src/test/backendMirror.test.ts.
import {
  evidenceNotes,
  failedLegLabels,
  isLegacyTestPackPayload,
  unprovenLegLabels,
} from "./testPackSummary";
import type { RevisionTestEvidence } from "./testPackSummary";
// The four outcomes a check run can have, and the ONE place their wording is written.
// This panel and the banner above it used to compose their own sentences from the same
// boolean, and said different things about the same run.
import {
  MAKE_LIVE_NEEDS_CHECKS_TITLE,
  testLegWord,
  testPackReading,
} from "@/lib/testPackOutcomeManifest";

export type { RevisionTestEvidence } from "./testPackSummary";

/** The live revision's config summary, rendered read-only in the drawer. */
export interface BundleSummaryData {
  inputConfigured: boolean;
  outputTemplateConfigured: boolean;
  outputFormat: string | null;
  deliveryProtocol: string | null;
  deliveryAutoDeliver: boolean;
  hasCredentials: boolean;
  itemMappingCount: number;
  acceptanceBound: boolean;
  acceptanceVersionNo: number | null;
  catalogMode: string;
}

/**
 * The version-history view itself — every revision row + lifecycle controls, the
 * read-only live-configuration summary, and the replay panel. Owns NO mutation
 * logic (handlers + state are passed in). Rendered BOTH inside the drawer chrome
 * (HistoryDrawer) and inline inside a Card on the supplier page
 * (SupplierHistoryTab, STRUCT-1) — so the two surfaces render LITERALLY the same
 * code.
 */
export interface HistoryContentProps {
  // Connection context.
  connectionId: string;
  revisions: ConnectionRevisionSummary[];
  activeRevisionId: string | null;

  // Live-version configuration summary (read-only). Null until the active
  // revision bundle has loaded.
  liveSummary: BundleSummaryData | null;
  liveVersionNo: number | null;

  // Per-revision test evidence from the most recent "Test" call (owned upstream).
  testEvidence: RevisionTestEvidence | null;

  // True while ANY lifecycle mutation is in flight (disables all row actions).
  busy: boolean;

  // Per-action pending flags + the revision id each is targeting, so only the
  // acting row shows a spinner (mirrors ConnectionDetail's existing wiring).
  testingRevisionId: string | null;
  rollingBackRevisionId: string | null;
  discardingRevisionId: string | null;

  // Relocated triggers — these call the upstream handlers.
  onTest: (revisionId: string) => void;
  onRequestPublish: (revisionId: string, versionNo: number) => void;
  onRequestRollback: (revisionId: string, versionNo: number) => void;
  onRequestArchive: (revisionId: string, versionNo: number) => void;
}

export interface HistoryDrawerProps extends HistoryContentProps {
  open: boolean;
  onClose: () => void;
}

// Shared card chrome for the three sections inside HistoryContent.
const HISTORY_SECTION_LABEL_STYLE: React.CSSProperties = {
  margin: 0,
  fontSize: 11,
  fontWeight: 600,
  color: "var(--ink-faint)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const HISTORY_CARD_STYLE: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "12px 14px",
  marginBottom: 16,
};

/**
 * Version history + live-config summary + replay, sans dialog chrome. Extracted
 * from HistoryDrawer's scrollable body so the supplier History tab renders the
 * IDENTICAL view inline (STRUCT-1). The drawer wraps this in its slide-over.
 */
export function HistoryContent(props: HistoryContentProps) {
  const {
    connectionId,
    revisions,
    activeRevisionId,
    liveSummary,
    liveVersionNo,
    testEvidence,
    busy,
    testingRevisionId,
    rollingBackRevisionId,
    discardingRevisionId,
    onTest,
    onRequestPublish,
    onRequestRollback,
    onRequestArchive,
  } = props;

  const sectionLabelStyle = HISTORY_SECTION_LABEL_STYLE;
  const cardStyle = HISTORY_CARD_STYLE;

  return (
    <>
      {/* ── Version history + lifecycle controls ─────────────────── */}
      <section style={cardStyle} aria-label="Version history">
        <p style={sectionLabelStyle}>Version history</p>
        {revisions.length === 0 ? (
          <p
            style={{
              margin: "8px 0 2px",
              fontSize: 12.5,
              lineHeight: 1.5,
              color: "var(--ink-muted)",
            }}
          >
            No versions yet. Edit the mapping to begin.
          </p>
        ) : (
          <ul className="flex flex-col gap-2 list-none p-0 m-0" style={{ marginTop: 8 }}>
            {revisions.map((r) => {
              const isActive = r.id === activeRevisionId;
              const status = (r.status ?? "").toLowerCase();
              const canTest = status === "draft" || status === "test";
              const canPublish = status === "draft" || status === "test";
              const canRollback = status === "archived";
              const canArchive = status === "draft" || status === "test";

              const evidenceForThisRevision =
                testEvidence && testEvidence.revisionId === r.id ? testEvidence : null;
              // One reading of one outcome, feeding BOTH the gate and the words beside
              // it. `favourable` is true only for `passed`, so a run that tested nothing
              // — a supplier with no orders, i.e. the default at onboarding — leaves the
              // button shut and says why, instead of unlocking it and calling that a pass.
              const evidenceReading = evidenceForThisRevision
                ? testPackReading(evidenceForThisRevision.outcome)
                : null;
              const testsPassed = evidenceReading?.favourable === true;

              return (
                <li
                  key={r.id}
                  className="rounded-[8px]"
                  style={{
                    border: `1px solid ${isActive ? "var(--brand-green)" : "var(--border)"}`,
                    boxShadow: isActive ? "0 0 0 1px var(--brand-green)" : "none",
                    padding: "12px 14px",
                    background: "var(--surface)",
                  }}
                >
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="text-[13px] font-mono font-semibold" style={{ color: "var(--ink)" }}>
                        v{r.versionNo}
                      </span>
                      <RevisionStatusBadge status={r.status} size="sm" />
                    </div>
                    <span className="text-[11px]" style={{ color: "var(--ink-faint)" }}>
                      {status === "published"
                        ? `Live since ${formatDateTime(r.publishedAt)}`
                        : status === "archived"
                          ? (r.publishedAt ? `Was live · ${formatDateTime(r.publishedAt)}` : `Discarded`)
                          : `Created ${formatDateTime(r.createdAt)}`}
                    </span>
                  </div>

                  <div className="mt-2.5 flex flex-wrap gap-2">
                    {canTest && (
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={busy}
                        loading={testingRevisionId === r.id}
                        title="Runs a safety check against your recent orders to catch problems. Nothing is actually sent."
                        onClick={() => onTest(r.id)}
                      >
                        Test
                      </Button>
                    )}
                    {canPublish && (
                      <Button
                        variant="primary"
                        size="sm"
                        disabled={busy || !testsPassed}
                        // The tooltip is the button's own explanation of why it is shut,
                        // so it has to distinguish the same four states the panel does.
                        // "Run tests — checks must pass" was the only wording available
                        // before, and it was wrong twice over for a run that HAD been
                        // done and had simply tested nothing.
                        title={evidenceReading?.makeLiveTitle ?? MAKE_LIVE_NEEDS_CHECKS_TITLE}
                        onClick={() => onRequestPublish(r.id, r.versionNo)}
                      >
                        Make live
                      </Button>
                    )}
                    {canRollback && (
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={busy}
                        loading={rollingBackRevisionId === r.id}
                        title={'Makes this older version live for new orders again — just like "Make live".'}
                        onClick={() => onRequestRollback(r.id, r.versionNo)}
                      >
                        Use this version
                      </Button>
                    )}
                    {canArchive && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        loading={discardingRevisionId === r.id}
                        onClick={() => onRequestArchive(r.id, r.versionNo)}
                      >
                        Discard
                      </Button>
                    )}
                  </div>

                  {evidenceForThisRevision && (
                    <TestEvidenceSummary evidence={evidenceForThisRevision} />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ── Configuration summary (read-only) ────────────────────── */}
      <section style={cardStyle} aria-label="Live configuration summary">
        <p style={sectionLabelStyle}>
          Live configuration{liveVersionNo != null ? ` · v${liveVersionNo}` : ""}
        </p>
        <p
          style={{
            margin: "6px 0 8px",
            fontSize: 12,
            lineHeight: 1.45,
            color: "var(--ink-muted)",
          }}
        >
          What this supplier receives for new orders today.
        </p>
        {liveSummary ? (
          <ConfigSummary data={liveSummary} />
        ) : (
          <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink-faint)" }}>
            Nothing live yet.
          </p>
        )}
      </section>

      {/* ── Replay (impact preview) — reused verbatim ────────────── */}
      <section aria-label="Test with recent orders">
        <ReplayPanel
          connectionId={connectionId}
          revisions={revisions}
          activeRevisionId={activeRevisionId}
        />
      </section>
    </>
  );
}

export function HistoryDrawer(props: HistoryDrawerProps) {
  const {
    open,
    onClose,
    connectionId,
    revisions,
    activeRevisionId,
    liveSummary,
    liveVersionNo,
    testEvidence,
    busy,
    testingRevisionId,
    rollingBackRevisionId,
    discardingRevisionId,
    onTest,
    onRequestPublish,
    onRequestRollback,
    onRequestArchive,
  } = props;

  const panelRef = useRef<HTMLElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  // Escape + Tab trap + focus-in + focus-restore + scroll lock. This file and
  // OrderDetailsDrawer were the two best of the six hand-rolled copies; the
  // shared hook IS that implementation, generalised and given a layer stack so a
  // dialog opened on top of this one owns Escape.
  useDialogA11y({ open, onClose, panelRef, initialFocusRef: closeBtnRef });

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label="Version history and advanced actions"
      aria-modal="true"
      className="motion-reduce:transition-none"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 70,
        background: "rgba(11,26,47,0.32)",
        display: "flex",
        justifyContent: "flex-end",
        animation: "plk-drawer-scrim 180ms ease-out",
      }}
      onClick={onClose}
    >
      {/* Local keyframes — transform/opacity only, honoured-reduced via the class. */}
      <style>{`
        @keyframes plk-drawer-scrim { from { opacity: 0 } to { opacity: 1 } }
        @keyframes plk-drawer-slide { from { transform: translateX(16px); opacity: 0 } to { transform: translateX(0); opacity: 1 } }
        @media (prefers-reduced-motion: reduce) {
          .plk-history-scrim, .plk-history-panel { animation: none !important }
        }
      `}</style>

      <aside
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
        className="plk-history-panel"
        style={{
          width: "min(460px, 100%)",
          background: "var(--surface)",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          boxShadow: "-12px 0 30px rgba(11,26,47,0.12)",
          animation: "plk-drawer-slide 200ms cubic-bezier(0.16,1,0.3,1)",
        }}
      >
        {/* Header */}
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "20px 22px 12px",
            flexShrink: 0,
            borderBottom: "1px solid var(--border)",
          }}
        >
          <div style={{ minWidth: 0 }}>
            <h2
              style={{
                fontFamily: "var(--font-display, 'Bricolage Grotesque', Inter, sans-serif)",
                fontSize: 18,
                fontWeight: 600,
                color: "var(--ink)",
                margin: 0,
                lineHeight: 1.2,
              }}
            >
              History &amp; advanced
            </h2>
            <p
              style={{
                margin: "3px 0 0",
                fontSize: 12,
                color: "var(--ink-muted)",
                lineHeight: 1.4,
              }}
            >
              See every saved version, test changes, or go back to an older one. Nothing here touches live orders — every change is reversible.
            </p>
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            aria-label="Close history and advanced actions"
            className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-blue)] rounded"
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              fontSize: 22,
              lineHeight: 1,
              color: "var(--ink-faint)",
              padding: 10,
              minWidth: "var(--tap-min)",
              minHeight: "var(--tap-min)",
              flexShrink: 0,
            }}
          >
            ×
          </button>
        </header>

        {/* Scrollable body — the IDENTICAL view rendered inline on the supplier
            History tab (SupplierHistoryTab), so the two surfaces never drift. */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 22px" }}>
          <HistoryContent
            connectionId={connectionId}
            revisions={revisions}
            activeRevisionId={activeRevisionId}
            liveSummary={liveSummary}
            liveVersionNo={liveVersionNo}
            testEvidence={testEvidence}
            busy={busy}
            testingRevisionId={testingRevisionId}
            rollingBackRevisionId={rollingBackRevisionId}
            discardingRevisionId={discardingRevisionId}
            onTest={onTest}
            onRequestPublish={onRequestPublish}
            onRequestRollback={onRequestRollback}
            onRequestArchive={onRequestArchive}
          />
        </div>
      </aside>
    </div>
  );
}

// ── Test-pack evidence summary (inline under a tested version row) ───────────

/**
 * Three paint jobs for three kinds of news. `warn` is not decoration: a run that found
 * no fault but tested nothing is neither "carry on" nor "you broke something", and
 * borrowing either colour re-tells the lie the headline just stopped telling.
 */
const EVIDENCE_TONE_STYLE: Record<"ok" | "warn" | "err", React.CSSProperties> = {
  ok: { background: "var(--brand-green-soft)", border: "1px solid var(--brand-green-soft)", color: "var(--brand-green-deep)" },
  warn: { background: "var(--amber-soft)", border: "1px solid var(--amber-soft)", color: "var(--amber-text)" },
  err: { background: "var(--danger-soft)", border: "1px solid var(--danger-soft)", color: "var(--danger)" },
};

function TestEvidenceSummary({ evidence }: { evidence: RevisionTestEvidence }) {
  const { outcome, testedAt, summary } = evidence;
  const reading = testPackReading(outcome);
  // PRE-PR-207 COMPATIBILITY — SCAFFOLDING, delete this line, the sentence it renders
  // below, and `isLegacyTestPackPayload` once PR 207 is deployed everywhere.
  //
  // The old backend sent only booleans, which cannot say whether a check ran. That
  // resolves to the same not-favourable reading as any answer this page cannot read —
  // but an operator deserves the real reason rather than a generic one, so when the
  // payload is recognisably the old shape we say which it is.
  const isLegacyPayload =
    reading.outcome === "unrecognised" &&
    (isLegacyTestPackPayload(summary) || typeof evidence.legacyPassed === "boolean");
  const notes = evidenceNotes(summary);
  const replay = summary?.replay ?? null;
  const conformance = summary?.conformance ?? null;
  const parseLeg = summary?.parseLeg ?? null;
  // The run's verdict names no leg, so read back which ones actually found a fault — a
  // run that fails only on the source re-read used to turn this panel red and then say
  // nothing at all about why.
  const failedLegs = failedLegLabels(summary);
  // And which ones proved nothing. Kept separate because "these did not run" is not
  // "these failed": pointing an operator at fixing a version that may be perfectly fine
  // is its own wrong answer. `not_applicable` is excluded — see unprovenLegLabels.
  const unprovenLegs = reading.outcome === "passed" ? [] : unprovenLegLabels(summary);

  return (
    <div
      className="mt-2.5 rounded-[6px] px-3 py-2.5 text-[11.5px] leading-[1.55]"
      style={EVIDENCE_TONE_STYLE[reading.tone]}
      role="status"
      data-testid="revision-check-evidence"
      data-outcome={reading.outcome}
    >
      <span className="font-semibold" data-testid="revision-check-headline">
        {reading.headline}
        {/* Which check. Without this a source-re-read-only failure read as an
            unexplained red panel: the other two legs printed normal-looking lines, and
            the verdict says only that something went wrong. */}
        {failedLegs.length > 0 ? ` — ${failedLegs.join(" and ")}` : ""}
      </span>
      <span> · {formatDateTime(testedAt)}</span>
      {(replay || conformance || parseLeg) && (
        <div className="mt-1" style={{ opacity: 0.92 }}>
          {replay && (
            <span>
              Recent orders rebuilt: {testLegWord(replay.outcome)} · {replay.orderCount} order
              {replay.orderCount === 1 ? "" : "s"}
              {replay.outputErrors > 0 ? `, ${replay.outputErrors} couldn't be rebuilt` : ""}
            </span>
          )}
          {replay && conformance && <span> · </span>}
          {conformance && (
            <span>
              {/* "no such check for this setup" rather than "skipped": CSV, JSON and XML
                  have no published standard to check against and no operator action can
                  create one, so this is a fact about the format, not a gap in the run.
                  It used to print "skipped" here while the pack counted it as a pass. */}
              Standards: {testLegWord(conformance.outcome)}
              {conformance.profile ? ` (${conformance.profile})` : ""}
            </span>
          )}
          {(replay || conformance) && parseLeg && <span> · </span>}
          {parseLeg && (
            <span>
              Source files re-read: {testLegWord(parseLeg.outcome)} · {parseLeg.ordersReParsed} order
              {parseLeg.ordersReParsed === 1 ? "" : "s"}
              {parseLeg.parseChanges > 0 ? `, ${parseLeg.parseChanges} would read differently` : ""}
              {parseLeg.failures > 0 ? `, ${parseLeg.failures} failed` : ""}
              {parseLeg.skipped > 0 ? `, ${parseLeg.skipped} skipped` : ""}
            </span>
          )}
        </div>
      )}
      {/* Name what was left unproven, so "did not test this version" is attributable
          rather than a bare assertion the operator cannot act on. */}
      {unprovenLegs.length > 0 && (
        <div className="mt-1">Not proven here: {unprovenLegs.join(", ")}.</div>
      )}
      {/* SCAFFOLDING — delete with the rest of the pre-PR-207 compatibility block. */}
      {isLegacyPayload && (
        <div className="mt-1">
          This result came from an earlier version of these checks, which could not report
          whether each check actually ran. Run the checks again to get a result this page can
          read.
        </div>
      )}
      {/* A fault the payload does not attribute to any leg. Saying so beats an
          unexplained red box, and beats guessing at a leg. */}
      {reading.outcome === "failed" && failedLegs.length === 0 && notes.length === 0 && (
        <div className="mt-1">The server did not say which check failed.</div>
      )}
      {notes.length > 0 && (
        <ul className="mt-1 list-disc pl-4 m-0">
          {notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Read-only configuration summary rows ─────────────────────────────────────

function ConfigSummary({ data }: { data: BundleSummaryData }) {
  const deliveryLabel = (() => {
    const p = data.deliveryProtocol;
    if (!p) return "Not configured";
    const names: Record<string, string> = {
      http: "HTTP webhook",
      sftp: "SFTP",
      ftp: "FTP",
      ftps: "FTPS",
      smtp: "Email (SMTP)",
      erp_erply: "Erply (ERP)",
      erp_directo: "Directo (ERP)",
    };
    return names[p] ?? p.toUpperCase();
  })();

  return (
    <dl className="flex flex-col gap-px m-0">
      <SummaryRow
        label="Input mapping"
        value={data.inputConfigured ? "Configured" : "Default / none"}
        unconfigured={!data.inputConfigured}
      />
      <SummaryRow
        label="Output template"
        value={data.outputTemplateConfigured ? "Custom template" : "Fixed transformer"}
      />
      <SummaryRow label="Output format" value={data.outputFormat ? data.outputFormat.toUpperCase() : "Default"} />
      <SummaryRow
        label="Delivery channel"
        value={
          data.deliveryProtocol
            ? `${deliveryLabel}${data.deliveryAutoDeliver ? " · auto-send" : ""}${data.hasCredentials ? " · credentials set" : ""}`
            : deliveryLabel
        }
        unconfigured={!data.deliveryProtocol}
      />
      <SummaryRow
        label="Item mappings"
        value={`${data.itemMappingCount} code${data.itemMappingCount === 1 ? "" : "s"}`}
        unconfigured={data.itemMappingCount === 0}
      />
      <SummaryRow
        label="Acceptance rules"
        value={
          data.acceptanceBound
            ? `Bound${data.acceptanceVersionNo != null ? ` · v${data.acceptanceVersionNo}` : ""}`
            : "Not bound"
        }
        unconfigured={!data.acceptanceBound}
      />
      <SummaryRow label="Catalog" value={data.catalogMode === "live" ? "Live (read at send time)" : data.catalogMode} />
    </dl>
  );
}

function SummaryRow({ label, value, unconfigured }: { label: string; value: string; unconfigured?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2" style={{ borderBottom: "1px solid var(--border)" }}>
      <dt className="text-[12px] font-medium" style={{ color: "var(--ink-muted)" }}>
        {label}
      </dt>
      {unconfigured ? (
        <dd className="text-right m-0">
          <span
            className="inline-flex items-center rounded-full text-[11px] font-semibold px-2 h-[20px] whitespace-nowrap"
            style={{ background: "var(--amber-soft)", color: "var(--amber-text)" }}
          >
            {value}
          </span>
        </dd>
      ) : (
        <dd className="text-[12.5px] font-semibold text-right m-0" style={{ color: "var(--ink)" }}>
          {value}
        </dd>
      )}
    </div>
  );
}

export default HistoryDrawer;
