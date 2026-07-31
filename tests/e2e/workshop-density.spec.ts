import { test, expect } from "@playwright/test";

/**
 * WP-28 · DB-4 — Order Workshop density.
 *
 * ACCEPTANCE, verbatim: "order data begins within 160 px of the content top at
 * 1440 px; issue count is visible without a click."
 *
 * THIS TEST MEASURES. It runs a real Chromium at a real 1440×900 viewport and
 * reads `getBoundingClientRect()` off the live DOM. A jsdom test could not do
 * this job: jsdom performs no layout, so every rect is zeros and an assertion
 * against 160 would pass no matter what the page looked like. A mock-mode
 * workshop route IS reachable (tests/e2e/upload-to-workshop.spec.ts already
 * drives /inbox/ord-002), so there is no reason to accept the weaker guard.
 *
 * The number moves if the layout moves: put a band back above the columns,
 * un-delete the orientation helper, or grow either of the two kept bands, and
 * the delta grows past 160.
 *
 * Mode: NEXT_PUBLIC_USE_MOCK=true + PROCULINK_QA_BYPASS_AUTH=true (webServer env
 * in playwright.config.ts). `ord-002` is the seeded ElectroSupply Co order:
 * 4 lines, 2 resolved, 2 carrying pending AI suggestions → 2 open issues, so it
 * exercises the "issues are open" branch of both assertions.
 */

const DESKTOP = { width: 1440, height: 900 };

/** The vertical budget the brief sets for everything above the three columns. */
const MAX_OFFSET_PX = 160;

test.use({ viewport: DESKTOP });

test.beforeEach(async ({ page }) => {
  // The cookie banner is a fixed bottom overlay; pre-decide it so it can never
  // intercept a click or shift the measured layout.
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("proculink_cookie_consent_v1", "functional-only");
      // The mapper's orientation helper is dismissible AND remembered, so a
      // developer who dismissed it once would measure a passing layout on a
      // failing build. Clear the flag: this test must see what a NEW operator
      // sees on their first order.
      window.localStorage.removeItem("plk-mapper-orient-seen");
      // useWorkshopLayout persists focus; start from the default three-zone view.
      window.sessionStorage.removeItem("plk-workshop-layout");
    } catch {
      /* private mode — the defaults are the same */
    }
  });
});

/**
 * Measure the gap between the top of the workshop's content container and the
 * top of the three-column grid (the first order data on the screen), plus the
 * bands stacked in between.
 */
async function measure(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const root = document.querySelector('[data-testid="order-workshop"]') as HTMLElement | null;
    if (!root) throw new Error("workshop root not rendered");
    const canvas = document.querySelector("[data-mapper-canvas]") as HTMLElement | null;
    if (!canvas) throw new Error("three-column canvas not rendered");
    // The canvas is the received|output inner wrap; its parent is the outer
    // three-column grid (received | output | preview).
    const grid = canvas.parentElement as HTMLElement;
    const rootTop = root.getBoundingClientRect().top;

    // Every element that occupies vertical space above the grid, at any depth,
    // reported as a flat band list. Walk down from the root, stopping at the
    // grid — anything wholly above it and taller than a hairline is a band.
    const bands: { text: string; height: number }[] = [];
    const gridTop = grid.getBoundingClientRect().top;
    const walk = (el: HTMLElement) => {
      for (const child of Array.from(el.children) as HTMLElement[]) {
        if (child === grid || child.contains(grid)) {
          if (child !== grid) walk(child);
          continue;
        }
        const r = child.getBoundingClientRect();
        if (r.height <= 2 || r.bottom > gridTop) continue;
        bands.push({
          text: (child.innerText || "").replace(/\s+/g, " ").trim().slice(0, 60),
          height: Math.round(r.height),
        });
      }
    };
    walk(root);

    return { offset: Math.round(gridTop - rootTop), bands };
  });
}

test("order data begins within 160px of the content top at 1440px", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/inbox/ord-002");
  await expect(page.getByTestId("order-workshop")).toBeVisible({ timeout: 30_000 });
  // The three columns render once the mapper model resolves.
  await page.waitForSelector("[data-mapper-canvas]", { timeout: 30_000 });
  // Let the preview/suggestion queries settle so no late band appears after the read.
  await page.waitForTimeout(2_500);

  const { offset, bands } = await measure(page);
  const detail = bands.map((b) => `${b.height}px  ${b.text}`).join("\n");
  // Report the measurement even on success — a passing number that is drifting
  // toward the budget is worth seeing in CI before it crosses it.
  test.info().annotations.push({ type: "measured", description: `${offset}px / ${MAX_OFFSET_PX}px budget` });
  // eslint-disable-next-line no-console
  console.log(`[WP-28] order data begins ${offset}px below the content top (budget ${MAX_OFFSET_PX}px)\n${detail}`);

  expect(
    offset,
    `Order data starts ${offset}px below the content top (budget ${MAX_OFFSET_PX}px).\n` +
      `Bands above the three columns:\n${detail}`,
  ).toBeLessThanOrEqual(MAX_OFFSET_PX);
});

test("at most two chrome bands render above the three columns", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/inbox/ord-002");
  await expect(page.getByTestId("order-workshop")).toBeVisible({ timeout: 30_000 });
  await page.waitForSelector("[data-mapper-canvas]", { timeout: 30_000 });
  await page.waitForTimeout(2_500);

  const { bands } = await measure(page);
  const detail = bands.map((b) => `${b.height}px  ${b.text}`).join("\n");

  expect(bands.length, `Bands above the three columns:\n${detail}`).toBeLessThanOrEqual(2);
});

test("the issue count is visible without a click", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/inbox/ord-002");
  await expect(page.getByTestId("order-workshop")).toBeVisible({ timeout: 30_000 });
  await page.waitForSelector("[data-mapper-canvas]", { timeout: 30_000 });

  // NOTHING is clicked in this test. The issue list used to be the "Issues" tab
  // of the third column; it is now an always-rendered region of that column.
  const head = page.getByTestId("issues-column-head");
  await expect(head).toBeVisible({ timeout: 20_000 });
  await expect(head).toContainText("Issues");
  // ord-002 seeds two unresolved AI-suggested lines → two open issues.
  await expect(head.getByTestId("issues-column-count")).toHaveText("2");

  // And the list itself — the cards, not just a badge — is on screen.
  await expect(page.getByTestId("issues-panel")).toBeVisible();
  await expect(page.getByTestId("issues-panel")).toHaveAttribute("data-issues", "2");
});
