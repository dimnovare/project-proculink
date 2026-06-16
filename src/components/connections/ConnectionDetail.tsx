"use client";

// Connection detail — Group V1. Shows the ACTIVE published revision's bundle
// (input mapping, output template/format, delivery channel, item-mapping count,
// acceptance binding, catalog mode) + the revision history with lifecycle
// controls: create draft (clones active), run tests, publish (with confirm),
// archive, and rollback (clone a prior published revision into a new live one).
//
// Backend: ProcuLink.Api/Controllers/ConnectionsController.cs.
//   - published revisions are IMMUTABLE; edit = create a NEW draft (clone-from-active).
//   - publishing flips the connection's active pointer + archives the prior published rev.
//   - publish is EVIDENCE-GATED (launch batch 3): the backend 409s with
//     "Run tests on this revision before publishing." until the test pack has
//     passed since the last edit — that server message renders inline here.
//   - POST .../test RUNS the test pack (replay + conformance; never delivers) and
//     returns the evidence body; a FAILED pack is still a 200 with passed=false.
//   - POST .../rollback clones an archived previously-published revision into a
//     NEW published revision; the target stays archived and pinned orders are
//     unaffected.
//   - the backend's 409 (illegal transition / immutable) surfaces as an ApiHttpError.
//
// The component-level draft editors (mapping / output template / delivery /
// item codes) are NOT rebuilt here — V1 links to the existing per-supplier
// editors. The replay / impact view (V2) is now LIVE: ReplayPanel below replays
// historical orders against a revision and shows the per-order diff before publish.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/bridge/layout/PageShell";
import { PageHeader } from "@/components/bridge/layout/PageHeader";
import { Card } from "@/components/bridge/layout/Card";
import { Button } from "@/components/bridge/DSPrimitives";
import { RevisionStatusBadge } from "@/components/connections/RevisionStatusBadge";
import { ReplayPanel } from "@/components/connections/ReplayPanel";
import { MapperWorkbench } from "@/components/bridge/mapper/MapperWorkbench";
import {
  apiClient,
  getConnection,
  getConnectionRevision,
  createConnectionDraft,
  publishConnectionRevision,
  markConnectionRevisionTest,
  archiveConnectionRevision,
  rollbackConnectionRevision,
  ApiHttpError,
} from "@/lib/api-client";
import type { ConnectionRevisionSummary, ConnectionTestEvidence } from "@/lib/api/types";
import { useQueriesEnabled } from "@/hooks/useQueriesEnabled";

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type Notice = { text: string; kind: "ok" | "err" } | null;

type ConfirmState =
  | { kind: "publish"; revisionId: string; versionNo: number }
  | { kind: "rollback"; revisionId: string; versionNo: number }
  | { kind: "archive"; revisionId: string; versionNo: number }
  | null;

// ── Test-pack evidence (returned by POST .../test) ───────────────────────────
// Mirrors the backend's stored TestPackSummary JSON (camelCase):
//   { replay: {...} | null, conformance: {...} | null, error: string | null }

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

interface RevisionTestEvidence {
  revisionId: string;
  passed: boolean;
  testedAt: string;
  summary: TestPackSummary | null;
}

