import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import createMDX from "@next/mdx";

const withMDX = createMDX({ extension: /\.mdx?$/ });

const nextConfig: NextConfig = {
  pageExtensions: ["ts", "tsx", "mdx"],
  // API lives on a separate origin — no rewrites needed
  // Baseline security headers on every response. HSTS is already applied by the
  // Vercel edge, so we add the remaining hardening headers here. A full
  // Content-Security-Policy (script/style allowlist compatible with Clerk +
  // Next's inline runtime) is intentionally deferred — it needs careful testing
  // against the Clerk SDK to avoid breaking auth, so it is tracked separately.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
          },
          // Anti-clickjacking via CSP — the modern equivalent of the
          // X-Frame-Options above, kept in sync with it (same-origin only).
          // A full script/style/connect CSP stays deferred (needs careful
          // testing against Clerk/Stripe/PostHog/Sentry).
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
        ],
      },
    ];
  },
  async redirects() {
    return [
      // Keep one public origin for search engines, auth callbacks, and shared
      // links. The sitemap and metadata use the apex domain, so www must not
      // serve a second copy of the site.
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.proculink.eu" }],
        destination: "https://proculink.eu/:path*",
        permanent: true,
      },
      // Orphan legacy views (older `src/views/*`) — collapse them onto the
      // canonical Bridge-design routes so any bookmarked or typed old URL
      // ends up at the same place the sidebar links to.
      { source: "/dashboard",        destination: "/bridge",            permanent: true },
      { source: "/mappings",         destination: "/library/mappings",  permanent: true },
      { source: "/suppliers",        destination: "/library/suppliers", permanent: true },
      { source: "/orders",           destination: "/inbox",             permanent: true },
      { source: "/orders/:id",       destination: "/inbox/:id",         permanent: true },
      // Help-article consolidation: delivery-config was deleted (it carried a
      // false claim about a test-fire gate); its true content was merged into
      // delivery-setup, which is now the single delivery article.
      { source: "/help/delivery-config", destination: "/help/delivery-setup", permanent: true },
    ];
  },
};

const configWithMdx = withMDX(nextConfig);

// Only wrap with Sentry in production. The @sentry/nextjs SDK 8.x has a known
// issue with Next.js 15.5.18 dev mode where it expects routes-manifest.json
// (a production-only file), producing ENOENT 500s on every dev request.
export default process.env.NODE_ENV === "production"
  ? withSentryConfig(configWithMdx, {
      // Only upload source maps when SENTRY_AUTH_TOKEN is set (CI/prod)
      silent: true,
      telemetry: false,
      // Strip dead Sentry code from the client bundle. Session Replay is NOT
      // registered in sentry.client.config.ts (no replayIntegration()), so the
      // replay excludes are guaranteed no-ops functionally; debug statements
      // are the SDK's internal logger, unused in production. Tracing is kept —
      // tracesSampleRate: 0.1 is live functionality.
      bundleSizeOptimizations: {
        excludeDebugStatements: true,
        excludeReplayIframe: true,
        excludeReplayShadowDom: true,
        excludeReplayWorker: true,
      },
    })
  : configWithMdx;
