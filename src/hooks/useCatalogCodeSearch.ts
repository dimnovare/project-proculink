"use client";

// useCatalogCodeSearch — the ONE supplier-code lookup. Search runs server-side
// (GET /api/suppliers/{id}/catalog?q=), so a code at row 90,000 of a real
// distributor catalog is findable; a client-side filter over a fetched page can
// only ever search the part it loaded.
//
// Cache identity comes from catalogCodes.ts: an empty query lands on the SAME
// ["supplier-catalog-codes", supplierId] entry CatalogHintCard probes, and every
// search sits under that prefix so an import/clear invalidation sweeps them all.
//
// Honesty: `claim` is derived from the CURRENT query's own result only. While a
// new query is in flight the claim is "unknown" — the previous page's verdict is
// never reused to describe a query it did not answer.

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getSupplierCatalog } from "@/lib/api-client";
import { useQueriesEnabled } from "@/hooks/useQueriesEnabled";
import {
  CATALOG_CODES_TAKE,
  catalogCodesQueryKey,
  catalogPageClaim,
  type CatalogPageClaim,
} from "@/lib/catalogCodes";
import type { SupplierProduct } from "@/lib/api/types";

/** Typing settles for this long before a request goes out. */
export const CATALOG_SEARCH_DEBOUNCE_MS = 250;

export interface CatalogCodeSearch {
  /** The matches for `settledQuery` (empty while a new query is in flight). */
  items: SupplierProduct[];
  /** What this page proves — the ONLY thing the UI may state. */
  claim: CatalogPageClaim;
  /** The trimmed query the current items answer. */
  settledQuery: string;
  isFetching: boolean;
  isError: boolean;
  refetch: () => void;
}

export function useCatalogCodeSearch({
  supplierId,
  query,
  enabled,
}: {
  supplierId: string;
  query: string;
  /** False when there is no supplier to ask about (unrouted order, closed picker). */
  enabled: boolean;
}): CatalogCodeSearch {
  const queryEnabled = useQueriesEnabled();
  const trimmed = query.trim();

  const [settledQuery, setSettledQuery] = useState(trimmed);
  useEffect(() => {
    if (trimmed === settledQuery) return;
    const t = setTimeout(() => setSettledQuery(trimmed), CATALOG_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [trimmed, settledQuery]);

  const on = enabled && queryEnabled && !!supplierId;
  const { data, isSuccess, isFetching, isError, refetch } = useQuery({
    queryKey: catalogCodesQueryKey(supplierId, settledQuery),
    queryFn: () => getSupplierCatalog(supplierId, settledQuery || undefined, CATALOG_CODES_TAKE),
    enabled: on,
    staleTime: 60_000,
    retry: 1,
  });

  // `isSuccess` alone would go on claiming things during a background refetch of
  // the same key; pairing it with !isFetching keeps every claim tied to a page
  // that is currently true.
  const settled = isSuccess && !isFetching;

  return {
    items: settled ? (data?.items ?? []) : [],
    claim: catalogPageClaim({ page: data, settled, query: settledQuery }),
    settledQuery,
    isFetching,
    isError,
    refetch: () => void refetch(),
  };
}
