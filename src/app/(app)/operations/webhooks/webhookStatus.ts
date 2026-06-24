// Pure helper for the Webhooks monitor — split out for unit testing (vitest),
// mirroring the inboxSend.ts pattern. Kept free of React / next / api-client
// imports so the test can import it in a plain node environment.

export type WebhookStatus = "healthy" | "failing" | "paused";

/**
 * Derive the endpoint pill status from the DTO's `isActive` + `failureCount`.
 * Mirrors the Settings page (src/app/(app)/settings/page.tsx) exactly. The
 * backend auto-deactivates an endpoint after 3 consecutive failures, so:
 *   • !isActive               → "paused"  (operator-disabled OR auto-killed — off, not benign)
 *   • isActive & failures>0   → "failing" (red — recent failures, NOT healthy)
 *   • isActive & failures==0  → "healthy"
 *
 * The old mapper derived status from `isActive` alone and DROPPED failureCount,
 * so every active endpoint read "Healthy" even while it was failing every
 * delivery (and an auto-killed endpoint never surfaced as a problem).
 */
export function deriveWebhookStatus(
  isActive: boolean,
  failureCount: number,
): WebhookStatus {
  if (!isActive) return "paused";
  return failureCount > 0 ? "failing" : "healthy";
}
