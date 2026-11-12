import { test, expect } from "@playwright/test";
import {
  CATEGORY_ORDER,
  HELP_ARTICLES,
  POPULAR_ARTICLE_SLUGS,
  getArticleBySlug,
} from "../../src/lib/help-articles";

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

  // WP-27: the CTA now asks where to email the finished file before it starts the
  // run, because a practice order with nowhere to deliver dead-ends at "no delivery
  // is set up" — the thing the packet exists to remove.
  //
  // The click can land before `next dev` finishes hydrating the route, silently
  // dropping the React handler, so retry until the prompt actually opens.
  const addressField = page.getByLabel(/send the finished file to/i);
  await expect(async () => {
    await sampleCta.click();
    await expect(addressField).toBeVisible({ timeout: 4_000 });
  }).toPass({ timeout: 45_000, intervals: [500, 1000, 2000] });
  await addressField.fill("coordinator@northgate.example");

  // Click + wait for navigation to /inbox/<id>. Generous timeout: in CI mock mode the
  // webServer is `next dev`, which cold-compiles the /inbox/[orderId] route on first
  // navigation. The click can also land before hydration finishes, silently dropping
  // the React handler — so retry click+wait until the navigation actually sticks.
  const run = page.getByRole("button", { name: /^run it$/i });
  await expect(async () => {
    await run.click();
    await page.waitForURL(/\/inbox\/[^/?]+/, { timeout: 8_000 });
  }).toPass({ timeout: 45_000, intervals: [500, 1000, 2000] });

  // WP-27: no ?sample=1. The practice framing is driven by the order's own IsSample
  // flag, so it survives a bookmark, the back button, and an inbox row click.
  expect(page.url()).not.toContain("sample=1");

  // The non-quota practice note should be visible on the destination page.
  // WP-28 moved it out of its own chrome band above the three columns and into
  // the Issues column, where the other per-order teaching already lives — the
  // role, the accessible name and the copy are unchanged, so this contract is
  // the same one; only its position moved. Match on the role="note" container
  // rather than the <strong>, which holds only "Practice order".
  // The apostrophe class is widened because the copy now uses the typographic
  // U+2019 rather than U+0027. A test that fails on a curly quote is testing
  // the glyph, not the promise.
  const banner = page.getByRole("note", { name: /practice order/i });
  await expect(banner).toBeVisible({ timeout: 15_000 });
  await expect(banner).toContainText(/free/i);
  await expect(banner).toContainText(/doesn['’]?t count against your plan/i);
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
  // "N articles" count. The expected set is DERIVED from the help registry, never
  // re-typed, so retiring or adding a category cannot leave this test asserting the
  // previous help center.
  const topicGrid = page.getByRole("heading", { level: 2, name: /browse help topics/i });
  await expect(topicGrid).toBeAttached();

  const categories = CATEGORY_ORDER.filter((c) => HELP_ARTICLES.some((a) => a.category === c));
  expect(categories.length).toBeGreaterThan(0);
  for (const category of categories) {
    await expect(
      page.getByRole("heading", { level: 3, name: new RegExp(`^${category}$`, "i") }),
    ).toBeVisible();
  }

  // One "N article(s)" counter per category card.
  const countLabels = page.getByText(/^\d+ articles?$/);
  expect(await countLabels.count()).toBeGreaterThanOrEqual(categories.length);

  // The "Popular articles" rail renders real article links (not dead controls).
  // Asserted on the href of the first popular slug that resolves to a registered
  // article: POPULAR_ARTICLE_SLUGS is editorial and its entries get renamed or retired.
  const popular = POPULAR_ARTICLE_SLUGS.find((slug) => getArticleBySlug(slug));
  expect(popular, "no popular article resolves to a registered article").toBeTruthy();
  await expect(page.locator(`a[href="/help/${popular}"]`).first()).toBeVisible();
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
