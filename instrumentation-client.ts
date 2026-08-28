// Sentry client-side init — LAZY-LOADED so the ~122 KB @sentry/nextjs SDK is
// code-split OUT of every route's first-load JS.
//
// NEXT LOADS THIS FILE BY NAME. It was `sentry.client.config.ts`, which the
// Sentry SDK injected into the client entry via withSentryConfig; since Next
// 15.3 the framework itself runs `instrumentation-client.ts` on the client, and
// @sentry/nextjs v10 deprecates the old filename in favour of it. The rename is
// the whole migration — the contents below are unchanged, and nothing needs to
// register it. A module-scope
// `import * as Sentry from "@sentry/nextjs"` used to pull the whole SDK into the
// shared first-load chunk of EVERY route — marketing included — ~45% of the
// marketing first-load JS and the top Time-to-Blocking contributor on `/` and
// `/pricing`. The DSN/NODE_ENV guard only skipped `Sentry.init()`; the SDK code
// still shipped.
//
// Replacing the static import with a dynamic `import("@sentry/nextjs")` moves
// the SDK into its own async chunk that is fetched after the browser goes idle
// (or immediately on the first error signal), so it never blocks FCP/LCP/TBT —
// while browser error tracking still works once the chunk arrives a few ms
// post-load. Same proven pattern as the PostHog lazy-load in src/lib/analytics.ts.
//
// The runtime config below (DSN, enabled guard, tracesSampleRate, replay rates,
// ignoreErrors, beforeSend) is UNCHANGED from the previous static init.

if (
  typeof window !== "undefined" &&
  process.env.NODE_ENV === "production" &&
  process.env.NEXT_PUBLIC_SENTRY_DSN
) {
  let booted = false;

  const boot = () => {
    if (booted) return;
    booted = true;

    void import("@sentry/nextjs").then((Sentry) => {
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
    });
  };

  // Defer the SDK fetch until the browser is idle so it never competes with
  // hydration or the LCP paint; fall back to a short timer where
  // requestIdleCallback is unavailable (Safari). Load immediately on the first
  // error / unhandled rejection so anything that throws before the idle boot
  // still starts the SDK (its global handlers then capture subsequent errors).
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(boot, { timeout: 3000 });
  } else {
    window.setTimeout(boot, 2000);
  }
  window.addEventListener("error", boot, { once: true });
  window.addEventListener("unhandledrejection", boot, { once: true });
}
