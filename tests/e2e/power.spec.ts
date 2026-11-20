import { test, expect, type Locator, type Page } from "@playwright/test";
import { preparePage, settle } from "./a11yHarness";
import { MOCK_DOCUMENT_NUMBER } from "../../src/lib/api/mockEngine";
import { SHORTCUTS } from "../../src/lib/shortcuts";

const box = async (l: Locator) => (await l.boundingBox())!;

/** Filled controls in the work area (main and the phone action bar): a solid background under white text. */
const filled = (page: Page) => page.evaluate(() => {
  const root = [...document.querySelectorAll("main, [data-testid=action-bar]")];
  return [...new Set(root.flatMap((r) => [...r.querySelectorAll("button, a[href]")]))].filter((el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    if (r.width < 2 || r.height < 2 || s.visibility === "hidden") return false;
    const bg = s.backgroundColor.match(/[\d.]+/g)?.map(Number) ?? [];
    const opaque = bg.length === 3 || (bg.length === 4 && bg[3] === 1);
    return opaque && s.color === "rgb(255, 255, 255)" && bg.slice(0, 3).some((v) => v < 200);
  }).map((el) => (el.textContent ?? "").trim());
});

/** The smallest font size of any text a person can see in main, in px. */
const smallestText = (page: Page) => page.evaluate(() => {
  let min = Infinity;
  for (const el of document.querySelectorAll("main *")) {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || getComputedStyle(el).visibility === "hidden") continue;
    if ([...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim())) min = Math.min(min, parseFloat(getComputedStyle(el).fontSize));
  }
  return min;
});

/**
 * The mock engine answers in the page (src/lib/api/mockEngine.ts, after a 120 ms timer), so no request reaches the
 * network and `page.route` has nothing to hold. While `window.__plkSlow` is set, that timer is stretched instead:
 * the search's answer is out for 1.5 s longer, as on a slow server.
 */
const slowMockAnswers = (page: Page) => page.addInitScript(() => {
  const real = window.setTimeout;
  window.setTimeout = ((fn: TimerHandler, ms?: number, ...rest: unknown[]) =>
    real(fn, (window as unknown as { __plkSlow?: boolean }).__plkSlow && ms === 120 ? 1620 : ms, ...rest)) as typeof window.setTimeout;
});

