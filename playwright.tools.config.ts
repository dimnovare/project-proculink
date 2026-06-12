import { defineConfig, devices } from "@playwright/test";

/**
 * Isolated config for recording the PER-TOOL walkthrough videos
 * (scripts/demo-video/tools/capture-*.spec.ts) — one short video per tab/tool.
 *
 * Separate from playwright.config.ts (test suite) and playwright.demo.config.ts
 * (the original full-walkthrough capture) so tool captures never run as part of
 * `bun run test:e2e`. MOCK mode on the dedicated demo port (8090 — never 8082,
 * which a dev server usually owns), 1080p recordVideo.
 *
 *   bun run demo:tools:capture                 # capture every tool
 *   bun run demo:tools:capture capture-upload  # capture one tool
 *
 * Each spec saves its own footage deterministically to
 * scripts/demo-video/tools/out/<tool>/capture.webm via page.video().saveAs().
 */

const PORT = process.env.DEMO_PORT ?? "8090";

export default defineConfig({
  testDir: "./scripts/demo-video/tools",
  testMatch: /capture-.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  timeout: 420_000,
  outputDir: "./scripts/demo-video/tools/out/.playwright",

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`,
    viewport: { width: 1920, height: 1080 },
    video: { mode: "on", size: { width: 1920, height: 1080 } },
    trace: "off",
    screenshot: "off",
    // Bound every action so a bad selector can never hang a take — a missed
    // element throws in 8s and the fail-soft wrapper moves on.
    actionTimeout: 8_000,
    navigationTimeout: 45_000,
    launchOptions: { args: ["--force-color-profile=srgb", "--hide-scrollbars"] },
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1920, height: 1080 } },
    },
  ],

  webServer: {
    command: "bun run dev:demo",
    url: `http://localhost:${PORT}`,
    timeout: 120_000,
    reuseExistingServer: true,
    env: {
      PROCULINK_QA_BYPASS_AUTH: "true",
      NEXT_PUBLIC_QA_BYPASS_AUTH: "true",
      NEXT_PUBLIC_USE_MOCK: "true",
      NEXT_PUBLIC_API_BASE_URL: process.env.PLAYWRIGHT_API_URL ?? "http://localhost:5223",
      // Placeholder Clerk keys (same trick as CI): with NO key at all,
      // @clerk/nextjs v7 boots its "keyless" dev mode and paints popups over
      // the UI ("Configure your application", "Organizations feature required")
      // — fatal for footage. A syntactically-present-but-unreachable key keeps
      // Clerk quiet; PROCULINK_QA_BYPASS_AUTH bypasses the middleware.
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_ci_placeholder_not_real",
      CLERK_SECRET_KEY: "sk_test_ci_placeholder_not_real",
    },
  },
});
