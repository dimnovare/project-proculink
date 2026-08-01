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

test("watch page renders the walkthrough video player", async ({ page }) => {
  await page.goto("/watch");

  await expect(page.getByRole("heading", { level: 1, name: /watch the walkthrough/i })).toBeVisible({
    timeout: 10_000,
  });

  // /watch shows an HTML5 <video> when NEXT_PUBLIC_WALKTHROUGH_VIDEO_URL is set,
  // falling back to a Loom iframe, then to a "coming shortly" placeholder
  // (src/app/(marketing)/watch/page.tsx).
  //
  // The placeholder is the ABSENCE of a player. Accepting it as a pass — which
  // this test used to do — meant "renders the walkthrough video player" could go
  // green on a page with no player on it, forever. It is asserted away instead.
  // The committed .env sets NEXT_PUBLIC_WALKTHROUGH_VIDEO_URL to the R2
  // walkthrough, so a player is the state this suite runs against; if the
  // placeholder shows up, the env the page was built with is wrong and that is
  // worth failing on.
  const video = page.locator("video");
  const iframe = page.locator("iframe[title='ProcuLink walkthrough']");
  const placeholder = page.getByText(/walkthrough is coming shortly/i);

  await expect(
    placeholder,
    "/watch rendered the no-player placeholder — NEXT_PUBLIC_WALKTHROUGH_VIDEO_URL / _LOOM_URL are unset for this server",
  ).toHaveCount(0);

  // Whichever player it is, name it and assert it carries a real source — an
  // empty <video> or a src-less iframe is a player in markup only.
  if ((await video.count()) > 0) {
    await expect(video.first()).toBeVisible();
    await expect(video.first()).toHaveJSProperty("controls", true);
    const src = await video.first().locator("source").first().getAttribute("src");
    expect(src, "the <video> on /watch has no playable source").toMatch(/^https?:\/\/\S+/i);
  } else {
    await expect(
      iframe.first(),
      "/watch rendered neither a <video> nor the Loom embed",
    ).toBeVisible();
    const src = await iframe.first().getAttribute("src");
    expect(src, "the walkthrough iframe on /watch has no src").toMatch(/^https?:\/\/\S+/i);
  }
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
  // Asserted on the href, not a title: POPULAR_ARTICLE_SLUGS is editorial and its
  // entries get renamed/retired (this pinned "first-upload" until the phase-2 guide
  // pass replaced it with "order-intake-options"). The slug is the contract the rail
  // actually has to honour — a dead control would not carry one.
  const popularLinks = page.locator('a[href^="/help/"]');
  expect(await popularLinks.count()).toBeGreaterThan(0);
  await expect(page.locator('a[href="/help/order-intake-options"]').first()).toBeVisible();
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
