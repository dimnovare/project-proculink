/**
 * Thin helpers around @sentry/nextjs for setting context that future errors
 * arrive with. Only fires in production (matches instrumentation-client.ts).
 *
 * Why this exists: the wizard, sample-order CTA, and contact form all catch
 * fetch errors and convert them to UI notices. Without explicit captureException
 * calls those errors never reach Sentry. These helpers make it a one-liner.
 *
 * The SDK is loaded LAZILY via dynamic import(). A module-scope
 * `import * as Sentry from "@sentry/nextjs"` pulled the whole ~122 KB SDK into
 * the first-load JS of every route that imports these helpers (the marketing
 * support / book-demo forms + the (app) error boundary). Every helper is
 * fire-and-forget (void, no return value), so deferring the SDK fetch until the
 * first real call — and letting the shared async chunk resolve — is functionally
 * transparent. Same pattern as the PostHog lazy-load in src/lib/analytics.ts.
 */

import type * as SentryType from "@sentry/nextjs";

const isSentryActive =
  typeof window !== "undefined"
  && process.env.NODE_ENV === "production"
  && Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN);

let sentryPromise: Promise<typeof SentryType> | null = null;

/**
 * Fetch the @sentry/nextjs chunk on first use (deduped — webpack resolves this
 * and instrumentation-client.ts's dynamic import to the same async chunk).
 * Returns null outside production so the SDK is never fetched in dev/mock/CI.
 */
function loadSentry(): Promise<typeof SentryType> | null {
  if (!isSentryActive) return null;
  if (!sentryPromise) sentryPromise = import("@sentry/nextjs");
  return sentryPromise;
}

/** Set a tag for the current scope. No-op outside production. */
export function setTag(key: string, value: string | number | boolean): void {
  void loadSentry()?.then((Sentry) => Sentry.setTag(key, value));
}

/** Add a breadcrumb visible on the next error. No-op outside production. */
export function addBreadcrumb(message: string, data?: Record<string, unknown>): void {
  void loadSentry()?.then((Sentry) =>
    Sentry.addBreadcrumb({
      category: "ui",
      message,
      level: "info",
      data,
    }),
  );
}

/**
 * Capture an exception with optional extra tags + context. Useful in catch
 * blocks where we swallow the error into a UI notice — without this call the
 * error never reaches Sentry.
 */
export function captureException(
  error: unknown,
  context?: { tags?: Record<string, string>; extra?: Record<string, unknown> },
): void {
  void loadSentry()?.then((Sentry) => {
    Sentry.withScope((scope) => {
      if (context?.tags) {
        for (const [k, v] of Object.entries(context.tags)) scope.setTag(k, v);
      }
      if (context?.extra) {
        for (const [k, v] of Object.entries(context.extra)) scope.setExtra(k, v);
      }
      Sentry.captureException(error);
    });
  });
}
