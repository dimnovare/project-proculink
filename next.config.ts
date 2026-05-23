import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  // API lives on a separate origin — no rewrites needed
};

export default withSentryConfig(nextConfig, {
  // Only upload source maps when SENTRY_AUTH_TOKEN is set (CI/prod)
  silent: true,
  telemetry: false,
});
