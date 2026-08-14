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
//   - publish is EVIDENCE-GATED, on THREE outcomes not two (BE PR 207): the backend
//     409s when there is no fresh evidence, 409s separately when the run tested
//     nothing (`EvidenceNotExercised` — no orders to run it against), and only
//     proceeds on `passed`. Both server messages render inline via `notice`.
//   - POST .../test RUNS the checks (recent orders rebuilt through this version, a
//     standards check, a source re-read; it never delivers). It returns 200 for a
//     failed run AND for a run that tested nothing — read `outcome`, not `passed`.
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
import { testPackReading } from "@/lib/testPackOutcomeManifest";
import { parseTestSummary } from "./testPackSummary";
import type { RevisionTestEvidence } from "./testPackSummary";

// `warn` exists because a check run has an outcome that is neither. A run that found no
// fault but tested nothing must not be painted green ("carry on") and must not be painted
// red ("you broke something") — the operator needs to know the version is UNPROVEN.
// Collapsing it into either colour re-tells the lie in a different font.
export type Notice = { text: string; kind: "ok" | "warn" | "err" } | null;

export type ConfirmState =
  | { kind: "publish"; revisionId: string; versionNo: number }
  | { kind: "rollback"; revisionId: string; versionNo: number }
  | { kind: "archive"; revisionId: string; versionNo: number }
  | null;

// ── Test-pack evidence (returned by POST .../test) ───────────────────────────
//
// The shape and its reader now live in `./testPackSummary`, which is where the
// `parseLeg` this file's copy never had was added. The two structurally-identical
// declarations that used to sit here and in HistoryDrawer.tsx are why a leg the
// backend had been sending for months was invisible on both surfaces at once.
// Re-exported so existing importers of `parseTestSummary` / `RevisionTestEvidence`
// are unchanged.
export {
  parseTestSummary,
  type RevisionTestEvidence,
  type TestPackSummary,
} from "./testPackSummary";

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
      const summary = parseTestSummary(evidence.summaryJson);
      // The endpoint's own field first, the stored summary's copy of it second. They are
      // written from the same value (SupplierConnectionService.cs:245 and the summary's
      // `Outcome`), so this only covers a half-deployed backend — and when NEITHER is
      // there the value stays null, which the manifest reads as `unrecognised`.
      //
      // `evidence.passed` is deliberately not consulted. It is a narrowing of this same
      // outcome and cannot distinguish "found a fault" from "tested nothing", which is
      // the entire distinction this screen exists to draw.
      const outcome = evidence.outcome ?? summary?.outcome ?? null;
      // PRE-PR-207 COMPATIBILITY — SCAFFOLDING, delete when PR 207 is deployed
      // everywhere. When neither field carried an outcome, the backend predates PR 207
      // and `passed` is all it sent. It is recorded, NOT promoted: `true` there is the
      // exact value a run that exercised nothing produced, so it resolves to the same
      // conservative reading as an outcome this page cannot read, and never to a pass.
      const legacyPassed = outcome === null ? evidence.passed : null;
      setTestEvidence({ revisionId, outcome, legacyPassed, testedAt: evidence.testedAt, summary });
      // One sentence, derived from the outcome in one place. This used to be a ternary
      // over a boolean here AND a second ternary over the same boolean in HistoryDrawer,
      // which is how the banner came to announce a pass while the panel below it said a
      // leg had been skipped.
      const reading = testPackReading(outcome);
      setNotice({ text: reading.notice, kind: reading.tone });
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