function parseTestSummary(summaryJson: string): TestPackSummary | null {
  try {
    const parsed = JSON.parse(summaryJson) as TestPackSummary;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/** Non-null notes carried by the evidence (replay note, conformance note, pack error). */
function evidenceNotes(summary: TestPackSummary | null): string[] {
  if (!summary) return [];
  return [summary.replay?.note, summary.conformance?.note, summary.error].filter(
    (n): n is string => typeof n === "string" && n.length > 0,
  );
}

export function ConnectionDetail({ connectionId }: { connectionId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const queriesEnabled = useQueriesEnabled();
  const [notice, setNotice] = useState<Notice>(null);
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  // Evidence from the most recent "Run tests" call, rendered inline under its revision row.
  const [testEvidence, setTestEvidence] = useState<RevisionTestEvidence | null>(null);

  const {
    data: connection,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["connection", connectionId],
    queryFn: () => getConnection(connectionId),
    enabled: queriesEnabled,
  });

  const activeRevisionId = connection?.activeRevisionId ?? null;

  // Bundle of the live (published) revision — drives the "what's live now" summary.
  const { data: activeRevision } = useQuery({
    queryKey: ["connection-revision", connectionId, activeRevisionId],
    queryFn: () => getConnectionRevision(connectionId, activeRevisionId as string),
    enabled: queriesEnabled && !!activeRevisionId,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["connection", connectionId] });
    queryClient.invalidateQueries({ queryKey: ["connections"] });
  };

  const onMutationError = (e: unknown) => {
    const msg = e instanceof ApiHttpError ? e.message : "Action failed — please retry.";
    setNotice({ text: msg, kind: "err" });
  };

  const createDraftMutation = useMutation({
    mutationFn: () => createConnectionDraft(connectionId, { cloneFromActive: true }),
    onSuccess: (rev) => {
      invalidate();
      setNotice({
        text: rev
          ? `Editing v${rev.versionNo}${activeRevisionId ? " (a copy of the live version)" : ""} — make your changes below, then make it live.`
          : "Editable copy ready — make your changes below.",
        kind: "ok",
      });
    },
    onError: onMutationError,
  });

  const testMutation = useMutation({
    mutationFn: (revisionId: string) => markConnectionRevisionTest(connectionId, revisionId),
    onSuccess: (evidence: ConnectionTestEvidence, revisionId: string) => {
      invalidate();
      setTestEvidence({
        revisionId,
        passed: evidence.passed,
        testedAt: evidence.testedAt,
        summary: parseTestSummary(evidence.summaryJson),
      });
      setNotice(
        evidence.passed
          ? { text: "Checks passed — this version is ready to make live.", kind: "ok" }
          : { text: "Checks ran but FAILED — see the details below. Fix these before making it live.", kind: "err" },
      );
    },
    onError: onMutationError,
  });

  const publishMutation = useMutation({
    mutationFn: (revisionId: string) => publishConnectionRevision(connectionId, revisionId),
    onSuccess: () => {
      invalidate();
      setConfirm(null);
      setNotice({ text: "Live — new orders for this supplier use this version now.", kind: "ok" });
    },
    onError: (e) => {
      setConfirm(null);
      onMutationError(e);
    },
  });

  // Rollback = clone a previously-published (archived) revision into a NEW
  // published revision via POST .../rollback. The target stays archived;
  // orders pinned to it are unaffected.
  const rollbackMutation = useMutation({
    mutationFn: (revisionId: string) => rollbackConnectionRevision(connectionId, revisionId),
    onSuccess: (rev) => {
      invalidate();
      setConfirm(null);
      setNotice({
        text: rev
          ? `Restored — v${rev.versionNo} is live for new orders now.`
          : "Restored.",
        kind: "ok",
      });
    },
    onError: (e) => {
      setConfirm(null);
      onMutationError(e);
    },
  });

  const archiveMutation = useMutation({
    mutationFn: (revisionId: string) => archiveConnectionRevision(connectionId, revisionId),
    onSuccess: () => {
      invalidate();
      setConfirm(null);
      setNotice({ text: "Draft discarded.", kind: "ok" });
    },
    onError: (e) => {
      setConfirm(null);
      onMutationError(e);
    },
  });

  const busy =
    createDraftMutation.isPending ||
    testMutation.isPending ||
    publishMutation.isPending ||
    rollbackMutation.isPending ||
    archiveMutation.isPending;

  const revisions: ConnectionRevisionSummary[] = useMemo(
    () => connection?.revisions ?? [],
    [connection],
  );

  // ── Phase 3 mapper mount ────────────────────────────────────────────────────
  // Author the mapping ONCE here, on the draft revision. Published revisions are
  // immutable → the mapper renders read-only against the live revision and points the
  // user at "Create draft from live" to edit. The newest draft (status === "draft") is the
  // editable target; fall back to the active published revision for a read-only view.
  const draftRevision = useMemo(
    () => revisions.find((r) => (r.status ?? "").toLowerCase() === "draft") ?? null,
    [revisions],
  );
  const mapperRevisionId = draftRevision?.id ?? activeRevisionId ?? null;
  const mapperReadOnly = !draftRevision; // only the draft is editable

  // A sample/recent order for THIS supplier — the connection (author-once) path has no
  // single order, so the mapper wires + previews against the most recent real order for the
  // supplier. None yet → the mapper's source lane + preview show their honest empty states.
  const supplierId = connection?.supplierId ?? null;
  const { data: sampleOrderPage } = useQuery({
    queryKey: ["connection-sample-order", supplierId],
    queryFn: () => apiClient.getOrders({ supplierId: supplierId as string, pageSize: 1 }),
    enabled: queriesEnabled && !!supplierId,
    staleTime: 60_000,
    retry: 1,
  });
  const sampleOrderId = sampleOrderPage?.items[0]?.id ?? null;

  return (
    <PageShell variant="wide">
      <PageHeader
        title={connection?.name ?? "Connection"}
        sub="How this supplier's orders are mapped, validated and delivered"
        actions={
          <>
            <Link
              href="/connections"
              className="inline-flex h-[44px] sm:h-[32px] items-center rounded px-3 text-[12.5px] font-medium no-underline"
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                color: "var(--ink)",
              }}
            >
              ← All connections
            </Link>
            {/* Single context-aware action. While a draft is open the user is already
                editing inline (no overlay) and "Make live" lives on the draft row, so the
                header button steps aside to avoid a second-draft footgun + duplicate actions. */}
            {!draftRevision && (
              <Button
                variant="primary"
                size="md"
                onClick={() => {
                  setNotice(null);
                  createDraftMutation.mutate();
                }}
                disabled={busy || isLoading || isError || !connection}
                loading={createDraftMutation.isPending}
              >
                {activeRevisionId ? "Edit mapping" : "Create mapping"}
              </Button>
            )}
          </>
        }
      />

      {notice && (
        <div
          role="status"
          className="mb-4 rounded-[8px] px-4 py-3 text-[12.5px]"
          style={
            notice.kind === "ok"
              ? { border: "1px solid var(--brand-green-soft)", borderLeft: "3px solid var(--brand-green)", background: "var(--brand-green-soft)", color: "var(--brand-green-deep)" }
              : { border: "1px solid #F5C6CB", borderLeft: "3px solid var(--danger)", background: "var(--danger-soft)", color: "var(--danger)" }
          }
        >
          {notice.text}
        </div>
      )}

      {isLoading && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" aria-busy="true" aria-label="Loading connection">
          {[1, 2].map((i) => (
            <div key={i} className="rounded-[8px] animate-pulse" style={{ height: 280, background: "var(--border)", border: "1px solid var(--border)" }} />
          ))}
        </div>
      )}

      {!isLoading && isError && (
        <Card className="flex flex-col items-center justify-center gap-3 text-center">
          <p className="text-[13px] font-semibold" style={{ color: "var(--danger)" }}>
            Could not load this connection
          </p>
          <Button variant="secondary" size="sm" onClick={() => refetch()}>Retry</Button>
        </Card>
      )}

      {!isLoading && !isError && !connection && (
        <Card className="flex flex-col items-center justify-center gap-3 text-center min-h-[240px]">
          <p className="text-[14px] font-semibold" style={{ color: "var(--ink)" }}>Connection not found</p>
          <p className="text-[12.5px]" style={{ color: "var(--ink-muted)" }}>
            It may have been removed, or you don&rsquo;t have access to it.
          </p>
          <Button variant="secondary" size="sm" onClick={() => router.push("/connections")}>
            Back to connections
          </Button>
        </Card>
      )}

      {!isLoading && !isError && connection && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:items-start">
          {/* ── Left: the live (published) bundle summary ─────────────── */}
          <Card edge="green" title="Live version" sub="What this supplier receives for new orders today">
            {activeRevisionId ? (
              <>
                <div className="flex items-center gap-2 mb-3">
                  <RevisionStatusBadge status="published" size="md" />
                  {activeRevision && (
                    <span className="text-[12px] font-mono" style={{ color: "var(--ink-muted)" }}>
                      v{activeRevision.versionNo}
                    </span>
                  )}
                </div>
                <BundleSummary
                  inputConfigured={!!activeRevision?.inputMappingJson}
                  outputTemplateConfigured={!!activeRevision?.outputMappingJson}
                  outputFormat={activeRevision?.outputFormat ?? null}
                  deliveryProtocol={activeRevision?.deliveryProtocol ?? null}
                  deliveryAutoDeliver={activeRevision?.deliveryAutoDeliver ?? false}
                  hasCredentials={activeRevision?.hasCredentials ?? false}
                  itemMappingCount={activeRevision?.itemMappings.length ?? 0}
                  acceptanceBound={activeRevision?.acceptanceProfileId != null}
                  acceptanceVersionNo={activeRevision?.acceptanceVersionNo ?? null}
                  catalogMode={activeRevision?.catalogMode ?? "live"}
                  loading={!activeRevision}
                />
                <div className="mt-4 pt-3 flex flex-wrap gap-2" style={{ borderTop: "1px solid var(--border)" }}>
                  <Link
                    href={`/library/suppliers/${connection.supplierId}`}
                    className="inline-flex h-[44px] sm:h-[32px] items-center rounded px-3 text-[12.5px] font-medium no-underline"
                    style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--ink)" }}
                  >
                    Open supplier editors
                  </Link>
                </div>
              </>
            ) : (
              <div className="py-4">
                <p className="text-[13px] font-semibold" style={{ color: "var(--ink)" }}>
                  Nothing live yet
                </p>
                <p className="text-[12.5px] mt-1.5 leading-[1.55]" style={{ color: "var(--ink-muted)" }}>
                  Set up the mapping below, then make it live so new orders for this supplier
                  start using it.
                </p>
                <Link
                  href={`/library/suppliers/${connection.supplierId}`}
                  className="mt-3 inline-flex h-[44px] sm:h-[32px] items-center rounded px-3 text-[12.5px] font-medium no-underline"
                  style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--ink)" }}
                >
                  Open supplier editors
                </Link>
              </div>
            )}
          </Card>

          {/* ── Right: version history + lifecycle controls ──────────── */}
          <Card title="Version history" sub="Each version, newest first">
            {revisions.length === 0 ? (
              <p className="text-[12.5px] py-4" style={{ color: "var(--ink-muted)" }}>
                No versions yet. Edit the mapping below to begin.
              </p>
            ) : (
              <ul className="flex flex-col gap-2 list-none p-0 m-0">
                {revisions.map((r) => {
                  const isActive = r.id === activeRevisionId;
                  const status = (r.status ?? "").toLowerCase();
                  const canTest = status === "draft" || status === "test";
                  const canPublish = status === "draft" || status === "test";
                  // Rollback = re-publish a previously published (now archived) revision.
                  const canRollback = status === "archived";
                  const canArchive = status === "draft" || status === "test";

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
                          {/* The "Live" badge already marks the active version (published === active),
                              so no separate "Live" pill — it read as a duplicate "Live Live". */}
                          <RevisionStatusBadge status={r.status} size="sm" />
                        </div>
                        <span className="text-[11px]" style={{ color: "var(--ink-faint)" }}>
                          {status === "published"
                            ? `Live since ${formatDateTime(r.publishedAt)}`
                            : status === "archived"
                              // Archived = either a superseded once-live version, or a discarded
                              // draft that was never live (no publishedAt → don't claim "was live").
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
                            loading={testMutation.isPending && testMutation.variables === r.id}
                            onClick={() => { setNotice(null); testMutation.mutate(r.id); }}
                          >
                            Test
                          </Button>
                        )}
                        {canPublish && (
                          <Button
                            variant="primary"
                            size="sm"
                            disabled={busy}
                            onClick={() =>
                              setConfirm({ kind: "publish", revisionId: r.id, versionNo: r.versionNo })
                            }
                          >
                            Make live
                          </Button>
                        )}
                        {canRollback && (
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={busy}
                            loading={rollbackMutation.isPending && rollbackMutation.variables === r.id}
                            onClick={() =>
                              setConfirm({ kind: "rollback", revisionId: r.id, versionNo: r.versionNo })
                            }
                          >
                            Restore this version
                          </Button>
                        )}
                        {canArchive && (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            loading={archiveMutation.isPending && archiveMutation.variables === r.id}
                            onClick={() =>
                              setConfirm({ kind: "archive", revisionId: r.id, versionNo: r.versionNo })
                            }
                          >
                            Discard
                          </Button>
                        )}
                      </div>

                      {testEvidence && testEvidence.revisionId === r.id && (
                        <TestEvidenceSummary evidence={testEvidence} />
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          {/* ── Mapping — author once (Phase 3 three-pane mapper) ─────── */}
          <div className="lg:col-span-2">
            <Card
              title="Mapping"
              sub={
                mapperReadOnly
                  ? "How this supplier's orders are mapped to their output. Click to edit."
                  : "Wire incoming fields → the supplier's output. Saved automatically; “Make live” to publish."
              }
            >
              {mapperRevisionId ? (
                // The mapper renders the LIVE mapping. When it's the published (read-only) version we
                // overlay an unmistakable one-click "Edit" — clicking transparently opens an editable
                // draft (the revision lifecycle stays hidden; the user just edits, then "Make live").
                <div className="relative">
                  <MapperWorkbench
                    variant="connection"
                    connectionId={connectionId}
                    revisionId={mapperRevisionId}
                    supplierId={supplierId ?? undefined}
                    supplierName={connection?.name ?? undefined}
                    previewOrderId={sampleOrderId}
                    readOnly={mapperReadOnly}
                  />
                  {mapperReadOnly && (
                    <button
                      type="button"
                      onClick={() => { setNotice(null); createDraftMutation.mutate(); }}
                      disabled={busy}
                      aria-label="Edit this mapping — opens an editable draft you can publish"
                      className="absolute inset-0 z-10 flex items-center justify-center transition-colors"
                      style={{ background: "rgba(247,248,250,0.5)", cursor: busy ? "wait" : "pointer", border: "none" }}
                    >
                      <span
                        className="rounded-[10px] px-4 py-3 text-center"
                        style={{ background: "#fff", border: "1px solid var(--border)", boxShadow: "0 4px 16px rgba(11,26,47,0.12)" }}
                      >
                        <span className="block text-[13px] font-semibold" style={{ color: "var(--ink)" }}>
                          {createDraftMutation.isPending ? "Opening an editable copy…" : "✎ Edit this mapping"}
                        </span>
                        <span className="block text-[11.5px] font-normal mt-1" style={{ color: "var(--ink-muted)" }}>
                          You're viewing the live version. Editing opens a draft you can publish.
                        </span>
                      </span>
                    </button>
                  )}
                </div>
              ) : (
                <div className="py-4">
                  <p className="text-[13px] font-semibold" style={{ color: "var(--ink)" }}>
                    No mapping yet
                  </p>
                  <p className="text-[12.5px] mt-1.5 leading-[1.55]" style={{ color: "var(--ink-muted)" }}>
                    Start a mapping for this supplier — wire their incoming fields to the output,
                    then make it live.
                  </p>
                  <Button
                    variant="primary"
                    size="sm"
                    className="mt-3"
                    onClick={() => { setNotice(null); createDraftMutation.mutate(); }}
                    disabled={busy}
                    loading={createDraftMutation.isPending}
                  >
                    Start mapping
                  </Button>
                </div>
              )}
            </Card>
          </div>

          {/* ── Replay / impact preview — V2 (live) ───────────────────── */}
          <div className="lg:col-span-2">
            <ReplayPanel
              connectionId={connectionId}
              revisions={revisions}
              activeRevisionId={activeRevisionId}
            />
          </div>
        </div>
      )}

      {confirm && (
        <ConfirmDialog
          state={confirm}
          busy={publishMutation.isPending || rollbackMutation.isPending || archiveMutation.isPending}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            setNotice(null);
            if (confirm.kind === "publish") publishMutation.mutate(confirm.revisionId);
            else if (confirm.kind === "rollback") rollbackMutation.mutate(confirm.revisionId);
            else archiveMutation.mutate(confirm.revisionId);
          }}
        />
      )}
    </PageShell>
  );
}

