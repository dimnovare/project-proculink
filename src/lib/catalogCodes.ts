// catalogCodes — the shared identity + honesty rules for every supplier-code
// lookup in the product (review-screen catalog picker, upload-preview manual
// entry, the review screen's catalog hint).
//
// Search runs SERVER-SIDE via GET /api/suppliers/{id}/catalog?q= — a real
// distributor catalog is 100k+ rows, so any client-side filter over a fetched
// page can only ever search the part it happened to load.
//
// Query-key contract:
//   ["supplier-catalog-codes", supplierId]        ← the empty-query probe
//   ["supplier-catalog-codes", supplierId, q]     ← one entry per search
// Searches sit UNDER the probe prefix on purpose: CatalogSourceEditor and the
// supplier Catalog tab already invalidate ["supplier-catalog-codes", supplierId]
// after an import/sync/clear, and React Query matches keys by prefix — so one
// invalidation sweeps the probe AND every cached search with it.
//
// No React, no fetching here — unit-tested in catalogCodes.test.ts.

import type { SupplierProduct } from "@/lib/api/types";

/**
 * Page size for a code lookup. Small on purpose: this feeds a picker list, not a
 * catalog browser, and the server searches the whole catalog either way.
 */
export const CATALOG_CODES_TAKE = 25;

/** An unrouted order serializes its supplier as Guid.Empty — there IS no supplier. */
export const UNASSIGNED_SUPPLIER_ID = "00000000-0000-0000-0000-000000000000";

/**
 * Whether there is a real supplier to ask about. False → no catalog request, and
 * nothing in the UI may claim anything about "this supplier's catalog".
 */
export function hasAssignedSupplier(supplierId: string | null | undefined): boolean {
  return !!supplierId && supplierId !== UNASSIGNED_SUPPLIER_ID;
}

/** The cache key for a lookup. An empty/whitespace query yields the shared probe key. */
export function catalogCodesQueryKey(supplierId: string, query?: string): (string | undefined)[] {
  const q = query?.trim();
  return q ? ["supplier-catalog-codes", supplierId, q] : ["supplier-catalog-codes", supplierId];
}

/**
 * What a returned catalog page actually proves.
 *
 * `no-catalog` and `no-match` are different claims and must never be swapped:
 * the server's `total` is the WHOLE catalog row count (SupplierCatalogService
 * CountAsync ignores `?q=`), so a search that matched nothing in a 120k-row
 * catalog is a no-match, not an empty catalog.
 */
export type CatalogPageClaim =
  /** Loading, errored, or otherwise unsettled — the UI may claim nothing. */
  | { kind: "unknown" }
  /** Settled: this supplier has no catalog rows at all. */
  | { kind: "no-catalog" }
  /** Settled: the catalog has rows, but none match this query. */
  | { kind: "no-match"; query: string }
  /** Settled: matches to show. `capped` = the page came back full, so there may be more. */
  | { kind: "matches"; capped: boolean; shown: number };

export function catalogPageClaim(args: {
  page: { total: number; items: Pick<SupplierProduct, "id" | "code">[] } | undefined;
  /** The query SUCCEEDED (not loading, not errored) — the gate on every claim below. */
  settled: boolean;
  /** The query the page answers (already debounced + trimmed by the caller). */
  query: string;
}): CatalogPageClaim {
  if (!args.settled || !args.page) return { kind: "unknown" };

  const shown = args.page.items.length;
  if (shown > 0) return { kind: "matches", capped: shown >= CATALOG_CODES_TAKE, shown };

  return args.page.total === 0
    ? { kind: "no-catalog" }
    : { kind: "no-match", query: args.query };
}
