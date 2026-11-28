import { test, expect, type Locator, type Page } from "@playwright/test";
import { preparePage, settle } from "./a11yHarness";

const box = async (l: Locator) => (await l.boundingBox())!;

/** The Destinations tab's own content: the helper row, the list's card and the Google block (not the shell, not the tab strip). */
const section = (page: Page) => page.locator("div.grid.gap-3", { has: page.getByRole("list", { name: "Destinations" }) }).last();

/**
 * Every element box and every line of text in the section, against the viewport and the section's card.
 * Text is measured line by line (a box can hold while its text runs out of it); a line inside an element that
 * clips (`truncate`) is measured by the clipping box, which is what a person sees.
 */
const overflows = (root: Locator) =>
  root.evaluate((el) => {
    const vw = window.innerWidth;
    const out: string[] = [];
    // A <Card> draws its surface inline; it clips, so a line cut by the card itself counts as running past it.
    const cardOf = (n: Element) => n.closest("[style*='--surface']") ?? el;
    const clipOf = (n: Element) => {
      for (let p: Element | null = n; p && p !== cardOf(n); p = p.parentElement)
        if (getComputedStyle(p).overflowX !== "visible") return p.getBoundingClientRect();
      return null;
    };
    const check = (what: string, r: { left: number; right: number }, n: Element) => {
      const c = cardOf(n).getBoundingClientRect();
      if (r.left < -0.5 || r.right > vw + 0.5) out.push(`${what} runs past the screen: ${r.left.toFixed(1)}..${r.right.toFixed(1)} of ${vw}`);
      else if (r.left < c.left - 0.5 || r.right > c.right + 0.5) out.push(`${what} runs past its card: ${r.left.toFixed(1)}..${r.right.toFixed(1)} in ${c.left.toFixed(1)}..${c.right.toFixed(1)}`);
    };
    for (const n of [el, ...el.querySelectorAll("*")]) {
      const r = n.getBoundingClientRect();
      if (r.width && r.height) check(`<${n.tagName.toLowerCase()}> "${(n.textContent ?? "").trim().slice(0, 40)}"`, r, n);
    }
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let t = walk.nextNode(); t; t = walk.nextNode()) {
      if (!t.textContent?.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(t);
      const clip = clipOf(t.parentElement!);
      for (const line of range.getClientRects()) {
        const r = clip ? { left: Math.max(line.left, clip.left), right: Math.min(line.right, clip.right) } : line;
        check(`text line "${t.textContent.trim().slice(0, 40)}"`, r, t.parentElement!);
      }
    }
    return out;
  });

/** Every visible text's size in px, smallest first. */
const smallestText = (root: Locator) =>
  root.evaluate((el) => {
    const sizes: [number, string][] = [];
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let t = walk.nextNode(); t; t = walk.nextNode()) {
      const p = t.parentElement!;
      if (!t.textContent?.trim() || !p.getClientRects().length) continue;
      sizes.push([parseFloat(getComputedStyle(p).fontSize), t.textContent.trim().slice(0, 40)]);
    }
    return sizes.sort((a, b) => a[0] - b[0])[0];
  });

/** Stand-alone links and buttons in the section that are on screen, with their heights. */
const controlHeights = (root: Locator) =>
  root.evaluate((el) =>
    [...el.querySelectorAll<HTMLElement>("a, button")]
      .filter((n) => n.getClientRects().length)
      .map((n) => [(n.getAttribute("aria-label") ?? n.textContent ?? "").trim().slice(0, 40), n.getBoundingClientRect().height] as const));

/** Buttons and links on the page's content with a dark fill (navy, green, blue, red, violet): the "filled" ones. */
const filledButtons = (page: Page) =>
  page.locator("#main-content").evaluate((el) =>
    [...el.querySelectorAll<HTMLElement>("a, button")]
      .filter((n) => n.getClientRects().length)
      .filter((n) => {
        const m = getComputedStyle(n).backgroundColor.match(/[\d.]+/g)?.map(Number) ?? [];
        const [r, g, b, a = 1] = m;
        return m.length >= 3 && a > 0.5 && (r + g + b) / 3 < 150;
      })
      .map((n) => (n.textContent ?? "").trim()));

