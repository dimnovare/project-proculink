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
export interface ServerErrorWatch {
  /** 5xx that are genuinely faults. The gate asserts this is empty. */
  failures: string[];
  /** 503 + Retry-After: the documented "not ready yet" answer. Reported, never asserted on. */
  retryable: string[];
}

export function watchForServerErrors(page: Page, baseURL: string | undefined): ServerErrorWatch {
  const failures: string[] = [];
  const retryable: string[] = [];
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
    if (isDocumentedRetry(res.status(), res.headers())) {
      retryable.push(`${res.status()} ${res.request().method()} ${res.url()}`);
      return;
    }
    failures.push(`${res.status()} ${res.request().method()} ${res.url()}`);
  });

  return { failures, retryable };
}

/**
 * A `503` carrying `Retry-After` is this system's DOCUMENTED "not ready yet, ask again"
 * answer, and it is not a failure of the thing this bar exists to catch.
 *
 * Read the history before relaxing this any further, because the bar was deliberately
 * strict when it shipped and this narrowing is the result of the semantics changing
 * underneath it, not of the rule proving inconvenient:
 *
 *   • The defect was four to five HTTP **500**s on a new organisation's first page load —
 *     `UnauthorizedAccessException("Organisation not resolved")` — because Clerk mints the
 *     session token before the organisation claim is attached, and the API had no mapping
 *     for that exception. A 500 says "this server has a bug".
 *   • The backend now answers `503 + Retry-After` there instead, matching what
 *     TenantResolutionMiddleware already returned for its sibling condition (tenant
 *     resolution cannot reach the database during a Neon cold start). Nothing is broken:
 *     the request arrived a moment early.
 *   • The client agrees, without being told twice. `classifyApiFailure` in
 *     src/lib/apiFailure.ts marks `status >= 500` retryable, and `apiRetryDelayMs` honours
 *     a server-named `Retry-After` over its own backoff — so these retry transparently and
 *     the user sees a slightly later first paint, not an error.
 *
 * The test of whether a narrowing is legitimate is whether the ORIGINAL defect would still
 * trip the gate. It would: those were 500s, and a 500 still fails here. So does a 502, a
 * 504, and — deliberately — a 503 with NO `Retry-After`, which is a server falling over
 * rather than one asking to be asked again.
 *
 * These are still reported, never swallowed: `settleInFlightRequests`'s caller prints them.
 * A run where they climb is telling you the activation window is getting wider, and that is
 * worth seeing before it becomes something worse.
 */
function isDocumentedRetry(status: number, headers: Record<string, string>): boolean {
  if (status !== 503) return false;
  const retryAfter = headers["retry-after"];
  return typeof retryAfter === "string" && retryAfter.trim().length > 0;
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
