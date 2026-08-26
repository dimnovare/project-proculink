import { test as base, expect, type Page } from "@playwright/test";
import { listProdScreens } from "./prodScreens";
import { readDisposableState } from "./disposableIdentity";
import { settleInFlightRequests, watchForServerErrors } from "./serverErrorWatch";

/**
 * Does the signed-in product actually render in production?
 *
 * Nothing in CI answered that before this file. `uptime.yml` in the backend repo
 * curls the marketing site and the API's readiness endpoint, and the Playwright
 * suite runs against `next dev` with PROCULINK_QA_BYPASS_AUTH — a mode in which
 * Clerk is deliberately dormant and the API is a mock. Both are useful and
 * neither can see a broken Vercel deploy, a Clerk key rotated out from under
 * production, a middleware change that bounces every signed-in user, or a client
 * bundle that throws on hydration. Those are the failures that take the product
 * down for everyone while every check stays green.
 *
 * tests/e2e/coreScreens.ts already said as much, in the note explaining why
 * /sign-in is NOT in the core-screen list: "The Clerk widget cannot be rendered
 * without live keys, so this needs an authenticated-QA harness, not a curated
 * list entry." This is that harness.
 *
 * WHAT COUNTS AS "RENDERED". A 200 does not, and neither does a URL. Next.js
 * serves the app shell for a screen whose every query failed, and the error
 * boundary renders with a 200 too. So each screen has to clear five separate
 * bars, and the interesting ones are the negatives:
 *
 *   1. It is still the screen we asked for — not /sign-in, not the org gate.
 *      A signed-out run would otherwise "render" the sign-in page beautifully.
 *   2. The `<title>` is the one src/lib/pageTitles.ts says the route serves.
 *      Derived from the registry, so a renamed route fails here instead of
 *      silently being checked against a 404.
 *   3. Exactly one non-empty `<h1>`, and a `<main>` with real content in it.
 *   4. No error boundary, and no uncaught exception on the page. A client bundle
 *      that throws during hydration still returns 200 and still paints chrome.
 *   5. None of our own hosts answered 5xx while the screen loaded. Bars 1-4 watch
 *      the document and the JS runtime; a query that fails in XHR is invisible to
 *      all four, because TanStack Query catches it and renders an empty state.
 *      See watchForServerErrors in ./serverErrorWatch — this bar exists because
 *      that really happened.
 */

/**
 * The fifth bar, applied to EVERY test in this file by construction.
 *
 * It shipped as a per-test opt-in and the very next test forgot it. The greeting test
 * below was not instrumented, and within an hour a real production 500 —
 * GET /api/dashboard/topology answering UnauthorizedAccessException("Organisation not
 * resolved") for a freshly created organisation — ran straight through a green run. A gate
 * you have to remember to attach is a gate that documents the last failure rather than
 * catching the next one.
 *
 * `auto: true` means no test opts in and none can opt out, including tests added later.
 * The assertion lives in fixture teardown, which Playwright runs after the test body and
 * before `page` is disposed, so a late-arriving response is still counted.
 */
const test = base.extend<{ noServerErrors: void }>({
  noServerErrors: [
    async ({ page, baseURL }, use) => {
      const failures = watchForServerErrors(page, baseURL);
      await use();

      // In-flight queries get a bounded moment to land before the assertion: a screen can
      // satisfy every other bar off its shell before its data arrives. Best-effort, and its
      // timeout is not a failure — see settleInFlightRequests.
      await settleInFlightRequests(page);
      expect(failures, "5xx from our own hosts during this test").toEqual([]);
    },
    { auto: true },
  ],
});

const screens = listProdScreens();

/**
 * Every error surface in this app carries `data-plk-error-boundary` — the route
 * boundary, the root boundary, and the nested component boundary alike. The
 * attribute exists precisely for gates like this one, and src/test/
 * errorBoundaryMarker.test.ts keeps it from being deleted as decoration.
 *
 * Matching the ATTRIBUTE rather than the headline text matters here. `(app)/
 * error.tsx` renders inside `(app)/layout.tsx`, so a page component that throws
 * still answers 200 and still paints the topbar, the nav and the shell — an
 * adversarial run of the axe gate proved chrome alone satisfies every "did it
 * render" floor. Its copy is also not the component boundary's copy, so a text
 * assertion would catch one of the three surfaces and quietly miss the others.
 */
const ERROR_BOUNDARY_SELECTOR = "[data-plk-error-boundary]";

/** Collect uncaught exceptions so a hydration crash cannot pass as a render. */
function watchForPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

test.describe("authenticated production", () => {
  for (const screen of screens) {
    test(`${screen.label} (${screen.path}) renders for a signed-in user`, async ({ page }) => {
      const pageErrors = watchForPageErrors(page);

      const response = await page.goto(screen.path, { waitUntil: "domcontentloaded" });
      expect(response, `no response for ${screen.path}`).not.toBeNull();
      expect(response!.status(), `HTTP status for ${screen.path}`).toBeLessThan(400);

      // 1. Still the screen we asked for.
      await expect(page).toHaveURL(new RegExp(`${escapeRegExp(screen.path)}(\\?|$)`));
      await expect(page).not.toHaveURL(/\/sign-in/);
      await expect(page).not.toHaveURL(/\/onboarding\//);

      // 2. The title the route registry says this route serves.
      await expect(page).toHaveTitle(screen.title);

      // 3. One heading, and a main region with something in it. The h1 is
      //    matched by role rather than by text: several of these screens hide
      //    their title visually (PageHeader `titleHidden`) because the topbar
      //    already names the page, and on /library/suppliers the wording is
      //    direction-dependent. The heading's EXISTENCE is the invariant; its
      //    wording is owned by the copy guards, not by this file.
      const heading = page.getByRole("heading", { level: 1 });
      await expect(heading).toHaveCount(1);
      await expect(heading).not.toHaveText("");

      const main = page.locator("#main-content");
      await expect(main).toBeVisible();
      // A shell with an empty main is exactly the "200 but nothing rendered"
      // case this suite exists to catch. 40 characters is below every real
      // screen and above every empty one.
      await expect
        .poll(async () => ((await main.innerText()) ?? "").trim().length, {
          message: `${screen.path} rendered a main region with almost no text`,
          timeout: 20_000,
        })
        .toBeGreaterThan(40);

      // 4. No error boundary, no uncaught exception.
      await expect(page.locator(ERROR_BOUNDARY_SELECTOR)).toHaveCount(0);
      expect(pageErrors, `uncaught exceptions on ${screen.path}`).toEqual([]);
    });
  }

  /**
   * The session is genuinely OURS, and the client really hydrated.
   *
   * Every assertion above would also pass for a cached, signed-out, statically
   * rendered shell. This one cannot: the dashboard greets by first name
   * (DashboardContextLine), that name comes from the Clerk user this run created
   * minutes ago, and it is printed by a client component after mount. Seeing it
   * means a real production Clerk session hydrated in a real browser.
   */
  test("the dashboard greets the disposable user by name", async ({ page }) => {
    const state = readDisposableState();

    await page.goto("/bridge");
    await expect(page.getByText(state.firstName, { exact: false }).first()).toBeVisible({
      timeout: 30_000,
    });
  });
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
