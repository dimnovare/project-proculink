import { test, expect, type Page } from "@playwright/test";
import { MOCK_ENGINE_IDS } from "../../src/lib/api/mockEngine";
import { preparePage, settle } from "./a11yHarness";

const sideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const DOCUMENT_URL = `/flows/${MOCK_ENGINE_IDS.flow}/documents/${MOCK_ENGINE_IDS.document}`;

test.describe("app shell", () => {
  test.describe.configure({ timeout: 120_000 });

  test("a 120-character file name wraps inside a 375px screen", async ({ page }) => {
    await preparePage(page, { dismissCookieBanner: true });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(DOCUMENT_URL);
    await settle(page);
    const h1 = page.getByRole("heading", { level: 1 });
    await expect(h1).toBeVisible();
    const before = await sideways(page);
    await h1.evaluate((el) => { el.textContent = `${"x".repeat(116)}.pdf`; });
    expect(await sideways(page), "the long name must not add sideways scroll").toBe(before);
    const box = (await h1.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(375);
  });
});
