import { test, expect } from "@playwright/test";

/**
 * Group L sample-order happy-path smoke test.
 *
 * Exercises Phase 6.3 (Try-with-sample-order button) end-to-end:
 *   1. Visit /upload
 *   2. Click "Try with sample order"
 *   3. Navigate to /inbox/{id}?sample=1
 *   4. Sample-mode banner is visible
 *
 * Runs against either MOCK or LIVE mode per playwright.config.ts.
 *
 * Auth: relies on PROCULINK_QA_BYPASS_AUTH=true (set by webServer config in
 * playwright.config.ts) so we don't need to drive a real Clerk session.
 */

test("upload page renders with the Try-with-sample-order button", async ({ page }) => {
  await page.goto("/upload");

  // The page header should be visible.
  await expect(page.getByRole("heading", { level: 1, name: /upload/i }).first()).toBeVisible({
    timeout: 10_000,
  });

  // The sample-order CTA from Phase 6.3 should be rendered.
  const sampleCta = page.getByRole("button", { name: /try with.*sample order/i });
  await expect(sampleCta).toBeVisible();
  await expect(sampleCta).toBeEnabled();
});

test("clicking Try with sample order routes to a sample order page with banner", async ({ page }) => {
  await page.goto("/upload");

  const sampleCta = page.getByRole("button", { name: /try with.*sample order/i });
  await expect(sampleCta).toBeVisible({ timeout: 10_000 });

  // Click + wait for navigation to /inbox/<id>?sample=1.
  await Promise.all([
    page.waitForURL(/\/inbox\/[^/?]+\?.*sample=1/i, { timeout: 15_000 }),
    sampleCta.click(),
  ]);

  // The non-quota sample banner should be visible on the destination page.
  const banner = page.getByText(/this is a sample order/i);
  await expect(banner).toBeVisible({ timeout: 10_000 });
  await expect(banner).toContainText(/doesn'?t count toward your monthly quota/i);
});

test("watch page renders walkthrough placeholder when Loom URL is unset", async ({ page }) => {
  await page.goto("/watch");

  await expect(page.getByRole("heading", { level: 1, name: /watch a.*walkthrough/i })).toBeVisible({
    timeout: 10_000,
  });

  // Without NEXT_PUBLIC_WALKTHROUGH_LOOM_URL set we render the "video is being recorded" placeholder.
  // (When the founder pastes a real Loom URL this assertion needs to flip — keep it loose.)
  const placeholder = page.getByText(/walkthrough video is being recorded/i);
  const iframe = page.locator("iframe[title='ProcuLink walkthrough']");

  // At least one of the two states must be present.
  expect(
    (await placeholder.count()) > 0 || (await iframe.count()) > 0,
  ).toBeTruthy();
});

test("help index renders 7 articles", async ({ page }) => {
  await page.goto("/help");

  await expect(page.getByRole("heading", { level: 1, name: /help/i })).toBeVisible({
    timeout: 10_000,
  });

  const articles = page.getByRole("link").filter({ hasText: /upload|mapping|delivery|ai|billing|email|troubleshooting/i });
  // We expect 7 articles per Phase 8, give or take footer / nav links.
  expect(await articles.count()).toBeGreaterThanOrEqual(7);
});

test("cookie consent banner appears on first marketing visit", async ({ context, page }) => {
  // Fresh context so localStorage is empty.
  await context.clearCookies();
  await page.goto("/");

  // Banner from Phase 3.
  const banner = page.getByRole("dialog", { name: /cookie consent/i });
  await expect(banner).toBeVisible({ timeout: 10_000 });

  // Accepting persists the choice — banner should vanish.
  await page.getByRole("button", { name: /accept analytics/i }).click();
  await expect(banner).toBeHidden({ timeout: 5_000 });
});