// ── Test-pack evidence summary (inline under the tested revision row) ─────────

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
          : { background: "var(--danger-soft)", border: "1px solid #F5C6CB", color: "var(--danger)" }
      }
      role="status"
    >
      <span className="font-semibold">
        Checks {passed ? "passed" : "failed"}
      </span>
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

// ── Bundle summary rows ───────────────────────────────────────────────────────

function BundleSummary(props: {
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
  loading: boolean;
}) {
  if (props.loading) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="rounded-[6px] animate-pulse" style={{ height: 34, background: "var(--border)" }} />
        ))}
      </div>
    );
  }

  const deliveryLabel = (() => {
    const p = props.deliveryProtocol;
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
      <SummaryRow label="Input mapping" value={props.inputConfigured ? "Configured" : "Default / none"} ok={props.inputConfigured} />
      <SummaryRow
        label="Output template"
        value={props.outputTemplateConfigured ? "Custom template" : "Fixed transformer"}
      />
      <SummaryRow label="Output format" value={props.outputFormat ? props.outputFormat.toUpperCase() : "Default"} />
      <SummaryRow
        label="Delivery channel"
        value={
          props.deliveryProtocol
            ? `${deliveryLabel}${props.deliveryAutoDeliver ? " · auto-send" : ""}${props.hasCredentials ? " · credentials set" : ""}`
            : deliveryLabel
        }
        ok={!!props.deliveryProtocol}
      />
      <SummaryRow
        label="Item mappings"
        value={`${props.itemMappingCount} code${props.itemMappingCount === 1 ? "" : "s"}`}
      />
      <SummaryRow
        label="Acceptance rules"
        value={
          props.acceptanceBound
            ? `Bound${props.acceptanceVersionNo != null ? ` · v${props.acceptanceVersionNo}` : ""}`
            : "Not bound"
        }
      />
      <SummaryRow label="Catalog" value={props.catalogMode === "live" ? "Live (read at send time)" : props.catalogMode} />
    </dl>
  );
}

