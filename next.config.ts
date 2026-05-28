import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  // API lives on a separate origin — no rewrites needed
  async redirects() {
    return [
      // Orphan legacy views (older `src/views/*`) — collapse them onto the
      // canonical Bridge-design routes so any bookmarked or typed old URL
      // ends up at the same place the sidebar links to.
      { source: "/dashboard", destination: "/bridge",            permanent: true },
      { source: "/mappings",  destination: "/library/mappings",  permanent: true },
      { source: "/suppliers", destination: "/library/suppliers", permanent: true },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  // Only upload source maps when SENTRY_AUTH_TOKEN is set (CI/prod)
  silent: true,
  telemetry: false,
});
