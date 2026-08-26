import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type {
  ConnectionDetail,
  ConnectionRevision,
  ConnectionTestEvidence,
} from "@/lib/api/types";

// STRUCT-1 — useConnectionRevisions lifts the connection revision data + every
// lifecycle mutation out of ConnectionDetail so the supplier History tab can
// consume the SAME machinery. These tests assert the relocated handlers call the
// right apiClient functions and that liveSummary stays null until the active
// revision's BUNDLE has loaded (the on-page / drawer config summary depends on it).

const getConnection = vi.fn();
const getConnectionRevision = vi.fn();
const createConnectionDraft = vi.fn();
const publishConnectionRevision = vi.fn();
const markConnectionRevisionTest = vi.fn();
const archiveConnectionRevision = vi.fn();
const rollbackConnectionRevision = vi.fn();

// Hoisted so the (also-hoisted) vi.mock factory below can reference it directly without a
// temporal-dead-zone error — the factory evaluates `ApiHttpError: FakeApiHttpError` at import
// time, before a plain top-level class declaration would have initialized.
const { FakeApiHttpError } = vi.hoisted(() => {
  class FakeApiHttpError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  }
  return { FakeApiHttpError };
});

vi.mock("@/lib/api-client", () => ({
  getConnection: (...a: unknown[]) => getConnection(...a),
  getConnectionRevision: (...a: unknown[]) => getConnectionRevision(...a),
  createConnectionDraft: (...a: unknown[]) => createConnectionDraft(...a),
  publishConnectionRevision: (...a: unknown[]) => publishConnectionRevision(...a),
  markConnectionRevisionTest: (...a: unknown[]) => markConnectionRevisionTest(...a),
  archiveConnectionRevision: (...a: unknown[]) => archiveConnectionRevision(...a),
  rollbackConnectionRevision: (...a: unknown[]) => rollbackConnectionRevision(...a),
  ApiHttpError: FakeApiHttpError,
}));

vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => true, useTenantQueriesEnabled: () => true }));

import { useConnectionRevisions } from "./useConnectionRevisions";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const CONNECTION: ConnectionDetail = {
  id: "conn-1",
  supplierId: "sup-1",
  name: "Acme connection",
  activeRevisionId: "rev-2",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-02T00:00:00Z",
  revisions: [
    { id: "rev-3", versionNo: 3, status: "draft", effectiveFrom: null, effectiveTo: null, publishedAt: null, createdAt: "2026-01-03T00:00:00Z" },
    { id: "rev-2", versionNo: 2, status: "published", effectiveFrom: null, effectiveTo: null, publishedAt: "2026-01-02T00:00:00Z", createdAt: "2026-01-02T00:00:00Z" },
    { id: "rev-1", versionNo: 1, status: "archived", effectiveFrom: null, effectiveTo: null, publishedAt: "2026-01-01T00:00:00Z", createdAt: "2026-01-01T00:00:00Z" },
  ],
};

const ACTIVE_BUNDLE: ConnectionRevision = {
  id: "rev-2",
  connectionId: "conn-1",
  versionNo: 2,
  status: "published",
  effectiveFrom: null,
  effectiveTo: null,
  publishedAt: "2026-01-02T00:00:00Z",
  createdAt: "2026-01-02T00:00:00Z",
  inputMappingJson: "{}",
  outputMappingJson: null,
  outputFormat: "csv",
  deliveryProtocol: "http",
  deliveryConfigJson: null,
  deliveryAutoDeliver: true,
  hasCredentials: true,
  acceptanceProfileId: "acc-1",
  acceptanceVersionNo: 4,
  catalogMode: "live",
  itemMappings: [
    { buyerItemCode: "HX-1", supplierItemCode: "ACM-1", confidence: 1, source: "manual" },
  ],
};

const TEST_EVIDENCE: ConnectionTestEvidence = {
  // `outcome` is the authority; `passed` is the backend's fail-closed narrowing of it and
  // is deliberately not what the hook reads. The three non-passing outcomes are covered
  // in testPackOutcome.test.tsx.
  outcome: "passed",
  passed: true,
  testedAt: "2026-01-04T00:00:00Z",
  summaryJson: JSON.stringify({ outcome: "passed", replay: { outcome: "passed", orderCount: 2, outputErrors: 0, outputChanged: 0, validationChanged: 0, note: null }, conformance: null, error: null }),
};

beforeEach(() => {
  getConnection.mockReset().mockResolvedValue(CONNECTION);
  getConnectionRevision.mockReset().mockResolvedValue(ACTIVE_BUNDLE);
  createConnectionDraft.mockReset().mockResolvedValue({ ...ACTIVE_BUNDLE, id: "rev-4", versionNo: 4, status: "draft" });
  publishConnectionRevision.mockReset().mockResolvedValue(undefined);
  markConnectionRevisionTest.mockReset().mockResolvedValue(TEST_EVIDENCE);
  archiveConnectionRevision.mockReset().mockResolvedValue(undefined);
  rollbackConnectionRevision.mockReset().mockResolvedValue({ ...ACTIVE_BUNDLE, id: "rev-5", versionNo: 5 });
});

