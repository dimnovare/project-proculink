"use client";

import { useQuery } from "@tanstack/react-query";
import { listDocumentPage, listFlows } from "@/lib/api/documents";
import { DOCUMENT_TABS, DOCUMENTS_PAGE_SIZE, NEEDS_YOU_STATUSES, type DocumentTab } from "@/lib/documentTabs";
import { refusalToken } from "@/lib/documentRefusals";
import { useTenantQueriesEnabled } from "@/hooks/useQueriesEnabled";

/** One set of options for every `["flows"]` reader, so they share a request. An errored query with no data
 *  counts as stale, so without `refetchOnWindowFocus: false` a 403 would re-hit the server on every focus. */
export const flowsQuery = {
  queryKey: ["flows"],
  queryFn: () => listFlows(),
  retry: (n: number, e: unknown) => refusalToken(e) !== "document_engine_not_enabled" && n < 2,
  staleTime: 300_000,
  refetchOnWindowFocus: false,
} as const;

/** How many documents have these statuses, and which is newest. One request, shared by every reader of the same key. */
export const documentCountQuery = (statuses: readonly string[]) => ({
  queryKey: ["documents", "count", statuses.join(","), ""] as const,
  queryFn: () => listDocumentPage({ status: statuses, page: 1, pageSize: 1 }),
});
/** The needs-you number: the title line, its tab, "Review next" and the phone tab bar read this one request. */
export const needsYouQuery = documentCountQuery(NEEDS_YOU_STATUSES);

/** One page of a Documents tab. The Documents screen and the review queue read the same key. */
export const documentsPageQuery = (tab: DocumentTab, page: number) => ({
  queryKey: ["documents", "page", tab, page] as const,
  queryFn: () => listDocumentPage({ status: DOCUMENT_TABS.find((t) => t.id === tab)?.statuses ?? undefined, page, pageSize: DOCUMENTS_PAGE_SIZE }),
});
/** The documents a person reviews in turn: Needs you, first page, newest first (R1). */
export const reviewQueueQuery = documentsPageQuery("needs-you", 1);

/** "off" only on the server's explicit refusal; data in hand is "on" even if a later refetch fails;
 *  loading or any other failure with no data is "unknown". */
export function useDocumentEngine(): "on" | "off" | "unknown" {
  const { data, error } = useQuery({ ...flowsQuery, enabled: useTenantQueriesEnabled() });
  if (refusalToken(error) === "document_engine_not_enabled") return "off";
  return data ? "on" : "unknown";
}
