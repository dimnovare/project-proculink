import { test, expect, type Page } from "@playwright/test";
import { MOCK_ENGINE_IDS } from "../../src/lib/api/mockEngine";
import { preparePage, settle } from "./a11yHarness";

const DOCUMENT_URL = `/flows/${MOCK_ENGINE_IDS.flow}/documents/${MOCK_ENGINE_IDS.document}`;

/** The bar itself: one line high, and no item ending past the screen edge. Measures the bar, not the page under it. */
const barFits = (page: Page) =>
  page.getByTestId("topbar-row").evaluate((row) => ({
    height: row.getBoundingClientRect().height,
    inside: Math.max(...Array.from(row.children, (c) => c.getBoundingClientRect().right)) <= window.innerWidth + 0.5,
  }));

/** Page-level sideways scroll in px, measured the way the control sweep measures it. */
const sideways = (page: Page) =>
  page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth));

test.describe("app shell", () => {
  test.describe.configure({ timeout: 120_000 });

  test("a 120-character file name wraps inside a 375px screen", async ({ page }) => {
    await preparePage(page, { dismissCookieBanner: true });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(DOCUMENT_URL);
    await settle(page);
    const h1 = page.getByRole("heading", { level: 1 });
    await expect(h1).toBeVisible();
    await h1.evaluate((el) => { el.textContent = `${"x".repeat(116)}.pdf`; });
    // The page scrolls inside its own frame, so measure the title itself: a name that does not wrap overflows it.
    expect(await h1.evaluate((el) => el.scrollWidth <= el.clientWidth), "the long name must wrap inside the title").toBe(true);
  });

  test("a full-screen step on a phone has no tab bar and shows the way back", async ({ page }) => {
    await preparePage(page, { dismissCookieBanner: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/documents");
    await expect(page.getByTestId("tab-bar")).toBeVisible();
    // <main> ends where the tab bar begins (1px tolerance), at both phone widths.
    for (const width of [390, 700]) {
      await page.setViewportSize({ width, height: 844 });
      const [m, t] = [(await page.locator("main").boundingBox())!, (await page.getByTestId("tab-bar").boundingBox())!];
      expect(m.y + m.height, `width ${width}`).toBeLessThanOrEqual(t.y + 1);
      const bar = page.getByTestId("tab-bar");
      const targets = [...["Documents", "Flows", "Activity"].map((n) => bar.getByRole("link", { name: new RegExp(`^${n}`) })), bar.getByRole("button", { name: "More" })];
      for (const target of targets) expect((await target.boundingBox())!.height, `tab target height at ${width}`).toBeGreaterThanOrEqual(50);
    }
    await page.goto(DOCUMENT_URL);
    await expect(page.getByRole("link", { name: "Back to Documents" })).toBeVisible();
    await expect(page.getByTestId("tab-bar")).toHaveCount(0);
  });

  test("the top bar is one row at every width, and a 60-character workspace name is cut short, not wrapped", async ({ page }) => {
    await preparePage(page, { dismissCookieBanner: true });
    for (const width of [320, 390, 767, 768, 1023, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/documents");
      await settle(page);
      for (const name of ["as loaded", "N".repeat(60)]) {
        if (name !== "as loaded") await page.getByTestId("workspace-name").evaluate((el, text) => { el.textContent = text; }, name);
        const fit = await barFits(page);
        expect(Math.abs(fit.height - (width < 768 ? 52 : 56)), `row height ${fit.height} at ${width}, name ${name.length} long`).toBeLessThanOrEqual(0.5);
        expect(fit.inside, `every item inside the screen at ${width}, name ${name.length} long`).toBe(true);
      }
      expect(await page.getByTestId("workspace-name").evaluate((el) => el.scrollWidth > el.clientWidth), `long name is cut at ${width}`).toBe(true);
      // The widths the sweep already holds at zero: the bar must not be what breaks them.
      if ([390, 768, 1440].includes(width)) expect(await sideways(page), `sideways scroll at ${width}`).toBe(0);
    }
  });

  test("each width offers exactly one way to move between pages", async ({ page }) => {
    await preparePage(page, { dismissCookieBanner: true });
    const MODES = [[390, "tabs"], [767, "tabs"], [768, "menu"], [1023, "menu"], [1024, "links"], [1440, "links"]] as const;
    for (const [width, mode] of MODES) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/documents");
      await settle(page);
      const shown = {
        tabs: await page.getByTestId("tab-bar").isVisible(),
        menu: await page.getByRole("button", { name: "Open navigation" }).isVisible(),
        links: await page.getByTestId("topbar-nav").isVisible(),
      };
      expect(shown, `at ${width}`).toEqual({ tabs: mode === "tabs", menu: mode === "menu", links: mode === "links" });
    }
  });
});
