import { test, expect, type Page } from "@playwright/test";

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
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("load");
  await page.waitForTimeout(750);
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
      const violations = await collectViolations(page, () => visit(page, route));
      expect(violations, `CSP violations on ${route}`).toEqual([]);
    });
  }

  const appRoutes = ["/bridge", "/inbox", "/upload", "/settings", "/library/suppliers"];

  for (const route of appRoutes) {
    test(`app route ${route} renders with no policy violation`, async ({ page }) => {
      const violations = await collectViolations(page, () => visit(page, route));
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
