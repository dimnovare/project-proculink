import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { HELP_ARTICLES } from "../../src/lib/help-articles";
import { liveClientGuides } from "../../src/lib/guides";
import { preparePage, settle, DEV_OVERLAY_SELECTORS } from "./a11yHarness";

/**
 * The help centre's templates in a real browser: the home, the guides index, and the longest article and
 * guide (derived from the registry, never typed), at the widths the site is drawn for.
 *
 * Why a file of its own: no other spec walks the help templates at phone widths;
 * marketing-narrow-viewport.spec.ts checks only sideways scroll at 375. Three tests, because the CI
 * browser job is close to its limit; the axe test is tagged @a11y so it runs in the a11y job instead.
 */

const longest = <T,>(xs: T[], size: (x: T) => number) => xs.reduce((a, b) => (size(b) > size(a) ? b : a));
const ARTICLE = longest(HELP_ARTICLES, (a) => a.readMin);
const GUIDE = longest(liveClientGuides(), (g) => g.minutes ?? 0);
const ROUTES = ["/help", "/help/guides", `/help/${ARTICLE.slug}`, GUIDE.href];
const WIDTHS = [320, 375, 390, 768, 1440];

/** What a width breaks, measured inside `main`. Boxes that scroll or clip by design are measured, their insides are not. */
function problems(phone: boolean): string[] {
  const main = document.querySelector("main");
  if (!main) return ["no main"];
  const out: string[] = [];
  const name = (el: Element) => `${el.tagName.toLowerCase()} "${(el.textContent ?? "").trim().slice(0, 40)}"`;
  const insideScroller = (el: Element) => {
    for (let p = el.parentElement; p && p !== main; p = p.parentElement) {
      if (["auto", "scroll", "hidden"].includes(getComputedStyle(p).overflowX)) return true;
    }
    return false;
  };
  if (document.documentElement.scrollWidth > innerWidth + 1) out.push(`page scrolls sideways: ${document.documentElement.scrollWidth}`);
  for (const el of main.querySelectorAll("*")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.right > innerWidth + 1 && !insideScroller(el)) out.push(`past the edge: ${name(el)} right=${Math.round(r.right)}`);
    const text = [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim() !== "");
    if (text && parseFloat(getComputedStyle(el).fontSize) < 12.5) out.push(`text under 12.5px: ${name(el)}`);
    if (phone && (el.tagName === "A" || el.tagName === "BUTTON") && getComputedStyle(el).display !== "inline" && r.height < 44)
      out.push(`tap target ${Math.round(r.height)}px: ${name(el)}`);
  }
  return out;
}

test("no help page scrolls sideways, shrinks text or shrinks a tap target", async ({ page }) => {
  test.setTimeout(180_000);
  await preparePage(page);
  for (const route of ROUTES) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(route);
    await settle(page, 300);
    await expect(page.locator("main h1").first()).toBeVisible();
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(problems, width <= 390), `${route} at ${width}px`).toEqual([]);
      const aside =
        route === GUIDE.href
          ? page.getByRole("navigation", { name: "Guide steps" })
          : route.startsWith("/help/") && route !== "/help/guides"
            ? page.locator("main aside")
            : null;
      if (aside && width === 1440) await expect(aside, `${route} aside at 1440`).toBeVisible();
      if (aside && width === 390) await expect(aside, `${route} aside at 390`).toBeHidden();
    }
  }
});

test("help search works from the keyboard", async ({ page }) => {
  const guide = liveClientGuides()[0];
  await page.goto("/help");
  await settle(page, 300);
  const box = page.getByLabel("Search articles and guides");
  for (let i = 0; i < 30 && !(await box.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press("Tab");
  await expect(box, `focus is on ${await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 80))}`).toBeFocused();

  await page.keyboard.type(guide.title);
  await expect(page.locator("p[aria-live='polite']")).toHaveText(/^\d+ results?$/);
  const first = page.getByRole("region", { name: "Search results" }).getByRole("link").first();
  await expect(first).toHaveAttribute("href", guide.href);
  for (let i = 0; i < 10 && !(await first.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press("Tab");
  await expect(first).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`${guide.href}$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(guide.title);

  await page.goBack();
  await page.getByLabel("Search articles and guides").fill("sftp");
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Search articles and guides")).toHaveValue("");
  await expect(page.getByRole("heading", { level: 2, name: "Start here" })).toBeVisible();

  // A topic swaps its own button out: focus goes to the results it opened, and Clear brings it back to the box.
  await page.getByRole("button", { name: new RegExp(`^${HELP_ARTICLES[0].category}`) }).click();
  await expect(page.getByRole("heading", { level: 2, name: HELP_ARTICLES[0].category })).toBeFocused();
  await page.getByRole("button", { name: "Clear" }).click();
  await expect(page.getByLabel("Search articles and guides")).toBeFocused();
});

async function axe(page: Page) {
  let builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]);
  for (const s of DEV_OVERLAY_SELECTORS) builder = builder.exclude(s);
  return (await builder.analyze()).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

test("the help templates have no axe violations", { tag: "@a11y" }, async ({ page }) => {
  test.setTimeout(120_000);
  await preparePage(page);
  for (const route of ["/help", `/help/${ARTICLE.slug}`, GUIDE.href]) {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(route);
      await settle(page);
      await expect(page.locator("main h1").first()).toBeVisible();
      expect(await axe(page), `${route} at ${width}px`).toEqual([]);
    }
  }
});
