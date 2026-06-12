"use client";

// useSampleOrder — the ONE shared "run a practice/sample order" mutation.
//
// Centralizes what UploadWorkbench's inline handleSample does:
//   capture("sample_order_started") → POST /api/onboarding/sample-order →
//   invalidate onboarding-status + orders caches → router.push(/inbox/{id}?sample=1).
//
// Every sample CTA (onboarding checklist, /upload, inbox empty state, Cmd+K)
// should go through this hook so analytics, cache invalidation, and routing
// stay consistent across entry points.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { apiClient, isApiMockMode } from "@/lib/api-client";
import { capture } from "@/lib/analytics";
import { captureException } from "@/lib/sentry-context";
import { invalidateOnboardingStatus } from "@/hooks/useOnboardingStatus";

export interface UseSampleOrderResult {
  /** Start the sample run. No-op while a run is already pending. */
  runSample: () => void;
  isPending: boolean;
  /** Last failure, for inline display. Cleared on the next runSample(). */
  error: Error | null;
}

export function useSampleOrder(fromRoute: string): UseSampleOrderResult {
  const router = useRouter();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async () => {
      // Existing analytics event — fired at start, mirroring the original
      // UploadWorkbench handleSample semantics (started, not succeeded).
      capture("sample_order_started", { from_route: fromRoute });
      return apiClient.runSampleOrder();
    },
    onSuccess: async ({ orderId }) => {
      await Promise.all([
        invalidateOnboardingStatus(queryClient),
        queryClient.invalidateQueries({ queryKey: ["orders"] }),
      ]);
      router.push(`/inbox/${encodeURIComponent(orderId)}?sample=1`);
    },
    onError: (err) => {
      captureException(err, {
        tags: { ui_surface: "sample_order_cta" },
        extra: {
          from_route: fromRoute,
          api_base_url: process.env.NEXT_PUBLIC_API_BASE_URL ?? "(unset)",
          is_mock_mode: isApiMockMode,
        },
      });
    },
  });

  return {
    runSample: () => {
      if (!mutation.isPending) mutation.mutate();
    },
    isPending: mutation.isPending,
    error: mutation.error,
  };
}
