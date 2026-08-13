"use client";

// useSourceDocument — the order's original file, as server state.
//
// The bytes are immutable for the life of an order, so this is a plain cached query with a long
// staleTime; there is nothing to poll. What it adds over a bare `useQuery` is the mapping from
// "the query settled badly" to one of the states the screen actually knows how to say out loud.

import { useCallback, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient, ApiHttpError } from "@/lib/api-client";
import { useQueriesEnabled } from "@/hooks/useQueriesEnabled";
import type { SourceDocumentState } from "@/lib/sourceDocument";

/** Tailwind's `lg`, which is what separates the desktop workshop from MobileTriage. */
const LG_QUERY = "(min-width: 1024px)";
let lgMedia: MediaQueryList | null = null;

function lgMediaQuery(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  if (!lgMedia) lgMedia = window.matchMedia(LG_QUERY);
  return lgMedia;
}

/**
 * Is the desktop workshop the visible surface?
 *
 * This exists for ONE reason: `hidden lg:flex` hides the desktop mapper with CSS, but React
 * still mounts it and its hooks still run — so without this, opening an order on a phone would
 * download the whole source file for a pane that is not on screen. Below `lg` the document is
 * opt-in (MobileTriage's collapsed card), and this is what makes "opt-in" true rather than
 * decorative. The query string is Tailwind's own `lg` value, so JS and CSS agree by definition.
 */
export function useLgViewport(): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    const mql = lgMediaQuery();
    if (!mql) return () => {};
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return useSyncExternalStore(
    subscribe,
    () => lgMediaQuery()?.matches ?? false,
    // Server render: assume narrow, so nothing is fetched during SSR. The client corrects it on
    // the first commit, before any paint the operator could see.
    () => false,
  );
}

export interface UseSourceDocument {
  state: SourceDocumentState;
  /** True while the answer is genuinely unknown — never true once a state is settled. */
  isLoading: boolean;
  /** Convenience: a document exists AND arrived. */
  hasDocument: boolean;
}

export function useSourceDocument(
  orderId: string | null | undefined,
  options?: { enabled?: boolean },
): UseSourceDocument {
  const queriesEnabled = useQueriesEnabled();
  const enabled = queriesEnabled && !!orderId && options?.enabled !== false;

  const { data, error, isError, isLoading } = useQuery({
    queryKey: ["order-source", orderId],
    queryFn: () => apiClient.getOrderSource(orderId as string),
    enabled,
    // The source file cannot change under an order — only disappear, which the 410 branch
    // reports and which is not worth polling for.
    staleTime: 5 * 60_000,
  });

  if (data) return { state: data, isLoading: false, hasDocument: data.kind === "document" };

  if (isError) {
    // 429 survives the shared retry policy only when the budget is genuinely exhausted, so by
    // the time it lands here "wait and reload" is the honest instruction.
    if (error instanceof ApiHttpError && error.status === 429) {
      return {
        state: { kind: "throttled", retryAfterSeconds: error.retryAfterSeconds },
        isLoading: false,
        hasDocument: false,
      };
    }
    return { state: { kind: "error" }, isLoading: false, hasDocument: false };
  }

  // A disabled query reports isLoading:true with no data — treat "not asked yet" as loading,
  // never as an error (the repo's documented TanStack gotcha).
  return { state: { kind: "error" }, isLoading: enabled ? isLoading : true, hasDocument: false };
}
