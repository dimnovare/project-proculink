import { defineConfig, devices } from "@playwright/test";

const port = process.env.DEMO_PORT ?? "8090";

export default defineConfig({
  testDir: "./scripts/demo-video/films",
  testMatch: /capture-.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  timeout: 900_000,
  outputDir: "./scripts/demo-video/films/out/.playwright",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`,
    viewport: { width: 1920, height: 1080 },
    video: { mode: "on", size: { width: 1920, height: 1080 } },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 12_000,
    navigationTimeout: 45_000,
    launchOptions: {
      args: ["--force-color-profile=srgb", "--hide-scrollbars"],
    },
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1920, height: 1080 },
      },
    },
  ],
  webServer: {
    command: "bun run dev:demo",
    url: `http://127.0.0.1:${port}`,
    timeout: 120_000,
    reuseExistingServer: true,
    env: {
      PROCULINK_QA_BYPASS_AUTH: "true",
      NEXT_PUBLIC_QA_BYPASS_AUTH: "true",
      NEXT_PUBLIC_USE_MOCK: "true",
      NEXT_PUBLIC_API_BASE_URL:
        process.env.PLAYWRIGHT_API_URL ?? "http://localhost:5223",
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:
        "pk_test_ci_placeholder_not_real",
      CLERK_SECRET_KEY: "sk_test_ci_placeholder_not_real",
    },
  },
});
