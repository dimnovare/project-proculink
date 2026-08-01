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
import { isPracticeDeliveryState, type PracticeDeliveryState } from "@/lib/practiceDelivery";

/**
 * What THIS practice order's send will actually do, remembered per order id.
 *
 * Without it the review screen would promise "we'll email you the finished file" on a
 * deployment that cannot send. It used to store a bool, and that bool could not express
 * the case WP-39 §4.5 found — a supplier that already carries a delivery target this run
 * did not set up, where the screen said "this run will stop" and the send went out anyway.
 * See src/lib/practiceDelivery.ts.
 *
 * Session-scoped: it is a fact about one run, not durable state, and `null` (a bookmark
 * opened later, or a fresh session) is read as "we don't know" — which downgrades the copy
 * to what is always true rather than guessing.
 */
const PRACTICE_DELIVERY_PREFIX = "plk-practice-delivery:";

function rememberPracticeDelivery(orderId: string, state: PracticeDeliveryState | null) {
  try {
    if (state === null) window.sessionStorage.removeItem(PRACTICE_DELIVERY_PREFIX + orderId);
    else window.sessionStorage.setItem(PRACTICE_DELIVERY_PREFIX + orderId, state);
  } catch { /* storage unavailable — falls back to the "we don't know" copy */ }
}

/** The state when this session started the run; `null` when we never saw it. */
export function practiceDeliveryKnown(orderId: string): PracticeDeliveryState | null {
  try {
    const raw = window.sessionStorage.getItem(PRACTICE_DELIVERY_PREFIX + orderId);
    if (raw === null) return null;
    // "1"/"0" are what a tab open across the deploy still holds. Reading them as the two
    // states they meant is strictly better than dropping to "we don't know".
    if (raw === "1") return "emailed_to_you";
    if (raw === "0") return "not_set_up";
    return isPracticeDeliveryState(raw) ? raw : null;
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
    onSuccess: async ({ orderId, practiceDelivery }) => {
      rememberPracticeDelivery(orderId, practiceDelivery);
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
