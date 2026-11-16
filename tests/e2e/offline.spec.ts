import { test, expect, type Page } from "@playwright/test";
import { preparePage, settle } from "./a11yHarness";

// Offline in the app, on the mock dev server. `context.setOffline` is what the browser does
// when the connection drops: `navigator.onLine` goes false and every fetch fails. Only the
// document engine's mock fails offline (mockEngineFetch); the screens here are all served by it.
//
// Not covered here, and why: a 503 on a held file's first upload then Try again (the mock
// uploads in memory, so there is no request to answer 503; pinned in UploadQueue.test.tsx),
// and anything that needs a signed-in person (Clerk is dormant in mock mode).

const JPG = {
  name: "delivery-note-78.jpg",
  mimeType: "image/jpeg",
  buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]),
};
const EMPTY = { name: "empty.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(0) };

/** Files in the device store. The open is aborted if the database does not exist yet, so reading never creates it. */
const heldRecords = (page: Page) =>
  page.evaluate(() => new Promise<number>((resolve, reject) => {
    let missing = false;
    const open = indexedDB.open("plk-device");
    open.onupgradeneeded = () => { missing = true; open.transaction!.abort(); };
    open.onerror = () => (missing ? resolve(0) : reject(open.error));
    open.onsuccess = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains("held-uploads")) { db.close(); resolve(0); return; }
      const count = db.transaction("held-uploads").objectStore("held-uploads").count();
      count.onsuccess = () => { db.close(); resolve(count.result); };
      count.onerror = () => { db.close(); reject(count.error); };
    };
  }));

const openUpload = async (page: Page) => {
  await preparePage(page, { dismissCookieBanner: true });
  await page.goto("/upload");
  await expect(page.getByRole("button", { name: "Choose files" })).toBeVisible();
};
const justAdded = (page: Page, name: string) =>
  page.getByRole("region", { name: "Just added" }).getByRole("listitem").filter({ hasText: name });

