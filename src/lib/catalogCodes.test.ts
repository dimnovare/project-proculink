import { describe, it, expect } from "vitest";
import {
  CATALOG_CODES_TAKE,
  UNASSIGNED_SUPPLIER_ID,
  catalogCodesQueryKey,
  catalogPageClaim,
  hasAssignedSupplier,
} from "./catalogCodes";

// catalogCodes — the ONE query identity every supplier-code lookup shares, plus
// the pure claim the UI is allowed to make about a returned page.
//
// The key matters twice over: the empty-query entry is the SAME cache entry
// CatalogHintCard's self-resolve probe uses, and every search entry must sit
// UNDER that prefix so an import/clear invalidation
// (["supplier-catalog-codes", supplierId]) sweeps the searches too.

describe("catalogCodesQueryKey", () => {
  it("an empty query is the shared 2-part probe key (CatalogHintCard's entry)", () => {
    expect(catalogCodesQueryKey("sup-1")).toEqual(["supplier-catalog-codes", "sup-1"]);
    expect(catalogCodesQueryKey("sup-1", "")).toEqual(["supplier-catalog-codes", "sup-1"]);
    expect(catalogCodesQueryKey("sup-1", "   ")).toEqual(["supplier-catalog-codes", "sup-1"]);
  });

  it("a search key extends the SAME prefix, so a catalog invalidation sweeps it", () => {
    expect(catalogCodesQueryKey("sup-1", "ty-9")).toEqual([
      "supplier-catalog-codes",
      "sup-1",
      "ty-9",
    ]);
    // The prefix an import/clear invalidates.
    expect(catalogCodesQueryKey("sup-1", "ty-9").slice(0, 2)).toEqual(
      catalogCodesQueryKey("sup-1"),
    );
  });

  it("trims the query so ' ty-9 ' and 'ty-9' are one cache entry, not two", () => {
    expect(catalogCodesQueryKey("sup-1", "  ty-9  ")).toEqual(
      catalogCodesQueryKey("sup-1", "ty-9"),
    );
  });
});

describe("hasAssignedSupplier", () => {
  it("Guid.Empty is not a supplier — an unrouted order has no catalog to ask about", () => {
    expect(hasAssignedSupplier(UNASSIGNED_SUPPLIER_ID)).toBe(false);
    expect(hasAssignedSupplier("")).toBe(false);
    expect(hasAssignedSupplier(null)).toBe(false);
    expect(hasAssignedSupplier(undefined)).toBe(false);
    expect(hasAssignedSupplier("sup-1")).toBe(true);
  });
});

describe("catalogPageClaim — what a returned page proves", () => {
  const page = (itemCount: number, total: number) => ({
    total,
    items: Array.from({ length: itemCount }, (_, i) => ({ id: `p${i}`, code: `C${i}` })),
  });

  it("an unsettled probe (loading / error) proves nothing about the catalog", () => {
    expect(catalogPageClaim({ page: undefined, settled: false, query: "" })).toEqual({
      kind: "unknown",
    });
    // Data present but the probe is not settled — still no claim.
    expect(catalogPageClaim({ page: page(3, 900), settled: false, query: "x" })).toEqual({
      kind: "unknown",
    });
  });

  it("a settled probe with total 0 is a genuinely empty catalog", () => {
    expect(catalogPageClaim({ page: page(0, 0), settled: true, query: "" })).toEqual({
      kind: "no-catalog",
    });
    // `total` is the WHOLE catalog count server-side (it ignores ?q=), so a
    // search that matched nothing in a stocked catalog is NEVER "no catalog".
    expect(catalogPageClaim({ page: page(0, 120_000), settled: true, query: "zzz" })).toEqual({
      kind: "no-match",
      query: "zzz",
    });
  });

  it("a full page means the server had more matches than it returned", () => {
    expect(
      catalogPageClaim({ page: page(CATALOG_CODES_TAKE, 120_000), settled: true, query: "ty" }),
    ).toEqual({ kind: "matches", capped: true, shown: CATALOG_CODES_TAKE });
  });

  it("a partial page is the complete match set — no 'refine' nag", () => {
    expect(catalogPageClaim({ page: page(3, 120_000), settled: true, query: "ty-901" })).toEqual({
      kind: "matches",
      capped: false,
      shown: 3,
    });
  });
});
