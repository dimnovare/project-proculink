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
import { useQuery } from "@tanstack/react-query";
import { PageShell } from "@/components/bridge/layout/PageShell";
import { PageHeader } from "@/components/bridge/layout/PageHeader";
import { Card } from "@/components/bridge/layout/Card";
import { Button } from "@/components/bridge/DSPrimitives";
import { RevisionStatusBadge } from "@/components/connections/RevisionStatusBadge";
import { HistoryDrawer } from "@/components/connections/HistoryDrawer";
import { useConnectionRevisions } from "@/components/connections/useConnectionRevisions";
import { ConnectionNotice, ConnectionConfirmDialog } from "@/components/connections/ConnectionLifecycleUI";
import { MapperWorkbench } from "@/components/bridge/mapper/MapperWorkbench";
import { apiClient } from "@/lib/api-client";
import { useQueriesEnabled } from "@/hooks/useQueriesEnabled";

export function ConnectionDetail({ connectionId }: { connectionId: string }) {
  const router = useRouter();
  const queriesEnabled = useQueriesEnabled();
  // WS-8: all secondary/power actions (version history, checks, restore, discard,
  // replay, config summary) live behind this single right-side drawer.
  const [historyOpen, setHistoryOpen] = useState(false);

  // The connection revision machinery (queries + lifecycle mutations + live
  // summary + notice/confirm state) is shared with SupplierHistoryTab via this
  // hook (STRUCT-1). Consumed here so this page renders identically to before.
  const {
    connection,
    isLoading,
    isError,
    refetch,
    activeRevision,
    activeRevisionId,
    revisions,
    liveSummary,
    liveVersionNo,
    testEvidence,
    busy,
    testingRevisionId,
    rollingBackRevisionId,
    discardingRevisionId,
    notice,
    setNotice,
    confirm,
    setConfirm,
    onTest,
    onRequestPublish,
    onRequestRollback,
    onRequestArchive,
    createDraftMutation,
    publishMutation,
    rollbackMutation,
    archiveMutation,
  } = useConnectionRevisions(connectionId);

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
            {/* Quiet secondary trigger — opens the History & advanced drawer (version
                history, checks, restore, discard, replay, config summary). Kept low-key
                next to the primary action so the everyday surface stays simple. */}
            {connection && (
              <button
                type="button"
                onClick={() => setHistoryOpen(true)}
                aria-haspopup="dialog"
                aria-expanded={historyOpen}
                className="inline-flex h-[44px] sm:h-[32px] items-center gap-1.5 rounded px-3 text-[12.5px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-blue)]"
                style={{
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  color: "var(--ink)",
                  cursor: "pointer",
                }}
              >
                <span aria-hidden>↺</span>
                History &amp; advanced
                <span aria-hidden style={{ color: "var(--ink-faint)" }}>⌄</span>
              </button>
            )}
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

      <ConnectionNotice notice={notice} />

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
        <div className="grid gap-4 lg:items-start">
          {/* ── The live (published) bundle summary ───────────────────── */}
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
                  supplierName={connection?.name ?? "supplier"}
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

          {/* ── Mapping — author once (Phase 3 three-pane mapper) ─────── */}
          <div>
            <Card
              title="Mapping"
              sub={
                mapperReadOnly
                  ? "How this supplier's orders are mapped to their output. Click to edit."
                  : "Map incoming fields → the supplier's output. Saved automatically; “Make live” to publish."
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
                          This is the live version, sending orders now. Editing makes a test copy — check it, then switch to it safely. Older versions are kept so you can go back anytime.
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
                    Start a mapping for this supplier — map their incoming fields to the output,
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
        </div>
      )}

      {confirm && (
        <ConnectionConfirmDialog
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

      {/* ── History & advanced drawer (WS-8) ──────────────────────────────
          All secondary/power actions live here. The triggers below call the
          SAME mutation handlers used by the (now relocated) version-history
          rows — nothing is reimplemented; the drawer only relocates them. */}
      <HistoryDrawer
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
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
    </PageShell>
  );
}

// ── Bundle summary rows ───────────────────────────────────────────────────────

function BundleSummary(props: {
  supplierName: string;
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
      <SummaryRow
        label="Input mapping"
        title="Whether the incoming order format is translated first (rare — usually not needed)."
        value={props.inputConfigured ? "Configured" : "Default / none"}
        unconfigured={!props.inputConfigured}
      />
      <SummaryRow
        label="Output template"
        value={props.outputTemplateConfigured ? "Custom template" : "Standard format"}
        valueTitle={
          props.outputTemplateConfigured
            ? undefined
            : `The standard way we format this ${props.supplierName}'s orders — you rarely change this.`
        }
      />
      <SummaryRow label="Output format" value={props.outputFormat ? props.outputFormat.toUpperCase() : "Default"} />
      <SummaryRow
        label="Delivery channel"
        title="Where and how the finished order is sent."
        value={
          props.deliveryProtocol
            ? `${deliveryLabel}${props.deliveryAutoDeliver ? " · auto-send" : ""}${props.hasCredentials ? " · credentials set" : ""}`
            : deliveryLabel
        }
        unconfigured={!props.deliveryProtocol}
      />
      <SummaryRow
        label="Item mappings"
        value={`${props.itemMappingCount} code${props.itemMappingCount === 1 ? "" : "s"}`}
        unconfigured={props.itemMappingCount === 0}
      />
      <SummaryRow
        label="Acceptance rules"
        title={'The checks run before sending. "Bound" means checks are active.'}
        value={
          props.acceptanceBound
            ? `Bound${props.acceptanceVersionNo != null ? ` · v${props.acceptanceVersionNo}` : ""}`
            : "Not bound"
        }
        unconfigured={!props.acceptanceBound}
      />
      <SummaryRow
        label="Catalog"
        value={props.catalogMode === "live" ? "Live (read at send time)" : props.catalogMode}
        valueTitle={
          props.catalogMode === "live"
            ? `The ${props.supplierName}'s current product list is used each time an order is sent.`
            : undefined
        }
      />
    </dl>
  );
}

/**
 * One label/value row in the bundle summary. When `unconfigured` is true the
 * value reads as a muted amber "not configured" chip so an unset part of the
 * bundle is visually distinct from a real, configured value (rather than both
 * rendering as the same bold ink text).
 */
function SummaryRow({
  label,
  value,
  unconfigured,
  title,
  valueTitle,
}: {
  label: string;
  value: string;
  unconfigured?: boolean;
  title?: string;
  valueTitle?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2" style={{ borderBottom: "1px solid var(--border)" }}>
      <dt
        className="text-[12px] font-medium"
        style={{ color: "var(--ink-muted)", cursor: title ? "help" : undefined }}
        title={title}
      >
        {label}
      </dt>
      {unconfigured ? (
        <dd className="text-right m-0" title={valueTitle}>
          <span
            className="inline-flex items-center rounded-full text-[11px] font-semibold px-2 h-[20px] whitespace-nowrap"
            style={{ background: "var(--amber-soft)", color: "var(--amber-text)" }}
          >
            {value}
          </span>
        </dd>
      ) : (
        <dd
          className="text-[12.5px] font-semibold text-right m-0"
          style={{ color: "var(--ink)", cursor: valueTitle ? "help" : undefined }}
          title={valueTitle}
        >
          {value}
        </dd>
      )}
    </div>
  );
}

export default ConnectionDetail;
