"use client";

// SupplierHistoryTab — STRUCT-1.
//
// The version-history view, relocated onto the supplier page as a tab (replacing
// the standalone /connections surface in the launch nav; that route still
// resolves). This is a THIN consumer: useConnectionRevisions() owns the data +
// every lifecycle mutation, and HistoryContent renders the IDENTICAL view that
// the History & advanced drawer shows. The only thing this component adds is the
// inline notice banner and the publish/rollback/discard confirm dialog (both
// shared with ConnectionDetail) — so nothing about the revision machinery is
// reimplemented; it is purely relocated.

import { Card } from "@/components/bridge/layout/Card";
import { HistoryContent } from "@/components/connections/HistoryDrawer";
import { useConnectionRevisions } from "@/components/connections/useConnectionRevisions";
import { ConnectionNotice, ConnectionConfirmDialog } from "@/components/connections/ConnectionLifecycleUI";

export function SupplierHistoryTab({ connectionId }: { connectionId: string }) {
  const {
    revisions,
    activeRevisionId,
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
    publishMutation,
    rollbackMutation,
    archiveMutation,
  } = useConnectionRevisions(connectionId);

  return (
    <div>
      <ConnectionNotice notice={notice} />

      <Card
        title="Version history"
        sub="Every saved version of this supplier's mapping, validation and delivery — test, make live, or roll back."
      >
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
      </Card>

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
    </div>
  );
}

export default SupplierHistoryTab;
