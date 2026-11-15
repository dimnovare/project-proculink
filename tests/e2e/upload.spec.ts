import { test, expect } from "@playwright/test";
import { preparePage } from "./a11yHarness";

const pdf = (name: string, body = "%PDF-1.4") => ({ name, mimeType: "application/pdf", buffer: Buffer.from(body) });
const jpg = { name: "image.jpg", mimeType: "image/jpeg", buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) };

test.describe("upload", () => {
  test.describe.configure({ timeout: 120_000 });

  test("several files at once: each says how it went, and a ready one is sent from its row", async ({ page }) => {
    await preparePage(page, { dismissCookieBanner: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/upload");
    const flows = page.getByRole("group", { name: "Which flow is this for?" });
    await flows.getByRole("radio", { name: /^Remittance advices/ }).check();
    const zone = page.getByRole("region", { name: "Add files" });
    await expect(zone).toContainText("They go to Remittance advices.");
    await expect(page.getByRole("button", { name: "Take a photo" })).toBeHidden();
    await page.getByTestId("upload-files-input").setInputFiles([
      { name: "invoice-2292.csv", mimeType: "text/csv", buffer: Buffer.from("a,b\n1,2") },
      pdf("invoice-2293.pdf"),
      { name: "notes.zip", mimeType: "application/zip", buffer: Buffer.from("x") },
      pdf("empty.pdf", ""),
    ]);
    const panel = page.getByRole("region", { name: "Just uploaded" });
    await expect(panel).toContainText("4 files to Remittance advices");
    const row = (name: string) => panel.getByRole("listitem").filter({ hasText: name });
    await expect(row("notes.zip")).toContainText("This file type can't be read in this flow.");
    await expect(row("empty.pdf")).toContainText("This file couldn't be opened. It may be password-protected or damaged.");
    await expect(row("invoice-2293.pdf")).toContainText("1 value to check", { timeout: 15_000 });
    await expect(row("invoice-2292.csv")).toContainText("Ready to send", { timeout: 15_000 });
    await row("invoice-2292.csv").getByRole("button", { name: "Send invoice-2292.csv" }).click();
    await expect(row("invoice-2292.csv")).toContainText(/Sending|Sent/);   // the mock lands on sent at once
    await expect(row("invoice-2292.csv").getByRole("button")).toHaveCount(0);
    await zone.evaluate((el) => {                                    // the same file dropped again
      const dt = new DataTransfer();
      dt.items.add(new File(["%PDF-1.4"], "invoice-2293.pdf", { type: "application/pdf" }));
      el.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
    });
    await expect(panel).toContainText("5 files to Remittance advices");
    await expect(row("invoice-2293.pdf").first()).toContainText("Already uploaded to this flow");
    await row("invoice-2293.pdf").last().getByRole("link", { name: "invoice-2293.pdf" }).click();
    await expect(page).toHaveURL(/\/flows\/flow-4\/documents\/[^/]+$/);
    await page.goBack();
    await expect(flows.getByRole("radio", { name: /^Remittance advices\s*Last used/ })).toBeChecked();
    await expect(panel).toContainText("5 files to Remittance advices");   // the queue outlives the screen
  });

  test("on a phone, Add sends a file and a checked photo, and the tab bar counts what they need", async ({ page }) => {
    await preparePage(page, { dismissCookieBanner: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/documents");
    const tabBar = page.getByTestId("tab-bar");
    await expect(tabBar.getByRole("link", { name: "Documents, 3 need you" })).toBeVisible();
    await tabBar.getByRole("button", { name: "Add a document" }).click();
    const sheet = page.getByRole("dialog", { name: "Add a document" });
    await expect(sheet.getByRole("button", { name: /^Goes to Supplier invoices\. Choose another flow$/ })).toBeVisible();
    await page.getByTestId("sheet-file-input").setInputFiles(pdf("invoice-2294.pdf", "%PDF-1.4 a"));
    await expect(page).toHaveURL(/\/upload$/);
    const panel = page.getByRole("region", { name: "Just uploaded" });
    await expect(panel).toContainText("invoice-2294.pdf");
    await tabBar.getByRole("button", { name: "Add a document" }).click();
    await expect(sheet.getByRole("button", { name: /^Goes to Supplier invoices, last used\./ })).toBeVisible();
    await page.getByTestId("sheet-camera-input").setInputFiles(jpg);
    const check = page.getByRole("dialog", { name: "Check the photo" });
    await expect(check.getByRole("img", { name: "The photo you took" })).toBeVisible();
    await check.getByRole("button", { name: "Use this photo" }).click();
    await expect(page).toHaveURL(/\/upload$/);
    await expect(panel.getByRole("listitem").filter({ hasText: /photo-\d{8}-\d{6}\.jpg/ })).toContainText("1 value to check", { timeout: 15_000 });
    await expect(panel.getByRole("listitem").filter({ hasText: "invoice-2294.pdf" })).toContainText("1 value to check");
    await expect(tabBar.getByRole("link", { name: "Documents, 5 need you" })).toBeVisible({ timeout: 15_000 });
  });

  test("on a phone, the sheet and the photo step cover the tab bar, and nothing is under 44px or scrolls sideways", async ({ page }) => {
    await preparePage(page, { dismissCookieBanner: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/upload");
    const box = async (l: import("@playwright/test").Locator) => (await l.boundingBox())!;
    const main = page.locator("main");
    expect(await main.evaluate((el) => el.scrollWidth - el.clientWidth), "no sideways scroll").toBeLessThanOrEqual(0);
    for (const name of ["Take a photo", "Choose files"]) expect((await box(page.getByRole("button", { name }))).height).toBe(48);
    for (const r of await page.getByRole("radio").all()) expect((await box(r.locator("xpath=ancestor::label"))).height).toBeGreaterThanOrEqual(44);
    await page.getByTestId("tab-bar").getByRole("button", { name: "Add a document" }).click();
    const sheet = page.getByRole("dialog", { name: "Add a document" });
    const s = await box(sheet);
    expect(Math.abs(s.y + s.height - 844), "the sheet sits on the screen's edge").toBeLessThanOrEqual(1);
    const flowsTab = await box(page.getByTestId("tab-bar").getByRole("link", { name: "Flows" }));
    expect(await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest('[data-testid="tab-bar"]'), [flowsTab.x + flowsTab.width / 2, flowsTab.y + flowsTab.height / 2])).toBe(false);
    for (const b of await sheet.getByRole("button").all()) expect((await box(b)).height).toBeGreaterThanOrEqual(44);
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await page.getByTestId("camera-input").setInputFiles(jpg);
    const check = page.getByRole("dialog", { name: "Check the photo" });
    expect(await box(check)).toEqual({ x: 0, y: 0, width: 390, height: 844 });
    const use = await box(check.getByRole("button", { name: "Use this photo" }));
    expect(use.height).toBe(48);
    expect(use.y + use.height).toBeLessThanOrEqual(844 - 26 + 1);
    await check.getByRole("button", { name: "Back" }).click();
    await expect(check).toBeHidden();
  });

  test("on a phone at 390 and 360, Upload, the sheet and the photo step stay on the screen, read at 12.5px or more, and fill one button", async ({ page }) => {
    await preparePage(page, { dismissCookieBanner: true });
    for (const width of [390, 360]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/documents");
      const tabBar = page.getByTestId("tab-bar");
      await tabBar.getByRole("button", { name: "Add a document" }).click();
      const sheet = page.getByRole("dialog", { name: "Add a document" });
      await sheet.getByRole("button", { name: /^Goes to / }).click();                     // the flow list open: the sheet at its fullest
      expect(await audit(sheet), `the sheet at ${width}`).toEqual({ outside: [], small: [], short: [], filled: 0 });
      await page.getByTestId("sheet-camera-input").setInputFiles(jpg);
      const check = page.getByRole("dialog", { name: "Check the photo" });
      await check.getByRole("button", { name: "Change the flow this photo goes to" }).click();
      expect(await audit(check), `the photo step at ${width}`).toEqual({ outside: [], small: [], short: [], filled: 1 });
      expect(await covered(page), `the photo step covers the tab bar at ${width}`).toBe(false);
      await check.getByRole("button", { name: "Back" }).click();
      await page.getByTestId("sheet-file-input").setInputFiles([
        pdf(`${"a-very-long-supplier-invoice-name-".repeat(3)}2295.pdf`),
        { name: "notes.zip", mimeType: "application/zip", buffer: Buffer.from("x") },
      ]);
      await expect(page).toHaveURL(/\/upload$/);
      const panel = page.getByRole("region", { name: "Just uploaded" });
      await expect(panel.getByRole("listitem").filter({ hasText: "notes.zip" })).toContainText("This file type can't be read in this flow.");
      await expect(panel.getByRole("listitem").filter({ hasText: "2295.pdf" })).toContainText("1 value to check", { timeout: 15_000 });
      expect(await audit(page.locator("main")), `Upload at ${width}`).toEqual({ outside: [], small: [], short: [], filled: 1 });
    }
  });

  test("on a phone, the sheet and the photo step hold the keyboard, Escape steps back, and focus lands on Add", async ({ page }) => {
    await preparePage(page, { dismissCookieBanner: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/documents");
    const add = page.getByTestId("tab-bar").getByRole("button", { name: "Add a document" });
    const focusIn = (l: import("@playwright/test").Locator) => l.evaluate((el) => el.contains(document.activeElement));
    const tabsStayIn = async (l: import("@playwright/test").Locator) => {
      for (const key of [...Array(12).fill("Tab"), ...Array(12).fill("Shift+Tab")]) {
        await page.keyboard.press(key);
        expect(await focusIn(l), `focus after ${key}`).toBe(true);
      }
    };
    await add.click();
    const sheet = page.getByRole("dialog", { name: "Add a document" });
    await expect.poll(() => focusIn(sheet)).toBe(true);
    await tabsStayIn(sheet);
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(add).toBeFocused();
    await add.click();
    await page.getByTestId("sheet-camera-input").setInputFiles(jpg);
    const check = page.getByRole("dialog", { name: "Check the photo" });
    await expect.poll(() => focusIn(check)).toBe(true);
    await tabsStayIn(check);
    await page.keyboard.press("Escape");                                                // back to the sheet, not out of it
    await expect(check).toBeHidden();
    await expect.poll(() => focusIn(sheet)).toBe(true);
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(add).toBeFocused();
  });

  test("on a phone, Retake leaves nothing to send, and Use this photo sends the new photo once", async ({ page }) => {
    await preparePage(page, { dismissCookieBanner: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/documents");
    await page.getByTestId("tab-bar").getByRole("button", { name: "Add a document" }).click();
    await page.getByTestId("sheet-camera-input").setInputFiles(jpg);
    const check = page.getByRole("dialog", { name: "Check the photo" });
    await check.getByRole("button", { name: "Retake" }).click();                        // the camera opens; nobody takes a photo
    await expect(check).toBeHidden();
    await expect(page.getByRole("button", { name: "Use this photo" })).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "Add a document" })).toBeVisible();
    await expect(page).toHaveURL(/\/documents$/);
    await page.getByTestId("sheet-camera-input").setInputFiles({ ...jpg, buffer: Buffer.from([0xff, 0xd8, 0x00, 0xff, 0xd9]) });
    const use = check.getByRole("button", { name: "Use this photo" });
    await use.evaluate((b: HTMLElement) => { b.click(); b.click(); });                   // pressed twice before the step closes
    await expect(page).toHaveURL(/\/upload$/);
    const panel = page.getByRole("region", { name: "Just uploaded" });
    await expect(panel).toContainText("1 file to Supplier invoices");
    await expect(panel.getByRole("listitem")).toHaveCount(1);
  });

  test("the drop zone stays blue while a file is dragged over what is inside it", async ({ page }) => {
    await preparePage(page, { dismissCookieBanner: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/upload");
    const zone = page.getByTestId("upload-drop");
    const blue = () => zone.evaluate((el) => getComputedStyle(el).borderTopColor);
    const idle = await blue();
    const drag = (type: string, on: "zone" | "heading" | "button", to: "zone" | "heading" | "button" | "outside") => zone.evaluate((el, [type, on, to]) => {
      const pick = (k: string) => (k === "zone" ? el : k === "heading" ? el.querySelector("h2")! : k === "button" ? el.querySelector("button")! : document.body);
      pick(on).dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, relatedTarget: pick(to), dataTransfer: new DataTransfer() }));
      // A drag event is not a discrete one: React renders it later. Two frames, so the border read follows the render.
      return new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
    }, [type, on, to] as const);
    await drag("dragenter", "zone", "outside");
    // Repeated, as a browser does while a file hovers: the first may land before the page is hydrated.
    await expect.poll(async () => { await drag("dragover", "zone", "outside"); return blue(); }, { message: "blue while dragged over" }).not.toBe(idle);
    const dragging = await blue();
    // Into the heading, then on to the button: the browser fires a dragleave at what was left each time.
    await drag("dragenter", "heading", "zone");
    await drag("dragleave", "zone", "heading");
    expect(await blue(), "still blue over the heading").toBe(dragging);
    await drag("dragenter", "button", "heading");
    await drag("dragleave", "heading", "button");
    expect(await blue(), "still blue over the button").toBe(dragging);
    await drag("dragleave", "button", "outside");
    await expect.poll(blue, { message: "back to grey once the file leaves" }).toBe(idle);
  });
});

/** Is the middle of the tab bar's Flows tab hidden behind something? */
const covered = (page: import("@playwright/test").Page) => page.evaluate(() => {
  const r = document.querySelector('[data-testid="tab-bar"] a[href="/flows"]')!.getBoundingClientRect();
  return !!document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('[data-testid="tab-bar"]');
});

/**
 * Measured inside `root`: every visible box and every visible text line edge (clipped by the
 * overflow it sits in) inside the screen and inside its card; text under 12.5px; links and buttons
 * shorter than 44px; and how many buttons are filled (an opaque dark background).
 */
const audit = (root: import("@playwright/test").Locator) => root.evaluate((top) => {
  const W = window.innerWidth;
  const outside: string[] = [], small: string[] = [], short: string[] = [];
  const name = (el: Element) => `${el.tagName.toLowerCase()} "${(el.textContent ?? "").trim().slice(0, 40)}"`;
  const shown = (el: Element) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden"; };
  const cardOf = (el: Element) => {
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (a.getAttribute("role") === "dialog" || (parseFloat(s.borderTopWidth) > 0 && parseFloat(s.borderTopLeftRadius) > 0)) return a;
    }
    return null;
  };
  // Clipped only by what sits inside the card (a truncated name): a card or a screen that cuts text off is the overflow itself.
  const clip = (el: Element, card: Element | null) => {
    let [l, r] = [-Infinity, Infinity];
    for (let a: Element | null = el; a && a !== card && a !== top; a = a.parentElement) {
      if (getComputedStyle(a).overflowX === "visible") continue;
      const b = a.getBoundingClientRect();
      [l, r] = [Math.max(l, b.left), Math.min(r, b.right)];
    }
    return [l, r];
  };
  const check = (el: Element, left: number, right: number, what: string) => {
    const card = cardOf(el);
    const [cl, cr] = clip(el, card);
    [left, right] = [Math.max(left, cl), Math.min(right, cr)];
    if (right - left <= 0.5) return;                                                       // clipped away entirely
    const c = card?.getBoundingClientRect();
    if (left < -0.5 || right > W + 0.5) outside.push(`${what} ${name(el)} ${left.toFixed(1)}..${right.toFixed(1)} on a ${W} screen`);
    else if (c && (left < c.left - 0.5 || right > c.right + 0.5)) outside.push(`${what} ${name(el)} ${left.toFixed(1)}..${right.toFixed(1)} in a card ${c.left.toFixed(1)}..${c.right.toFixed(1)}`);
  };
  for (const el of [top, ...top.querySelectorAll("*")]) {
    if (!shown(el)) continue;
    const r = el.getBoundingClientRect();
    if (getComputedStyle(el).transform === "none") check(el, r.left, r.right, "box");     // the tilted papers are a picture
  }
  const walker = document.createTreeWalker(top, NodeFilter.SHOW_TEXT);
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    const el = t.parentElement!;
    if (!t.textContent!.trim() || !shown(el)) continue;
    if (parseFloat(getComputedStyle(el).fontSize) < 12.5) small.push(`${name(el)} ${getComputedStyle(el).fontSize}`);
    const range = document.createRange();
    range.selectNodeContents(t);
    for (const line of range.getClientRects()) check(el, line.left, line.right, "text line");
  }
  let filled = 0;
  for (const el of top.querySelectorAll("a, button")) {
    if (!shown(el)) continue;
    const h = el.getBoundingClientRect().height;
    const inSentence = el.tagName === "A" && [...el.parentElement!.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim());
    if (h < 44 && !inSentence) short.push(`${name(el)} ${h.toFixed(1)}px`);
    const [r, g, b, a = 1] = (getComputedStyle(el).backgroundColor.match(/[\d.]+/g) ?? []).map(Number);
    if (a > 0.9 && 0.2126 * r + 0.7152 * g + 0.0722 * b < 128) filled++;
  }
  return { outside, small, short, filled };
});