test.describe("offline", () => {
  test.describe.configure({ timeout: 120_000 });

  test.afterEach(async ({ context, page }) => {
    await context.setOffline(false);
    // Test setup, not a product path: the next test starts with an empty device store.
    await page.evaluate(() => { indexedDB.deleteDatabase("plk-device"); }).catch(() => {});
  });

  test("says it is offline, keeps the rows, and does not draw a send as done", async ({ page, context }) => {
    await preparePage(page, { dismissCookieBanner: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/documents?show=all");
    const table = page.getByRole("table");
    const row = table.getByRole("row", { name: /invoice-1002\.pdf/ });
    await expect(row).toBeVisible();
    await settle(page);
    const rows = await table.getByRole("row").count();
    const notice = page.getByTestId("offline-notice");
    await expect(notice).toHaveText("");

    await context.setOffline(true);
    await expect(notice).toHaveText("You're offline. Showing what was loaded last.");
    await page.evaluate(() => { window.dispatchEvent(new Event("focus")); document.dispatchEvent(new Event("visibilitychange")); });
    await settle(page);
    await expect(table.getByRole("row")).toHaveCount(rows);

    const send = row.getByRole("button", { name: "Send invoice-1002.pdf" });
    await send.click();
    await expect(row.getByRole("alert")).toHaveText("Something went wrong. Try again.");
    await expect(send).toBeEnabled();
    await expect(row).not.toContainText(/Sending|Sent\b/);

    await context.setOffline(false);
    await expect(notice).toHaveText("");
  });

  test("a file added offline waits on the device and goes up once when the connection returns", async ({ page, context }) => {
    await openUpload(page);
    await context.setOffline(true);
    await page.getByTestId("upload-files-input").setInputFiles(JPG);
    const row = justAdded(page, JPG.name);
    await expect(row).toContainText("Waiting for connection");
    await expect(row).toContainText("It uploads when you're back online.");
    await expect.poll(() => heldRecords(page)).toBe(1);

    await context.setOffline(false);
    await expect(row.getByRole("link", { name: JPG.name })).toBeVisible();          // uploaded: the row opens its document
    await expect(row).not.toContainText("Waiting");
    await expect.poll(() => heldRecords(page)).toBe(0);
    await settle(page);
    await expect(page.getByText(JPG.name, { exact: true })).toHaveCount(1);
  });

  test("a held file from a closed tab goes up from exactly one of two new tabs", async ({ page, context }) => {
    // B and C are open before A holds the file, so both meet it at the same moment: when the
    // connection returns. Opened one after the other, the first would send it before the second
    // looked, and the test would pass without the lock (checked by making the claim always win).
    const tabs = [page, await context.newPage()];
    for (const tab of tabs) await openUpload(tab);
    const a = await context.newPage();
    await openUpload(a);
    await context.setOffline(true);
    await a.getByTestId("upload-files-input").setInputFiles(JPG);
    await expect(justAdded(a, JPG.name)).toContainText("Waiting for connection");
    await expect.poll(() => heldRecords(a)).toBe(1);
    await a.close();
    // The closed tab's lock is released a moment after it closes. The two tabs look only once,
    // when the connection returns, so wait for the release first: on a slow runner the
    // connection came back while the lock was still held, and neither tab took the file.
    const heldLocks = () => tabs[0].evaluate(async () => ((await navigator.locks.query()).held ?? []).filter((l) => l.name?.startsWith("plk-held:")).length);
    await expect.poll(heldLocks).toBe(0);
    await context.setOffline(false);

    const listed = async () => (await Promise.all(tabs.map((tab) => tab.getByText(JPG.name, { exact: true }).count()))).reduce((a, b) => a + b);
    await expect.poll(listed).toBe(1);
    await expect.poll(() => heldRecords(tabs[0])).toBe(0);
    await Promise.all(tabs.map((tab) => settle(tab)));
    expect(await listed(), "still exactly one row across both tabs").toBe(1);
    const done = async () => (await Promise.all(tabs.map((tab) => tab.getByRole("link", { name: JPG.name }).count()))).reduce((a, b) => a + b);
    await expect.poll(done).toBe(1);
  });

  test("an empty held file is refused on arrival in the server's words, and can be removed", async ({ page, context }) => {
    await openUpload(page);
    await context.setOffline(true);
    await page.getByTestId("upload-files-input").setInputFiles(EMPTY);
    const row = justAdded(page, EMPTY.name);
    await expect(row).toContainText("Waiting for connection");
    await expect.poll(() => heldRecords(page)).toBe(1);

    await context.setOffline(false);
    await expect(row).toContainText("Not uploaded");
    await expect(row).toContainText("This file couldn't be opened. It may be password-protected or damaged.");
    await row.getByRole("button", { name: `Remove ${EMPTY.name}` }).click();
    await expect(row).toHaveCount(0);
    await expect.poll(() => heldRecords(page)).toBe(0);
  });

  test("the switch removes a worker and its caches; the Add sheet stays put offline", async ({ page, context }) => {
    await preparePage(page, { dismissCookieBanner: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/documents");
    await settle(page);
    const registrations = () => page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length);
    const cacheNames = () => page.evaluate(() => caches.keys());
    await page.evaluate(async () => { await navigator.serviceWorker.register("/sw.js"); await caches.open("plk-test"); });
    expect(await registrations(), "the worker was registered").toBe(1);
    expect(await cacheNames()).toContain("plk-test");
    await page.reload();                                                               // a non-production build runs the off path on load
    await expect.poll(registrations).toBe(0);
    await expect.poll(cacheNames).not.toContain("plk-test");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/documents");
    await settle(page);
    await context.setOffline(true);
    await page.getByTestId("tab-bar").getByRole("button", { name: "Add a document" }).click();
    const sheet = page.getByRole("dialog", { name: "Add a document" });
    await expect(sheet).toBeVisible();
    await page.getByTestId("sheet-file-input").setInputFiles(JPG);
    await expect(sheet).toBeHidden();
    await expect(page).toHaveURL(/\/documents$/);
    const strip = page.getByTestId("held-uploads");
    await expect(strip).toContainText(JPG.name);
    await expect(strip).toContainText("Waiting for connection");

    await context.setOffline(false);
    await expect(strip).toBeHidden();                                                  // it went up, and left the strip
  });
});
