import { test, expect, type Page } from "@playwright/test";
import { listProdScreens } from "./prodScreens";
import { readDisposableState } from "./disposableIdentity";

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
 *      See watchForServerErrors — this bar exists because that really happened.
 */

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

/**
 * Collect 5xx answers from our own hosts — the fifth bar, and the one the four above
 * provably cannot see.
 *
 * On 2026-08-23 a new organisation's first page load produced a cascade of backend
 * failures — a cold Neon connection, a failed Organisation INSERT, then four
 * `UnauthorizedAccessException("Organisation not resolved")` responses across
 * /api/orders, /api/suppliers, /api/billing/status and /api/onboarding/status. 255 such
 * events accumulated in Sentry over 14 days. Every scheduled run of this suite reported
 * success throughout.
 *
 * Nothing here was broken by accident: the four bars above watch the DOCUMENT and the JS
 * runtime, and the failures were in XHR. TanStack Query catches a rejected query, retries
 * it, and renders a loading or empty state — so the document is 200, the title is right,
 * the h1 is there, `<main>` has well over 40 characters of chrome and empty-state copy,
 * no error boundary mounts, and nothing throws. The product was visibly broken for the
 * user and every assertion passed.
 *
 * Scope is deliberately OUR domain, taken from the base URL rather than hardcoded. A 5xx
 * from api.proculink.eu is ours to fix and must redden this gate. A 5xx from PostHog or a
 * Sentry ingest endpoint is neither our bug nor something merging code would repair, and
 * letting a third party's bad afternoon fail this run would teach everyone to ignore it.
 */
function watchForServerErrors(page: Page, baseURL: string | undefined): string[] {
  const failures: string[] = [];
  const ourDomain = registrableDomain(baseURL);

  page.on("response", (res) => {
    if (res.status() < 500) return;
    let host: string;
    try {
      host = new URL(res.url()).hostname;
    } catch {
      return;
    }
    if (ourDomain && host !== ourDomain && !host.endsWith(`.${ourDomain}`)) return;
    failures.push(`${res.status()} ${res.request().method()} ${res.url()}`);
  });

  return failures;
}

/** "https://proculink.eu" → "proculink.eu". Null when the base URL is unusable. */
function registrableDomain(baseURL: string | undefined): string | null {
  if (!baseURL) return null;
  try {
    return new URL(baseURL).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

test.describe("authenticated production", () => {
  for (const screen of screens) {
    test(`${screen.label} (${screen.path}) renders for a signed-in user`, async ({
      page,
      baseURL,
    }) => {
      const pageErrors = watchForPageErrors(page);
      const serverErrors = watchForServerErrors(page, baseURL);

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

      // 5. Nothing of ours answered 5xx while the screen was assembling itself.
      //    Give in-flight queries a bounded moment to land first — a screen can satisfy
      //    every bar above off its shell before its data arrives. Screens that poll never
      //    go idle, so the wait is best-effort and its timeout is not a failure.
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
      expect(serverErrors, `server errors while loading ${screen.path}`).toEqual([]);
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
