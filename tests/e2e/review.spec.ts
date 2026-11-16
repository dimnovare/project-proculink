import { test, expect, type Page } from "@playwright/test";
import { preparePage, settle } from "./a11yHarness";

/** What a person sees go wrong on a narrow screen, measured on the document screen as it stands. */
async function measure(page: Page) {
  return page.evaluate(() => {
    const W = window.innerWidth;
    const shown = (el: Element) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 1 && r.height > 1 && s.visibility !== "hidden" && s.display !== "none";
    };
    // A box inside a sideways-scrolling area (the sheet of the original) is measured against that area, not the page.
    // A clipped box (overflow hidden) is not exempt: what it cuts off is text a person cannot read.
    const scroller = (el: Element) => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        const o = getComputedStyle(p).overflowX;
        if ((o === "auto" || o === "scroll") && p.scrollWidth > p.clientWidth + 1) return p;
      }
      return null;
    };
    const name = (el: Element) => `<${el.tagName.toLowerCase()}> "${(el.textContent ?? "").trim().slice(0, 30)}"`;
    const out = { overflow: [] as string[], short: [] as string[], small: [] as string[], filled: [] as string[] };
    const root = [...document.querySelectorAll("main, [data-testid=action-bar]")];
    const all = [...new Set(root.flatMap((r) => [r, ...r.querySelectorAll("*")]))].filter(shown);   // the bar may sit inside main
    for (const el of all) {
      const r = el.getBoundingClientRect();
      const card = el.closest("[id^=review-pane-]");
      const c = card && card !== el ? card.getBoundingClientRect() : null;
      if (!scroller(el)) {
        if (r.left < -0.5 || r.right > W + 0.5) out.overflow.push(`${name(el)} box ${Math.round(r.left)}..${Math.round(r.right)} of ${W}`);
        else if (c && (r.left < c.left - 0.5 || r.right > c.right + 0.5)) out.overflow.push(`${name(el)} box ${Math.round(r.left)}..${Math.round(r.right)} past its pane ${Math.round(c.left)}..${Math.round(c.right)}`);
      }
      for (const n of el.childNodes) {
        if (n.nodeType !== Node.TEXT_NODE || !n.textContent?.trim()) continue;
        const s = getComputedStyle(el);
        if (parseFloat(s.fontSize) < 12.5) out.small.push(`${name(el)} ${s.fontSize}`);
        if (scroller(el)) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        for (const line of range.getClientRects()) {
          if (line.width < 1) continue;
          const past = line.left < -0.5 || line.right > W + 0.5 || (c && (line.left < c.left - 0.5 || line.right > c.right + 0.5));
          if (past) out.overflow.push(`${name(el)} text line ${Math.round(line.left)}..${Math.round(line.right)}`);
        }
      }
      const tag = el.tagName.toLowerCase();
      const control = tag === "button" || (tag === "a" && el.hasAttribute("href")) || el.getAttribute("role") === "tab";
      if (!control) continue;
      const s = getComputedStyle(el);
      if (!(tag === "a" && s.display === "inline") && r.height < 44 - 0.5) out.short.push(`${name(el)} ${Math.round(r.height)}px`);
      const bg = s.backgroundColor.match(/[\d.]+/g)?.map(Number) ?? [];
      const opaque = bg.length === 3 || (bg.length === 4 && bg[3] === 1);
      if (opaque && s.color === "rgb(255, 255, 255)" && bg.slice(0, 3).some((v) => v < 200)) out.filled.push(name(el));
    }
    return out;
  });
}

const clean = (m: Awaited<ReturnType<typeof measure>>, where: string) => {
  expect(m.overflow, `nothing runs past the screen or its pane ${where}`).toEqual([]);
  expect(m.short, `links and buttons are at least 44px tall ${where}`).toEqual([]);
  expect(m.small, `no text under 12.5px ${where}`).toEqual([]);
  expect(m.filled, `exactly one filled button ${where}`).toHaveLength(1);
};

