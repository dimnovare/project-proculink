"use client";

// useSampleOrder — the ONE shared "run a practice/sample order" mutation.
//
// Centralizes what UploadWorkbench's inline handleSample does:
//   capture("sample_order_started") → POST /api/onboarding/sample-order →
//   invalidate onboarding-status + orders caches → router.push(/inbox/{id}).
//
// Every sample CTA (onboarding wizard, checklist, /upload, inbox empty state,
// Cmd+K) should go through this hook so analytics, cache invalidation, and
// routing stay consistent across entry points.
//
// WP-27 changed two things here:
//   • an optional `deliverTo` address is passed through, which is what seeds the
//     practice supplier's delivery setup and lets the run actually reach
//     `delivered` without any cooperation from a real supplier;
//   • the destination no longer carries `?sample=1`. The practice framing is now
//     driven by the order's own `isSample` flag, so it survives a bookmark, the
//     back button, and an inbox row click.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { apiClient, isApiMockMode } from "@/lib/api-client";
import { capture } from "@/lib/analytics";
import { captureException } from "@/lib/sentry-context";
import { invalidateOnboardingStatus } from "@/hooks/useOnboardingStatus";

/**
 * Whether THIS practice order's delivery was actually set up, remembered per order id.
 *
 * The backend answers `deliveryConfigured: false` when it seeded nothing — no usable
 * address, or a deployment with no email provider. Without this the review screen would
 * promise "we'll email you the finished file" on a deployment that cannot send, and the
 * user would meet a delivery_failed after being told otherwise. Session-scoped: it is a
 * fact about one run, not durable state, and `null` (a bookmark opened later, or a fresh
 * session) is read as "we don't know" — which downgrades the copy to what is always true
 * rather than guessing.
 */
const PRACTICE_DELIVERY_PREFIX = "plk-practice-delivery:";

function rememberPracticeDelivery(orderId: string, configured: boolean) {
  try {
    window.sessionStorage.setItem(PRACTICE_DELIVERY_PREFIX + orderId, configured ? "1" : "0");
  } catch { /* storage unavailable — falls back to the "we don't know" copy */ }
}

/** `true` / `false` when this session started the run; `null` when we never saw it. */
export function practiceDeliveryKnown(orderId: string): boolean | null {
  try {
    const raw = window.sessionStorage.getItem(PRACTICE_DELIVERY_PREFIX + orderId);
    return raw === null ? null : raw === "1";
  } catch {
    return null;
  }
}

/**
 * The address a practice order's finished file should be emailed to.
 *
 * The signed-in user's own inbox is the answer that needs nobody else's cooperation,
 * which is the whole point of the practice run. Empty string when Clerk has no email
 * for the session (QA bypass, mock mode) — callers must SHOW the address next to the
 * CTA so nobody's mail is sent to an address they never read.
 */
export function usePracticeOrderEmail(): string {
  const { user } = useUser();
  return user?.primaryEmailAddress?.emailAddress ?? "";
}

export interface UseSampleOrderResult {
  /**
   * Start the practice run. No-op while a run is already pending.
   *
   * @param deliverTo where the finished supplier-ready file should be emailed when
   * the user presses send — normally their own address. Omitting it still produces a
   * practice order; it just stops at "no delivery is set up", as it did before WP-27.
   */
  runSample: (deliverTo?: string) => void;
  isPending: boolean;
  /** Last failure, for inline display. Cleared on the next runSample(). */
  error: Error | null;
}

export function useSampleOrder(fromRoute: string): UseSampleOrderResult {
  const router = useRouter();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (deliverTo?: string) => {
      // Existing analytics event — fired at start, mirroring the original
      // UploadWorkbench handleSample semantics (started, not succeeded).
      // The address itself is never captured; only whether one was supplied.
      capture("sample_order_started", { from_route: fromRoute, with_delivery: Boolean(deliverTo) });
      return apiClient.runSampleOrder(deliverTo);
    },
    onSuccess: async ({ orderId, deliveryConfigured }) => {
      rememberPracticeDelivery(orderId, deliveryConfigured);
      await Promise.all([
        invalidateOnboardingStatus(queryClient),
        queryClient.invalidateQueries({ queryKey: ["orders"] }),
      ]);
      router.push(`/inbox/${encodeURIComponent(orderId)}`);
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
    runSample: (deliverTo?: string) => {
      if (!mutation.isPending) mutation.mutate(deliverTo);
    },
    isPending: mutation.isPending,
    error: mutation.error,
  };
}