function SummaryRow({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2" style={{ borderBottom: "1px solid var(--border)" }}>
      <dt className="text-[12px] font-medium" style={{ color: "var(--ink-muted)" }}>
        {label}
      </dt>
      <dd
        className="text-[12.5px] font-semibold text-right m-0"
        style={{ color: ok === false ? "var(--ink-faint)" : "var(--ink)" }}
      >
        {value}
      </dd>
    </div>
  );
}

// ── Confirm dialog (publish / archive) ────────────────────────────────────────

function ConfirmDialog({
  state,
  busy,
  onCancel,
  onConfirm,
}: {
  state: NonNullable<ConfirmState>;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const isPublish = state.kind === "publish";
  const isRollback = state.kind === "rollback";
  const title = isPublish
    ? `Make v${state.versionNo} live?`
    : isRollback
      ? `Restore v${state.versionNo}?`
      : `Discard v${state.versionNo}?`;
  const body = isPublish
    ? "New orders for this supplier will use this version from now on. Orders already in progress keep the version they started with."
    : isRollback
      ? "Brings this older version back as the live one for new orders. Orders already in progress are unaffected."
      : "Throws away this draft. Versions that are live (or were used by past orders) are kept.";
  const confirmLabel = isPublish ? "Make live" : isRollback ? "Restore" : "Discard";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end bg-[#0B1A2F66] p-0 sm:items-center sm:justify-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="connection-confirm-title"
    >
      <div
        className="w-full overflow-auto rounded-t-[10px] bg-white shadow-2xl sm:max-w-[440px] sm:rounded-[10px]"
        style={{ border: "1px solid var(--border)" }}
      >
        <div className="px-5 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
          <h2 id="connection-confirm-title" className="text-[17px] font-semibold leading-tight" style={{ color: "var(--ink)" }}>
            {title}
          </h2>
        </div>
        <div className="px-5 py-4">
          <p className="text-[13px] leading-[1.55] m-0" style={{ color: "var(--ink-muted)" }}>
            {body}
          </p>
        </div>
        <div
          className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:justify-end"
          style={{ borderTop: "1px solid var(--border)", background: "var(--bg)" }}
        >
          <Button variant="secondary" size="md" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={isPublish || isRollback ? "primary" : "danger"}
            size="md"
            onClick={onConfirm}
            disabled={busy}
            loading={busy}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default ConnectionDetail;
