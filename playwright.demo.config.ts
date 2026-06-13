import { defineConfig, devices } from "@playwright/test";

/**
 * Isolated config for recording the walkthrough video.
 *
 * Separate from playwright.config.ts so the capture (a ~2-minute screen
 * recording, NOT a test) never runs as part of `bun run test:e2e`. It lives
 * under scripts/demo-video/, runs in MOCK mode on a dedicated port (8090) to
 * avoid colliding with a dev server on 8082, and records 1080p video.
 *
 *   bun run demo:capture
 *
 * Output webm lands under scripts/demo-video/out/capture/ and the newest one is
 * picked up by the assembler.
 */

const PORT = process.env.DEMO_PORT ?? "8090";

export default defineConfig({
  testDir: "./scripts/demo-video",
  testMatch: /capture\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  timeout: 300_000,
  outputDir: "./scripts/demo-video/out/capture",

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`,
    viewport: { width: 1920, height: 1080 },
    video: { mode: "on", size: { width: 1920, height: 1080 } },
    trace: "off",
    screenshot: "off",
    // Bound every action so a bad selector can never hang the whole take —
    // a missed element throws in 8s and the fail-soft wrapper moves on.
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
    reuseExistingServer: !process.env.CI,
    env: {
      PROCULINK_QA_BYPASS_AUTH: "true",
      NEXT_PUBLIC_USE_MOCK: "true",
      NEXT_PUBLIC_API_BASE_URL: process.env.PLAYWRIGHT_API_URL ?? "http://localhost:5223",
      // Without a Clerk publishable key, @clerk/nextjs v7 enters "keyless" dev
      // mode and paints "Organizations feature required" / "Configure your
      // application" popups over the UI, which block + corrupt the capture
      // (a ~66s hang at the validate step). Same placeholder-key trick as CI
      // and the tools capture config.
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_ci_placeholder_not_real",
    },
  },
});
