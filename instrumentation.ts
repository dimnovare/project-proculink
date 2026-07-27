import type { Instrumentation } from "next";

export async function register() {
  // Skip Sentry in dev — the SDK reads production-only manifests
  // (routes-manifest.json, prerender-manifest.json) that Next dev doesn't
  // generate, causing ENOENT 500s on every request.
  if (process.env.NODE_ENV !== "production") return;

  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { init } = await import("@sentry/nextjs");
    init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      tracesSampleRate: 0.1,
    });
  }
}

// Without this hook, errors thrown inside nested React Server Components never
// reach Sentry — every production build warned about it ("Could not find
// `onRequestError` hook in instrumentation file"), and the warning was hidden
// because the Sentry plugin ran with silent: true. Same production-only guard
// and lazy import as register() above.
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NODE_ENV !== "production") return;
  const { captureRequestError } = await import("@sentry/nextjs");
  captureRequestError(err, request, context);
};
