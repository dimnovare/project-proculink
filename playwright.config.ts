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

// Dev-server port. Defaults to the project's 8082 (what CI uses); overridable so two
// git worktrees can run their own suites at once instead of one silently reusing the
// other's server and testing the wrong tree.
const PORT = process.env.PLAYWRIGHT_PORT ?? "8082";
const ORIGIN = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  // Warm /upload and the other heavy routes before the suite so the first test
  // that hits them doesn't eat the Next dev cold-compile and flake.
  globalSetup: "./tests/e2e/global-setup.ts",
  // Generous default assertion timeout — single-worker CI under load is slow.
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // One retry everywhere. CI runs single-worker; local runs many workers against a
  // single `next dev`, so a heavy route's first cold compile can still exceed a
  // tight visibility timeout even after globalSetup warms it. A single retry absorbs
  // that residual cold-compile jitter (a genuine product failure fails both attempts).
  retries: 1,
  workers: process.env.CI ? 1 : undefined,
  // WP-02 — a skip must be LEGIBLE, not silent.
  //
  // CI ran with `reporter: "github"` alone. The GitHub reporter emits file annotations for
  // FAILURES and prints nothing else, and Playwright's runner counts `skipped` as a
  // non-failure — so 31 of 111 tests skipping in the default (mock) run produced a green
  // check and not one line of output saying so. The HTML report was uploaded only on
  // failure, so there was no artifact to go and look at either.
  //
  // Skipping is still not a failure — the declared-condition skips (live-backend gates) are
  // correct by design. It is now merely impossible to miss:
  //   github → failure annotations, as before
  //   list   → one line per test, with SKIPPED shown inline in the job log
  //   json   → machine-readable, consumed by the "Skipped Playwright tests" CI step
  //   html   → a real report to download; the artifact upload is now `if: always()`
  reporter: process.env.CI
    ? [
        ["github"],
        ["list"],
        ["json", { outputFile: "test-results/results.json" }],
        ["html", { open: "never" }],
      ]
    : "list",

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? ORIGIN,
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
    command: `next dev -p ${PORT}`,
    url: ORIGIN,
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
      // In mock/QA mode there is no real Clerk session. Clear the publishable key
      // so ClerkProvider runs in its graceful degraded (no-session) state.
      // CRITICAL: also disable Clerk KEYLESS mode. In `next dev` (development) with
      // no/empty publishable key, @clerk/nextjs auto-provisions a throwaway Clerk
      // app and redirects to its "claim your application" page on any navigation to
      // a protected route — which hijacks router.push and breaks every e2e nav test.
      // NEXT_PUBLIC_CLERK_KEYLESS_DISABLED=true keeps Clerk fully dormant: hooks
      // return safe no-session defaults and the router is NOT patched.
      ...(isLive ? {} : { NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "", NEXT_PUBLIC_CLERK_KEYLESS_DISABLED: "true" }),
    },
  },
});
