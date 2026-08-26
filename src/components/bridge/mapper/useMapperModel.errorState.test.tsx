import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { OrderMappingOverride } from "@/lib/api/types";

// B12 — a failed save must surface the error through the returned model RELIABLY.
// The error was previously held in a useRef, which doesn't trigger a render, so the
// "Couldn't save" message only painted by coincidence (when saveMut.isPending flipped
// on settle). After promoting it to useState, onError must repaint result.current.error.
//
// We test the hook in isolation: api-client is mocked so upsertMappingOverride REJECTS,
// the queries are force-enabled, and every read endpoint returns empty so only the
// save path matters.

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

// Force queries enabled without a Clerk session.
vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => true, useTenantQueriesEnabled: () => true }));

// AI / canonical reads — all empty so the model has nothing extra to do.
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

describe("useMapperModel — save error surfaces via the returned model", () => {
  it("a rejected save sets result.current.error to the failure message", async () => {
    upsertMappingOverride.mockRejectedValue(new Error("Server said no"));

    const { result } = renderHook(
      () => useMapperModel({ variant: "order", scopeId: "ord-1", initialOverride: seedOverride }),
      { wrapper },
    );

    // Resting: no error.
    expect(result.current.error).toBeNull();

    // Trigger a save (any mutator persists via the same saveMut path).
    act(() => {
      result.current.onSourceConnect("tok-1", "PoNumber");
    });

    // The state-backed error repaints — the ref version would not have.
    await waitFor(() => {
      expect(result.current.error).toBe("Server said no");
    });
  });

  it("clears the error on the next save attempt (onMutate)", async () => {
    // First save fails, second succeeds — the error must clear when the retry starts.
    upsertMappingOverride
      .mockRejectedValueOnce(new Error("Transient blip"))
      .mockResolvedValueOnce({ customFields: [] });

    const { result } = renderHook(
      () => useMapperModel({ variant: "order", scopeId: "ord-1", initialOverride: seedOverride }),
      { wrapper },
    );

    act(() => { result.current.onSourceConnect("tok-1", "PoNumber"); });
    await waitFor(() => expect(result.current.error).toBe("Transient blip"));

    act(() => { result.current.onSourceConnect("tok-2", "Currency"); });
    await waitFor(() => expect(result.current.error).toBeNull());
  });
});
