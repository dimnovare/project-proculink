import { test, expect } from "@playwright/test";

/**
 * UI-hang regression — Bridge dashboard.
 *
 * Repro the production bug where /bridge would render a blank white page
 * indefinitely when /api/dashboard/stats stalled. Naked `fetch()` calls (no
 * timeout, no abort) combined with TanStack Query's default infinite retry
 * meant the page never reached a loading or error UI: the user just saw white.
 *
 * What this test asserts:
 *   1. We stall every /api/** request for 30 seconds (longer than any UI
 *      timeout we want to allow).
 *   2. Within 12 seconds of navigating to /bridge, the app chrome must be
 *      visible and interactive — sidebar rendered, nav links clickable.
 *   3. The user can navigate away (sidebar click → /inbox) within that window.
 *      A frozen white page would fail this assertion.
 *
 * Notes on modes:
 *   - LIVE mode (PLAYWRIGHT_LIVE=1): real fetch() runs, route interceptor
 *     fires, this test exercises the actual regression path.
 *   - MOCK mode (default): the api-client mock layer resolves in memory via
 *     setTimeout, bypassing HTTP — the route interceptor sees nothing. The
 *     test still validates that the chrome renders + nav stays responsive,
 *     which acts as a baseline smoke (it should pass trivially since nothing
 *     stalls).
 *
 * To reproduce the original hang locally before Agent 1's fix:
 *   PLAYWRIGHT_LIVE=1 bun run test:e2e -- tests/e2e/no-hang.spec.ts
 *
 * Auth bypass: PROCULINK_QA_BYPASS_AUTH=true is set by playwright.config.ts
 * webServer.env so we don't need a real Clerk session.
 */

test.describe("no-hang regression — Bridge dashboard", () => {
  test("UI stays interactive when /api/** stalls", async ({ page }) => {
    test.setTimeout(20_000);

    // Stall every API request. We never fulfill — the request is held until
    // the route handler aborts after 30s, which is well past any allowable
    // UI timeout. Any pending fetch() that lacks its own AbortController
    // budget will be stuck inside this handler indefinitely.
    await page.route("**/api/**", async (route) => {
      await new Promise<void>((resolve) => setTimeout(resolve, 30_000));
      await route.abort("timedout");
    });

    const start = Date.now();
    // domcontentloaded — don't wait for networkidle because the stalled
    // requests will never settle.
    await page.goto("/bridge", { waitUntil: "domcontentloaded" });

    // ── Assertion 1: chrome is rendered + interactive ─────────────────────
    // The sidebar nav link "Inbox" lives in BridgeSidebar.tsx and is
    // server-rendered regardless of API state. If the page is frozen white,
    // this assertion will fail because the React tree never mounted.
    const inboxNav = page.getByRole("link", { name: /^inbox$/i }).first();
    await expect(inboxNav).toBeVisible({ timeout: 12_000 });
    expect(
      Date.now() - start,
      "chrome must render within 12s even when /api/** is stalled",
    ).toBeLessThan(15_000);

    // ── Assertion 2: page is not frozen — navigation works ────────────────
    // Click the sidebar nav link to /inbox. If the main React thread is
    // blocked (e.g. by a synchronous render hung on an unresolved promise
    // in some surprising way), the URL will not change in time.
    await inboxNav.click();
    await expect(page).toHaveURL(/\/inbox/, { timeout: 5_000 });
  });
});
