import { defineConfig, devices } from "@playwright/test";
import { STORAGE_STATE } from "./tests/prod/disposableIdentity";

/**
 * Playwright against the LIVE production deployment — https://proculink.eu.
 *
 * A separate config, not a project inside playwright.config.ts, for one reason
 * that is not stylistic: that config declares a `webServer` block which starts
 * `next dev` with PROCULINK_QA_BYPASS_AUTH=true and NEXT_PUBLIC_USE_MOCK. Every
 * run of it therefore boots a local app whose auth is bypassed and whose data is
 * a fixture set. Pointing it at production with `PLAYWRIGHT_BASE_URL` would
 * still start that server, and the very flags that make the local suite work are
 * the ones that would make a production result meaningless.
 *
 * So: no webServer, no globalSetup (there is no cold compile to warm — this is a
 * built, deployed bundle), no mock env, and no QA bypass anywhere.
 *
 * Run:
 *   node scripts/prod-smoke/clerk-disposable.mjs provision
 *   bun run test:prod
 *   node scripts/prod-smoke/clerk-disposable.mjs cleanup
 */

const BASE_URL = process.env.PROD_SMOKE_BASE_URL ?? "https://proculink.eu";

export default defineConfig({
  testDir: "./tests/prod",
  // Production is a network away and behind a CDN; local assertion timeouts are
  // tuned for localhost and are too tight here.
  expect: { timeout: 20_000 },
  timeout: 120_000,
  // Serial. The suite shares ONE Clerk session (the sign-in ticket is single-use,
  // so it is redeemed once and reused via storageState); parallel workers would
  // also mean parallel writes from the same disposable org, which is not what
  // this is measuring.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  // One retry. A transient CDN or cold-lambda hiccup should not page anyone at
  // 06:00; a real outage fails both attempts.
  retries: 1,

  // Same reporter set as the main suite, and for the same reason: `github` alone
  // prints only failure annotations, so a run that skipped everything would look
  // identical to a run that passed everything.
  reporter: process.env.CI
    ? [
        ["github"],
        ["list"],
        ["json", { outputFile: "test-results/prod-results.json" }],
        ["html", { open: "never", outputFolder: "playwright-report-prod" }],
      ]
    : "list",

  use: {
    baseURL: BASE_URL,
    // On a scheduled run nobody is watching, so the artifact IS the diagnosis.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },

  projects: [
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "prod",
      testIgnore: /auth\.setup\.ts/,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], storageState: STORAGE_STATE },
    },
  ],
});
