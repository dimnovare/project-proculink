import { test, expect } from "@playwright/test";

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

for (const route of ROUTES) {
  test(`${route} renders without mock-residue literals`, async ({ page }) => {
    const navResponse = await page.goto(route, { waitUntil: "domcontentloaded" });
    expect(navResponse, `navigation to ${route} returned no response`).not.toBeNull();

    // Let TanStack Query settle so any deferred renders land in the HTML snapshot.
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {
      // networkidle can hang on routes with long-poll websockets — that's fine.
    });

    const html = await page.content();

    for (const literal of BANNED_LITERALS) {
      expect(
        html.includes(literal),
        `route ${route} must not contain banned literal "${literal}" — demo data has leaked`,
      ).toBe(false);
    }
  });
}
