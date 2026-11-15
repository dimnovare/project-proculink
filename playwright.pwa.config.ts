import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright against a local PRODUCTION build (`next build`, then `next start`).
 *
 * A separate config for the same reason as playwright.prod.config.ts: the main config's
 * `webServer` starts `next dev` with the QA bypass and the mock API. The service worker is
 * registered only by a production build (src/lib/pwa/worker.ts), so nothing in that suite can
 * see it. Here there is no webServer block: tests/pwa/installed-app.spec.ts starts and stops
 * `next start` itself, because one of its tests stops the server mid-test to prove the
 * offline page.
 *
 * Run:
 *   bun run build
 *   bun run test:pwa            # PWA_PORT overrides 8085
 */

const PORT = process.env.PWA_PORT ?? "8085";

export default defineConfig({
  testDir: "./tests/pwa",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  // Serial: the tests share one server, and one of them stops it.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [["github"], ["list"], ["html", { open: "never", outputFolder: "playwright-report-pwa" }]]
    : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
