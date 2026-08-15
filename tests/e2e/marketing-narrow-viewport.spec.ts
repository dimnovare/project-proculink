import { test, expect } from "@playwright/test";
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

import { preparePage, settle } from "./a11yHarness";

/**
 * MARKETING PAGES MUST NOT SCROLL SIDEWAYS ON A PHONE.
 *
 * ── WHY THIS EXISTS, WHEN A VISUAL SUITE ALREADY RUNS AT A NARROW WIDTH ───────
 *
 * The visual suite's narrow viewport is 390. Three marketing pages broke at 375
 * — iPhone SE, iPhone 6/7/8/X/11 Pro/12 mini, and every Android that reports
 * 375 — and the suite could not have seen any of them:
 *
 *   • /subprocessors overflowed at BOTH widths (465px table, 326px box at 390)
 *     and was never asserted on, because the visual suite covers ten CORE
 *     SCREENS and no legal page is one of them.
 *   • /privacy's table landed at x=382 at 390 — inside the frame by 8px, purely
 *     because the page's side padding absorbed the spill — and pushed the
 *     document to 382px at 375.
 *   • /one-pager's three-column grid needed 319px against a 303px box at 375 and
 *     318px at 390: a one-pixel miss at the tested width.
 *
 * Two of the three were within 8px of the tested viewport. A screenshot gate
 * would not have caught them anyway: a table that spills into the page padding
 * still renders, and the baseline would have been captured broken.
 *
 * So the check is not a screenshot and it is not a fourth baseline width. It is
 * a layout invariant — `documentElement.scrollWidth <= innerWidth` — which needs
 * no PNGs, cannot drift with font rasterisation, runs on any platform, and
 * covers EVERY marketing route rather than the two the baselines happen to hold.
 *
 * ── THE ROUTE LIST IS DISCOVERED, NOT TYPED ──────────────────────────────────
 *
 * A hand-typed list is how /subprocessors went unchecked for its whole life. The
 * routes below are read off the filesystem, so a marketing page added tomorrow is
 * covered the day it lands and nobody has to remember. The anti-vacuity block
 * underneath is what stops a broken globber from "passing" by discovering
 * nothing.
 */

/** iPhone SE / older iPhone. Deliberately NOT 390 — see the header. */
const NARROW_WIDTH = 375;

const MARKETING_DIR = join(process.cwd(), "src", "app", "(marketing)");

/** Every static page under (marketing), as a URL path. */
function discoverMarketingRoutes(): string[] {
  const routes: string[] = [];

  const walk = (dir: string, segments: string[]) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      // Dynamic segments need a real id to render and are not marketing pages.
      if (entry.name.includes("[")) continue;
      const next = join(dir, entry.name);
      // A route group — `(foo)` — contributes no URL segment.
      const nextSegments = /^\(.*\)$/.test(entry.name) ? segments : [...segments, entry.name];
      if (existsSync(join(next, "page.tsx"))) routes.push("/" + nextSegments.join("/"));
      walk(next, nextSegments);
    }
  };

  walk(MARKETING_DIR, []);
  // `/` is served by src/app/(home)/page.tsx — a sibling group, not a child of
  // (marketing), and the single most-visited page in the product.
  routes.push("/");
  return routes.sort();
}

const ROUTES = discoverMarketingRoutes();

test.describe(`marketing pages at ${NARROW_WIDTH}px`, () => {
  test("the route list is real — discovery cannot silently find nothing", () => {
    // Floor, not an exact count: a new marketing page must not fail this test.
    expect(ROUTES.length).toBeGreaterThanOrEqual(18);
    // The two that actually broke, pinned by name. If a refactor moves them out
    // of (marketing), this fails and someone re-points the discovery rather than
    // quietly losing the coverage.
    expect(ROUTES).toContain("/privacy");
    expect(ROUTES).toContain("/subprocessors");
    expect(ROUTES).toContain("/one-pager");
    expect(ROUTES).toContain("/");
  });

  for (const route of ROUTES) {
    test(`${route} does not scroll horizontally`, async ({ page }) => {
      await page.setViewportSize({ width: NARROW_WIDTH, height: 812 });
      // The cookie banner is deliberately NOT dismissed. It is a fixed-position
      // overlay that a first-time visitor on a phone sees on every one of these
      // pages, so it is part of what must fit — and it is how these pages were
      // measured when the three breaks were found.
      await preparePage(page);
      await page.goto(route);
      await settle(page);

      const measured = await page.evaluate(() => ({
        doc: document.documentElement.scrollWidth,
        body: document.body.scrollWidth,
        inner: window.innerWidth,
        // Name the widest offender in the failure message. A bare "382 > 375"
        // sends the next person hunting through the whole page.
        widest: (() => {
          let worst = { tag: "", right: 0, text: "" };
          for (const el of Array.from(document.querySelectorAll("*"))) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 && r.height === 0) continue;
            if (r.right > worst.right) {
              worst = {
                tag: el.tagName.toLowerCase(),
                right: Math.round(r.right),
                text: (el.textContent ?? "").trim().slice(0, 60),
              };
            }
          }
          return worst;
        })(),
      }));

      const detail =
        `${route} overflows at ${NARROW_WIDTH}px: documentElement.scrollWidth=${measured.doc}, ` +
        `body.scrollWidth=${measured.body}, innerWidth=${measured.inner}. ` +
        `Widest box: <${measured.widest.tag}> right=${measured.widest.right} ` +
        `"${measured.widest.text}". A table or grid whose min-content exceeds the content ` +
        `box is the usual cause — width:100% is a maximum, not a floor.`;

      expect(measured.doc, detail).toBeLessThanOrEqual(measured.inner);
      expect(measured.body, detail).toBeLessThanOrEqual(measured.inner);
    });
  }

  /**
   * The one break the page-level invariant above is blind to.
   *
   * /one-pager's "How it works" row is three `1fr` tracks — and `1fr` is
   * `minmax(auto, 1fr)`, whose floor is min-content, not zero. At 375 the three
   * cards needed 319px against the 303px content box print.css leaves, so the row
   * overflowed ITS OWN container and spilled into the page's 36px padding. The
   * document never scrolled (the widest box stopped at x=355 < 375), so
   * `documentElement.scrollWidth <= innerWidth` passed while the layout was
   * visibly broken. This measures the box that actually overflowed.
   */
  test("/one-pager's step row fits its own container", async ({ page }) => {
    await page.setViewportSize({ width: NARROW_WIDTH, height: 812 });
    await preparePage(page);
    await page.goto("/one-pager");
    await settle(page);

    const row = page.getByTestId("one-pager-steps");
    await expect(row).toBeVisible();

    const box = await row.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      columns: getComputedStyle(el).gridTemplateColumns,
    }));

    expect(
      box.scrollWidth,
      `/one-pager's step row overflows its container at ${NARROW_WIDTH}px: ` +
        `scrollWidth=${box.scrollWidth} > clientWidth=${box.clientWidth}, ` +
        `grid-template-columns="${box.columns}". Fixed track counts do not collapse — ` +
        `use repeat(auto-fit, minmax(...)) so the row reflows on a phone.`,
      // +1 absorbs sub-pixel track rounding.
    ).toBeLessThanOrEqual(box.clientWidth + 1);
  });
});
