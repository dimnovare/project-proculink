import { test, expect, type Page } from "@playwright/test";
import { MOCK_ENGINE_IDS } from "../../src/lib/api/mockEngine";
import { preparePage, settle } from "./a11yHarness";

const DOCUMENT_URL = `/flows/${MOCK_ENGINE_IDS.flow}/documents/${MOCK_ENGINE_IDS.document}`;

/** The account chip: the menu button with a Clerk session, the static chip without one (the mock shell). */
const ACCOUNT_CHIP = ':is(button[aria-label^="Account: "], [title="Clerk is not configured"])';

/** The bar itself: one line high, and no item ending past the screen edge. Measures the bar, not the page under it. */
const barFits = (page: Page) =>
  page.getByTestId("topbar-row").evaluate((row) => ({
    height: row.getBoundingClientRect().height,
    inside: Math.max(...Array.from(row.children, (c) => c.getBoundingClientRect().right)) <= window.innerWidth + 0.5,
  }));

test.describe("app shell", () => {
  test.describe.configure({ timeout: 120_000 });

  test("a 120-character file name wraps inside a 375px screen", async ({ page }) => {
    await preparePage(page, { dismissCookieBanner: true });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(DOCUMENT_URL);
    await settle(page);
    const h1 = page.getByRole("heading", { level: 1 });
    await expect(h1).toBeVisible();
    await h1.evaluate((el) => { el.textContent = `${"x".repeat(116)}.pdf`; });
    // The page scrolls inside its own frame, so measure the title itself: a name that does not wrap overflows it.
    expect(await h1.evaluate((el) => el.scrollWidth <= el.clientWidth), "the long name must wrap inside the title").toBe(true);
  });

  test("a full-screen step on a phone has no tab bar and shows the way back", async ({ page }) => {
    await preparePage(page, { dismissCookieBanner: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/documents");
    await expect(page.getByTestId("tab-bar")).toBeVisible();
    // <main> ends where the tab bar begins (1px tolerance), at each phone width.
    for (const width of [360, 390, 700]) {
      await page.setViewportSize({ width, height: 844 });
      const [m, t] = [(await page.locator("main").boundingBox())!, (await page.getByTestId("tab-bar").boundingBox())!];
      expect(Math.abs(m.y + m.height - t.y), `width ${width}`).toBeLessThanOrEqual(1);
      const bar = page.getByTestId("tab-bar");
      const docsTab = bar.getByRole("link", { name: /^Documents/ });
      expect(await docsTab.locator("span.truncate").evaluate((el) => el.scrollWidth <= el.clientWidth), `Documents label cut at ${width}`).toBe(true);
      if (width === 390) {
        // A long count grows to the right, away from the icon: at least half the 22px icon stays visible.
        const badge = docsTab.locator("span.absolute");
        await badge.evaluate((el) => { el.textContent = "100+"; });
        const [b, i] = [(await badge.boundingBox())!, (await docsTab.locator("svg").boundingBox())!];
        expect(b.x - i.x, "badge left edge against icon left edge").toBeGreaterThanOrEqual(11);
      }
      const targets = [...["Documents", "Flows", "Settings"].map((n) => bar.getByRole("link", { name: new RegExp(`^${n}`) })), bar.getByRole("button", { name: "Add a document" })];
      for (const target of targets) expect((await target.boundingBox())!.height, `tab target height at ${width}`).toBeGreaterThanOrEqual(50);
    }
    await page.goto(DOCUMENT_URL);
    await expect(page.getByRole("link", { name: "Back to Documents" })).toBeVisible();
    await expect(page.getByTestId("tab-bar")).toHaveCount(0);
  });

  test("the top bar is one row at every width, and a 60-character workspace name is cut short, not wrapped", async ({ page }) => {
    await preparePage(page, { dismissCookieBanner: true });
    for (const width of [320, 390, 767, 768, 1023, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/documents");
      await settle(page);
      for (const name of ["as loaded", "N".repeat(60)]) {
        if (name !== "as loaded") await page.getByTestId("workspace-name").evaluate((el, text) => { el.textContent = text; }, name);
        const fit = await barFits(page);
        expect(Math.abs(fit.height - (width < 768 ? 52 : 56)), `row height ${fit.height} at ${width}, name ${name.length} long`).toBeLessThanOrEqual(0.5);
        expect(fit.inside, `every item inside the screen at ${width}, name ${name.length} long`).toBe(true);
      }
      expect(await page.getByTestId("workspace-name").evaluate((el) => el.scrollWidth > el.clientWidth), `long name is cut at ${width}`).toBe(true);
      if (width === 1280) {
        // The current page's white line sits above the gradient strip, not under it.
        const hit = await page.getByTestId("topbar-row").evaluate((row) => {
          const link = row.querySelector('a[aria-current="page"]')!.getBoundingClientRect();
          const el = document.elementFromPoint(link.left + link.width / 2, row.getBoundingClientRect().bottom - 1);
          return !!el?.closest('a[aria-current="page"]') && !el?.classList.contains("link-spine");
        });
        expect(hit, "the current link, not the gradient line, is 1px above the row's bottom edge").toBe(true);
      }
    }
  });

  test("the top bar has three places, lit from the pages under them; Settings' own header has no account chip or Admin", async ({ page }) => {
    await preparePage(page, { dismissCookieBanner: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    const nav = page.getByTestId("topbar-nav");
    const LIT = [["/documents", "Documents"], ["/lookups", "Flows"], ["/operations/log", "Documents"], ["/settings", "Settings"],
      [DOCUMENT_URL, "Documents"], ["/archive", "Documents"]] as const;
    for (const [path, lit] of LIT) {
      await page.goto(path);
      await settle(page);
      await expect(nav.getByRole("link"), `the places on ${path}`).toHaveText(["Documents", "Flows", "Settings"]);
      await expect(nav.locator('[aria-current="page"]'), `one place lit on ${path}`).toHaveCount(1);
      await expect(nav.getByRole("link", { name: lit, exact: true }), `${lit} lit on ${path}`).toHaveAttribute("aria-current", "page");
      if (path === "/settings") {
        // The top bar holds the account chip and Admin from 768 up; the page header's own copies are for phones.
        await expect(page.locator(ACCOUNT_CHIP).locator("visible=true"), "one account chip on the page").toHaveCount(1);
        await expect(page.locator(`#main-content ${ACCOUNT_CHIP}`)).toBeHidden();
        await expect(page.getByRole("link", { name: "Admin" }).locator("visible=true"), "one Admin control on the page").toHaveCount(1);
        await expect(page.locator("#main-content").getByRole("link", { name: "Admin" })).toBeHidden();
      }
    }
  });

  test("the phone keeps its four, and reaches every place the old More held", async ({ page }) => {
    await preparePage(page, { dismissCookieBanner: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/documents");
    await settle(page);
    const bar = page.getByTestId("tab-bar");
    await expect(bar.locator(":scope > a, :scope > button")).toHaveCount(4);
    for (const name of [/^Documents/, /^Flows$/, /^Add a document$/, /^Settings$/])
      await expect(bar.getByRole("link", { name }).or(bar.getByRole("button", { name })), `${name.source} on the tab bar`).toBeVisible();
    await expect(bar.getByRole("button", { name: "More" }).or(bar.getByRole("link", { name: "More" }))).toHaveCount(0);
    // Workspace switcher: the top bar's workspace name.
    await expect(page.getByTestId("topbar-row").getByTestId("workspace-name")).toBeVisible();
    // History: the Documents footer link.
    await page.locator("#main-content").getByRole("link", { name: "History", exact: true }).click();
    await expect(page).toHaveURL(/\/operations\/log$/);
    // Lookups and History: Search.
    for (const [action, url] of [["Open Lookups", /\/lookups$/], ["Open History", /\/operations\/log$/]] as const) {
      await page.goto("/documents");
      await settle(page);
      await page.getByRole("button", { name: "Search", exact: true }).click();
      // An empty search lists the first three actions; typing the place's name finds its action.
      const dialog = page.getByRole("dialog", { name: "Search documents, flows, lookups and actions" });
      await dialog.getByRole("combobox", { name: "Search" }).fill(action.slice(5));
      await dialog.getByRole("option", { name: action, exact: true }).click();
      await expect(page, action).toHaveURL(url);
    }
    // Help: the top bar's Help button opens the help panel.
    await page.getByRole("button", { name: "Help", exact: true }).click();
    await expect(page.locator("#help-panel")).toBeVisible();
    await page.getByRole("button", { name: "Close help" }).click();
    // Account menu and Admin (the mock user is staff): the Settings page header.
    await page.goto("/settings");
    await settle(page);
    await expect(page.locator(`#main-content ${ACCOUNT_CHIP}`)).toBeVisible();
    await expect(page.locator("#main-content").getByRole("link", { name: "Admin" })).toHaveAttribute("href", "/admin");
    // The tab bar lights the place each page belongs to.
    for (const [path, lit] of [["/lookups", "Flows"], ["/operations/log", "Documents"], ["/archive", "Documents"], ["/settings", "Settings"]] as const) {
      await page.goto(path);
      await settle(page);
      await expect(bar.locator('[aria-current="page"]'), `one place lit on ${path}`).toHaveCount(1);
      await expect(bar.getByRole("link", { name: new RegExp(`^${lit}`) }), `${lit} lit on ${path}`).toHaveAttribute("aria-current", "page");
    }
  });

  test("each width offers exactly one way to move between pages", async ({ page }) => {
    await preparePage(page, { dismissCookieBanner: true });
    const MODES = [[390, "tabs"], [767, "tabs"], [768, "menu"], [1023, "menu"], [1024, "links"], [1440, "links"]] as const;
    for (const [width, mode] of MODES) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/documents");
      await settle(page);
      const shown = {
        tabs: await page.getByTestId("tab-bar").isVisible(),
        menu: await page.getByRole("button", { name: "Open navigation" }).isVisible(),
        links: await page.getByTestId("topbar-nav").isVisible(),
      };
      expect(shown, `at ${width}`).toEqual({ tabs: mode === "tabs", menu: mode === "menu", links: mode === "links" });
    }
  });

  test("at a tablet width the navigation panel lights Documents on a document's review", async ({ page }) => {
    await preparePage(page, { dismissCookieBanner: true });
    await page.setViewportSize({ width: 900, height: 900 });
    await page.goto(DOCUMENT_URL);
    await settle(page);
    await page.getByRole("button", { name: "Open navigation" }).click();
    const lit = page.getByRole("dialog", { name: "Navigation" }).locator('[aria-current="page"]');
    await expect(lit).toHaveCount(1);
    await expect(lit).toHaveText(/^\s*Documents/);
  });
});
