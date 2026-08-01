import { test, expect, type Page, type Response } from "@playwright/test";

/**
 * Content-Security-Policy smoke tests.
 *
 * Two jobs:
 *  1. the security headers are actually on the response (they are built in
 *     src/lib/security/csp.ts and wired through next.config.ts headers()),
 *  2. walking the real pages produces ZERO policy violations — so the day
 *     CSP_MODE is flipped to "enforce" nothing on these routes breaks.
 *
 * Runs against `next dev` (see playwright.config.ts), so the policy under test
 * is the dev variant: same allowlist plus 'unsafe-eval' and ws: for HMR.
 *
 * What this CANNOT cover: Clerk, PostHog and Sentry are all dormant in this
 * config (no publishable key, no analytics key, SDK init is production-only),
 * so their hosts are never actually contacted here. Those directives are
 * exercised against a production build — and, once deployed, by the CSP reports
 * the policy POSTs to Sentry.
 */

/** Navigate and let deferred/lazy chunks settle without the flaky networkidle. */
async function visit(page: Page, route: string) {
  const response = await page.goto(route, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("load");
  await page.waitForTimeout(750);
  return response;
}

/**
 * Prove the page actually rendered — WITHOUT this, the violation list proves
 * nothing.
 *
 * A route that 500s, that 404s, or that bounces to /sign-in reports ZERO CSP
 * violations: a page which never rendered cannot execute a script, load a font
 * or open a connection, so it cannot break the policy. That makes
 * `expect(violations).toEqual([])` satisfied by exactly the failures it is meant
 * to catch, while the test name still claims the route "renders".
 *
 * Four cheap facts close the hole:
 *   1. the navigation answered below 400 — a dev-mode 500 and the branded 404
 *      (src/app/not-found.tsx) both fail here;
 *   2. we are still on the route we asked for. The (app) routes render in place
 *      because PROCULINK_QA_BYPASS_AUTH turns src/middleware.ts into a
 *      pass-through (playwright.config.ts webServer env sets it) — landing on
 *      /sign-in means the bypass is off and the policy was measured on the
 *      sign-in page instead of the route in the test name;
 *   3. the <main id="main-content"> landmark is there. Every family in these two
 *      lists supplies one: (marketing)/layout.tsx, (app)/layout.tsx and, for "/",
 *      (home)/page.tsx;
 *   4. that landmark carries text, and not the text of an error boundary. An
 *      empty shell has no text; (app)/error.tsx, global-error.tsx and the Bridge
 *      <ErrorBoundary> all render at HTTP 200, so only their copy gives them
 *      away. Same strings live-full-e2e.spec.ts's assertNoErrorBoundary uses.
 */
async function expectRendered(page: Page, response: Response | null, route: string) {
  expect(response, `no response for ${route}`).not.toBeNull();

  const status = response!.status();
  expect(
    status,
    `${route} answered HTTP ${status} — a page that did not render cannot violate a policy`,
  ).toBeLessThan(400);

  // Trailing slash normalised; "/" is left alone.
  const landed = new URL(page.url()).pathname.replace(/(.)\/$/, "$1");
  expect(
    landed,
    `${route} did not stay on its own route (landed on ${landed}) — the CSP was measured on a different page. If this is /sign-in, PROCULINK_QA_BYPASS_AUTH is not set on the server under test.`,
  ).toBe(route);

  const main = page.locator("main#main-content").first();
  await expect(main, `${route} rendered no <main id="main-content"> landmark`).toBeAttached();

  const text = (await main.innerText()).trim();
  expect(
    text.length,
    `${route} rendered an empty <main> — an empty page cannot violate a policy`,
  ).toBeGreaterThan(0);
  expect(
    text,
    `${route} rendered an error or not-found boundary instead of the page`,
  ).not.toMatch(
    /Something went wrong on this screen|An unexpected error interrupted ProcuLink|An unexpected error occurred while rendering this screen|This page took a wrong turn/i,
  );
}

/** Collect every CSP violation the browser reports while `run` executes. */
async function collectViolations(page: Page, run: () => Promise<void>) {
  const violations: string[] = [];

  await page.addInitScript(() => {
    (window as unknown as { __cspViolations: string[] }).__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (e) => {
      (window as unknown as { __cspViolations: string[] }).__cspViolations.push(
        `${e.effectiveDirective} blocked ${e.blockedURI}`,
      );
    });
  });

  await run();

  violations.push(
    ...(await page.evaluate(
      () => (window as unknown as { __cspViolations?: string[] }).__cspViolations ?? [],
    )),
  );
  return violations;
}

test.describe("Security headers", () => {
  test("every response carries the hardening headers and a CSP", async ({ page }) => {
    const response = await page.goto("/");
    expect(response, "no response for /").not.toBeNull();

    const headers = response!.headers();
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(headers["permissions-policy"]).toContain("camera=()");

    // Enforced policy — the subset that can never break a working page.
    const enforced = headers["content-security-policy"];
    expect(enforced, "no Content-Security-Policy header").toBeTruthy();
    expect(enforced).toContain("frame-ancestors 'self'");
    expect(enforced).toContain("object-src 'none'");
    expect(enforced).toContain("base-uri 'self'");

    // In the default (report-only) mode the full policy is measured, not enforced.
    const full = headers["content-security-policy-report-only"] ?? enforced;
    expect(full).toContain("script-src");
    expect(full).toContain("connect-src");
    expect(full).toContain("https://challenges.cloudflare.com");
  });

  test("protected app routes get the same headers as marketing", async ({ page }) => {
    const response = await page.goto("/bridge");
    const headers = response!.headers();
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'self'");
    expect(headers["x-content-type-options"]).toBe("nosniff");
  });
});

test.describe("No CSP violations", () => {
  const publicRoutes = ["/", "/pricing", "/how-it-works", "/watch", "/support", "/privacy"];

  for (const route of publicRoutes) {
    test(`marketing route ${route} renders with no policy violation`, async ({ page }) => {
      let response: Response | null = null;
      const violations = await collectViolations(page, async () => {
        response = await visit(page, route);
      });
      // "renders" is half the promise in this test's name — prove it before
      // reading anything into an empty violation list.
      await expectRendered(page, response, route);
      expect(violations, `CSP violations on ${route}`).toEqual([]);
    });
  }

  const appRoutes = ["/bridge", "/inbox", "/upload", "/settings", "/library/suppliers"];

  for (const route of appRoutes) {
    test(`app route ${route} renders with no policy violation`, async ({ page }) => {
      let response: Response | null = null;
      const violations = await collectViolations(page, async () => {
        response = await visit(page, route);
      });
      // Same as above, and it doubles as the QA-bypass check: an app route that
      // silently redirected to /sign-in would otherwise report a clean policy.
      await expectRendered(page, response, route);
      expect(violations, `CSP violations on ${route}`).toEqual([]);
    });
  }

  test("the cookie banner and its consent write survive the policy", async ({ context, page }) => {
    await context.clearCookies();
    const violations = await collectViolations(page, async () => {
      await visit(page, "/");
      const banner = page.getByRole("dialog", { name: /cookie consent/i });
      await expect(banner).toBeVisible({ timeout: 10_000 });
      await page.getByRole("button", { name: /^accept/i }).click();
      await expect(banner).toBeHidden({ timeout: 5_000 });
    });
    expect(violations).toEqual([]);
  });
});
