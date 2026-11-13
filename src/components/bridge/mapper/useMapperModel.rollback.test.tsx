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

const save = vi.fn();
const load = vi.fn();

vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => true, useTenantQueriesEnabled: () => true }));

import { useMapperModel } from "./useMapperModel";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const seedOverride: OrderMappingOverride = { customFields: [] };

// The flow adapter is the only load/save path left (the order and connection variants
// went 2026-11-13), so these drive the hook through it.
const adapter = {
  scope: "out-1",
  load: () => load() as Promise<OrderMappingOverride>,
  save: (next: OrderMappingOverride) => save(next) as Promise<OrderMappingOverride>,
  sourceFields: [],
};

beforeEach(() => {
  save.mockReset();
  load.mockReset();
  load.mockResolvedValue(seedOverride);
});

describe("useMapperModel — failed save rolls the optimistic edit back (B9)", () => {
  it("reverts sourceConnections to the prior server state AND surfaces the error", async () => {
    save.mockRejectedValue(new Error("Server said no"));

    const { result } = renderHook(
      () => useMapperModel({ variant: "flow", adapter, scopeId: "out-1" }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

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
    save
      .mockImplementationOnce(async (next: OrderMappingOverride) => next) // first save OK (the server echoes it)
      .mockRejectedValueOnce(new Error("blip")); // second save fails

    const { result } = renderHook(
      () => useMapperModel({ variant: "flow", adapter, scopeId: "out-1" }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

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
