import { type Page } from "@playwright/test";

/**
 * The production smoke gate's fifth bar — "none of OUR hosts answered 5xx while
 * this page loaded" — in one place, because TWO Playwright projects need it.
 *
 * It shipped inside signed-in-screens.spec.ts and was hardened there into an
 * `auto: true` fixture so that no test in that file could forget to attach it.
 * That closed the hole one level down and left it open one level up:
 * playwright.prod.config.ts declares a separate `setup` project for
 * tests/prod/auth.setup.ts, and that file imports `test` from "@playwright/test"
 * directly — a different `test` object, on which the spec's fixture does not
 * exist and cannot be made to exist.
 *
 * The setup project is also the one that runs FIRST, and the one that redeems the
 * sign-in ticket and lands on /bridge. That IS the app's first authenticated page
 * load for a brand-new organisation, which is precisely where the 5xx cascade this
 * bar exists to catch fires. Four to five `UnauthorizedAccessException`
 * ("Organisation not resolved") responses were observed there on every run of
 * 2026-08-18, 08-21, 08-25 and 08-26, and all four runs reported success.
 *
 * So the watcher lives here and is imported by both, rather than copied into
 * either. A guard that covers the tests it was attached to, and not the project
 * that runs before them, is the same failure rotated one level up.
 */

/** How long in-flight requests get to land before the assertion. Best-effort. */
const SETTLE_TIMEOUT_MS = 10_000;

/**
 * Collect 5xx answers from our own hosts — the fifth bar, and the one the other
 * four provably cannot see.
 *
 * On 2026-08-23 a new organisation's first page load produced a cascade of backend
 * failures — a cold Neon connection, a failed Organisation INSERT, then four
 * `UnauthorizedAccessException("Organisation not resolved")` responses across
 * /api/orders, /api/suppliers, /api/billing/status and /api/onboarding/status. 255 such
 * events accumulated in Sentry over 14 days. Every scheduled run of this suite reported
 * success throughout.
 *
 * Nothing here was broken by accident: the document-level bars watch the DOCUMENT and the
 * JS runtime, and the failures were in XHR. TanStack Query catches a rejected query, retries
 * it, and renders a loading or empty state — so the document is 200, the title is right,
 * the h1 is there, `<main>` has well over 40 characters of chrome and empty-state copy,
 * no error boundary mounts, and nothing throws. The product was visibly broken for the
 * user and every assertion passed.
 *
 * Scope is deliberately OUR domain, taken from the base URL rather than hardcoded. A 5xx
 * from api.proculink.eu is ours to fix and must redden this gate. A 5xx from PostHog or a
 * Sentry ingest endpoint is neither our bug nor something merging code would repair, and
 * letting a third party's bad afternoon fail this run would teach everyone to ignore it.
 *
 * Returns a LIVE array: it keeps filling for as long as the page exists, so a caller
 * asserts on it after the work is done rather than capturing a snapshot up front.
 */
export function watchForServerErrors(page: Page, baseURL: string | undefined): string[] {
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

/**
 * Give in-flight requests a bounded moment to land before asserting.
 *
 * A screen can satisfy every other bar off its shell before its data arrives, so
 * asserting the instant the work finishes would miss exactly the late 5xx this
 * watcher was written for. Screens that poll never go idle, so the wait is
 * best-effort and its own timeout is NOT a failure — the assertion that follows
 * it is the only thing allowed to fail.
 */
export async function settleInFlightRequests(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout: SETTLE_TIMEOUT_MS }).catch(() => {});
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
