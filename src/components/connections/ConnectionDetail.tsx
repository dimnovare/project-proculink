"use client";

// Connection detail — Group V1. Shows the ACTIVE published revision's bundle
// (input mapping, output template/format, delivery channel, item-mapping count,
// acceptance binding, catalog mode) + the revision history with lifecycle
// controls: create draft (clones active), mark test, publish (with confirm),
// archive, and rollback (publish a prior revision again).
//
// Backend: ProcuLink.Api/Controllers/ConnectionsController.cs.
//   - published revisions are IMMUTABLE; edit = create a NEW draft (clone-from-active).
//   - publishing flips the connection's active pointer + archives the prior published rev.
//   - the backend's 409 (illegal transition / immutable) surfaces as an ApiHttpError.
//
// The component-level draft editors (mapping / output template / delivery /
// item codes) are NOT rebuilt here — V1 links to the existing per-supplier
// editors. The replay / impact view is a SEPARATE V2 follow-up: a labelled
// placeholder marks where it will land.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/bridge/layout/PageShell";
import { PageHeader } from "@/components/bridge/layout/PageHeader";
import { Card } from "@/components/bridge/layout/Card";
import { Button } from "@/components/bridge/DSPrimitives";
import { RevisionStatusBadge } from "@/components/connections/RevisionStatusBadge";
import {
  getConnection,
  getConnectionRevision,
  createConnectionDraft,
  publishConnectionRevision,
  markConnectionRevisionTest,
  archiveConnectionRevision,
  ApiHttpError,
} from "@/lib/api-client";
import type { ConnectionRevisionSummary } from "@/lib/api/types";
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
  | { kind: "publish"; revisionId: string; versionNo: number; isRollback: boolean }
  | { kind: "archive"; revisionId: string; versionNo: number }
  | null;

export function ConnectionDetail({ connectionId }: { connectionId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const queriesEnabled = useQueriesEnabled();
  const [notice, setNotice] = useState<Notice>(null);
  const [confirm, setConfirm] = useState<ConfirmState>(null);

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
          ? `Draft v${rev.versionNo} created${activeRevisionId ? " (cloned from the live version)" : ""}.`
          : "Draft created.",
        kind: "ok",
      });
    },
    onError: onMutationError,
  });

  const testMutation = useMutation({
    mutationFn: (revisionId: string) => markConnectionRevisionTest(connectionId, revisionId),
    onSuccess: () => {
      invalidate();
      setNotice({ text: "Revision marked as test.", kind: "ok" });
    },
    onError: onMutationError,
  });

  const publishMutation = useMutation({
    mutationFn: (revisionId: string) => publishConnectionRevision(connectionId, revisionId),
    onSuccess: () => {
      invalidate();
      setConfirm(null);
      setNotice({ text: "Published — this is now the live revision for new orders.", kind: "ok" });
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
      setNotice({ text: "Revision archived.", kind: "ok" });
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
    archiveMutation.isPending;

  const revisions: ConnectionRevisionSummary[] = useMemo(
    () => connection?.revisions ?? [],
    [connection],
  );

  return (
    <PageShell variant="wide">
      <PageHeader
        title={connection?.name ?? "Connection"}
        sub="The versioned bundle this supplier receives — input mapping, output template, delivery and item codes"
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
              {activeRevisionId ? "Create draft from live" : "Create draft"}
            </Button>
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
          <Card edge="green" title="Live revision" sub="What this supplier receives for new orders today">
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
                <div
                  className="mt-4 pt-3 text-[12px] leading-[1.5]"
                  style={{ borderTop: "1px solid var(--border)", color: "var(--ink-faint)" }}
                >
                  Published revisions are immutable — to change the live bundle, create a draft
                  (it clones the live version), edit it, then publish.
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
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
                  No published revision yet
                </p>
                <p className="text-[12.5px] mt-1.5 leading-[1.55]" style={{ color: "var(--ink-muted)" }}>
                  This connection only has drafts. Configure a draft using the supplier editors,
                  mark it as test, then publish it to make it live for new orders.
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

          {/* ── Right: revision history + lifecycle controls ──────────── */}
          <Card title="Revision history" sub="Every version of this connection and its lifecycle">
            {revisions.length === 0 ? (
              <p className="text-[12.5px] py-4" style={{ color: "var(--ink-muted)" }}>
                No revisions yet. Create a draft to begin.
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
                          <RevisionStatusBadge status={r.status} size="sm" />
                          {isActive && (
                            <span
                              className="inline-flex items-center rounded-[4px] text-[10.5px] font-semibold px-1.5 h-[18px]"
                              style={{ background: "var(--brand-green-soft)", color: "var(--brand-green-deep)" }}
                            >
                              Live
                            </span>
                          )}
                        </div>
                        <span className="text-[11px]" style={{ color: "var(--ink-faint)" }}>
                          {status === "published" || status === "archived"
                            ? `Published ${formatDateTime(r.publishedAt)}`
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
                            Mark test
                          </Button>
                        )}
                        {canPublish && (
                          <Button
                            variant="primary"
                            size="sm"
                            disabled={busy}
                            onClick={() =>
                              setConfirm({ kind: "publish", revisionId: r.id, versionNo: r.versionNo, isRollback: false })
                            }
                          >
                            Publish
                          </Button>
                        )}
                        {canRollback && (
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={busy}
                            onClick={() =>
                              setConfirm({ kind: "publish", revisionId: r.id, versionNo: r.versionNo, isRollback: true })
                            }
                          >
                            Roll back to this
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
                            Archive
                          </Button>
                        )}
                        {status === "published" && (
                          <span className="text-[11.5px] self-center" style={{ color: "var(--ink-faint)" }}>
                            Immutable — create a draft to change it
                          </span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          {/* ── Replay / impact — V2 placeholder (NOT built in V1) ────── */}
          <Card
            edge="blue"
            title="Replay & impact preview"
            sub="Coming soon"
            className="lg:col-span-2"
          >
            <p className="text-[12.5px] leading-[1.55]" style={{ color: "var(--ink-muted)" }}>
              A future release will let you replay past orders against a draft revision and preview
              the diff before publishing — so you can see exactly which orders a change would affect.
              The replay endpoint is being built in parallel; this section is a placeholder until it ships.
            </p>
          </Card>
        </div>
      )}

      {confirm && (
        <ConfirmDialog
          state={confirm}
          busy={publishMutation.isPending || archiveMutation.isPending}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            setNotice(null);
            if (confirm.kind === "publish") publishMutation.mutate(confirm.revisionId);
            else archiveMutation.mutate(confirm.revisionId);
          }}
        />
      )}
    </PageShell>
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
  const title = isPublish
    ? state.isRollback
      ? `Roll back to v${state.versionNo}?`
      : `Publish v${state.versionNo}?`
    : `Archive v${state.versionNo}?`;
  const body = isPublish
    ? "This becomes the live revision for new orders. The currently-published revision is archived. Orders already in flight keep the revision they were created with."
    : "Archiving removes this revision from the working set. Published revisions stay retained for orders that pinned them.";
  const confirmLabel = isPublish ? (state.isRollback ? "Roll back & publish" : "Publish") : "Archive";

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
            variant={isPublish ? "primary" : "danger"}
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
