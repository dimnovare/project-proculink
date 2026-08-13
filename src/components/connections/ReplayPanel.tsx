"use client";

// Group V2 — Replay / impact preview.
//
// Replays historical orders through a connection revision (typically a DRAFT
// being vetted before publish) and shows, per order, the diff vs. the order's
// CURRENT result: output text diff, effective canonical-value changes, and
// validation pass/fail flips. The dangerous case — an order that currently
// PASSES validation but would START FAILING under the replayed revision — is
// prioritised and flagged in red. The replay itself is NON-DESTRUCTIVE: nothing
// is transformed, saved, or delivered by running it.
//
// WP-35 adds one PERSISTING action per row: re-processing that single order
// under the replayed revision writes (or reuses) a real output artifact. Even
// that delivers nothing — the order's deliverable artifact comes back unchanged
// and is shown, so an operator can see nothing was armed for sending.
//
// Backend: POST /api/connections/{connectionId}/revisions/{revisionId}/replay
//   → ProcuLink.Api/Services/ReplayService.cs (MaxOrders=50, recentLimit 1..50).
//          POST .../revisions/{revisionId}/reprocess
//   → ProcuLink.Api/Controllers/ConnectionsController.cs Reprocess.

import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card } from "@/components/bridge/layout/Card";
import { Button } from "@/components/bridge/DSPrimitives";
import { RevisionStatusBadge } from "@/components/connections/RevisionStatusBadge";
import { replayConnectionRevision, reprocessOrderUnderRevision, ApiHttpError } from "@/lib/api-client";
import type {
  ConnectionRevisionSummary,
  ReplayResponse,
  ReplayOrderDiff,
  ReplayFieldChange,
  ReplayValidationFlip,
  ReprocessResponse,
} from "@/lib/api/types";
import {
  replayImpact,
  summariseReplay,
  wouldStartFailing,
  type ReplaySummary,
} from "@/components/connections/replayImpactModel";

const RECENT_LIMIT_DEFAULT = 20;
const RECENT_LIMIT_MIN = 1;
const RECENT_LIMIT_MAX = 50;

