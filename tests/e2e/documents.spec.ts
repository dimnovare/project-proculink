import { test, expect } from "@playwright/test";
import { MOCK_ENGINE_IDS } from "../../src/lib/api/mockEngine";
import { preparePage, settle } from "./a11yHarness";

test.describe("documents", () => {
  test.describe.configure({ timeout: 120_000 });

  test("opens on Needs you, and the chosen filter survives a reload and Back", async ({ page }) => {
    await preparePage(page, { dismissCookieBanner: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/documents");
    const tab = (name: RegExp) => page.getByRole("tab", { name });
    await expect(tab(/^Needs you/)).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("table").getByRole("row")).toHaveCount(4);                 // the headings and three documents
    await tab(/^Sent/).click();
    await expect(page).toHaveURL(/\/documents\?show=sent$/);
    await page.reload();
    await expect(tab(/^Sent/)).toHaveAttribute("aria-selected", "true");
    await page.getByRole("table").getByRole("link").first().click();
    await expect(page).toHaveURL(/\/flows\/[^/]+\/documents\/[^/]+$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/documents\?show=sent$/);
    await expect(tab(/^Sent/)).toHaveAttribute("aria-selected", "true");
    await page.goto("/documents?show=bogus&page=-3");
    await expect(tab(/^Needs you/)).toHaveAttribute("aria-selected", "true");
    await page.goto("/documents?show=in-progress");
    await expect(page.getByRole("heading", { name: "Nothing is in progress right now." })).toBeVisible();
  });

  test("a ready document is sent from its row, and a stopped delivery is one alert with a way on", async ({ page }) => {
    await preparePage(page, { dismissCookieBanner: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/documents");
    const alert = page.getByRole("alert").filter({ hasText: "couldn't be sent" });
    await expect(alert).toContainText("1 document couldn't be sent. Sending to Accounting inbox stopped");
    await expect(alert).toContainText("The mailbox refused the message. The document is safe. Fix the destination, then send it again.");
    await expect(alert.getByRole("link", { name: "Fix the destination" })).toHaveAttribute("href", `/flows/${MOCK_ENGINE_IDS.setupFlow}?tab=outputs`);
    const table = page.getByRole("table");
    await expect(table.getByRole("button", { name: /^Send / })).toHaveCount(1);              // only the ready row
    await table.getByRole("button", { name: "Send invoice-1002.pdf" }).click();
    await expect(table.getByRole("row", { name: /invoice-1002\.pdf/ })).toContainText("Sending");
    await expect(table.getByRole("button", { name: /^Send / })).toHaveCount(0);
    await page.getByTestId("review-next").click();
    await expect(page).toHaveURL(new RegExp("/flows/flow-3/documents/doc-5$"));
  });

  test("on a phone, Review next sits in a bar above the tab bar and hides nothing", async ({ page }) => {
    await preparePage(page, { dismissCookieBanner: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/documents");
    await settle(page);
    const tabBar = page.getByTestId("tab-bar");
    await expect(tabBar.getByRole("link", { name: "Documents, 3 need you" })).toBeVisible();
    const bar = page.getByTestId("action-bar");
    const next = bar.getByRole("link", { name: /^Review next/ });
    await expect(page.getByTestId("review-next")).toBeHidden();                              // the title-row copy is for 768 and up
    await expect(page.getByRole("table")).toBeHidden();
    const box = async (l: import("@playwright/test").Locator) => (await l.boundingBox())!;
    const spacer = () => bar.evaluate((el) => (el.previousElementSibling as HTMLElement).getBoundingClientRect().height);
    for (const width of [390, 700]) {
      await page.setViewportSize({ width, height: 844 });
      const [a, t, b] = [await box(bar), await box(tabBar), await box(next)];
      expect(Math.abs(a.y + a.height - t.y), `the bar sits on the tab bar at ${width}`).toBeLessThanOrEqual(1);
      expect(b.height, `the button's height at ${width}`).toBe(48);
      expect(Math.abs((await spacer()) - a.height), `the spacer is the bar's height at ${width}`).toBeLessThanOrEqual(1);
    }
    // One "Review next" on screen either side of 768: the bar's below it, the title row's from it.
    const reviewNext = page.getByRole("link", { name: "Review next, 3 need you" });
    await page.setViewportSize({ width: 767, height: 844 });
    await expect(reviewNext).toHaveCount(1);
    await expect(next).toBeVisible();
    await page.setViewportSize({ width: 768, height: 844 });
    await expect(reviewNext).toHaveCount(1);
    await expect(page.getByTestId("review-next")).toBeVisible();
    // The round Add button bites into the bar's button by a few pixels, never enough to cover its label.
    const add = tabBar.getByRole("link", { name: "Add a document" });
    for (const width of [390, 360]) {
      await page.setViewportSize({ width, height: 844 });
      const [a, b] = [await box(add), await box(next)];
      expect(Math.max(0, b.y + b.height - a.y), `the Add button's overlap at ${width}`).toBeLessThanOrEqual(8);
    }
    // A short screen, so the page scrolls: at its end everything in the page's flow is above the bar
    // (the spacer is the last thing in that flow, so its top is where the content ends).
    // Reloaded after the resize: Chromium does not recompute the shell's `h-dvh` on an emulated resize.
    await page.setViewportSize({ width: 390, height: 560 });
    await page.reload();
    await settle(page);
    await page.evaluate(() => { for (const el of document.querySelectorAll("main, main *")) if (el.scrollHeight > el.clientHeight + 1) el.scrollTop = el.scrollHeight; });
    const spacerTop = await bar.evaluate((el) => (el.previousElementSibling as HTMLElement).getBoundingClientRect().top);
    expect(spacerTop, "the page's content ends above the bar").toBeLessThanOrEqual((await box(bar)).y + 1);
    // A 120-character file name is cut, and the page does not scroll sideways.
    const name = page.getByTestId("document-name").first();
    await name.evaluate((el) => { el.textContent = "N".repeat(120) + ".pdf"; });
    expect(await name.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    expect(await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth))).toBe(0);
    // Without the tab bar (as on a full-screen step) the bar drops to the screen's edge and its spacer follows.
    // The bar is hidden and un-classed, not removed: React still owns the node.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await settle(page);
    await tabBar.evaluate((el) => { el.classList.remove("plk-tabbar"); (el as HTMLElement).style.display = "none"; });
    // Polled: the first read can land before the style pass that drops the tab bar's height token.
    await expect.poll(async () => { const b = await box(bar); return Math.abs(b.y + b.height - 844); }).toBeLessThanOrEqual(1);
    expect(Math.abs((await spacer()) - (await box(bar)).height)).toBeLessThanOrEqual(1);
    // A phone row opens its document.
    await page.getByTestId("documents-phone-list").getByRole("link").first().click();
    await expect(page).toHaveURL(/\/flows\/[^/]+\/documents\/[^/]+$/);
  });
});
