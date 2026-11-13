import { describe, it, expect, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { OrderMappingOverride } from "@/lib/api/types";
import type { MapperAdapter, SourceField } from "./types";

const getSourceTokens = vi.fn().mockResolvedValue([]);
vi.mock("@/lib/api-client", () => ({
  getSourceTokens: (...a: unknown[]) => getSourceTokens(...a),
  getConnectionRevision: vi.fn(),
  updateConnectionDraft: vi.fn(),
  isApiMockMode: false,
  isQaBypass: false,
}));
vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => true, useTenantQueriesEnabled: () => true }));
vi.mock("@/lib/api/canonical-fields", () => ({ getCanonicalFields: vi.fn().mockResolvedValue([]) }));

import { useMapperModel } from "./useMapperModel";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const field = (id: string): SourceField => ({ id, label: `${id} label`, value: "v", group: "header", mapped: false });
const makeAdapter = (save: MapperAdapter["save"]): MapperAdapter => ({
  scope: "out-1",
  load: vi.fn().mockResolvedValue({
    customFields: [], output: { header: { Out1: { outputPath: "Out1", canonicalField: "a", fieldManipulators: [] } }, lines: {} },
  } as OrderMappingOverride),
  save,
  sourceFields: [field("a"), field("b")],
});

describe("useMapperModel — flow variant", () => {
  it("loads from the adapter and never calls the order endpoints", async () => {
    const adapter = makeAdapter(vi.fn(() => new Promise<OrderMappingOverride>(() => {})));
    const { result } = renderHook(() => useMapperModel({ variant: "flow", scopeId: adapter.scope, adapter }), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.sourceFields.map((f) => f.id)).toEqual(["a", "b"]);
    // A wired row names its source and shows its value from the adapter.
    expect([result.current.labelForCanonical("a"), result.current.canonicalValueByKey.get("a")]).toEqual(["a label", "v"]);
    // A disconnect empties the row; it does not hide it while the save is in flight.
    await act(async () => { result.current.onTargetDisconnect("Out1"); });
    expect([result.current.targetFields.map((f) => f.outputPath), result.current.outputConnections["Out1"]]).toEqual([["Out1"], undefined]);
    expect(adapter.load).toHaveBeenCalled();
    expect(getSourceTokens).not.toHaveBeenCalled();
  });

  it("saves through the adapter, shows what the server returned, and keeps a newer pending edit", async () => {
    const one: OrderMappingOverride = { customFields: [], outputTemplate: "server-one" };
    const two: OrderMappingOverride = { customFields: [], outputTemplate: "server-two" };
    let resolveFirst!: (o: OrderMappingOverride) => void;
    let resolveSecond!: (o: OrderMappingOverride) => void;
    const save = vi.fn()
      .mockImplementationOnce(() => new Promise<OrderMappingOverride>((r) => { resolveFirst = r; }))
      .mockImplementationOnce(() => new Promise<OrderMappingOverride>((r) => { resolveSecond = r; }));
    const adapter = makeAdapter(save);
    const { result } = renderHook(() => useMapperModel({ variant: "flow", scopeId: adapter.scope, adapter }), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => { result.current.onTargetConnect("a", "Out1"); });
    act(() => { result.current.onTargetConnect("b", "Out2"); });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    // The first save lands while the second is still in flight: the second edit must stay.
    await act(async () => { resolveFirst(one); });
    expect(result.current.outputConnections["Out2"]).toBe("b");
    // The last save lands: now the server's copy is what is shown.
    await act(async () => { resolveSecond(two); });
    await waitFor(() => expect(result.current.override).toEqual(two));
  });
});
