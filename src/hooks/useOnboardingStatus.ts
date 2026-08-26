"use client";

// useOnboardingStatus — single shared query for GET /api/onboarding/status
// (extended B1 payload; see OnboardingStatus in types/procurement.ts).
//
// Gated via useTenantQueriesEnabled() — the org-scoped gate, which still covers
// mock mode and live QA-bypass e2e (a query gated on clerkReady alone never runs
// in either, so dependent UI starves forever) and additionally holds the request
// back while a brand-new organisation is still being activated. /api/onboarding/
// status is answered per organisation, so sending it before the org claim exists
// earns a 500 `Organisation not resolved` and nothing else. Every screen that
// reads this hook shares the one cache entry, so gating it here covers the
// dashboard checklist, the wizard and the upload page at once.
//
// Consumers (checklist, dashboard, wizard, upload page) share the same
// queryKey, so one fetch serves them all and a single invalidation after any
// signal-changing action (supplier create, sample run, delivery-config save,
// test-fire success, catalog import) refreshes every surface.

import { useQuery, type QueryClient, type UseQueryResult } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { useTenantQueriesEnabled } from "@/hooks/useQueriesEnabled";
import type { OnboardingStatus } from "@/types/procurement";

export const ONBOARDING_STATUS_QUERY_KEY = ["onboarding-status"];

export function useOnboardingStatus(): UseQueryResult<OnboardingStatus> {
  const enabled = useTenantQueriesEnabled();
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
