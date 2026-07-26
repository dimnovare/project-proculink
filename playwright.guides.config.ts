import { defineConfig } from "@playwright/test";

/**
 * Screenshot rig for the step-by-step guides.
 *
 * Modelled on playwright.demo.config.ts (the capture setup that is known to
 * work on the founder's machine): a mock-mode dev server with the auth bypass
 * on, one worker, srgb colour profile, scrollbars hidden.
 *
 * Differences from the demo rig: no video, a smaller viewport (guide images are
 * rendered at ~720 CSS px in the prose column, so a 1180-wide capture at
 * deviceScaleFactor 2 is sharp without being enormous), and output goes to
 * public/guides/ as committed PNGs rather than to a gitignored scratch dir.
 *
 *   bun run guides:capture
 *
 * Port 8103 matches the `proculink-mock-8103` launch entry, so a capture run
 * does not collide with a dev server on 8082 or the demo rig on 8090.
 */

const PORT = process.env.GUIDES_PORT ?? "8103";
const HOST = "127.0.0.1";

export default defineConfig({
  testDir: "./scripts/guide-shots",
  testMatch: /capture\.spec\.ts/,
  timeout: 300_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  outputDir: "./scripts/guide-shots/.playwright",
  use: {
    baseURL: `http://${HOST}:${PORT}`,
    viewport: { width: 1180, height: 820 },
    deviceScaleFactor: 2,
    actionTimeout: 15_000,
    navigationTimeout: 90_000,
    launchOptions: {
      args: ["--force-color-profile=srgb", "--hide-scrollbars"],
    },
  },
  webServer: {
    command: `bun run next dev --hostname ${HOST} --port ${PORT}`,
    url: `http://${HOST}:${PORT}/help/guides`,
    reuseExistingServer: true,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      NEXT_PUBLIC_USE_MOCK: "true",
      PROCULINK_QA_BYPASS_AUTH: "true",
      NEXT_PUBLIC_QA_BYPASS_AUTH: "true",
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_ci_placeholder_not_real",
      NEXT_PUBLIC_CLERK_KEYLESS_DISABLED: "true",
    },
  },
});
