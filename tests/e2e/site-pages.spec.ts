import { test, expect, type Page } from "@playwright/test";

import { preparePage, settle } from "./a11yHarness";

/**
 * The small website pages (plan 14.25): Security, the five legal pages, Support,
 * Talk to us, Changelog, Welcome and the public page not found.
 *
 * jsdom has no layout, so widths, tap targets and font sizes are measured here,
 * in a real browser, on boxes (getBoundingClientRect), not on scrollWidth: a box
 * that spills into the page padding still leaves scrollWidth intact.
 */

const ROUTES = [
  "/security",
  "/privacy",
  "/terms",
  "/aup",
  "/dpa",
  "/subprocessors",
  "/support",
  "/book-demo",
  "/changelog",
  "/welcome",
  "/no-such-page",
];
const WIDTHS = [320, 390, 768, 1440];
const TAP_MIN = 44;
const TEXT_MIN = 12.5;

type Miss = { what: string; tag: string; text: string; value: number };

/** Every box in `main` that breaks one of the three floors at this width. */
async function measure(page: Page, checkTaps: boolean): Promise<Miss[]> {
  return page.evaluate(
    ({ checkTaps, TAP_MIN, TEXT_MIN }) => {
      const misses: Miss[] = [];
      const main = document.querySelector("main");
      if (!main) return [{ what: "no main", tag: "", text: "", value: 0 }];
      const label = (el: Element) => (el.textContent ?? "").trim().slice(0, 50);
      for (const el of Array.from(main.querySelectorAll<HTMLElement>("*"))) {
        const style = getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden") continue;
        const r = el.getBoundingClientRect();
        if (r.width <= 1 || r.height <= 1) continue;
        // A table scroller scrolls sideways by design; its own box must still fit.
        const inScroller = el.parentElement?.closest('[data-testid="table-scroller"]');
        if (!inScroller && r.right > window.innerWidth + 1) {
          misses.push({ what: "sideways", tag: el.tagName.toLowerCase(), text: label(el), value: Math.round(r.right) });
        }
        const ownText = Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim() !== "");
        if (ownText && parseFloat(style.fontSize) < TEXT_MIN) {
          misses.push({ what: "small text", tag: el.tagName.toLowerCase(), text: label(el), value: parseFloat(style.fontSize) });
        }
        const tag = el.tagName.toLowerCase();
        // A link inside a sentence is exempt (WCAG 2.5.8 inline exception), as in tap-targets.spec.ts.
        if (checkTaps && (tag === "button" || (tag === "a" && style.display !== "inline")) && r.height < TAP_MIN - 0.5) {
          misses.push({ what: "small target", tag, text: label(el), value: Math.round(r.height) });
        }
      }
      return misses;
    },
    { checkTaps, TAP_MIN, TEXT_MIN },
  );
}

test.describe("the small website pages", () => {
  // Under parallel local load a cold dev compile of /changelog outlasted the default navigation timeout.
  // Compile the routes once up front, and give single steps room of their own (as in one-way-in.spec.ts).
  test.use({ actionTimeout: 30_000, navigationTimeout: 60_000 });
  test.beforeAll(async ({ playwright }, info) => {
    test.setTimeout(300_000); // a hook gets the 30 s default
    const request = await playwright.request.newContext({ baseURL: info.project.use.baseURL });
    for (const url of ROUTES) await request.get(url, { timeout: 90_000 });
    await request.dispose();
  });

  test("no page of this piece scrolls sideways, shrinks text or shrinks a tap target", async ({ page }) => {
    test.setTimeout(240_000);
    await preparePage(page, { dismissCookieBanner: true });
    const all: string[] = [];
    for (const route of ROUTES) {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await settle(page, 300);
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 900 });
        if (width === 320 && (route === "/privacy" || route === "/dpa")) {
          await page.locator('nav[aria-label="On this page"] details').evaluate((d) => ((d as HTMLDetailsElement).open = true));
        }
        await page.waitForTimeout(150);
        for (const m of await measure(page, width <= 390)) {
          all.push(`${route} @${width}: ${m.what} <${m.tag}> ${m.value} "${m.text}"`);
        }
      }
    }
    expect(all, all.join("\n")).toEqual([]);
  });

  test("the page not found answers 404, is not indexed, and leads home and to Help", async ({ page }) => {
    await preparePage(page, { dismissCookieBanner: true });
    const r = await page.goto("/no-such-page");
    expect(r?.status()).toBe(404);
    // Next adds its own noindex for a 404 beside the page's; every one must say noindex.
    const robots = await page.locator('meta[name="robots"]').evaluateAll((ms) => ms.map((m) => m.getAttribute("content") ?? ""));
    expect(robots.length).toBeGreaterThan(0);
    for (const content of robots) expect(content).toContain("noindex");
    await expect(page.getByRole("heading", { level: 1, name: "This page took a wrong turn." })).toBeVisible();
    await expect(page.getByRole("banner")).toBeVisible();
    await expect(page.getByRole("contentinfo")).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to home" })).toHaveAttribute("href", "/");
    await expect(page.getByRole("link", { name: "Visit the help centre" })).toHaveAttribute("href", "/help");
  });

  test("support and call forms send once and answer in place", async ({ page }) => {
    await preparePage(page, { dismissCookieBanner: true });
    let sent = 0;
    page.on("console", (m) => {
      if (m.text().startsWith("[mock] submitSupportRequest")) sent += 1;
    });

    await page.goto("/support");
    const support = page.getByRole("form", { name: "Contact support" });
    await support.getByLabel(/^message/i).fill("A test request from the browser suite.");
    await support.getByLabel(/your email/i).fill("sam@example.test");
    await support.getByRole("button", { name: "Send message" }).dblclick();
    await expect(support.getByRole("status")).toContainText("Thanks", { timeout: 10_000 });
    expect(sent).toBe(1);

    sent = 0;
    await page.goto("/book-demo");
    const call = page.getByRole("form", { name: "Request a 20-minute call" });
    await call.getByLabel(/^name\b/i).fill("Alex Example");
    await call.getByLabel(/work email/i).fill("sam@example.test");
    await call.getByLabel(/^company\b/i).fill("Example Supplier Ltd");
    await call.getByRole("button", { name: "Request a call" }).dblclick();
    const done = page.getByRole("status").filter({ hasText: "Request received." });
    await expect(done).toBeFocused({ timeout: 10_000 });
    expect(sent).toBe(1);

    await page.goto("/changelog");
    expect(await page.locator("details").first().evaluate((d) => (d as HTMLDetailsElement).open)).toBe(false);
  });
});
