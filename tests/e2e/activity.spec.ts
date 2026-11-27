import { test, expect, type Locator, type Page } from "@playwright/test";
import { MOCK_ENGINE_IDS } from "../../src/lib/api/mockEngine";
import { preparePage, settle } from "./a11yHarness";

// The row times and day headings are read in the browser's zone; the mock's fixtures are written in UTC.
test.use({ timezoneId: "UTC" });

const box = async (l: Locator) => (await l.boundingBox())!;
const rows = (page: Page) => page.getByTestId("activity-row");
const tab = (page: Page, name: string) => page.getByRole("tab", { name, exact: true });
const failedRow = (page: Page) => rows(page).filter({ hasText: "invoice-1004.csv couldn't be sent to Accounting inbox" });
const pager = (page: Page) => page.getByRole("navigation", { name: "History pages" });

/** Records, on every DOM change, how many rows are on screen while the named tab is selected. */
const watchRows = (page: Page, tabName: string) => page.evaluate((name) => {
  const w = window as unknown as { __rowsSeen: number[] };
  w.__rowsSeen = [];
  new MutationObserver(() => {
    if (document.querySelector('[role="tab"][aria-selected="true"]')?.textContent === name)
      w.__rowsSeen.push(document.querySelectorAll('[data-testid="activity-row"]').length);
  }).observe(document.body, { subtree: true, childList: true, attributes: true });
}, tabName);
const rowsSeen = (page: Page) => page.evaluate(() => (window as unknown as { __rowsSeen: number[] }).__rowsSeen);

