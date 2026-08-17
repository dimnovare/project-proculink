// A FAILED READ OF THE SAVED MAPPING MUST NOT BECOME A BLANK WRITE.
//
// The backend PUT replaces the WHOLE OrderMappingOverride — the invariant at the top of
// useMapperModel.ts, written after a founder-reported data loss. The guard it describes
// (buildOverrideDraft carrying customFields + sourceMap + template through unchanged) protects
// the SAVE path. Nothing protected the LOAD path:
//
//   getMappingOverride throws on any non-404 non-2xx  →  overrideQuery.data is undefined
//   →  `override = draft ?? overrideQuery.data ?? emptyOverride()`  →  a blank document
//   →  the workbench renders exactly like an order nobody has mapped
//   →  the first edit assembles a draft FROM THE BLANK and PUTs it over the real mapping.
//
// `loading` keyed on isLoading only and `error` is the SAVE error, so no surface anywhere said
// the load had failed. These tests drive the real hook against a rejecting endpoint and assert
// on the NETWORK — whether a PUT was issued — because "the flag is set" is not the property that
// matters; "nothing was overwritten" is.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { OrderMappingOverride } from "@/lib/api/types";

const getMappingOverride = vi.fn();
const upsertMappingOverride = vi.fn();

vi.mock("@/lib/api-client", () => ({
  getMappingOverride: (...a: unknown[]) => getMappingOverride(...a),
  upsertMappingOverride: (...a: unknown[]) => upsertMappingOverride(...a),
  getSourceTokens: vi.fn().mockResolvedValue([]),
  getConnectionRevision: vi.fn().mockResolvedValue(null),
  updateConnectionDraft: vi.fn().mockResolvedValue(undefined),
  isApiMockMode: false,
  isQaBypass: false,
}));

vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => true }));
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

/**
 * A REAL saved mapping — the thing at risk. `sourceMap` is what a blank PUT destroys: the
 * operator's earlier wiring of the buyer's raw column onto the canonical PO number.
 */
const SAVED: OrderMappingOverride = {
  customFields: [],
  output: {
    header: { PoNumber: { outputPath: "PoNumber", canonicalField: "PoNumber", fieldManipulators: [] } },
    lines: {},
  },
  sourceMap: { PoNumber: { sourceToken: "tok-po", manipulators: [] } },
};

/**
 * The host (OrderWorkshop) reads the same endpoint into `["mapping-override", orderId]` and
 * passes its `data` down as `initialOverride`. On a failed load that data is `undefined`, so
 * the prop is omitted — which is precisely why the hook's own query is the last line of defence.
 */
function renderModel() {
  return renderHook(() => useMapperModel({ variant: "order", scopeId: "ord-1" }), { wrapper });
}

beforeEach(() => {
  getMappingOverride.mockReset();
  upsertMappingOverride.mockReset();
  upsertMappingOverride.mockResolvedValue({ customFields: [] });
});

describe("useMapperModel — the saved mapping could not be read", () => {
  it("reports the override as unavailable rather than as absent", async () => {
    getMappingOverride.mockRejectedValue(new Error("500 Internal Server Error"));

    const { result } = renderModel();

    await waitFor(() => expect(result.current.overrideUnavailable).toBe(true));
    // The tell that made this invisible: the failure leaves a well-formed EMPTY override, which
    // is indistinguishable from an unmapped order, and `error` stays null because it only ever
    // carried save failures.
    expect(result.current.override).toEqual({ customFields: [], output: null, sourceMap: null });
    expect(result.current.error).toBeNull();
  });

  it("refuses the edit instead of PUTting a blank document over the saved mapping", async () => {
    getMappingOverride.mockRejectedValue(new Error("500 Internal Server Error"));

    const { result } = renderModel();
    await waitFor(() => expect(result.current.overrideUnavailable).toBe(true));

    // The operator drags one wire. Before the fix this called saveMut with a draft assembled
    // from emptyOverride() and the PUT replaced the whole document.
    act(() => { result.current.onTargetConnect("BuyerName", "BuyerName"); });

    // Give the mutation every chance to fire before asserting it did not.
    await new Promise((r) => setTimeout(r, 20));
    expect(upsertMappingOverride).not.toHaveBeenCalled();
  });

  it("refuses a fixed value and a source wire on the same footing", async () => {
    // Every mutator funnels through apply(); if one bypassed it the refusal would be partial,
    // and a partial refusal on a destructive write is no refusal at all.
    getMappingOverride.mockRejectedValue(new Error("500 Internal Server Error"));

    const { result } = renderModel();
    await waitFor(() => expect(result.current.overrideUnavailable).toBe(true));

    act(() => { result.current.onSetFixedValue("Currency", "EUR", "header"); });
    act(() => { result.current.onSourceConnect("tok-9", "PoNumber"); });

    await new Promise((r) => setTimeout(r, 20));
    expect(upsertMappingOverride).not.toHaveBeenCalled();
  });
});

describe("useMapperModel — anti-vacuity: a mapper that saves nothing is a worse defect", () => {
  it("still saves when the override loaded, and carries the saved mapping through", async () => {
    getMappingOverride.mockResolvedValue(SAVED);

    const { result } = renderModel();
    await waitFor(() => expect(result.current.override.sourceMap).toEqual(SAVED.sourceMap));
    expect(result.current.overrideUnavailable).toBe(false);

    act(() => { result.current.onTargetConnect("BuyerName", "BuyerName"); });

    await waitFor(() => expect(upsertMappingOverride).toHaveBeenCalledTimes(1));
    const [, doc] = upsertMappingOverride.mock.calls[0] as [string, OrderMappingOverride];
    // The write is not merely issued — it still carries the earlier wiring, which is the
    // property the refusal above exists to protect.
    expect(doc.sourceMap?.PoNumber?.sourceToken).toBe("tok-po");
    expect(doc.output?.header?.BuyerName?.canonicalField).toBe("BuyerName");
  });

  it("treats a 404 (no mapping saved yet) as absent, not as unavailable", async () => {
    // getMappingOverride resolves null on 404. That is the ordinary first-edit path and it must
    // stay fully editable — a refusal here would block every new order in the product.
    getMappingOverride.mockResolvedValue(null);

    const { result } = renderModel();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.overrideUnavailable).toBe(false);

    act(() => { result.current.onTargetConnect("BuyerName", "BuyerName"); });
    await waitFor(() => expect(upsertMappingOverride).toHaveBeenCalledTimes(1));
  });
});
