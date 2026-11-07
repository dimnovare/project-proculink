import { describe, it, expect, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { OrderMappingOverride } from "@/lib/api/types";
import type { MapperAdapter, SourceField } from "./types";

const getSourceTokens = vi.fn().mockResolvedValue([]);
const getMappingOverride = vi.fn().mockResolvedValue(null);
const getMappingSuggestions = vi.fn().mockResolvedValue([]);
vi.mock("@/lib/api-client", () => ({
  getMappingOverride: (...a: unknown[]) => getMappingOverride(...a),
  upsertMappingOverride: vi.fn(),
  getSourceTokens: (...a: unknown[]) => getSourceTokens(...a),
  getConnectionRevision: vi.fn(),
  updateConnectionDraft: vi.fn(),
  isApiMockMode: false,
  isQaBypass: false,
}));
vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => true, useTenantQueriesEnabled: () => true }));
vi.mock("@/lib/api/canonical-fields", () => ({ getCanonicalFields: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/api/mapper-ai", () => ({
  getMappingSuggestions: (...a: unknown[]) => getMappingSuggestions(...a),
  recordSuggestionDecision: vi.fn().mockResolvedValue(undefined),
  getFieldValidation: vi.fn().mockResolvedValue([]),
  getCatalogHints: vi.fn().mockResolvedValue([]),
}));

import { useMapperModel } from "./useMapperModel";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const field = (id: string): SourceField => ({ id, label: id, value: "v", group: "header", mapped: false });
const makeAdapter = (save: MapperAdapter["save"]): MapperAdapter => ({
  scope: "out-1",
  load: vi.fn().mockResolvedValue({ customFields: [] } as OrderMappingOverride),
  save,
  sourceFields: [field("a"), field("b")],
});

describe("useMapperModel — flow variant", () => {
  it("loads from the adapter and never calls the order endpoints", async () => {
    const adapter = makeAdapter(vi.fn());
    const { result } = renderHook(() => useMapperModel({ variant: "flow", scopeId: adapter.scope, adapter }), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.sourceFields.map((f) => f.id)).toEqual(["a", "b"]);
    expect(adapter.load).toHaveBeenCalled();
    expect(getSourceTokens).not.toHaveBeenCalled();
    expect(getMappingOverride).not.toHaveBeenCalled();
    expect(getMappingSuggestions).not.toHaveBeenCalled();
  });

  it("saves through the adapter and shows what the server returned", async () => {
    const resolved: OrderMappingOverride = { customFields: [], outputTemplate: "as-the-server-holds-it" };
    const adapter = makeAdapter(vi.fn().mockResolvedValue(resolved));
    const { result } = renderHook(() => useMapperModel({ variant: "flow", scopeId: adapter.scope, adapter }), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => { result.current.onSourceConnect("a", "PoNumber"); });
    await waitFor(() => expect(result.current.override).toEqual(resolved));
    expect(adapter.save).toHaveBeenCalledTimes(1);
  });
});
