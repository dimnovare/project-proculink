"use client";

// useConnectionRevisions — STRUCT-1.
//
// The connection revision/version-history machinery (the queries + every
// lifecycle mutation: create-draft / test / publish / rollback / archive, plus
// the live-version BundleSummary memo and the confirm/notice UI state) was
// previously inlined in ConnectionDetail. STRUCT-1 relocates the version-history
// VIEW onto the Supplier page, so this hook lifts that data + mutation layer out
// VERBATIM (no behavior change) so BOTH surfaces — ConnectionDetail (the
// standalone /connections route, still resolvable) and the new
// SupplierHistoryTab — consume the SAME machinery.
//
// It returns exactly what HistoryDrawer / HistoryContent need as props today:
// revisions, activeRevisionId, liveSummary, liveVersionNo, testEvidence, busy,
// the per-action pending ids, confirm/setConfirm, notice/setNotice, the relocated
// handlers (onTest / onRequestPublish / onRequestRollback / onRequestArchive),
// and the underlying mutations (createDraft / publish / rollback / archive) for
// the confirm-dialog wiring.
//
// Backend lifecycle semantics are unchanged — see ConnectionsController.cs:
//   - published revisions are IMMUTABLE; edit = create a NEW draft (clone-from-active).
//   - publishing flips the active pointer + archives the prior published rev.
//   - publish is EVIDENCE-GATED: the backend 409s until the test pack has passed
//     since the last edit (that server message renders inline via `notice`).
//   - POST .../test RUNS the test pack (replay + conformance; never delivers).
//   - POST .../rollback clones an archived previously-published revision into a
//     NEW published revision; the target stays archived and pinned orders are
//     unaffected.

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { BundleSummaryData } from "@/components/connections/HistoryDrawer";
import {
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

export type Notice = { text: string; kind: "ok" | "err" } | null;

export type ConfirmState =
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

export interface RevisionTestEvidence {
  revisionId: string;
  passed: boolean;
  testedAt: string;
  summary: TestPackSummary | null;
}

export function parseTestSummary(summaryJson: string): TestPackSummary | null {
  try {
    const parsed = JSON.parse(summaryJson) as TestPackSummary;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function useConnectionRevisions(connectionId: string) {
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

  // Read-only live-version config summary. Null until the active revision's
  // bundle has loaded; null when nothing is live.
  const liveSummary: BundleSummaryData | null = useMemo(() => {
    if (!activeRevisionId || !activeRevision) return null;
    return {
      inputConfigured: !!activeRevision.inputMappingJson,
      outputTemplateConfigured: !!activeRevision.outputMappingJson,
      outputFormat: activeRevision.outputFormat ?? null,
      deliveryProtocol: activeRevision.deliveryProtocol ?? null,
      deliveryAutoDeliver: activeRevision.deliveryAutoDeliver ?? false,
      hasCredentials: activeRevision.hasCredentials ?? false,
      itemMappingCount: activeRevision.itemMappings.length,
      acceptanceBound: activeRevision.acceptanceProfileId != null,
      acceptanceVersionNo: activeRevision.acceptanceVersionNo ?? null,
      catalogMode: activeRevision.catalogMode ?? "live",
    };
  }, [activeRevisionId, activeRevision]);

  // Relocated triggers — these are the exact handlers ConnectionDetail wired into
  // HistoryDrawer. They set the notice / open the confirm dialog; the confirm
  // dialog calls the mutations directly.
  const onTest = (revisionId: string) => {
    setNotice(null);
    testMutation.mutate(revisionId);
  };
  const onRequestPublish = (revisionId: string, versionNo: number) =>
    setConfirm({ kind: "publish", revisionId, versionNo });
  const onRequestRollback = (revisionId: string, versionNo: number) =>
    setConfirm({ kind: "rollback", revisionId, versionNo });
  const onRequestArchive = (revisionId: string, versionNo: number) =>
    setConfirm({ kind: "archive", revisionId, versionNo });

  return {
    // Connection-level data.
    connection,
    isLoading,
    isError,
    refetch,
    activeRevision,
    activeRevisionId,
    revisions,

    // Live-version summary (drives the read-only config rows).
    liveSummary,
    liveVersionNo: activeRevision?.versionNo ?? null,

    // Test evidence from the most recent "Run tests" call.
    testEvidence,

    // Aggregate busy + per-action pending ids (only the acting row spins).
    busy,
    testingRevisionId: testMutation.isPending ? (testMutation.variables ?? null) : null,
    rollingBackRevisionId: rollbackMutation.isPending ? (rollbackMutation.variables ?? null) : null,
    discardingRevisionId: archiveMutation.isPending ? (archiveMutation.variables ?? null) : null,

    // Notice + confirm UI state.
    notice,
    setNotice,
    confirm,
    setConfirm,

    // Relocated handlers (the triggers HistoryContent calls).
    onTest,
    onRequestPublish,
    onRequestRollback,
    onRequestArchive,

    // Underlying mutations (createDraft for "Edit mapping"; the rest drive the
    // confirm dialog's onConfirm).
    createDraftMutation,
    publishMutation,
    rollbackMutation,
    archiveMutation,
  };
}

export type UseConnectionRevisions = ReturnType<typeof useConnectionRevisions>;
