import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import createMDX from "@next/mdx";
import remarkGfm from "remark-gfm";
import { cspModeFromEnv, securityHeaders } from "./src/lib/security/csp";
import { RETIRED_ROUTE_REDIRECTS } from "./src/lib/retired-routes";

// remark-gfm is what makes `| a | b |` a real <table>. Without it MDX parses
// only CommonMark, and every pipe table in the help centre — the format-support
// matrix on /help/output-templates, every field table in a guide — rendered as
// a paragraph of literal `|---|---|` text. Tables are the main tool these pages
// use to state what is and is not supported, so this is a correctness fix, not
// a styling one. GFM also brings strikethrough, task lists, footnotes, and bare
// URL autolinking; none of those change how existing copy reads.
const withMDX = createMDX({
  extension: /\.mdx?$/,
  options: { remarkPlugins: [remarkGfm] },
});

const nextConfig: NextConfig = {
  pageExtensions: ["ts", "tsx", "mdx"],
  // The dev-server overlay is a fixed-position element in the bottom corner. At
  // 390 and 768 it sits exactly on top of the cookie banner's Reject button, and
  // Playwright reports `<nextjs-portal> intercepts pointer events` — so the
  // first-run journey could not run at either width, while passing at 1280 where
  // the banner is wide enough to clear it.
  //
  // Suppressed ONLY under the Playwright QA bypass, which is `next dev` in a test
  // run and nothing else: the flag is already the switch that opts this process
  // into test behaviour, and NODE_ENV keeps it out of production builds. Not a
  // blanket disable — a developer running `bun run dev` still gets the overlay.
  ...(process.env.PROCULINK_QA_BYPASS_AUTH === "true" ? { devIndicators: { position: "top-right" as const } } : {}),
  // Tree-shake the lucide-react icon barrel into per-icon imports so a route
  // that uses a handful of icons doesn't pull the whole set into its bundle.
  // Zero behavior change — Next rewrites the imports at build time.
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
  // API lives on a separate origin — no rewrites needed.
  //
  // Security headers on every response. HSTS is applied by the Vercel edge; the
  // rest — including the full Content-Security-Policy — is built in
  // src/lib/security/csp.ts from the same env vars the browser code reads, so
  // the allowlist cannot drift from the hosts we actually talk to.
  //
  // CSP_MODE controls enforcement and defaults to report-only: the full policy
  // ships as Content-Security-Policy-Report-Only (violations go to Sentry via
  // the DSN's security endpoint) while a small enforced policy keeps the
  // frame-ancestors / base-uri / object-src guarantees we already had. Flip
  // CSP_MODE=enforce in the Vercel project once the reports are quiet.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders({
          mode: cspModeFromEnv(process.env.CSP_MODE),
          isDev: process.env.NODE_ENV !== "production",
          apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL,
          clerkPublishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
          posthogHost: process.env.NEXT_PUBLIC_POSTHOG_HOST,
          sentryDsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
          mediaUrls: [
            process.env.NEXT_PUBLIC_WALKTHROUGH_VIDEO_URL,
            process.env.NEXT_PUBLIC_WALKTHROUGH_VIDEO_POSTER,
          ],
          vercelEnv: process.env.VERCEL_ENV,
        }),
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
      // Retired when the step-by-step guides landed. Both articles were
      // procedures that a guide now carries better, so the URLs point at the
      // procedure rather than at a shorter duplicate of it:
      //   first-upload  → the end-to-end guide it was a summary of.
      //   email-polling → imap-provider-setup, which absorbed its unique
      //                   content (cadence, ingested types, failure alerting).
      { source: "/help/first-upload",  destination: "/help/guides/first-order-end-to-end", permanent: true },
      { source: "/help/email-polling", destination: "/help/imap-provider-setup",           permanent: true },
      // Retired app screens. Each pairing (and the reason for it) lives in
      // src/lib/retired-routes.ts, which is also what the retirement gate reads —
      // so a deletion and its redirect cannot drift apart.
      ...RETIRED_ROUTE_REDIRECTS,
    ];
  },
};

const configWithMdx = withMDX(nextConfig);

// Only wrap with Sentry in production. The @sentry/nextjs SDK 8.x has a known
// issue with Next.js 15.5.18 dev mode where it expects routes-manifest.json
// (a production-only file), producing ENOENT 500s on every dev request.
export default process.env.NODE_ENV === "production"
  ? withSentryConfig(configWithMdx, {
      // Stay quiet when there is no token (nothing to upload, nothing to say),
      // but LOG when there is one: a silent plugin is how a broken source-map
      // upload goes unnoticed — production JS frames were still minified
      // (`app:///_next/static/chunks/*.js:1`) with no error anywhere in the
      // Vercel build log.
      silent: !process.env.SENTRY_AUTH_TOKEN,
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