test.describe("Review", () => {
  test.describe.configure({ timeout: 120_000 });

  test("the review loop", async ({ page }) => {
    await preparePage(page, { dismissCookieBanner: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/documents");
    await settle(page);
    await page.getByTestId("review-next").click();
    await expect(page).toHaveURL(/\/flows\/flow-3\/documents\/doc-5$/);
    const header = page.getByTestId("review-header-actions");
    await expect(header).toContainText("1 of 3 that need you");
    await header.getByRole("button", { name: "Send and open next" }).click();             // flow-3 has no output
    await expect(page.getByTestId("review-refusal").getByRole("alert")).toContainText("Add an output to this flow before sending.");
    await expect(page.getByTestId("review-refusal").getByRole("link", { name: "Open the flow's outputs" }))
      .toHaveAttribute("href", "/flows/flow-3?tab=outputs");
    await expect(page).toHaveURL(/doc-5$/);
    await header.getByRole("button", { name: "Skip" }).click();
    await expect(page).toHaveURL(/\/documents\/doc-2$/);
    await header.getByRole("button", { name: "Skip" }).click();
    await expect(page).toHaveURL(/\/documents\/doc-1$/);
    await expect(header).toContainText("2 values to check");
    await expect(page.getByTestId("source-mark").or(page.locator("[data-marked]")).first()).toBeVisible();
    const supplier = page.getByRole("region", { name: "What we read" }).getByLabel("Supplier");
    await expect(supplier).toHaveAccessibleDescription(/Not found on the page\. Type it/);
    await supplier.fill("Example Supplier Ltd");
    await expect(page.getByTestId("save-state")).toHaveText(/Saving…|Saves as you type/);
    await header.getByRole("button", { name: "Send and open next" }).click();             // saves first, then sends
    await expect(page).toHaveURL(/\/documents\/doc-5$/);
    await expect(page.getByTestId("review-header-actions")).toContainText("1 of 2 that need you");
    await page.goBack();
    await expect(page).toHaveURL(/\/documents$/);
    await expect(page.getByRole("tab", { name: /Needs you/ })).toContainText("2");
  });

  test("a value saves after a pause, at once on Enter, and stays saved", async ({ page }) => {
    await preparePage(page, { dismissCookieBanner: true });   // the clock runs: the pause is real time
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/flows/flow-1/documents/doc-1");
    await settle(page);
    const state = page.getByTestId("save-state");
    const read = page.getByRole("region", { name: "What we read" });
    const header = page.getByTestId("review-header-actions");
    await expect(header).toContainText("2 values to check");
    // Typing waits for a pause before it saves.
    const typed = Date.now();
    await read.getByLabel("Supplier").fill("Example Supplier Ltd");
    await expect(state).toHaveText("Saving…");
    await expect(state).toHaveText("Saves as you type", { timeout: 10_000 });
    const pause = Date.now() - typed;
    expect(pause, "the save waits for the pause after typing").toBeGreaterThanOrEqual(1400);
    await expect(header).toContainText("1 value to check");                                // the server re-checked the saved value
    // Enter saves at once.
    const date = read.getByLabel("Date");
    await date.fill("2026-05-21");
    const pressed = Date.now();
    await date.press("Enter");
    await expect(state).toHaveText("Saves as you type");
    expect(Date.now() - pressed, "Enter saves without the pause").toBeLessThan(1400); // under the 1.5 s pause, with room for a slow runner
    // Both values are on the document when it opens again.
    await page.getByRole("link", { name: "Documents" }).first().click();
    await expect(page).toHaveURL(/\/documents$/);
    await page.getByRole("table").getByRole("link", { name: "invoice-1001.csv" }).click();
    await expect(page).toHaveURL(/\/documents\/doc-1$/);
    await expect(page.getByRole("region", { name: "What we read" }).getByLabel("Supplier")).toHaveValue("Example Supplier Ltd");
    await expect(page.getByRole("region", { name: "What we read" }).getByLabel("Date")).toHaveValue("2026-05-21");
    await expect(page.getByTestId("review-header-actions")).toContainText("Ready to send");
  });

  test("on a phone, one pane at a time and the main button in the action bar", async ({ page }) => {
    await preparePage(page, { dismissCookieBanner: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/flows/flow-1/documents/doc-1");
    await settle(page);
    const tabs = page.getByRole("tablist", { name: "Parts of this document" });
    await expect(tabs.getByRole("tab", { name: "What we read" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("region", { name: "Original" })).toBeHidden();
    const bar = page.getByTestId("action-bar");
    await expect(bar.getByRole("button", { name: "Send and open next" })).toBeVisible();
    await expect(bar.getByRole("button", { name: "Skip" })).toBeVisible();
    await expect(page.getByTestId("review-header-actions").getByRole("button", { name: "Send and open next" })).toBeHidden();
    await expect(page.getByTestId("tab-bar")).toBeHidden();
    const b = (await bar.boundingBox())!;
    expect(Math.abs(b.y + b.height - 844)).toBeLessThanOrEqual(1);
    for (const name of ["Skip", "Send and open next"]) {
      expect((await bar.getByRole("button", { name }).boundingBox())!.height, `${name} in the bar`).toBe(48);
    }
    // Every pane at both phone widths: nothing past the edge, 44px controls, no small text, one filled button.
    for (const width of [390, 360]) {
      await page.setViewportSize({ width, height: 844 });
      for (const pane of ["What we read", "Original", "What we'll send"]) {
        await tabs.getByRole("tab", { name: pane }).click();
        await expect(page.getByRole("tabpanel", { name: pane })).toBeVisible();
        if (pane === "Original") await expect(page.locator("[data-marked]").first()).toBeVisible();
        if (pane === "What we'll send") await expect(page.getByRole("tabpanel", { name: pane }).getByText("Invoice CSV").first()).toBeVisible();
        clean(await measure(page), `on "${pane}" at ${width}`);
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await tabs.getByRole("tab", { name: "What we read" }).click();
    // the last line of the pane is above the bar once scrolled to the end
    await page.evaluate(() => { for (const el of document.querySelectorAll("main, main *")) if (el.scrollHeight > el.clientHeight + 1) el.scrollTop = el.scrollHeight; });
    const spacerTop = await bar.evaluate((el) => (el.previousElementSibling as HTMLElement).getBoundingClientRect().top);
    expect(spacerTop).toBeLessThanOrEqual(b.y + 1);
    // a long name wraps and the page never scrolls sideways
    await page.locator("h1").evaluate((el) => { el.textContent = "N".repeat(120) + ".csv"; });
    expect(await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth))).toBe(0);
    expect((await measure(page)).overflow, "a long name stays on screen").toEqual([]);
    // pointing from the value switches to the original
    await page.getByRole("link", { name: "point to it on the original" }).click();
    await expect(tabs.getByRole("tab", { name: "Original" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText("Click the cell that holds Supplier.")).toBeVisible();
  });

  test("from 768 to 1023 wide the panes are tabs and the header carries one Skip and one Send", async ({ page }) => {
    await preparePage(page, { dismissCookieBanner: true });
    await page.setViewportSize({ width: 820, height: 1180 });
    await page.goto("/flows/flow-1/documents/doc-1");
    await settle(page);
    await expect(page.getByRole("tablist", { name: "Parts of this document" })).toBeVisible();
    await expect(page.getByTestId("action-bar")).toBeHidden();
    const header = page.getByTestId("review-header-actions");
    await expect(header.getByRole("button", { name: "Skip" })).toBeVisible();
    await expect(header.getByRole("button", { name: "Send and open next" })).toBeVisible();
    for (const name of ["Skip", "Send and open next"]) {
      const visible = await page.getByRole("button", { name, exact: true }).evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().width > 0).length);
      expect(visible, `one ${name} at 820`).toBe(1);
    }
    const m = await measure(page);
    expect(m.overflow, "nothing past the screen at 820").toEqual([]);
    expect(m.filled, "exactly one filled button at 820").toHaveLength(1);
  });

  test("a document that can no longer be sent offers one Review next, and no Skip or Send", async ({ page }) => {
    await preparePage(page, { dismissCookieBanner: true });
    for (const width of [1440, 820, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/flows/flow-1/documents/doc-3");
      await settle(page);
      const next = page.getByRole("link", { name: "Review next" });
      const shown = await next.evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().width > 0).length);
      expect(shown, `one Review next at ${width}`).toBe(1);
      await expect(page.getByRole("button", { name: "Skip" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Send and open next" })).toHaveCount(0);
      expect((await measure(page)).filled, `exactly one filled button at ${width}`).toHaveLength(1);
    }
  });

  test("Enter goes through the values to check and stops on Send without sending; a table takes arrow keys and a paste", async ({ page }) => {
    await preparePage(page, { dismissCookieBanner: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/flows/flow-1/documents/doc-1");
    await settle(page);
    const read = page.getByRole("region", { name: "What we read" });
    await expect(read.getByLabel("Date")).toBeFocused();                       // the cursor starts in the first value to check
    await page.keyboard.press("Enter");
    await expect(read.getByLabel("Supplier")).toBeFocused();
    // Enter held down: the first press moves to Send, the repeats press nothing.
    await page.keyboard.down("Enter");
    await page.keyboard.down("Enter");
    await page.keyboard.down("Enter");
    await page.keyboard.up("Enter");
    const header = page.getByTestId("review-header-actions");
    await expect(header.getByRole("button", { name: "Send and open next" })).toBeFocused();
    await page.waitForTimeout(500);
    await expect(page).toHaveURL(/\/documents\/doc-1$/);                       // the key that moved the focus did not press the button
    await expect(header).toContainText("2 values to check");
    // Typing on after that Enter is typing, not a press of Send: a space and letters go back into the value.
    await page.keyboard.press("Space");
    await page.keyboard.type("Ltd");
    await expect(read.getByLabel("Supplier")).toBeFocused();
    await expect(read.getByLabel("Supplier")).toHaveValue(" Ltd");
    await expect(page).toHaveURL(/\/documents\/doc-1$/);
    // The value is saved and no longer needs a look: it moves to the other group and keeps the cursor.
    await expect(header).toContainText("1 value to check", { timeout: 10_000 });
    await expect(read.getByLabel("Supplier")).toBeFocused();
    const cell = (row: number, column: string) => read.getByLabel(`Lines row ${row} ${column}`);
    await cell(1, "Item code").focus();
    await page.keyboard.press("ArrowDown");
    await expect(cell(2, "Item code")).toBeFocused();
    await cell(2, "Item code").evaluate((el, text) => {
      const data = new DataTransfer();
      data.setData("text/plain", text);
      el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    }, "B-201\t6\t61.00\nC-301\t3\t121.00\nD-400\t1\t9.00");
    await expect(cell(2, "Item code")).toHaveValue("B-201");
    await expect(cell(3, "Unit price")).toHaveValue("121.00");
    await expect(cell(4, "Quantity")).toHaveValue("1");                         // a fourth row was added for the third pasted line
  });

  test("on a wide screen the waiting list, the original and its values share the screen; the original stays in view, its values can be clicked, and the handle moves", async ({ page }) => {
    await preparePage(page, { dismissCookieBanner: true });
    const original = page.locator("#review-pane-original");
    const read = page.locator("#review-pane-read");
    for (const [width, height] of [[1920, 1080], [2560, 1440]] as const) {
      await page.setViewportSize({ width, height });
      await page.goto("/flows/flow-1/documents/doc-1");
      await settle(page);
      const [o, r] = [(await original.boundingBox())!, (await read.boundingBox())!];
      expect(Math.abs(o.y - r.y), `the two panes start level at ${width}`).toBeLessThanOrEqual(1);
      expect(r.x + r.width, `the values reach the right edge of the page at ${width}`).toBeGreaterThan(width - 200);
      expect(await read.locator(".overflow-x-auto").evaluateAll((els) => els.map((e) => e.scrollWidth - e.clientWidth)), `no table scrolls sideways at ${width}`).toEqual([0]);
      // The documents that still need a person are listed beside the review, with this one marked.
      const list = page.getByRole("complementary", { name: "Documents that need you" });
      await expect(list.getByRole("link", { name: /invoice-1001\.csv/ })).toHaveAttribute("aria-current", "page");
      // A value's place on the original goes to the value.
      await page.getByRole("button", { name: "Go to Date" }).click();
      await expect(page.getByRole("region", { name: "What we read" }).getByLabel("Date")).toBeFocused();
    }
    // A short window, scrolled to the end: the bar with Send and the original are both still on screen.
    await page.setViewportSize({ width: 1920, height: 640 });
    await page.evaluate(() => { for (const el of document.querySelectorAll("main, main *")) if (el.scrollHeight > el.clientHeight + 1) el.scrollTop = el.scrollHeight; });
    const bar = (await page.getByTestId("review-header-actions").boundingBox())!;
    expect(bar.y, "the bar stays at the top").toBeLessThan(120);
    const stuck = (await original.boundingBox())!;
    expect(stuck.y, "the original stays under the bar").toBeGreaterThanOrEqual(bar.y + bar.height - 1);
    expect(stuck.y, "the original stays in view").toBeLessThan(220);
    // Dragging the handle gives the original more room, and the choice is kept.
    const grip = (await page.getByRole("separator", { name: "Width of the original" }).boundingBox())!;
    const y = grip.y + grip.height / 2;
    await page.mouse.move(grip.x + grip.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(grip.x + 220, y, { steps: 6 });
    await page.mouse.up();
    expect((await original.boundingBox())!.width, "the original is wider after the drag").toBeGreaterThan(stuck.width + 150);
    await page.reload();
    await settle(page);
    expect((await original.boundingBox())!.width, "the width is remembered").toBeGreaterThan(stuck.width + 150);
    // One click in the list opens another document that needs a person.
    await page.getByRole("complementary", { name: "Documents that need you" }).getByRole("link", { name: /invoice-1005\.csv/ }).click();
    await expect(page).toHaveURL(/\/documents\/doc-5$/);
  });
});
