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
  test.setTimeout(60_000); // cold-compile of /inbox/[orderId] under full-suite CI load can exceed the 30s default
  await page.goto("/upload");

  const sampleCta = page.getByRole("button", { name: /try with.*sample order/i });
  await expect(sampleCta).toBeVisible({ timeout: 10_000 });

  // Click + wait for navigation to /inbox/<id>?sample=1.
  // Generous timeout: in CI mock mode the webServer is `next dev`, which
  // cold-compiles the /inbox/[orderId] route on first navigation. Under
  // full-suite load (single worker) that compile plus the mock's ~800ms
  // sample-create delay can exceed a tight 15s budget intermittently.
  // The click can land before the next-dev page finishes hydrating (cold-compile,
  // worse when the backend stack runs on the same machine), silently dropping the
  // React handler. Retry click+wait until the navigation actually sticks.
  await expect(async () => {
    await sampleCta.click();
    await page.waitForURL(/\/inbox\/[^/?]+\?.*sample=1/i, { timeout: 8_000 });
  }).toPass({ timeout: 45_000, intervals: [500, 1000, 2000] });

  // The non-quota sample banner should be visible on the destination page.
  // The banner copy reads: "Practice order — free, doesn't count against your plan…"
  // Use the aria role="note" container so we match the whole banner text, not just
  // the <strong> inner element (which only contains "Practice order").
  const banner = page.getByRole("note", { name: /practice order/i });
  await expect(banner).toBeVisible({ timeout: 15_000 });
  await expect(banner).toContainText(/free/i);
  await expect(banner).toContainText(/doesn'?t count against your plan/i);
});

test("watch page renders the walkthrough video player", async ({ page }) => {
  await page.goto("/watch");

  await expect(page.getByRole("heading", { level: 1, name: /watch the walkthrough/i })).toBeVisible({
    timeout: 10_000,
  });

  // /watch shows an HTML5 <video> when NEXT_PUBLIC_WALKTHROUGH_VIDEO_URL is set
  // (the committed .env points it at the R2 walkthrough), falling back to a Loom
  // iframe, then a quiet placeholder. Assert one of those states is present so the
  // test stays green regardless of which env vars are configured.
  const video = page.locator("video");
  const iframe = page.locator("iframe[title='ProcuLink walkthrough']");
  const placeholder = page.getByText(/walkthrough is coming shortly/i);

  expect(
    (await video.count()) > 0 || (await iframe.count()) > 0 || (await placeholder.count()) > 0,
  ).toBeTruthy();
});

test("help index renders the browse-by-topic categories and popular articles", async ({ page }) => {
  await page.goto("/help");

  // Redesigned help center: hero is "How can we help?" (still the page h1).
  await expect(page.getByRole("heading", { level: 1, name: /how can we help/i })).toBeVisible({
    timeout: 10_000,
  });

  // The default (non-search) view is a browse-by-topic grid: one card per
  // category that has at least one published article. Categories are <button>s
  // (they filter the index in place), each carrying a category heading and an
  // "N articles" count. Assert the full set of topic categories renders — this
  // is the real article-surfacing structure (17 articles across 8 categories),
  // replacing the old brittle "count keyword-matching links" assertion that
  // assumed a flat link list.
  const topicGrid = page.getByRole("heading", { level: 2, name: /browse help topics/i });
  await expect(topicGrid).toBeAttached();

  for (const category of [
    "Getting started",
    "Connections",
    "Mapping",
    "Delivery",
    "Integrations",
    "AI",
    "Billing",
    "Troubleshooting",
  ]) {
    await expect(
      page.getByRole("heading", { level: 3, name: new RegExp(`^${category}$`, "i") }),
    ).toBeVisible();
  }

  // The category cards advertise an article count each; the totals across all
  // visible cards must add up to the full registry (17 articles). Assert at
  // least 8 "N article(s)" counters are present (one per category).
  const countLabels = page.getByText(/^\d+ articles?$/);
  expect(await countLabels.count()).toBeGreaterThanOrEqual(8);

  // The "Popular articles" rail renders real article links (not dead controls).
  const popularLinks = page.getByRole("link").filter({ hasText: /first purchase order upload/i });
  await expect(popularLinks.first()).toBeVisible();
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