test.describe("destinations", () => {
  test.describe.configure({ timeout: 120_000 });

  test("from a stopped document to a passing test and Send it now, and Back lands where the person was", async ({ page }) => {
    await preparePage(page, { dismissCookieBanner: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/documents?show=failed");
    await page.getByRole("link", { name: "Fix the destination" }).first().click();   // the alert's; each stopped row has its own too
    await expect(page).toHaveURL(/\/settings\?tab=destinations&open=dest-1$/);
    const panel = page.getByRole("region", { name: "Edit Accounting inbox" });
    await expect(panel).toContainText("One file uses this destination, so it can't be deleted.");
    await panel.getByRole("button", { name: "Save and send a test" }).click();
    await expect(panel.getByText(/^Test accepted by the mail server at \d\d:\d\d\.$/)).toBeVisible();
    const band = panel.getByTestId("destination-waiting");
    await expect(band).toContainText("1 document is waiting for this destination.");
    await expect(band).toContainText(/invoice-1004\.csv couldn't be sent on 24 May/); // the year follows once it is not this year
    await band.getByRole("button", { name: "Send it now" }).click();
    await expect(panel).toContainText("invoice-1004.csv is on its way again.");
    await expect(panel.getByTestId("destination-waiting")).toHaveCount(0);
    const server = page.getByRole("list", { name: "Destinations" }).getByRole("listitem").filter({ hasText: "Accounting server" });
    await server.getByRole("button", { name: "Send a test to Accounting server" }).click();
    await expect(server.getByRole("alert")).toContainText("The test didn't arrive. The server refused the login.");
    await page.goBack();
    await expect(page).toHaveURL(/\/documents\?show=failed$/);
    await page.goto("/settings");
    await page.getByRole("button", { name: "Destinations" }).click();
    await expect(page).toHaveURL(/\/settings\?tab=destinations$/);
    await page.getByRole("button", { name: "Edit Accounting inbox" }).click();
    await page.getByRole("link", { name: "Invoice CSV in Supplier invoices" }).click();
    await expect(page).toHaveURL(/\/flows\/flow-1\?tab=outputs$/);
    await page.goBack();
    await expect(page.getByRole("region", { name: "Edit Accounting inbox" })).toBeVisible();
  });

  test("on a phone the rows stack, every control is a thumb's width, and the main button clears the tab bar", async ({ page }) => {
    await preparePage(page, { dismissCookieBanner: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/settings?tab=destinations&open=dest-3");
    await settle(page);
    const list = page.getByRole("list", { name: "Destinations" });
    const listBox = await box(list);
    expect(listBox.x + listBox.width).toBeLessThanOrEqual(390);
    for (const b of await list.getByRole("button", { name: /^(Test|Edit) / }).all()) expect((await box(b)).height).toBeGreaterThanOrEqual(44);
    const save = page.getByRole("button", { name: "Save and send a test" });
    await save.scrollIntoViewIfNeeded();
    const tabBar = await box(page.getByTestId("tab-bar"));
    const s = await box(save);
    expect(s.y + s.height).toBeLessThanOrEqual(tabBar.y);
    expect(s.height).toBeGreaterThanOrEqual(44);
  });

  test("on a phone at 390 and 360 nothing runs past the screen or its card, no text is under 12.5px, and every control is 44px tall", async ({ page }) => {
    await preparePage(page, { dismissCookieBanner: true });
    for (const width of [390, 360]) {
      await page.setViewportSize({ width, height: 844 });
      // Reloaded per width: Chromium does not recompute the shell's `h-dvh` on an emulated resize.
      // dest-1 is the open row with the most in it: the in-use sentence and its output link.
      await page.goto("/settings?tab=destinations&open=dest-1");
      await settle(page);
      const root = section(page);
      await expect(root.getByRole("region", { name: "Edit Accounting inbox" })).toBeVisible();
      await root.getByRole("button", { name: "More options" }).click();
      await root.getByRole("button", { name: "Save and send a test" }).click();
      await expect(root.getByTestId("destination-waiting")).toBeVisible();          // the amber band and Send it now are measured too
      await root.getByRole("button", { name: "Send a test to Accounting server" }).click();
      await expect(root.getByRole("listitem").filter({ hasText: "Accounting server" }).getByRole("alert")).toBeVisible();
      expect(await overflows(root), `overflow at ${width}`).toEqual([]);
      const [size, text] = await smallestText(root);
      expect(size, `the smallest text at ${width} is "${text}"`).toBeGreaterThanOrEqual(12.5);
      const short = (await controlHeights(root)).filter(([, h]) => h < 44);
      expect(short, `controls under 44px at ${width}`).toEqual([]);
    }
  });

  test("one filled button: Save and send a test while a panel is open, none otherwise", async ({ page }) => {
    await preparePage(page, { dismissCookieBanner: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/settings?tab=destinations");
    await expect(page.getByRole("list", { name: "Destinations" })).toBeVisible();
    await settle(page);
    expect(await filledButtons(page)).toEqual([]);
    await page.getByRole("button", { name: "Edit Accounting server" }).click();
    await expect(page.getByRole("region", { name: "Edit Accounting server" })).toBeVisible();
    expect(await filledButtons(page)).toEqual(["Save and send a test"]);
    await page.getByRole("button", { name: "Add a destination" }).click();         // opening another replaces the first
    await expect(page.getByRole("region", { name: "New destination" })).toBeVisible();
    expect(await filledButtons(page)).toEqual(["Save and send a test"]);
  });

  test("a saved login is never shown back, an unused destination is deleted after asking, and one in use names its outputs", async ({ page }) => {
    await preparePage(page, { dismissCookieBanner: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/settings?tab=destinations&open=dest-3");
    const panel = page.getByRole("region", { name: "Edit Accounting server" });
    await expect(panel.getByLabel("Username")).toHaveValue("");
    const fake = "example-not-a-real-key";
    await panel.getByLabel("Username").fill("example-user");
    await panel.getByLabel("New password").fill(fake);
    await panel.getByRole("button", { name: "Save and send a test" }).click();
    // The test ran on what was saved, and its result is said where it was pressed.
    await expect(panel.getByRole("alert")).toContainText("The test didn't arrive. The server refused the login.");
    await expect(panel.getByRole("button", { name: "Close" })).toBeVisible();
    await expect(panel.getByLabel("New password")).toHaveValue("");
    expect(await page.evaluate((s) => document.body.innerText.includes(s)
      || [...document.querySelectorAll("input, textarea")].some((i) => (i as HTMLInputElement).value.includes(s)), fake)).toBe(false);
    // In use: named, linked, and no way to delete it.
    await page.getByRole("button", { name: "Edit Accounting inbox" }).click();
    const inUse = page.getByRole("region", { name: "Edit Accounting inbox" });
    await expect(inUse).toContainText("One file uses this destination, so it can't be deleted.");
    await expect(inUse.getByRole("link", { name: "Invoice CSV in Supplier invoices" })).toHaveAttribute("href", "/flows/flow-1?tab=outputs");
    await expect(inUse.getByRole("button", { name: "Delete destination" })).toHaveCount(0);
    // Unused: asked first; Keep leaves it, Delete removes the row.
    await page.getByRole("button", { name: "Edit Accounting API" }).click();
    const api = page.getByRole("region", { name: "Edit Accounting API" });
    await api.getByRole("button", { name: "Delete destination" }).click();
    const dialog = page.getByRole("alertdialog").or(page.getByRole("dialog"));
    await expect(dialog).toContainText('Delete "Accounting API"? This cannot be undone.');
    await dialog.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText("Accounting API was deleted.")).toBeVisible();
    await expect(page).toHaveURL(/\/settings\?tab=destinations$/);
    await expect(page.getByRole("list", { name: "Destinations" }).getByRole("listitem")).toHaveCount(2);
    await expect(page.getByRole("button", { name: "Edit Accounting API" })).toHaveCount(0);
  });

  test("at 1440 each row is one line of five cells under the five column heads (widths compared with the board in the report)", async ({ page }) => {
    await preparePage(page, { dismissCookieBanner: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/settings?tab=destinations");
    const list = page.getByRole("list", { name: "Destinations" });
    await expect(list).toBeVisible();
    await settle(page);
    // The heads are hidden from screen readers (each row's cells carry their own words), so they are read by position.
    const heads = await list.evaluate((ul) => [...ul.previousElementSibling!.children].map((c) => c.getBoundingClientRect()));
    test.info().annotations.push({ type: "columns at 1440", description: heads.map((h) => h.width.toFixed(1)).join(" ") });
    test.info().annotations.push({ type: "list width at 1440", description: (await box(list)).width.toFixed(1) });
    expect(heads).toHaveLength(5);
    for (const item of await list.getByRole("listitem").all()) {
      const cells = await item.locator(":scope > div").first().evaluate((row) => [...row.children].map((c) => c.getBoundingClientRect()));
      expect(cells.map((c) => Math.round(c.left)), "each cell starts under its head").toEqual(heads.map((h) => Math.round(h.left)));
      expect(Math.max(...cells.map((c) => c.top)) - Math.min(...cells.map((c) => c.top)), "the cells share one line").toBeLessThanOrEqual(12);
    }
  });
});
