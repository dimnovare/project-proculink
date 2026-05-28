/**
 * Thin helpers around @sentry/nextjs for setting context that future errors
 * arrive with. Only fires in production (matches sentry.client.config.ts).
 *
 * Why this exists: the wizard, sample-order CTA, and contact form all catch
 * fetch errors and convert them to UI notices. Without explicit captureException
 * calls those errors never reach Sentry. These helpers make it a one-liner.
 */

import * as Sentry from "@sentry/nextjs";

const isSentryActive =
  typeof window !== "undefined"
  && process.env.NODE_ENV === "production"
  && Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN);

/** Set a tag for the current scope. No-op outside production. */
export function setTag(key: string, value: string | number | boolean): void {
  if (!isSentryActive) return;
  Sentry.setTag(key, value);
}

/** Add a breadcrumb visible on the next error. No-op outside production. */
export function addBreadcrumb(message: string, data?: Record<string, unknown>): void {
  if (!isSentryActive) return;
  Sentry.addBreadcrumb({
    category: "ui",
    message,
    level: "info",
    data,
  });
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
  if (!isSentryActive) return;
  Sentry.withScope((scope) => {
    if (context?.tags) {
      for (const [k, v] of Object.entries(context.tags)) scope.setTag(k, v);
    }
    if (context?.extra) {
      for (const [k, v] of Object.entries(context.extra)) scope.setExtra(k, v);
    }
    Sentry.captureException(error);
  });
}
