"use client";

// useQueriesEnabled — single source of truth for the "may data queries run?" gate.
//
// The gate has to be true in THREE situations:
//   1. Mock mode (isApiMockMode)            — dev/demo, no real backend.
//   2. Live QA-bypass e2e (isQaBypass)      — NEXT_PUBLIC_QA_BYPASS_AUTH=true +
//      PROCULINK_QA_BYPASS_AUTH on the API. The browser has NO Clerk session, so
//      the clerkReady branch below is false and every query would starve. This
//      branch keeps the live e2e screens populated and the upload button enabled.
//   3. A signed-in Clerk user (clerkReady)  — the normal production path.
//
// Production behavior is unchanged: NEXT_PUBLIC_QA_BYPASS_AUTH is unset there, so
// isQaBypass is false and the gate collapses back to `isApiMockMode || clerkReady`.

import { useAuth } from "@clerk/nextjs";
import { isApiMockMode, isQaBypass } from "@/lib/api-client";

/**
 * Returns whether TanStack Query data fetches should be enabled for the current
 * auth/runtime context. Replaces the per-component
 * `const clerkReady = ...; const queryEnabled = isApiMockMode || clerkReady;`.
 */
export function useQueriesEnabled(): boolean {
  const { isLoaded, isSignedIn } = useAuth();
  return isApiMockMode || isQaBypass || (isLoaded && !!isSignedIn);
}
