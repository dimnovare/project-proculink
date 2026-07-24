import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, cleanup, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// useCatalogCodeSearch — the ONE server-side supplier-code lookup both the
// review-screen catalog picker and the upload-preview manual entry run through.
// What these tests pin is the part a client-side filter got wrong: the query
// text must reach the SERVER, so a code at row 90,000 of a real distributor
// catalog is findable.

vi.mock("@/lib/api-client", () => ({
  getSupplierCatalog: vi.fn().mockResolvedValue({ total: 0, items: [] }),
}));
vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => true }));

import { getSupplierCatalog } from "@/lib/api-client";
import { CATALOG_CODES_TAKE } from "@/lib/catalogCodes";
import { useCatalogCodeSearch, CATALOG_SEARCH_DEBOUNCE_MS } from "./useCatalogCodeSearch";

const catalogMock = vi.mocked(getSupplierCatalog);

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  catalogMock.mockReset().mockResolvedValue({ total: 0, items: [] });
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("useCatalogCodeSearch", () => {
  it("sends the query to the SERVER — not a client-side filter over one page", async () => {
    const { rerender } = renderHook(
      ({ query }) => useCatalogCodeSearch({ supplierId: "sup-1", query, enabled: true }),
      { wrapper, initialProps: { query: "" } },
    );
    await waitFor(() => expect(catalogMock).toHaveBeenCalledWith("sup-1", undefined, CATALOG_CODES_TAKE));

    rerender({ query: "TY-90112" });
    act(() => { vi.advanceTimersByTime(CATALOG_SEARCH_DEBOUNCE_MS); });
    await waitFor(() =>
      expect(catalogMock).toHaveBeenCalledWith("sup-1", "TY-90112", CATALOG_CODES_TAKE),
    );
  });

  it("debounces — typing four characters is not four requests", async () => {
    const { rerender } = renderHook(
      ({ query }) => useCatalogCodeSearch({ supplierId: "sup-1", query, enabled: true }),
      { wrapper, initialProps: { query: "" } },
    );
    await waitFor(() => expect(catalogMock).toHaveBeenCalledTimes(1)); // the empty probe

    for (const q of ["T", "TY", "TY-", "TY-9"]) {
      rerender({ query: q });
      act(() => { vi.advanceTimersByTime(CATALOG_SEARCH_DEBOUNCE_MS / 4); });
    }
    act(() => { vi.advanceTimersByTime(CATALOG_SEARCH_DEBOUNCE_MS); });
    await waitFor(() => expect(catalogMock).toHaveBeenCalledWith("sup-1", "TY-9", CATALOG_CODES_TAKE));
    // Probe + the settled search only — the three intermediate keystrokes never fired.
    expect(catalogMock).toHaveBeenCalledTimes(2);
  });

  it("does not fetch at all when disabled (no supplier assigned yet)", () => {
    renderHook(() => useCatalogCodeSearch({ supplierId: "sup-1", query: "x", enabled: false }), {
      wrapper,
    });
    act(() => { vi.advanceTimersByTime(CATALOG_SEARCH_DEBOUNCE_MS * 4); });
    expect(catalogMock).not.toHaveBeenCalled();
  });

  it("reports a full page as capped, and the query the items actually answer", async () => {
    catalogMock.mockResolvedValue({
      total: 120_000,
      items: Array.from({ length: CATALOG_CODES_TAKE }, (_, i) => ({ id: `p${i}`, code: `TY-${i}` })),
    });
    const { result, rerender } = renderHook(
      ({ query }) => useCatalogCodeSearch({ supplierId: "sup-1", query, enabled: true }),
      { wrapper, initialProps: { query: "" } },
    );
    rerender({ query: "  TY  " });
    act(() => { vi.advanceTimersByTime(CATALOG_SEARCH_DEBOUNCE_MS); });
    await waitFor(() => expect(result.current.claim.kind).toBe("matches"));
    expect(result.current.claim).toEqual({ kind: "matches", capped: true, shown: CATALOG_CODES_TAKE });
    // Trimmed: the settled query is what the server was actually asked.
    expect(result.current.settledQuery).toBe("TY");
  });

  it("makes NO claim while a new query is still in flight", async () => {
    const { result, rerender } = renderHook(
      ({ query }) => useCatalogCodeSearch({ supplierId: "sup-1", query, enabled: true }),
      { wrapper, initialProps: { query: "" } },
    );
    await waitFor(() => expect(result.current.claim.kind).toBe("no-catalog"));

    // Never resolves — the "searching" window.
    catalogMock.mockImplementation(() => new Promise(() => {}));
    rerender({ query: "zzz" });
    act(() => { vi.advanceTimersByTime(CATALOG_SEARCH_DEBOUNCE_MS); });
    await waitFor(() => expect(result.current.isFetching).toBe(true));
    // The previous page's "no catalog" verdict must not be reused for a new query.
    expect(result.current.claim).toEqual({ kind: "unknown" });
  });
});