test.describe("history", () => {
  test.describe.configure({ timeout: 180_000 });

  test("desktop: tabs, the open failed row, Send again, paging", async ({ page }) => {
    await preparePage(page, { dismissCookieBanner: true, freezeClock: true });
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.goto("/operations/log");
    await expect(page.getByRole("heading", { level: 1, name: "History" })).toBeVisible();
    await expect(page).toHaveTitle("History — ProcuLink");
    await expect(page.getByRole("heading", { name: "Today, 1 June" })).toBeVisible();
    await expect(page.getByRole("tablist", { name: "Show" }).getByRole("tab")).toHaveText(["All", "Changes"]);
    await expect(tab(page, "All")).toHaveAttribute("aria-selected", "true");
    await expect(pager(page)).toContainText("Showing the newest 50 of 61.");
    await expect(pager(page).getByRole("link", { name: "Newer" })).toHaveCount(0);

    // A new tab never shows the rows of the one before, even for a moment.
    await watchRows(page, "Changes");
    await tab(page, "Changes").click();
    await expect(page).toHaveURL(/\/operations\/log\?show=changes$/);
    await expect(pager(page)).toContainText(/Showing all \d+\./);
    const changes = await rows(page).count();
    expect(changes, "rows under Changes").toBeLessThan(50);
    const seen = await rowsSeen(page);
    expect(seen.length, "DOM changes watched under Changes").toBeGreaterThan(0);
    expect(Math.max(...seen), "rows seen under Changes").toBeLessThanOrEqual(changes);

    // The old Couldn't send address reads as All, and the failed row is there.
    await page.goto("/operations/log?show=failed");
    await expect(tab(page, "All")).toHaveAttribute("aria-selected", "true");
    const row = failedRow(page);
    await expect(row).toHaveCount(1);

    // The open failed row says in words where the send stopped, and offers one filled way on.
    await row.getByRole("button", { name: "Show details" }).click();
    const detail = row.getByTestId("activity-detail");
    await expect(detail).toContainText("Attempts");
    await expect(detail).toContainText("3, the last at 08:06. We stopped there.");
    const fix = detail.getByRole("link", { name: "Fix the destination" });
    await expect(fix).toHaveCount(1);
    await expect(fix).toHaveAttribute("href", "/settings?tab=destinations&open=dest-1");
    await expect(row.getByRole("button", { name: "Hide details" })).toHaveAttribute("aria-expanded", "true");

    // Send again says what happened, once, beside the button. (The mock engine answers in the page, with no
    // request to count, so "one send per press" is pinned by ActivityRow.test.tsx; here the press must land.)
    await detail.getByRole("button", { name: "Send again" }).dblclick();
    await expect(page.getByText("Sending again. A new row shows the result.")).toHaveCount(1);
    await expect(detail.getByRole("button", { name: "Send again" })).toBeEnabled();

    // The way on lands on a real screen, and Back returns to the same tab.
    await fix.click();
    await expect(page).toHaveURL(/\/settings\?tab=destinations&open=dest-1$/);
    await expect(page.getByText(/could not be found|404/i)).toHaveCount(0);
    await page.goBack();
    await expect(page).toHaveURL(/\/operations\/log\?show=failed$/);
    await expect(tab(page, "All")).toHaveAttribute("aria-selected", "true");
    await failedRow(page).getByRole("button", { name: "Show details" }).click();
    await failedRow(page).getByRole("link", { name: "Open document" }).click();
    await expect(page).toHaveURL(new RegExp(`/flows/${MOCK_ENGINE_IDS.setupFlow}/documents/doc-4$`));
    await expect(page.getByText("invoice-1004.csv").first()).toBeVisible();
    await expect(page.getByText(/could not be found|404/i)).toHaveCount(0);
    await page.goBack();
    await expect(tab(page, "All")).toHaveAttribute("aria-selected", "true");

    // The filter survives a reload.
    await page.goto("/operations/log?show=changes");
    await page.reload();
    await expect(tab(page, "Changes")).toHaveAttribute("aria-selected", "true");
    await expect(rows(page)).toHaveCount(changes);

    // The way back: Documents, at the top of the page.
    await page.getByRole("link", { name: "Back to Documents" }).click();
    await expect(page).toHaveURL(/\/documents$/);
    await page.goBack();

    // Paging: Older and Newer are links in the address, absent at either end.
    await tab(page, "All").click();
    await expect(page).toHaveURL(/\/operations\/log$/);
    await expect(pager(page)).toContainText("Showing the newest 50 of 61.");
    await pager(page).getByRole("link", { name: "Older" }).click();
    await expect(page).toHaveURL(/\/operations\/log\?page=2$/);
    await expect(pager(page)).toContainText("Showing 51 to 61 of 61.");
    await expect(rows(page)).toHaveCount(11);
    await expect(pager(page).getByRole("link", { name: "Older" })).toHaveCount(0);
    await expect(pager(page).getByRole("link", { name: "Newer" })).toHaveAttribute("href", "/operations/log");
    const second = rows(page).filter({ hasText: "invoice-1001.csv" }).first();
    await second.getByRole("button", { name: "Show details" }).click();
    await second.getByRole("link", { name: "Open document" }).click();
    await expect(page).toHaveURL(/\/flows\/[^/]+\/documents\/doc-1$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/operations\/log\?page=2$/);
    await expect(pager(page)).toContainText("Showing 51 to 61 of 61.");

    // A page past the end says so and leads back.
    await page.goto("/operations/log?page=9");
    await expect(page.getByText("There is nothing on this page.")).toBeVisible();
    await page.getByRole("link", { name: "First page" }).click();
    await expect(page).toHaveURL(/\/operations\/log$/);
    await expect(pager(page)).toContainText("Showing the newest 50 of 61.");

    // A search looks at documents only: the flow version put in use is not among its rows.
    await expect(rows(page).filter({ hasText: "was put in use" }).first(), "the row the search must leave out is there before it").toBeVisible();
    await page.getByRole("searchbox", { name: "Search history" }).fill("invoice-1003");
    await expect(rows(page).first()).toContainText("invoice-1003");
    await expect(pager(page)).toContainText(/Showing all \d+\./);
    await expect(rows(page).filter({ hasText: "was put in use" })).toHaveCount(0);

    // Export hands over a CSV of the tab, and a second press while it runs does nothing.
    await page.getByRole("searchbox", { name: "Search history" }).fill("");
    await expect(pager(page)).toContainText("Showing the newest 50 of 61.");
    const downloads: import("@playwright/test").Download[] = [];
    page.on("download", (d) => downloads.push(d));
    const first = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download CSV" }).dblclick();
    const file = await first;
    expect(file.suggestedFilename()).toBe("history-2026-06-01.csv");
    const text = await (await file.createReadStream()).toArray().then((c) => Buffer.concat(c).toString("utf8"));
    expect(text.split(/\r?\n/)[0]).toBe('"Date","Time","What happened","Flow","Who","Result","Details"');
    expect(text.split(/\r?\n/).filter(Boolean)).toHaveLength(62);
    await page.waitForTimeout(1500);
    expect(downloads, "files for one double press").toHaveLength(1);
  });

  test("phone: fits, 44px controls, last control clear of the tab bar", async ({ page }) => {
    await preparePage(page, { dismissCookieBanner: true, freezeClock: true });
    for (const width of [390, 360]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/operations/log");
      await settle(page);
      const row = failedRow(page);
      await row.getByRole("button", { name: "Show details" }).click();
      await expect(row.getByTestId("activity-detail")).toBeVisible();
      // The longest reply a server might write still wraps inside the row.
      await row.getByTestId("activity-detail").locator("dd").first().evaluate((el) => { el.textContent = "x".repeat(600); });

      // Nothing in main passes the right edge: no box, and no line of text (text spills out of its box, and a
      // card's overflow-hidden would cut it silently). Exempt: what sits in a strip that scrolls sideways, and
      // text cut on purpose with an ellipsis.
      const over = await page.evaluate(() => {
        const vw = window.innerWidth;
        const main = document.querySelector("main")!;
        /** The nearest ancestor that does not let content show past its edge, and how it treats it. */
        const clip = (el: Element) => {
          for (let p: Element | null = el; p && p !== main; p = p.parentElement) {
            const cs = getComputedStyle(p);
            if (cs.textOverflow === "ellipsis" && cs.overflowX !== "visible") return { exempt: true, right: vw };
            if (p !== el && (cs.overflowX === "auto" || cs.overflowX === "scroll")) return { exempt: true, right: vw };
            if (p !== el && cs.overflowX !== "visible") return { exempt: false, right: Math.min(vw, p.getBoundingClientRect().right) };
          }
          return { exempt: false, right: vw };
        };
        const name = (el: Element) => `${el.tagName}.${(el as HTMLElement).className}`.slice(0, 100);
        const boxes = [...main.querySelectorAll("*")].filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.right > vw + 0.5 && !clip(el).exempt;
        }).map(name);
        const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
        const texts: string[] = [];
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          if (!n.textContent!.trim()) continue;
          const c = clip(n.parentElement!);
          if (c.exempt) continue;
          const range = document.createRange();
          range.selectNodeContents(n);
          const right = Math.max(...[...range.getClientRects()].map((r) => r.right));
          if (right > c.right + 0.5) texts.push(`"${n.textContent!.trim().slice(0, 30)}" in ${name(n.parentElement!)} to ${Math.round(right)}`);
        }
        return [...boxes, ...texts];
      });
      expect(over, `boxes and text past the right edge at ${width}`).toEqual([]);
      expect(await page.locator("#main-content").evaluate((el) => Math.max(...[el, ...el.children].map((e) => e.scrollWidth - e.clientWidth))),
        `sideways scroll at ${width}`).toBeLessThanOrEqual(1);

      // Every stand-alone control is a 44px target.
      const detail = row.getByTestId("activity-detail");
      const controls = [
        row.getByRole("button", { name: "Hide details" }),
        ...["All", "Changes"].map((n) => tab(page, n)),
        page.getByRole("searchbox", { name: "Search history" }),
        page.getByRole("button", { name: "Download CSV" }),
        detail.getByRole("link", { name: "Fix the destination" }),
        detail.getByRole("button", { name: "Send again" }),
        detail.getByRole("link", { name: "Open document" }),
        pager(page).getByRole("link", { name: "Older" }),
      ];
      for (const c of controls) expect((await box(c)).height, `${c} at ${width}`).toBeGreaterThanOrEqual(44);
      // 16px, so a phone does not zoom the page when the field takes focus.
      expect(await page.getByRole("searchbox", { name: "Search history" }).evaluate((el) => getComputedStyle(el).fontSize)).toBe("16px");

      // No visible text under 12.5px.
      const small = await page.evaluate(() => [...document.querySelectorAll("main *")]
        .filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim()) && el.getBoundingClientRect().width > 1)
        .filter((el) => parseFloat(getComputedStyle(el).fontSize) < 12.5)
        .map((el) => `${el.tagName} ${getComputedStyle(el).fontSize} "${el.textContent!.trim().slice(0, 30)}"`));
      expect(small, `text under 12.5px at ${width}`).toEqual([]);

      // At the end of the page the last row and the pager sit above the tab bar and away from the round Add button.
      await page.evaluate(() => { for (const el of document.querySelectorAll("main, main *")) if (el.scrollHeight > el.clientHeight + 1) el.scrollTop = el.scrollHeight; });
      await page.waitForTimeout(200);
      const tabBar = await box(page.getByTestId("tab-bar"));
      const add = await box(page.getByTestId("tab-bar").getByRole("button", { name: "Add a document" }));
      const vh = await page.evaluate(() => window.innerHeight);
      const older = await box(pager(page).getByRole("link", { name: "Older" }));
      const last = await box(rows(page).last());
      expect(older.y + older.height, `Older's bottom at ${width}`).toBeLessThanOrEqual(vh - tabBar.height - 15);
      expect(older.y + older.height, `Older clears the Add button at ${width}`).toBeLessThanOrEqual(add.y);
      expect(Math.abs(older.x + older.width / 2 - width / 2), `Older's distance from the centre at ${width}`).toBeGreaterThan(40);
      expect(last.y + last.height, `the last row's bottom at ${width}`).toBeLessThanOrEqual(Math.min(tabBar.y, add.y));
    }

    // Opened on the last filter, the selected tab is inside its strip. The two tabs fit even at 320: the strip does not scroll.
    for (const width of [360, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/operations/log?show=changes");
      await settle(page);
      const strip = page.getByRole("tablist", { name: "Show" });
      expect(await strip.evaluate((el) => el.scrollWidth - el.clientWidth), `the strip fits at ${width}`).toBeLessThanOrEqual(0);
      await expect.poll(async () => {
        const [t, s] = [await box(page.getByRole("tab", { selected: true })), await box(strip)];
        return Math.max(s.x - t.x, t.x + t.width - (s.x + s.width));
      }, { message: `the selected tab's overflow of its strip at ${width}` }).toBeLessThanOrEqual(1);
    }
  });
});
