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