test.describe("power tools", () => {
  test.describe.configure({ timeout: 120_000 });

  test("on a document being checked, Ctrl+Enter saves and sends, Tab goes to the next value, ? shows the list", async ({ page }) => {
    await preparePage(page, { dismissCookieBanner: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/flows/flow-1/documents/doc-1");
    await settle(page);
    const read = page.getByRole("region", { name: "What we read" });
    const header = page.getByTestId("review-header-actions");
    await expect(header).toContainText("2 values to check");
    // The marked values come first; Tab goes from the first to the second.
    const boxes = read.getByRole("textbox");
    await boxes.nth(0).focus();
    await page.keyboard.press("Tab");
    await expect(boxes.nth(1)).toBeFocused();
    const second = await boxes.nth(1).evaluate((el) => (el as HTMLInputElement).labels?.[0]?.textContent ?? "");
    expect(second, "the second marked value is the supplier").toContain("Supplier");
    await page.keyboard.type("Example Supplier Ltd");
    await page.keyboard.press("Control+Enter");
    await expect(page).toHaveURL(/\/flows\/[^/]+\/documents\/(?!doc-1$)[^/]+$/);
    await expect(page.getByTestId("review-header-actions")).toContainText("1 of 2 that need you");
    // The mock remembers for the life of the page: open doc-1 again without a reload, through the list.
    await page.getByRole("link", { name: "Documents" }).first().click();
    await page.getByRole("tab", { name: /^Finished/ }).click();
    await page.getByRole("table").getByRole("link", { name: "invoice-1001.csv" }).click();
    await expect(page).toHaveURL(/\/documents\/doc-1$/);
    await expect(page.getByRole("region", { name: "What we read" }).getByLabel("Supplier")).toHaveValue("Example Supplier Ltd");
    await expect(page.getByTestId("review-header-actions").getByText(/^(Sent|Sending)$/)).toBeVisible();
    // ? on the page (not in a box) opens the list; its rows are the registry's.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("?");
    const list = page.getByRole("region", { name: "Keyboard shortcuts" });
    await expect(list).toBeVisible();
    await expect(list.locator("dt")).toHaveCount(SHORTCUTS.length);
    await list.getByRole("checkbox", { name: "Open this list with the ? key" }).uncheck();
    await list.getByRole("button", { name: "Close keyboard shortcuts" }).click();
    await expect(list).toHaveCount(0);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("?");
    await page.waitForTimeout(300);
    await expect(list).toHaveCount(0);
    // Switched off, the list is still one search away.
    await page.keyboard.press("Control+K");
    await page.getByRole("combobox", { name: "Search" }).fill("short");
    await expect(page.getByRole("option", { name: "Keyboard shortcuts" })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(list).toBeVisible();
  });

  test("Select ticks rows, the bar sends the ready one and downloads both in a zip; on a phone it sits above the tab bar", async ({ page }) => {
    await preparePage(page, { dismissCookieBanner: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/documents");
    await settle(page);
    await page.getByRole("button", { name: "Select" }).click();
    const table = page.getByRole("table");
    await table.getByRole("checkbox", { name: "Select invoice-1001.csv" }).check();
    await table.getByRole("checkbox", { name: "Select invoice-1002.pdf" }).check();
    const bar = page.getByRole("region", { name: "2 documents selected" });
    await expect(bar).toBeVisible();
    expect(await filled(page), "the bar's Send is the one filled button").toEqual(["Send the ready one"]);
    expect(await smallestText(page), "no text under 12.5px in Select mode").toBeGreaterThanOrEqual(12.5);
    const b = await box(bar);
    expect(b.y + b.height, "the bar is on screen at 1440").toBeLessThanOrEqual(900);
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(1440);
    const download = page.waitForEvent("download");
    await bar.getByRole("button", { name: "Download files" }).click();
    expect((await download).suggestedFilename()).toBe("documents.zip");
    await expect(bar.getByRole("status")).toHaveText("2 files downloaded in documents.zip.");
    await bar.getByRole("button", { name: "Send the ready one" }).click();
    const left = page.getByRole("region", { name: "1 document selected" });
    await expect(left.getByRole("status")).toHaveText("invoice-1002.pdf is on its way.");
    await expect(left.getByRole("alert")).toHaveText("");                          // everything went: a status, the alert stays empty
    await expect(table.getByRole("row", { name: /invoice-1002\.pdf/ })).toHaveCount(0);
    await expect(table.getByRole("row", { name: /invoice-1001\.csv/ })).toHaveCount(1);

    // On a phone.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/documents");
    await settle(page);
    await page.getByRole("button", { name: "Select" }).click();
    const phone = page.getByTestId("documents-phone-list");
    const tick = phone.getByRole("checkbox", { name: "Select invoice-1002.pdf" });
    await tick.check();
    const label = await box(tick.locator("xpath=.."));
    expect(label.width, "the tick's box is 44 wide").toBeGreaterThanOrEqual(44);
    expect(label.height, "the tick's box is 44 tall").toBeGreaterThanOrEqual(44);
    const one = page.getByRole("region", { name: "1 document selected" });
    await expect(one).toBeVisible();
    await expect(page.getByTestId("action-bar")).toHaveCount(0);                 // Review next steps aside while rows are ticked
    expect(await filled(page), "the bar's Send is the one filled button on a phone").toEqual(["Send"]);
    const tabBar = page.getByTestId("tab-bar");
    const add = tabBar.getByRole("button", { name: "Add a document" });
    const [p, t, a] = [await box(one), await box(tabBar), await box(add)];
    // Measured 2026-11-15: 24px above the tab bar (bottom-6), 9px above the round Add button, which rises 15px over it.
    expect(t.y - (p.y + p.height), "the bar sits 24px above the tab bar").toBeGreaterThanOrEqual(23);
    expect(a.y - (p.y + p.height), "the bar clears the Add button").toBeGreaterThanOrEqual(8);
    expect(p.x).toBeGreaterThanOrEqual(0);
    expect(p.x + p.width).toBeLessThanOrEqual(390);
    for (const button of await one.getByRole("button").all()) {
      expect((await box(button)).height, `${await button.textContent()} is a tap target`).toBeGreaterThanOrEqual(44);
    }
    expect(await smallestText(page), "no text under 12.5px in Select mode on a phone").toBeGreaterThanOrEqual(12.5);
    expect(await page.locator("#main-content").evaluate((el) => Math.max(...[el, ...el.children].map((e) => e.scrollWidth - e.clientWidth)))).toBeLessThanOrEqual(1);
    // The footer's inline controls are tap targets too. (Its Ctrl K search shows from 768 up; on a phone History is the link.)
    expect((await box(page.locator("#main-content").getByRole("link", { name: "History", exact: true }))).height).toBeGreaterThanOrEqual(44);
    expect((await box(page.getByRole("link", { name: "Old orders" }))).height).toBeGreaterThanOrEqual(44);
    // Everything ticked went: the result is drawn clear of the tab bar, with no Review next bar over it, and holds focus.
    await one.getByRole("button", { name: "Send" }).click();
    const result = page.getByRole("status").filter({ hasText: "invoice-1002.pdf is on its way." });
    await expect(result).toBeVisible();
    await expect(page.getByTestId("action-bar")).toHaveCount(0);
    const r = await box(result);
    expect(r.y, "the result is on screen").toBeGreaterThanOrEqual(0);
    expect(t.y - (r.y + r.height), "the result sits clear above the tab bar").toBeGreaterThanOrEqual(23);
    await expect(page.locator(":focus"), "focus moved to the result, not the page").toContainText("invoice-1002.pdf is on its way.");
  });

  test("Ctrl K finds a document by number and opens it; while the server is out it never shows the last answer", async ({ page }) => {
    await preparePage(page, { dismissCookieBanner: true });
    await slowMockAnswers(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/documents");
    await settle(page);
    await page.keyboard.press("Control+K");
    const dialog = page.getByRole("dialog", { name: "Search documents, flows, lookups and actions" });
    await expect(dialog).toBeVisible();
    const input = dialog.getByRole("combobox", { name: "Search" });
    const found = dialog.getByRole("option", { name: "invoice-1001.csv" });
    await input.fill(MOCK_DOCUMENT_NUMBER);
    await expect(found).toBeVisible();
    await page.evaluate(() => { (window as unknown as { __plkSlow: boolean }).__plkSlow = true; });
    await input.pressSequentially("99");
    await expect(dialog.getByRole("status")).toHaveText("Searching…");
    await expect(found).toHaveCount(0);
    await page.waitForTimeout(800);                                                 // well inside the 1.5 s the answer is out
    await expect(dialog.getByRole("status")).toHaveText("Searching…");
    await expect(found).toHaveCount(0);
    await page.evaluate(() => { (window as unknown as { __plkSlow: boolean }).__plkSlow = false; });
    await input.fill("invoice-1001");
    await expect(found).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/flows\/flow-1\/documents\/doc-1$/);
    await expect(dialog).toHaveCount(0);
    // The footer's words open the same search.
    await page.getByRole("link", { name: "Documents" }).first().click();
    await expect(page).toHaveURL(/\/documents$/);
    await page.getByRole("button", { name: "Search all documents" }).click();
    await expect(dialog).toBeVisible();
  });
});
