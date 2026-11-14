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
// We test the hook in isolation: the adapter's save REJECTS and the queries are
// force-enabled, so only the save path matters.

const save = vi.fn();
const load = vi.fn();

// Force queries enabled without a Clerk session.
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

describe("useMapperModel — save error surfaces via the returned model", () => {
  it("a rejected save sets result.current.error to the failure message", async () => {
    save.mockRejectedValue(new Error("Server said no"));

    const { result } = renderHook(
      () => useMapperModel({ variant: "flow", adapter, scopeId: "out-1" }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

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
    save
      .mockRejectedValueOnce(new Error("Transient blip"))
      .mockResolvedValueOnce({ customFields: [] });

    const { result } = renderHook(
      () => useMapperModel({ variant: "flow", adapter, scopeId: "out-1" }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => { result.current.onSourceConnect("tok-1", "PoNumber"); });
    await waitFor(() => expect(result.current.error).toBe("Transient blip"));

    act(() => { result.current.onSourceConnect("tok-2", "Currency"); });
    await waitFor(() => expect(result.current.error).toBeNull());
  });
});
