// Sentry client-side init. The @sentry/nextjs SDK auto-loads this file when
// next.config.ts is wrapped with withSentryConfig (production only — dev is
// skipped via the NODE_ENV check in next.config.ts).
//
// Without this file there is NO browser-side error tracking. The previous
// setup only had instrumentation.ts for nodejs/edge runtimes.

import * as Sentry from "@sentry/nextjs";

if (process.env.NODE_ENV === "production" && process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0.1,
    // Suppress the noisy "ResizeObserver loop limit exceeded" + Clerk SDK
    // transient errors that are not actionable.
    ignoreErrors: [
      "ResizeObserver loop limit exceeded",
      "ResizeObserver loop completed with undelivered notifications",
      "Non-Error promise rejection captured",
      // Clerk transient session refresh errors.
      /clerk.*token/i,
    ],
    beforeSend(event, hint) {
      // Tag fetch failures with the URL the browser was trying to reach.
      // Helps debug CORS / cert / backend-down issues.
      const err = hint?.originalException;
      if (err instanceof TypeError && /failed to fetch|load failed/i.test(err.message)) {
        event.tags = {
          ...event.tags,
          fetch_failure: "true",
          api_base_url: process.env.NEXT_PUBLIC_API_BASE_URL ?? "(unset)",
        };
      }
      return event;
    },
  });
}
