import { test, expect } from "@playwright/test";

/**
 * P3 — the queue's two geometry properties, measured.
 *
 * Both of these regressed on this screen and BOTH passed every unit test, the
 * build, the a11y gate and the e2e suite. Only the visual baselines caught them,
 * and a visual baseline reports "this screen changed", not "this screen is
 * wrong" — a human still has to open the diff and decide. These two assertions
 * say which change is a defect, so CI can answer that on its own.
 *
 * THIS TEST MEASURES. Real Chromium, real 1440x900 viewport, real
 * `getBoundingClientRect()`. jsdom performs no layout, so the same assertions
 * there would read zeros and pass against any layout at all.
 *
 * 1  DOCUMENT HEIGHT. The queue is a fixed-height shell: the table scrolls
 *    inside its card, so the page itself must not scroll. It went to 1758px on
 *    a 900px viewport — ~860px of blank canvas under the footer — because an
 *    `sr-only` span was added inside a table cell. Tailwind's `sr-only` is
 *    `position: absolute`, and with no positioned ancestor between the cell and
 *    the initial containing block, the span's static position resolved against
 *    the DOCUMENT instead of against the scroll container it was painted in.
 *    The last row's span landed at y≈1756 and dragged `scrollHeight` with it.
 *    Nothing about that is visible in a component test; it is a property of the
 *    containing-block chain, which only a real layout has.
 *
 * 2  ROW HEIGHT. This screen exists for an operator working 50-200 orders, and
 *    rows-per-screen is the measure of whether it does its job. Rows went 44px
 *    to 59px — 12 orders per screen to 9 — because one cell stacked a third
 *    line. The budget is deliberately 46px, not 59: two pixels of headroom for
 *    a font-metric difference between machines, and nowhere near enough to fit
 *    another line of type.
 */

const DESKTOP = { width: 1440, height: 900 };

/** A third line of type in any cell costs ~13px. 46 leaves room for none. */
const MAX_ROW_HEIGHT_PX = 46;

/**
 * The page may exceed the viewport by a hair (sub-pixel rounding on the shell),
 * never by a band of content. Anything approaching a second viewport is the
 * escaped-containing-block defect above.
 */
const MAX_DOC_OVERFLOW_PX = 24;

test.use({ viewport: DESKTOP });

test.beforeEach(async ({ page }) => {
  // The cookie banner is a fixed bottom overlay. Pre-decide it so it cannot
  // shift or overlay the geometry being measured.
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("proculink_cookie_consent_v1", "functional-only");
    } catch {
      /* storage unavailable — the banner just renders, and it is fixed anyway */
    }
  });
  await page.goto("/inbox");
  // Rows, not a spinner: every assertion below is meaningless against an empty
  // table, so wait for the real thing.
  await expect(page.locator("tbody tr").first()).toBeVisible();
});

test("the queue page does not scroll — the table scrolls inside it", async ({ page }) => {
  const { doc, viewport, rowCount } = await page.evaluate(() => ({
    doc: document.documentElement.scrollHeight,
    viewport: window.innerHeight,
    rowCount: document.querySelectorAll("tbody tr").length,
  }));

  // Anti-vacuity: a page with two rows in it cannot demonstrate this property,
  // because the defect only shows once the table is taller than its card. The
  // mock queue pages at 25.
  expect(rowCount, "too few rows for the overflow property to mean anything").toBeGreaterThan(10);
  expect(
    doc - viewport,
    `the page scrolls ${doc - viewport}px past the viewport (doc ${doc}, viewport ${viewport}). ` +
      "Something inside the table escaped the card's scroll container — check for a " +
      "position:absolute descendant (sr-only!) with no positioned ancestor.",
  ).toBeLessThanOrEqual(MAX_DOC_OVERFLOW_PX);
});

test("a queue row stays inside its height budget", async ({ page }) => {
  const heights = await page.evaluate(() =>
    [...document.querySelectorAll("tbody tr")]
      .map((r) => Math.round(r.getBoundingClientRect().height))
      // Skeleton/empty/error rows are not data rows and are not being budgeted.
      .filter((h) => h > 20),
  );

  expect(heights.length, "no measurable rows").toBeGreaterThan(10);
  const tallest = Math.max(...heights);
  expect(
    tallest,
    `tallest row is ${tallest}px against a ${MAX_ROW_HEIGHT_PX}px budget — that is ` +
      "roughly one fewer order visible per 3 rows on a queue built for scanning.",
  ).toBeLessThanOrEqual(MAX_ROW_HEIGHT_PX);
});

test("both sides of the supplier flow are readable, not ellipsized to a prefix", async ({ page }) => {
  // The supplier is the primary scanning key on this screen. Truncating it to
  // ~14 characters means two suppliers sharing a prefix need a hover to tell
  // apart, which is the cost the What's-needed column must not impose.
  const cells = await page.evaluate(() =>
    [...document.querySelectorAll("tbody tr")].slice(0, 10).flatMap((tr) => {
      const td = tr.querySelector("td:nth-child(3)");
      if (!td) return [];
      return [...td.querySelectorAll("span")]
        .filter((s) => (s.textContent || "").trim().length > 2)
        .map((s) => ({
          text: (s.textContent || "").trim(),
          clipped: s.scrollWidth > s.clientWidth + 1,
        }));
    }),
  );

  expect(cells.length, "no party names measured").toBeGreaterThan(10);
  const clipped = cells.filter((c) => c.clipped).map((c) => c.text);
  expect(clipped, `party names ellipsized at 1440: ${clipped.join(", ")}`).toEqual([]);
});
