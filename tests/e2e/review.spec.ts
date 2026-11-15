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
    expect(Date.now() - pressed, "Enter saves without the pause").toBeLessThan(1000);
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
});
