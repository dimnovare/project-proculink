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

import { useEffect, useRef } from "react";
import { Button } from "@/components/bridge/DSPrimitives";
import { RevisionStatusBadge } from "@/components/connections/RevisionStatusBadge";
import { ReplayPanel } from "@/components/connections/ReplayPanel";
import { formatDateTime } from "@/lib/format-date";
import type { ConnectionRevisionSummary } from "@/lib/api/types";

// Test-pack evidence shape, mirrored from ConnectionDetail (kept structurally
// compatible so the same object flows straight through).
interface TestPackReplayLeg {
  passed: boolean;
  orderCount: number;
  outputErrors: number;
  outputChanged: number;
  validationChanged: number;
  note: string | null;
}
interface TestPackConformanceLeg {
  skipped: boolean;
  passed: boolean | null;
  profile: string | null;
  errors: number;
  warnings: number;
  note: string | null;
}
interface TestPackSummary {
  replay: TestPackReplayLeg | null;
  conformance: TestPackConformanceLeg | null;
  error: string | null;
}
export interface RevisionTestEvidence {
  revisionId: string;
  passed: boolean;
  testedAt: string;
  summary: TestPackSummary | null;
}

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
              const testsPassed = evidenceForThisRevision?.passed === true;

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
                        title={
                          testsPassed
                            ? "Applies this version to new orders. Orders already sent keep their original format. You can revert anytime."
                            : "Run tests — checks must pass before going live."
                        }
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

function evidenceNotes(summary: TestPackSummary | null): string[] {
  if (!summary) return [];
  return [summary.replay?.note, summary.conformance?.note, summary.error].filter(
    (n): n is string => typeof n === "string" && n.length > 0,
  );
}

// Selectors that can receive keyboard focus — used to bound the focus-trap.
const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

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
  // Element focused before the drawer opened — focus returns here on close.
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  // Capture the trigger, move focus into the drawer, restore it on close.
  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = (document.activeElement as HTMLElement) ?? null;
    // Focus the close affordance after paint.
    const id = window.requestAnimationFrame(() => closeBtnRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(id);
      restoreFocusRef.current?.focus?.();
    };
  }, [open]);

  // Esc closes + Tab is trapped within the panel while open.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || !panel.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

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

function TestEvidenceSummary({ evidence }: { evidence: RevisionTestEvidence }) {
  const { passed, testedAt, summary } = evidence;
  const notes = evidenceNotes(summary);
  const replay = summary?.replay ?? null;
  const conformance = summary?.conformance ?? null;

  return (
    <div
      className="mt-2.5 rounded-[6px] px-3 py-2.5 text-[11.5px] leading-[1.55]"
      style={
        passed
          ? { background: "var(--brand-green-soft)", border: "1px solid var(--brand-green-soft)", color: "var(--brand-green-deep)" }
          : { background: "var(--danger-soft)", border: "1px solid var(--danger-soft)", color: "var(--danger)" }
      }
      role="status"
    >
      <span className="font-semibold">Checks {passed ? "passed" : "failed"}</span>
      <span> · {formatDateTime(testedAt)}</span>
      {(replay || conformance) && (
        <div className="mt-1" style={{ opacity: 0.92 }}>
          {replay && (
            <span>
              Replay: {replay.orderCount} order{replay.orderCount === 1 ? "" : "s"}
              {replay.outputErrors > 0 ? `, ${replay.outputErrors} render error${replay.outputErrors === 1 ? "" : "s"}` : ""}
            </span>
          )}
          {replay && conformance && <span> · </span>}
          {conformance && (
            <span>
              Conformance:{" "}
              {conformance.skipped
                ? "skipped"
                : `${conformance.passed ? "passed" : "failed"}${conformance.profile ? ` (${conformance.profile})` : ""}`}
            </span>
          )}
        </div>
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
            style={{ background: "var(--amber-soft)", color: "var(--amber)" }}
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