describe("useConnectionRevisions", () => {
  it("exposes the connection's revisions and active revision id", async () => {
    const { result } = renderHook(() => useConnectionRevisions("conn-1"), { wrapper });
    await waitFor(() => expect(result.current.revisions).toHaveLength(3));
    expect(result.current.activeRevisionId).toBe("rev-2");
    expect(getConnection).toHaveBeenCalledWith("conn-1");
  });

  it("liveSummary is null until the active revision BUNDLE has loaded, then derived from it", async () => {
    // Hold the bundle fetch open so the connection resolves first.
    let resolveBundle: (v: ConnectionRevision) => void = () => {};
    getConnectionRevision.mockReturnValue(new Promise<ConnectionRevision>((res) => { resolveBundle = res; }));

    const { result } = renderHook(() => useConnectionRevisions("conn-1"), { wrapper });

    // Connection loaded (active id known) but the bundle hasn't → liveSummary null.
    await waitFor(() => expect(result.current.activeRevisionId).toBe("rev-2"));
    expect(result.current.liveSummary).toBeNull();
    expect(result.current.liveVersionNo).toBeNull();

    // Bundle arrives → liveSummary is derived (and reflects the bundle's fields).
    act(() => resolveBundle(ACTIVE_BUNDLE));
    await waitFor(() => expect(result.current.liveSummary).not.toBeNull());
    expect(result.current.liveSummary).toMatchObject({
      inputConfigured: true,
      outputTemplateConfigured: false,
      outputFormat: "csv",
      deliveryProtocol: "http",
      deliveryAutoDeliver: true,
      hasCredentials: true,
      itemMappingCount: 1,
      acceptanceBound: true,
      acceptanceVersionNo: 4,
      catalogMode: "live",
    });
    expect(result.current.liveVersionNo).toBe(2);
  });

  it("onTest runs the test pack via markConnectionRevisionTest and stores the evidence", async () => {
    const { result } = renderHook(() => useConnectionRevisions("conn-1"), { wrapper });
    await waitFor(() => expect(result.current.revisions).toHaveLength(3));

    act(() => result.current.onTest("rev-3"));

    await waitFor(() => expect(markConnectionRevisionTest).toHaveBeenCalledWith("conn-1", "rev-3"));
    await waitFor(() => expect(result.current.testEvidence?.revisionId).toBe("rev-3"));
    expect(result.current.testEvidence?.outcome).toBe("passed");
    // The summary JSON is parsed into the structured shape HistoryContent reads.
    expect(result.current.testEvidence?.summary?.replay?.orderCount).toBe(2);
  });

  it("createDraftMutation calls createConnectionDraft with cloneFromActive", async () => {
    const { result } = renderHook(() => useConnectionRevisions("conn-1"), { wrapper });
    await waitFor(() => expect(result.current.revisions).toHaveLength(3));

    act(() => result.current.createDraftMutation.mutate());

    await waitFor(() => expect(createConnectionDraft).toHaveBeenCalledWith("conn-1", { cloneFromActive: true }));
  });

  it("publishMutation / rollbackMutation / archiveMutation call the matching apiClient fns", async () => {
    const { result } = renderHook(() => useConnectionRevisions("conn-1"), { wrapper });
    await waitFor(() => expect(result.current.revisions).toHaveLength(3));

    act(() => result.current.publishMutation.mutate("rev-3"));
    await waitFor(() => expect(publishConnectionRevision).toHaveBeenCalledWith("conn-1", "rev-3"));

    act(() => result.current.rollbackMutation.mutate("rev-1"));
    await waitFor(() => expect(rollbackConnectionRevision).toHaveBeenCalledWith("conn-1", "rev-1"));

    act(() => result.current.archiveMutation.mutate("rev-3"));
    await waitFor(() => expect(archiveConnectionRevision).toHaveBeenCalledWith("conn-1", "rev-3"));
  });

  it("onRequestPublish / onRequestRollback / onRequestArchive open the matching confirm state (no mutation yet)", async () => {
    const { result } = renderHook(() => useConnectionRevisions("conn-1"), { wrapper });
    await waitFor(() => expect(result.current.revisions).toHaveLength(3));

    act(() => result.current.onRequestPublish("rev-3", 3));
    expect(result.current.confirm).toEqual({ kind: "publish", revisionId: "rev-3", versionNo: 3 });
    // Requesting publish must NOT fire the mutation — that's the confirm dialog's job.
    expect(publishConnectionRevision).not.toHaveBeenCalled();

    act(() => result.current.onRequestRollback("rev-1", 1));
    expect(result.current.confirm).toEqual({ kind: "rollback", revisionId: "rev-1", versionNo: 1 });

    act(() => result.current.onRequestArchive("rev-3", 3));
    expect(result.current.confirm).toEqual({ kind: "archive", revisionId: "rev-3", versionNo: 3 });
  });
});
