import { test, expect, type Page, type Response } from "@playwright/test";

/**
 * Group J2 mock-residue crawl test.
 *
 * Crawls every operational route a prospect / customer might land on and asserts
 * the rendered HTML contains no demo-data literals — the kind of staged content
 * that signals "this is a sandbox demo" rather than a real product.
 *
 * The banned set comes from the Phase 6 J2 brief:
 *   - "008412"            — the canonical fake PO id used in mock seeds
 *   - "PO-2026-008412"    — its rendered form
 *   - "__mock__"          — an internal mock-marker substring
 *   - "mockOrders"        — JS identifier for the in-memory order store
 *   - "mockSuppliers"     — JS identifier for the in-memory supplier store
 *   - "BUYERS" / "SUPPLIERS" — all-caps identifiers that should never leak into JSX
 *
 * If any of these appear in `page.content()` after navigation, demo data has
 * leaked into a production-reachable surface and the test fails with a hint
 * about which route + which literal triggered the regression.
 *
 * Runs in MOCK mode by default (per playwright.config.ts webServer env), which
 * is the strictest setting: even mock-mode renders must stay free of fake-PO ids
 * because our replacement strategy was to swap "008412" for a clearly-non-real
 * "DEMO-001" pattern.
 */

const BANNED_LITERALS = [
  "008412",
  "PO-2026-008412",
  "__mock__",
  "mockOrders",
  "mockSuppliers",
  "BUYERS",
  "SUPPLIERS",
];

const ROUTES = [
  "/bridge",
  "/upload",
  "/inbox",
  "/library/suppliers",
  "/library/mappings",
  "/operations/log",
  "/settings",
];

/**
 * Prove the route rendered before reading anything into a clean crawl.
 *
 * "No banned literal appeared" is trivially true of a page that has no content:
 * a 500, the branded 404, an empty shell, or a bounce to /sign-in all contain
 * none of the seven strings below and would report this route clean while the
 * test name claims it "renders". A crawl that never reached the surface has not
 * cleared it.
 *
 * Four facts, all cheap:
 *   1. a response came back at all, and its status is below 400 — a dev-mode 500
 *      and src/app/not-found.tsx both fail here;
 *   2. we are still on the route we asked for. These are all (app) routes and
 *      render in place because PROCULINK_QA_BYPASS_AUTH turns src/middleware.ts
 *      into a pass-through; landing on /sign-in means the crawl inspected the
 *      sign-in page, which of course has no demo data in it;
 *   3. <main id="main-content"> from (app)/layout.tsx is present;
 *   4. it carries text, and not the copy of an error boundary — (app)/error.tsx,
 *      global-error.tsx and the Bridge <ErrorBoundary> that wraps every (app)
 *      page all render at HTTP 200, so their wording is the only thing that
 *      gives them away. Same strings live-full-e2e.spec.ts's
 *      assertNoErrorBoundary uses.
 */
async function expectRouteRendered(page: Page, response: Response | null, route: string) {
  expect(response, `navigation to ${route} returned no response`).not.toBeNull();

  const status = response!.status();
  expect(
    status,
    `${route} answered HTTP ${status} — an unrendered page trivially contains no demo data`,
  ).toBeLessThan(400);

  // Trailing slash normalised; "/" is left alone.
  const landed = new URL(page.url()).pathname.replace(/(.)\/$/, "$1");
  expect(
    landed,
    `${route} did not stay on its own route (landed on ${landed}) — the crawl cleared a different page. If this is /sign-in, PROCULINK_QA_BYPASS_AUTH is not set on the server under test.`,
  ).toBe(route);

  const main = page.locator("main#main-content").first();
  await expect(main, `${route} rendered no <main id="main-content"> landmark`).toBeAttached();

  const text = (await main.innerText()).trim();
  expect(
    text.length,
    `${route} rendered an empty <main> — there was no surface to inspect for demo data`,
  ).toBeGreaterThan(0);
  expect(
    text,
    `${route} rendered an error or not-found boundary instead of the page`,
  ).not.toMatch(
    /Something went wrong on this screen|An unexpected error interrupted ProcuLink|An unexpected error occurred while rendering this screen|This page took a wrong turn/i,
  );
}

for (const route of ROUTES) {
  test(`${route} renders without mock-residue literals`, async ({ page }) => {
    const navResponse = await page.goto(route, { waitUntil: "domcontentloaded" });

    // Let TanStack Query settle so any deferred renders land in the HTML snapshot.
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {
      // networkidle can hang on routes with long-poll websockets — that's fine.
    });

    await expectRouteRendered(page, navResponse, route);

    const html = await page.content();

    for (const literal of BANNED_LITERALS) {
      expect(
        html.includes(literal),
        `route ${route} must not contain banned literal "${literal}" — demo data has leaked`,
      ).toBe(false);
    }
  });
}