export function ReplayPanel({
  connectionId,
  revisions,
  activeRevisionId,
}: {
  connectionId: string;
  revisions: ConnectionRevisionSummary[];
  activeRevisionId: string | null;
}) {
  // Default the target to the newest draft/test revision (most useful to vet),
  // else the live published revision, else the newest revision.
  const defaultRevisionId = useMemo(() => {
    const draftOrTest = revisions.find((r) => {
      const s = (r.status ?? "").toLowerCase();
      return s === "draft" || s === "test";
    });
    return draftOrTest?.id ?? activeRevisionId ?? revisions[0]?.id ?? "";
  }, [revisions, activeRevisionId]);

  const [revisionId, setRevisionId] = useState<string>(defaultRevisionId);
  const [recentLimit, setRecentLimit] = useState<number>(RECENT_LIMIT_DEFAULT);

  // If the revision list changes (e.g. a draft was created) and nothing is
  // selected yet, fall back to the computed default.
  const effectiveRevisionId = revisionId || defaultRevisionId;

  const selectedRevision = useMemo(
    () => revisions.find((r) => r.id === effectiveRevisionId) ?? null,
    [revisions, effectiveRevisionId],
  );

  const replay = useMutation<ReplayResponse, unknown, void>({
    mutationFn: () => {
      const limit = clampLimit(recentLimit);
      return replayConnectionRevision(connectionId, effectiveRevisionId, { recentLimit: limit });
    },
  });

  const result = replay.data ?? null;

  const summary = useMemo(
    () => (result ? summariseReplay(result.orders) : null),
    [result],
  );

  // Most dangerous first: would-start-failing, then validation-changed, then
  // output-changed, then the rest. Stable within each band by input order.
  const orderedOrders = useMemo<ReplayOrderDiff[]>(() => {
    if (!result) return [];
    const rank = (o: ReplayOrderDiff): number => {
      if (wouldStartFailing(o)) return 0;
      if (o.validationChanged) return 1;
      if (o.outputChanged) return 2;
      return 3;
    };
    return [...result.orders].sort((a, b) => rank(a) - rank(b));
  }, [result]);

  // Distinguish a 4xx validation/request rejection (the request itself was bad —
  // retrying unchanged won't help; surface the backend's reason) from a network
  // / 5xx / timeout failure (transient — a retry may succeed).
  const errorKind: "validation" | "network" | null =
    replay.error instanceof ApiHttpError
      ? replay.error.status >= 400 && replay.error.status < 500
        ? "validation"
        : "network"
      : replay.error
        ? "network"
        : null;

  const errorMessage =
    errorKind === "validation" && replay.error instanceof ApiHttpError
      ? replay.error.message
      : errorKind === "network"
        ? "Couldn't reach the server to run this test. Check your connection and try again."
        : null;

  const canRun = !!effectiveRevisionId && !replay.isPending;

  return (
    <Card edge="blue" title="Test with recent orders" sub="Test a version against recent orders before you make it live — running a test never contacts your supplier">
      {/* ── Controls ─────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:flex-wrap">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="replay-revision" className="text-[11.5px] font-medium" style={{ color: "var(--ink-muted)" }}>
            Version to test
          </label>
          <select
            id="replay-revision"
            value={effectiveRevisionId}
            onChange={(e) => setRevisionId(e.target.value)}
            disabled={revisions.length === 0 || replay.isPending}
            className="h-[44px] sm:h-[34px] rounded px-2.5 text-[12.5px]"
            style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--ink)", minWidth: 220 }}
          >
            {revisions.length === 0 && <option value="">No versions yet</option>}
            {revisions.map((r) => {
              const s = (r.status ?? "").toLowerCase();
              const live = r.id === activeRevisionId;
              return (
                <option key={r.id} value={r.id}>
                  v{r.versionNo} · {revisionStatusText(s)}{live ? " · live" : ""}
                </option>
              );
            })}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="replay-limit" className="text-[11.5px] font-medium" style={{ color: "var(--ink-muted)" }}>
            How many recent orders
          </label>
          <input
            id="replay-limit"
            type="number"
            min={RECENT_LIMIT_MIN}
            max={RECENT_LIMIT_MAX}
            value={recentLimit}
            onChange={(e) => setRecentLimit(parseLimit(e.target.value))}
            disabled={replay.isPending}
            className="h-[44px] sm:h-[34px] rounded px-2.5 text-[12.5px] w-[120px]"
            style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--ink)" }}
          />
        </div>

        <div className="sm:ml-auto flex items-end">
          <Button
            variant="primary"
            size="md"
            onClick={() => replay.mutate()}
            disabled={!canRun}
            loading={replay.isPending}
          >
            {result ? "Run again" : "Run replay"}
          </Button>
        </div>
      </div>

      <p className="mt-3 text-[12px] leading-[1.5]" style={{ color: "var(--ink-muted)" }}>
        Pick a version and how many recent orders to test against. More orders = more confidence but takes longer. Start
        with 10 if unsure.
      </p>

      {selectedRevision && (
        <p className="mt-2 text-[11.5px] leading-[1.5]" style={{ color: "var(--ink-faint)" }}>
          Replays the most recent {clampLimit(recentLimit)} order{clampLimit(recentLimit) === 1 ? "" : "s"} for this
          supplier through v{selectedRevision.versionNo}. Running the test only compares results — it changes no order.
          Re-processing a single order afterwards writes an output file you can inspect, and still sends nothing to your
          supplier.
        </p>
      )}

      {/* ── Error ────────────────────────────────────────────────────── */}
      {/* Validation (4xx) → danger: the request was rejected, the reason matters. */}
      {/* Network/5xx/timeout → amber: transient, a retry may succeed. */}
      {errorMessage && (
        <div
          role="alert"
          className="mt-4 rounded-[8px] px-4 py-3 text-[12.5px] leading-[1.5]"
          style={
            errorKind === "validation"
              ? {
                  border: "1px solid var(--danger)",
                  borderLeft: "3px solid var(--danger)",
                  background: "var(--danger-soft)",
                  color: "var(--danger)",
                }
              : {
                  border: "1px solid var(--amber)",
                  borderLeft: "3px solid var(--amber)",
                  background: "var(--amber-soft)",
                  color: "var(--amber-text)",
                }
          }
        >
          <span className="font-semibold">
            {errorKind === "validation" ? "Replay rejected: " : "Connection problem: "}
          </span>
          {errorMessage}
        </div>
      )}

      {/* ── Loading ──────────────────────────────────────────────────── */}
      {replay.isPending && (
        <div className="mt-4 flex flex-col gap-2" aria-busy="true" aria-label="Testing recent orders">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-[8px] animate-pulse" style={{ height: 56, background: "var(--border)" }} />
          ))}
        </div>
      )}

      {/* ── Results ──────────────────────────────────────────────────── */}
      {!replay.isPending && result && summary && (
        <div className="mt-4">
          {summary.total === 0 ? (
            <div
              className="rounded-[8px] px-4 py-6 text-center"
              style={{ border: "1px dashed var(--border)", background: "var(--bg)" }}
            >
              <p className="text-[13px] font-semibold m-0" style={{ color: "var(--ink)" }}>
                No recent orders to test against
              </p>
              <p className="text-[12px] mt-1 m-0" style={{ color: "var(--ink-muted)" }}>
                This supplier has no orders in history yet. Once orders flow through, you can vet a draft against them
                here.
              </p>
            </div>
          ) : (
            <>
              <ReplaySummaryHeader summary={summary} revisionStatus={result.revisionStatus} versionNo={result.revisionVersionNo} />
              <p className="mt-3 text-[11.5px] leading-[1.5] m-0" style={{ color: "var(--ink-muted)" }}>
                Red = an order that passes today would start failing. Yellow = its output would change. No colour = no
                impact.
              </p>
              <ul className="mt-2 flex flex-col gap-2 list-none p-0 m-0">
                {orderedOrders.map((o) => (
                  <OrderDiffRow
                    key={o.orderId}
                    order={o}
                    // Target the revision the server actually replayed, not the
                    // selector's current value — those drift once the operator
                    // changes the dropdown after a run.
                    connectionId={result.connectionId || connectionId}
                    revisionId={result.revisionId}
                    versionNo={result.revisionVersionNo}
                  />
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {/* ── Idle hint (before first run) ─────────────────────────────── */}
      {!replay.isPending && !result && !errorMessage && (
        <p className="mt-4 text-[12.5px] leading-[1.55]" style={{ color: "var(--ink-muted)" }}>
          Run a test to preview exactly which past orders this version would change — and, critically, which orders
          would <strong>start failing validation</strong> if you published it.
        </p>
      )}
    </Card>
  );
}

// ── Summary header ─────────────────────────────────────────────────────────

function ReplaySummaryHeader({
  summary,
  revisionStatus,
  versionNo,
}: {
  summary: ReplaySummary;
  revisionStatus: string;
  versionNo: number;
}) {
  // The ONE verdict. Tone and headline come from the same call, so the fill can
  // never stay calm under a sentence that is not — the old header keyed its colour
  // off `startFailing` alone, which is blind to a revision that rendered nothing.
  const impact = replayImpact(summary);
  const SHELL: Record<typeof impact.tone, { border: string; bg: string; body: string; strong: string }> = {
    danger: { border: "var(--danger)", bg: "var(--danger-soft)", body: "var(--danger)", strong: "var(--danger)" },
    warning: { border: "var(--amber)", bg: "var(--amber-soft)", body: "var(--amber-text)", strong: "var(--ink)" },
    calm: { border: "var(--border)", bg: "var(--brand-blue-soft)", body: "var(--ink-muted)", strong: "var(--ink)" },
  };
  const shell = SHELL[impact.tone];
  return (
    <div
      className="rounded-[8px] px-4 py-3"
      style={{ border: `1px solid ${shell.border}`, background: shell.bg }}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[12.5px] font-mono font-semibold" style={{ color: "var(--ink)" }}>
          v{versionNo}
        </span>
        <RevisionStatusBadge status={revisionStatus} size="sm" />
      </div>
      <p className="mt-1.5 text-[12.5px] leading-[1.5] m-0" style={{ color: shell.body }}>
        {impact.headline}
      </p>
      <p
        className="mt-1.5 text-[13px] font-semibold leading-[1.5] m-0"
        style={{ color: shell.strong }}
      >
        {summary.total} order{summary.total === 1 ? "" : "s"} replayed · {summary.outputChanges} output change
        {summary.outputChanges === 1 ? "" : "s"} · {summary.validationChanges} validation change
        {summary.validationChanges === 1 ? "" : "s"}
        {summary.startFailing > 0 ? ` (${summary.startFailing} would start failing)` : ""}
      </p>
      {summary.errors > 0 && (
        <p className="mt-1 text-[12px] m-0" style={{ color: "var(--amber-text)" }}>
          {summary.errors} order{summary.errors === 1 ? "" : "s"} could not produce output under this revision — see the
          warnings below.
        </p>
      )}
    </div>
  );
}

// ── One order's diff (expandable) ────────────────────────────────────────────

function OrderDiffRow({
  order,
  connectionId,
  revisionId,
  versionNo,
}: {
  order: ReplayOrderDiff;
  connectionId: string;
  revisionId: string;
  versionNo: number;
}) {
  const [open, setOpen] = useState(false);
  const danger = wouldStartFailing(order);
  const hasDetail =
    order.outputChanged ||
    !!order.outputError ||
    order.effectiveValueChanges.length > 0 ||
    order.validationFlips.length > 0;

  return (
    <li
      className="rounded-[8px]"
      style={{
        border: `1px solid ${danger ? "var(--danger)" : "var(--border)"}`,
        boxShadow: danger ? "0 0 0 1px var(--danger)" : "none",
        background: "var(--surface)",
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={() => hasDetail && setOpen((v) => !v)}
        aria-expanded={hasDetail ? open : undefined}
        disabled={!hasDetail}
        className="w-full flex items-center justify-between gap-3 px-3.5 py-3 text-left"
        style={{ background: "transparent", border: "none", cursor: hasDetail ? "pointer" : "default" }}
      >
        <div className="flex items-center gap-2.5 min-w-0 flex-wrap">
          <span className="text-[13px] font-mono font-semibold truncate" style={{ color: "var(--ink)" }}>
            {order.poNumber || order.orderId}
          </span>
          <span
            className="inline-flex items-center rounded-[4px] text-[10.5px] font-semibold px-1.5 h-[18px] uppercase"
            style={{ background: "var(--surface-2)", color: "var(--ink-muted)" }}
          >
            {order.outputFormat}
          </span>
          <div className="flex items-center gap-1.5 flex-wrap">
            {danger && <Chip tone="danger">Would start failing</Chip>}
            {!danger && order.validationChanged && <Chip tone="amber">Validation changed</Chip>}
            {order.outputChanged && <Chip tone="info">Output changed</Chip>}
            {order.outputError && <Chip tone="amber">Output error</Chip>}
            {!order.outputChanged && !order.validationChanged && !order.outputError && (
              <Chip tone="neutral">No change</Chip>
            )}
          </div>
        </div>
        {hasDetail && (
          <span aria-hidden className="text-[12px] flex-shrink-0" style={{ color: "var(--ink-faint)" }}>
            {open ? "▲" : "▼"}
          </span>
        )}
      </button>

      {open && hasDetail && (
        <div className="px-3.5 pb-3.5 pt-0 flex flex-col gap-4" style={{ borderTop: "1px solid var(--border)" }}>
          {/* Output error (instead of a diff) */}
          {order.outputError && (
            <div className="pt-3">
              <SectionLabel>Output</SectionLabel>
              <div
                className="rounded-[6px] px-3 py-2.5 text-[12px] leading-[1.5]"
                style={{ border: "1px solid var(--amber)", background: "var(--amber-soft)", color: "var(--amber-text)" }}
              >
                This version could not produce output for this order: {order.outputError}
              </div>
            </div>
          )}

          {/* Output diff (only when it changed and there is no blocking error) */}
          {!order.outputError && order.outputChanged && (
            <div className="pt-3">
              <SectionLabel>Output diff</SectionLabel>
              <OutputDiff current={order.currentOutput} draft={order.draftOutput} />
            </div>
          )}

          {/* Effective value changes */}
          {order.effectiveValueChanges.length > 0 && (
            <div>
              <SectionLabel>
                Field changes ({order.effectiveValueChanges.length})
              </SectionLabel>
              <FieldChangeTable changes={order.effectiveValueChanges} />
            </div>
          )}

          {/* Validation flips */}
          {order.validationFlips.length > 0 && (
            <div>
              <SectionLabel>Validation changes ({order.validationFlips.length})</SectionLabel>
              <ValidationFlipList flips={order.validationFlips} />
            </div>
          )}
        </div>
      )}

      <ReprocessAction
        connectionId={connectionId}
        revisionId={revisionId}
        versionNo={versionNo}
        orderId={order.orderId}
      />
    </li>
  );
}

// ── Re-process this one order under the replayed revision (WP-35) ────────────
//
// This is the only thing in the panel that WRITES. It produces an output file
// for inspection; delivery stays a separate, explicit action elsewhere, so no
// copy here may suggest the order went anywhere. `reused: true` means the exact
// output already existed and nothing new was written — reported as such rather
// than as a fresh success.

/** How a failed re-process should read to an operator. */
function reprocessFailure(error: unknown): { tone: "amber" | "danger"; text: string } | null {
  if (!error) return null;
  if (error instanceof ApiHttpError) {
    // The request was fine and the order real — this version simply cannot
    // render it. The backend's reason is the actionable part.
    if (error.status === 422) {
      return { tone: "amber", text: `This version could not produce output for this order: ${error.message}` };
    }
    // Storage down: distinct from a bad request, and nothing was written.
    if (error.status === 503) {
      return { tone: "amber", text: `Storage is unavailable, so nothing was saved. ${error.message}` };
    }
    if (error.status >= 400 && error.status < 500) return { tone: "danger", text: error.message };
  }
  return {
    tone: "amber",
    text: "Couldn't reach the server to re-process this order. Nothing was saved — check your connection and try again.",
  };
}

/**
 * Guids are unusable at a glance; the leading segment is enough to match a file.
 * The ellipsis matters — without it a cut id reads as a whole one, and the full
 * value is kept on `title` so it stays copyable.
 */
function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

function ReprocessAction({
  connectionId,
  revisionId,
  versionNo,
  orderId,
}: {
  connectionId: string;
  revisionId: string;
  versionNo: number;
  orderId: string;
}) {
  const run = useMutation<ReprocessResponse, unknown, void>({
    mutationFn: () => reprocessOrderUnderRevision(connectionId, revisionId, orderId),
  });

  const result = run.data ?? null;
  const failure = reprocessFailure(run.error);

  return (
    <div
      className="px-3.5 py-3 flex flex-col gap-2"
      style={{ borderTop: "1px solid var(--border)", background: "var(--bg)" }}
    >
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <Button variant="secondary" size="sm" onClick={() => run.mutate()} disabled={run.isPending} loading={run.isPending}>
          Re-process under this version
        </Button>
        <span className="text-[11.5px] leading-[1.5]" style={{ color: "var(--ink-muted)" }}>
          Creates an output file you can inspect. It is not sent to the supplier.
        </span>
      </div>

      {result && (
        <div
          className="rounded-[6px] px-3 py-2.5 flex flex-col gap-1"
          style={{
            border: `1px solid ${result.reused ? "var(--border-strong)" : "var(--brand-green)"}`,
            background: result.reused ? "var(--surface-2)" : "var(--brand-green-soft)",
          }}
        >
          <p className="text-[12px] leading-[1.5] m-0" style={{ color: "var(--ink)" }}>
            {result.reused ? (
              <>
                This exact output already existed for this order under v{versionNo} — no new file was created:{" "}
                <span className="font-mono" style={{ color: "var(--ink)" }} title={result.artifactId}>
                  {result.format} · {shortId(result.artifactId)}
                </span>
                .
              </>
            ) : (
              <>
                Output file created under v{versionNo}:{" "}
                <span className="font-mono" style={{ color: "var(--ink)" }} title={result.artifactId}>
                  {result.format} · {shortId(result.artifactId)}
                </span>
                . It was not sent to the supplier.
              </>
            )}
          </p>
          {/* The reassurance the whole design rests on: the order still delivers
              exactly what it delivered before. */}
          <p className="text-[11.5px] leading-[1.5] m-0" style={{ color: "var(--ink-muted)" }}>
            {result.deliverableArtifactId ? (
              <>
                This order&rsquo;s deliverable output is unchanged:{" "}
                <span className="font-mono" title={result.deliverableArtifactId}>
                  {shortId(result.deliverableArtifactId)}
                </span>
                .
              </>
            ) : (
              <>This order has no deliverable output, and re-processing did not give it one.</>
            )}
          </p>
          {result.artifactSha256 && (
            <p className="text-[11px] leading-[1.5] m-0" style={{ color: "var(--ink-faint)" }}>
              Checksum <span className="font-mono">{result.artifactSha256.slice(0, 12)}</span>
            </p>
          )}
        </div>
      )}

      {failure && (
        <div
          role="alert"
          className="rounded-[6px] px-3 py-2.5 text-[12px] leading-[1.5]"
          style={
            failure.tone === "danger"
              ? { border: "1px solid var(--danger)", background: "var(--danger-soft)", color: "var(--danger)" }
              : { border: "1px solid var(--amber)", background: "var(--amber-soft)", color: "var(--amber-text)" }
          }
        >
          {failure.text}
        </div>
      )}
    </div>
  );
}

// ── Side-by-side output diff (simple line-by-line, no diff lib) ──────────────

function OutputDiff({ current, draft }: { current: string | null; draft: string | null }) {
  const currentLines = (current ?? "").split("\n");
  const draftLines = (draft ?? "").split("\n");
  const max = Math.max(currentLines.length, draftLines.length);

  const rows = Array.from({ length: max }, (_, i) => {
    const c = currentLines[i] ?? null;
    const d = draftLines[i] ?? null;
    return { c, d, changed: c !== d };
  });

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <DiffColumn label="Current (live)" lines={rows.map((r) => ({ text: r.c, changed: r.changed }))} side="current" empty={current == null} />
      <DiffColumn label="This version" lines={rows.map((r) => ({ text: r.d, changed: r.changed }))} side="draft" empty={draft == null} />
    </div>
  );
}

function DiffColumn({
  label,
  lines,
  side,
  empty,
}: {
  label: string;
  lines: { text: string | null; changed: boolean }[];
  side: "current" | "draft";
  empty: boolean;
}) {
  return (
    <div className="rounded-[6px] overflow-hidden" style={{ border: "1px solid var(--border)" }}>
      <div
        className="px-2.5 py-1.5 text-[11px] font-semibold"
        style={{ background: "var(--surface-2)", color: "var(--ink-muted)", borderBottom: "1px solid var(--border)" }}
      >
        {label}
      </div>
      {empty ? (
        <div className="px-2.5 py-3 text-[11.5px] italic" style={{ color: "var(--ink-faint)" }}>
          No output could be produced.
        </div>
      ) : (
        <pre
          className="m-0 px-2.5 py-2 text-[11px] leading-[1.55] overflow-auto"
          style={{ fontFamily: "var(--font-mono, ui-monospace, monospace)", color: "var(--ink)", maxHeight: 260, whiteSpace: "pre" }}
        >
          {lines.map((l, i) =>
            l.text == null ? (
              <div key={i} style={{ background: changedBg(true, side), minHeight: "1.55em" }}>
                {" "}
              </div>
            ) : (
              <div key={i} style={{ background: l.changed ? changedBg(true, side) : "transparent" }}>
                {l.text === "" ? " " : l.text}
              </div>
            ),
          )}
        </pre>
      )}
    </div>
  );
}

function changedBg(changed: boolean, side: "current" | "draft"): string {
  if (!changed) return "transparent";
  return side === "current" ? "var(--danger-soft)" : "var(--brand-green-soft)";
}

// ── Field-level change table ─────────────────────────────────────────────────

function FieldChangeTable({ changes }: { changes: ReplayFieldChange[] }) {
  return (
    <div className="rounded-[6px] overflow-hidden" style={{ border: "1px solid var(--border)" }}>
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr style={{ background: "var(--surface-2)" }}>
            <Th>Field</Th>
            <Th>Current</Th>
            <Th>This version</Th>
          </tr>
        </thead>
        <tbody>
          {changes.map((c, i) => (
            <tr key={`${c.scope}-${c.lineNumber ?? "h"}-${c.field}-${i}`} style={{ borderTop: "1px solid var(--border)" }}>
              <Td>
                <span className="font-medium" style={{ color: "var(--ink)" }}>
                  {c.field}
                </span>
                <span className="ml-1.5 text-[10.5px]" style={{ color: "var(--ink-faint)" }}>
                  {c.scope === "line" ? `line ${c.lineNumber ?? "?"}` : "header"}
                </span>
              </Td>
              <Td>
                <span className="font-mono" style={{ color: "var(--ink-muted)" }}>
                  {c.currentValue ?? "—"}
                </span>
              </Td>
              <Td>
                <span className="font-mono font-semibold" style={{ color: "var(--brand-green-deep)" }}>
                  {c.draftValue ?? "—"}
                </span>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Validation flip list ──────────────────────────────────────────────────────

function ValidationFlipList({ flips }: { flips: ReplayValidationFlip[] }) {
  return (
    <ul className="flex flex-col gap-1.5 list-none p-0 m-0">
      {flips.map((f, i) => {
        const startsFailing = f.currentStatus === "pass" && f.draftStatus === "fail";
        return (
          <li
            key={`${f.code}-${f.lineNumber ?? "h"}-${i}`}
            className="rounded-[6px] px-3 py-2 text-[12px] leading-[1.5]"
            style={{
              border: `1px solid ${startsFailing ? "var(--danger)" : "var(--border)"}`,
              background: startsFailing ? "var(--danger-soft)" : "var(--surface)",
            }}
          >
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono font-semibold" style={{ color: "var(--ink)" }}>
                {f.code}
              </span>
              {f.lineNumber != null && (
                <span className="text-[10.5px]" style={{ color: "var(--ink-faint)" }}>
                  line {f.lineNumber}
                </span>
              )}
              <span className="inline-flex items-center gap-1.5">
                <StatusToken status={f.currentStatus} />
                <span aria-hidden style={{ color: "var(--ink-faint)" }}>→</span>
                <StatusToken status={f.draftStatus} />
              </span>
            </div>
            {f.message && (
              <p className="mt-1 m-0" style={{ color: startsFailing ? "var(--danger)" : "var(--ink-muted)" }}>
                {f.message}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function StatusToken({ status }: { status: string | null }) {
  const s = (status ?? "").toLowerCase();
  if (s === "pass") {
    return (
      <span className="text-[11px] font-semibold" style={{ color: "var(--brand-green-deep)" }}>
        pass
      </span>
    );
  }
  if (s === "fail") {
    return (
      <span className="text-[11px] font-semibold" style={{ color: "var(--danger)" }}>
        fail
      </span>
    );
  }
  return (
    <span className="text-[11px] font-semibold" style={{ color: "var(--ink-faint)" }}>
      —
    </span>
  );
}

// ── Small shared bits ─────────────────────────────────────────────────────────

type ChipTone = "danger" | "amber" | "info" | "neutral";

function Chip({ tone, children }: { tone: ChipTone; children: React.ReactNode }) {
  const style: Record<ChipTone, { bg: string; fg: string }> = {
    danger: { bg: "var(--danger-soft)", fg: "var(--danger)" },
    amber: { bg: "var(--amber-soft)", fg: "var(--amber-text)" },
    info: { bg: "var(--brand-blue-soft)", fg: "var(--brand-blue-deep)" },
    neutral: { bg: "var(--surface-2)", fg: "var(--ink-muted)" },
  };
  const s = style[tone];
  return (
    <span
      className="inline-flex items-center rounded-full text-[10.5px] font-semibold px-2 h-[18px] whitespace-nowrap"
      style={{ background: s.bg, color: s.fg }}
    >
      {children}
    </span>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--ink-muted)" }}>
      {children}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="text-left px-2.5 py-1.5 text-[10.5px] font-semibold uppercase tracking-wide" style={{ color: "var(--ink-muted)" }}>
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-2.5 py-1.5 align-top">{children}</td>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function clampLimit(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return RECENT_LIMIT_DEFAULT;
  return Math.max(RECENT_LIMIT_MIN, Math.min(RECENT_LIMIT_MAX, Math.trunc(n)));
}

function parseLimit(raw: string): number {
  const trimmed = raw.trim();
  // Empty/non-numeric input falls back to the default rather than NaN.
  if (trimmed === "") return RECENT_LIMIT_DEFAULT;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return RECENT_LIMIT_DEFAULT;
  // Clamp to the valid 1..50 range immediately on input (not just at run time),
  // so the field can never hold an out-of-range value the backend would reject.
  return clampLimit(n);
}

function revisionStatusText(status: string): string {
  const s = (status ?? "").toLowerCase();
  if (s === "draft") return "draft";
  if (s === "test") return "test";
  if (s === "published") return "published";
  if (s === "archived") return "archived";
  return status || "revision";
}

export default ReplayPanel;
