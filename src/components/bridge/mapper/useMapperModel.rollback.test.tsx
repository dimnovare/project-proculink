import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { OrderMappingOverride } from "@/lib/api/types";

// B9 — a FAILED mapper save must roll the optimistic edit back. Before the fix, apply() did
// setDraft(next) then mutate(next), and onError only recorded a message — so a rejected save
// left the wires + "what we'll send" preview showing the edit while the server still held the
// OLD override. The fix snapshots the pre-edit draft and restores it in onError.
//
// We assert on the model's PROJECTED state (sourceConnections — what the wires/preview read),
// not just the error string, so the test fails if the draft isn't actually reverted.

const upsertMappingOverride = vi.fn();
vi.mock("@/lib/api-client", () => ({
  getMappingOverride: vi.fn().mockResolvedValue(null),
  upsertMappingOverride: (...a: unknown[]) => upsertMappingOverride(...a),
  getSourceTokens: vi.fn().mockResolvedValue([]),
  getConnectionRevision: vi.fn().mockResolvedValue(null),
  updateConnectionDraft: vi.fn().mockResolvedValue(undefined),
  isApiMockMode: false,
  isQaBypass: false,
}));

vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => true, useTenantQueriesEnabled: () => true }));
vi.mock("@/lib/api/canonical-fields", () => ({ getCanonicalFields: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/api/mapper-ai", () => ({
  getMappingSuggestions: vi.fn().mockResolvedValue([]),
  recordSuggestionDecision: vi.fn().mockResolvedValue(undefined),
  getFieldValidation: vi.fn().mockResolvedValue([]),
  getCatalogHints: vi.fn().mockResolvedValue([]),
}));

import { useMapperModel } from "./useMapperModel";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const seedOverride: OrderMappingOverride = { customFields: [] };

beforeEach(() => {
  upsertMappingOverride.mockReset();
});

describe("useMapperModel — failed save rolls the optimistic edit back (B9)", () => {
  it("reverts sourceConnections to the prior server state AND surfaces the error", async () => {
    upsertMappingOverride.mockRejectedValue(new Error("Server said no"));

    const { result } = renderHook(
      () => useMapperModel({ variant: "order", scopeId: "ord-1", initialOverride: seedOverride }),
      { wrapper },
    );

    // Resting: no wires, no error.
    expect(result.current.error).toBeNull();
    expect(Object.keys(result.current.sourceConnections)).toHaveLength(0);

    act(() => { result.current.onSourceConnect("tok-1", "PoNumber"); });

    // Optimistic edit lands immediately (the wire shows while the request is in flight).
    expect(result.current.sourceConnections["PoNumber"]).toBe("tok-1");

    // After the rejection: the edit is rolled back (wire gone) AND the error is visible.
    await waitFor(() => {
      expect(result.current.error).toBe("Server said no");
      expect(result.current.sourceConnections["PoNumber"]).toBeUndefined();
    });
  });

  it("a successful save keeps the edit; a subsequent failed save reverts only to the last GOOD state", async () => {
    upsertMappingOverride
      .mockResolvedValueOnce({ customFields: [] }) // first save OK
      .mockRejectedValueOnce(new Error("blip")); // second save fails

    const { result } = renderHook(
      () => useMapperModel({ variant: "order", scopeId: "ord-1", initialOverride: seedOverride }),
      { wrapper },
    );

    // First edit succeeds and persists in the draft.
    act(() => { result.current.onSourceConnect("tok-1", "PoNumber"); });
    await waitFor(() => expect(result.current.error).toBeNull());
    expect(result.current.sourceConnections["PoNumber"]).toBe("tok-1");

    // Second edit fails → rolls back to the FIRST edit's state (not all the way to empty).
    act(() => { result.current.onSourceConnect("tok-2", "Currency"); });
    await waitFor(() => {
      expect(result.current.error).toBe("blip");
      expect(result.current.sourceConnections["Currency"]).toBeUndefined();
    });
    expect(result.current.sourceConnections["PoNumber"]).toBe("tok-1");
  });
});
