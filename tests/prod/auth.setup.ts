import { test as setup, expect } from "@playwright/test";
import { readDisposableState, STORAGE_STATE } from "./disposableIdentity";
import { settleInFlightRequests, watchForServerErrors } from "./serverErrorWatch";

/**
 * Exchange the disposable sign-in ticket for a real production browser session.
 *
 * This runs as its own Playwright project so that the ticket — which is
 * SINGLE-USE — is redeemed exactly once, and every spec afterwards loads the
 * resulting cookies from `storageState`. Redeeming it per-test would fail every
 * test but the first, and would fail in a way that looks like a product bug.
 *
 * The ticket is minted by scripts/prod-smoke/clerk-disposable.mjs; see that
 * file's header for why a ticket is the only path that works on this Clerk
 * instance (the Native API is disabled, and Backend API session creation is
 * development-only).
 *
 * STORAGE_STATE and readDisposableState live in ./disposableIdentity because
 * playwright.prod.config.ts imports the first of them, and a Playwright config
 * may not import a module that declares tests.
 *
 * THIS FILE IS ALSO A SCREEN TEST, WHETHER OR NOT IT WANTS TO BE. Redeeming the
 * ticket ends on /bridge, so this step performs the app's FIRST authenticated
 * page load for a freshly created organisation and fires every tenant-scoped
 * query on it. signed-in-screens.spec.ts guards exactly that with a fifth bar —
 * "no host of ours answered 5xx while this screen loaded" — and hardened it into
 * an `auto: true` fixture so that no test there could forget to attach it. The
 * fixture extends that file's own `test` object; this file imports `test` from
 * "@playwright/test" directly, so the fixture never reached the one project that
 * runs FIRST and loads the very screen the bar was written about. Four to five
 * `UnauthorizedAccessException("Organisation not resolved")` responses fired here
 * on every run of 2026-08-18, 08-21, 08-25 and 08-26, and all four reported
 * success. The watcher now lives in ./serverErrorWatch and is applied below.
 */

setup("sign in to production with a disposable Clerk identity", async ({ page, baseURL }) => {
  const state = readDisposableState();

  // Armed before the first navigation, because the responses that matter arrive
  // during the redirect chain and the /bridge landing — not after them.
  const serverErrors = watchForServerErrors(page, baseURL);

  // Navigating with `__clerk_ticket` is the redemption. Clerk resolves it before
  // the app's own middleware runs and sets __session / __client on the redirect.
  await page.goto(`/sign-in?__clerk_ticket=${encodeURIComponent(state.ticket)}`);

  // The landing is /bridge, but not necessarily in one hop. A brand-new user has
  // no ACTIVE organisation on the edge session even though the membership
  // exists, so src/middleware.ts bounces once to /onboarding/select-organization,
  // which activates the org and forwards on with ?org_set=1. Waiting for the
  // destination rather than for a single redirect makes that hop invisible here
  // and keeps this setup honest if the gate's shape changes.
  await page.waitForURL(/\/bridge(\?|$)/, { timeout: 90_000 });

  // Being on /bridge is not the same as being signed in on /bridge: a signed-out
  // request is redirected to /sign-in, so the assertion that matters is the
  // negative one. If Clerk silently failed, this is where it says so.
  await expect(page).not.toHaveURL(/\/sign-in/);
  await expect(page).not.toHaveURL(/\/onboarding\//);

  // Persist BEFORE the 5xx bar. The session itself is sound by this point, and a
  // human re-running the failure by hand wants those cookies on disk. Playwright
  // skips a dependent project whenever its setup fails, so writing the file early
  // cannot let the `prod` project run on a sign-in that did not clear the bar.
  await page.context().storageState({ path: STORAGE_STATE });

  // The fifth bar. In-flight queries get the same bounded, best-effort settle the
  // spec gives them before asserting; that wait timing out is not a failure.
  await settleInFlightRequests(page);
  expect(serverErrors, signInServerErrorReport(serverErrors)).toEqual([]);
});

/**
 * What the 06:00 reader needs, in the order they need it: what we served, then the
 * one explanation that fits it nearly every time, then where to look.
 *
 * Do NOT answer a red run here by allowlisting these endpoints or downgrading this
 * to a warning. The 5xx is the product failing for a real new customer on their
 * first screen; a gate that is green because it was told to ignore the one thing it
 * exists to catch is worse than no gate.
 */
function signInServerErrorReport(failures: string[]): string {
  return [
    `${failures.length} server error(s) from our own hosts while signing in to production —`,
    `status, method and URL of each:`,
    ...failures.map((failure) => `    ${failure}`),
    ``,
    `A 5xx during sign-in usually means TENANT-SCOPED QUERIES FIRED BEFORE THE`,
    `ORGANISATION CLAIM WAS ATTACHED TO THE SESSION. This step lands on /bridge, which`,
    `is the app's first authenticated page load: a brand-new user has no active`,
    `organisation on the edge session yet, so any dashboard query that goes out before`,
    `the claim arrives is answered UnauthorizedAccessException("Organisation not`,
    `resolved").`,
    ``,
    `That is a client-side ordering bug, not necessarily an outage. Check that the`,
    `signed-in shell holds its tenant-scoped queries until the organisation resolves`,
    `(src/hooks/useQueriesEnabled.ts and its callers) before suspecting the API, the`,
    `database or the deploy.`,
  ].join("\n");
}
