import { test, expect } from "@playwright/test";
import { preparePage } from "./a11yHarness";
import { audit } from "./layoutAudit";

const pdf = (name: string, body = "%PDF-1.4") => ({ name, mimeType: "application/pdf", buffer: Buffer.from(body) });
const jpg = { name: "image.jpg", mimeType: "image/jpeg", buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) };

test.describe("upload", () => {
  test.describe.configure({ timeout: 120_000 });

  test("several files at once, with no flow to choose: each is sorted, says what it is, and a ready one is sent from its row", async ({ page }) => {
    await preparePage(page, { dismissCookieBanner: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/upload");
    await expect(page.getByRole("heading", { level: 1, name: "Add documents" })).toBeVisible();
    const zone = page.getByRole("region", { name: "Add files" });
    await expect(zone).toContainText("Invoices, orders, delivery notes, statements: any document.");
    await expect(page.getByRole("radio")).toHaveCount(0);                                   // no flow question
    await expect(page.getByRole("group", { name: "Which flow is this for?" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Take a photo" })).toBeHidden();
    await page.getByTestId("upload-files-input").setInputFiles([
      { name: "invoice-2292.csv", mimeType: "text/csv", buffer: Buffer.from("a,b\n1,2") },
      pdf("invoice-2293.pdf"),
      { name: "notes.zip", mimeType: "application/zip", buffer: Buffer.from("x") },
      pdf("empty.pdf", ""),
    ]);
    const panel = page.getByRole("region", { name: "Just added" });
    await expect(panel).toContainText("4 documents");
    const row = (name: string) => panel.getByRole("listitem").filter({ hasText: name });
    await expect(row("notes.zip")).toContainText("This file type can't be read.");
    await expect(row("empty.pdf")).toContainText("This file couldn't be opened. It may be password-protected or damaged.");
    // Read, then sorted by the mock's rules: Example Supplier Ltd's invoices go to Supplier invoices.
    await expect(row("invoice-2293.pdf")).toContainText("1 value to check", { timeout: 15_000 });
    await expect(row("invoice-2293.pdf")).toContainText("An invoice from Example Supplier Ltd");
    await expect(row("invoice-2292.csv")).toContainText("Ready to send", { timeout: 15_000 });
    await expect(row("invoice-2292.csv")).toContainText("An invoice from Example Supplier Ltd");
    await row("invoice-2292.csv").getByRole("button", { name: "Send invoice-2292.csv" }).click();
    await expect(row("invoice-2292.csv")).toContainText(/Sending|Sent/);   // the mock lands on sent at once
    await expect(row("invoice-2292.csv").getByRole("button")).toHaveCount(0);
    await zone.evaluate((el) => {                                    // the same file dropped again
      const dt = new DataTransfer();
      dt.items.add(new File(["%PDF-1.4"], "invoice-2293.pdf", { type: "application/pdf" }));
      el.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
    });
    await expect(panel).toContainText("5 documents");
    await expect(row("invoice-2293.pdf").first()).toContainText("Already in your workspace");
    await row("invoice-2293.pdf").last().getByRole("link", { name: "invoice-2293.pdf" }).click();
    await expect(page).toHaveURL(/\/flows\/flow-1\/documents\/[^/]+$/);                     // the first copy, sorted
    await page.goBack();
    await expect(panel).toContainText("5 documents");                                       // the queue outlives the screen
  });

  test("on a phone, Add sends a file and a checked photo, and the tab bar counts what they need", async ({ page }) => {
    await preparePage(page, { dismissCookieBanner: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/documents");
    const tabBar = page.getByTestId("tab-bar");
    await expect(tabBar.getByRole("link", { name: "Documents, 3 need you" })).toBeVisible();
    await tabBar.getByRole("button", { name: "Add a document" }).click();
    const sheet = page.getByRole("dialog", { name: "Add a document" });
    // No flow to choose: the three ways in, and nothing that says where a file goes.
    for (const name of ["Close", "Take a photo", "Choose a file", "Choose from your photos"]) await expect(sheet.getByRole("button", { name, exact: true })).toBeVisible();
    await expect(sheet.getByRole("button")).toHaveCount(4);
    await expect(sheet).not.toContainText("Goes to");
    await page.getByTestId("sheet-file-input").setInputFiles(pdf("invoice-2294.pdf", "%PDF-1.4 a"));
    await expect(page).toHaveURL(/\/upload$/);
    const panel = page.getByRole("region", { name: "Just added" });
    await expect(panel).toContainText("invoice-2294.pdf");
    await tabBar.getByRole("button", { name: "Add a document" }).click();
    await page.getByTestId("sheet-camera-input").setInputFiles(jpg);
    const check = page.getByRole("dialog", { name: "Check the photo" });
    await expect(check.getByRole("img", { name: "The photo you took" })).toBeVisible();
    await expect(check.getByRole("button", { name: /Change the flow/ })).toHaveCount(0);
    await expect(check).not.toContainText("Goes to");
    await check.getByRole("button", { name: "Use this photo" }).click();
    await expect(page).toHaveURL(/\/upload$/);
    // A photo of no kind we know waits in the workspace as a new kind; the invoice is sorted into Supplier invoices.
    const photoRow = panel.getByRole("listitem").filter({ hasText: /photo-\d{8}-\d{6}\.jpg/ });
    await expect(photoRow).toContainText("New kind", { timeout: 15_000 });
    await expect(photoRow).toContainText("A document. The first of its kind here.");
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
    await expect(page.getByRole("radio")).toHaveCount(0);                                   // no flow list to tap through
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

  test("on a phone at 390 and 360, Add documents, the sheet and the photo step stay on the screen, read at 12.5px or more, and fill one button", async ({ page }) => {
    await preparePage(page, { dismissCookieBanner: true });
    for (const width of [390, 360]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/documents");
      const tabBar = page.getByTestId("tab-bar");
      await tabBar.getByRole("button", { name: "Add a document" }).click();
      const sheet = page.getByRole("dialog", { name: "Add a document" });
      await expect(sheet.getByRole("button", { name: "Choose a file" })).toBeVisible();
      expect(await audit(sheet), `the sheet at ${width}`).toEqual({ outside: [], small: [], short: [], filled: 0 });
      await page.getByTestId("sheet-camera-input").setInputFiles(jpg);
      const check = page.getByRole("dialog", { name: "Check the photo" });
      await expect(check.getByRole("button", { name: "Use this photo" })).toBeVisible();
      expect(await audit(check), `the photo step at ${width}`).toEqual({ outside: [], small: [], short: [], filled: 1 });
      expect(await covered(page), `the photo step covers the tab bar at ${width}`).toBe(false);
      await check.getByRole("button", { name: "Back" }).click();
      await page.getByTestId("sheet-file-input").setInputFiles([
        pdf(`${"a-very-long-supplier-invoice-name-".repeat(3)}2295.pdf`),
        { name: "notes.zip", mimeType: "application/zip", buffer: Buffer.from("x") },
      ]);
      await expect(page).toHaveURL(/\/upload$/);
      const panel = page.getByRole("region", { name: "Just added" });
      await expect(panel.getByRole("listitem").filter({ hasText: "notes.zip" })).toContainText("This file type can't be read.");
      await expect(panel.getByRole("listitem").filter({ hasText: "2295.pdf" })).toContainText("1 value to check", { timeout: 15_000 });
      expect(await audit(page.locator("main")), `Add documents at ${width}`).toEqual({ outside: [], small: [], short: [], filled: 1 });
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
    const panel = page.getByRole("region", { name: "Just added" });
    await expect(panel).toContainText("1 document");
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
