import { defineConfig, devices } from "@playwright/test";

/**
 * ProcuLink Playwright config — focused on local smoke tests.
 *
 * Two modes:
 *  - MOCK mode (default in CI): NEXT_PUBLIC_USE_MOCK=true exercises the in-memory
 *    api-client mock so no backend is required.
 *  - LIVE mode: requires the backend stack (Postgres + Api + Worker) to be running
 *    per ProcuLink/README.md. Set PLAYWRIGHT_LIVE=1 to opt in.
 *
 * Auth: PROCULINK_QA_BYPASS_AUTH=true (set in webServer env below) lets Playwright
 * exercise (app) routes without a real Clerk session. Never used in production.
 *
 * Usage:
 *   bun run test:e2e         # mock mode
 *   bun run test:e2e:live    # live mode against running backend
 *   bun run test:e2e:ui      # interactive UI mode
 */

const isLive = process.env.PLAYWRIGHT_LIVE === "1";

export default defineConfig({
  testDir: "./tests/e2e",
  // Warm /upload and the other heavy routes before the suite so the first test
  // that hits them doesn't eat the Next dev cold-compile and flake.
  globalSetup: "./tests/e2e/global-setup.ts",
  // Generous default assertion timeout — single-worker CI under load is slow.
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8082",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: process.env.CI ? "off" : "retain-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: {
    command: isLive ? "bun run dev" : "bun run dev",
    url: "http://localhost:8082",
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    env: {
      PROCULINK_QA_BYPASS_AUTH: "true",
      // Browser-visible twin of the backend bypass: lets the Next client enable
      // data queries without a Clerk session (see useQueriesEnabled / isQaBypass).
      // Test-only — never set in production builds.
      NEXT_PUBLIC_QA_BYPASS_AUTH: "true",
      NEXT_PUBLIC_USE_MOCK: isLive ? "false" : "true",
      // When live, point at the locally-running backend. Default falls back to
      // HTTPS dev profile; override with PLAYWRIGHT_API_URL for HTTP.
      NEXT_PUBLIC_API_BASE_URL: process.env.PLAYWRIGHT_API_URL
        ?? (isLive ? "https://localhost:7230" : "http://localhost:5223"),
    },
  },
});
