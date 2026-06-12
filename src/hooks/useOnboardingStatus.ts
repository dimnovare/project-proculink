"use client";

// useOnboardingStatus — single shared query for GET /api/onboarding/status
// (extended B1 payload; see OnboardingStatus in types/procurement.ts).
//
// Gated via useQueriesEnabled() — mock || qa-bypass || signed-in — per the
// known clerkReady-starvation rule: a query gated on clerkReady alone never
// runs in mock mode or live QA-bypass e2e, so dependent UI starves forever.
//
// Consumers (checklist, dashboard, wizard, upload page) share the same
// queryKey, so one fetch serves them all and a single invalidation after any
// signal-changing action (supplier create, sample run, delivery-config save,
// test-fire success, catalog import) refreshes every surface.

import { useQuery, type QueryClient, type UseQueryResult } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { useQueriesEnabled } from "@/hooks/useQueriesEnabled";
import type { OnboardingStatus } from "@/types/procurement";

export const ONBOARDING_STATUS_QUERY_KEY = ["onboarding-status"];

export function useOnboardingStatus(): UseQueryResult<OnboardingStatus> {
  const enabled = useQueriesEnabled();
  return useQuery<OnboardingStatus>({
    queryKey: ONBOARDING_STATUS_QUERY_KEY,
    queryFn: () => apiClient.getOnboardingStatus(),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    enabled,
  });
}

/**
 * Invalidate the shared onboarding-status cache. Call after anything that can
 * flip a checklist signal; everything else self-heals via staleTime +
 * refetch-on-focus.
 */
export function invalidateOnboardingStatus(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: ONBOARDING_STATUS_QUERY_KEY });
}
