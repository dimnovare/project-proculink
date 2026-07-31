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
//
// ── WHAT THIS HOOK DOES NOT DO (WP-32) ────────────────────────────────────────
// It has no timeout, and it must not grow one. If Clerk's hosted JS never loads
// (ad blocker, corporate proxy, provider outage) `isLoaded` never flips and this
// returns FALSE FOREVER — which is the correct answer, because a query fired
// without a session token just 401s. The bug was never here; it was that nobody
// bounded the wait, so all 28 consumers rendered their loading branch forever
// and a blocked script was indistinguishable from a hang.
//
// The bound lives one level up, in <ClerkAvailabilityGate> at
// src/app/(app)/layout.tsx: after CLERK_LOAD_DEADLINE_MS it replaces the whole
// shell with an explanatory card. It arms that deadline on `!useQueriesEnabled()`
// precisely because this hook already knows the two cases that must never see
// the card — mock and QA-bypass, where Clerk is dormant BY DESIGN (empty
// publishable key) and `isLoaded` is legitimately false for the whole session.
// If you ever make this hook return true in a new no-Clerk mode, the gate
// disarms itself for that mode automatically. Keep them coupled this way.

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
