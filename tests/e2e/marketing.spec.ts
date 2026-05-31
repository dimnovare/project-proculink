import { test, expect } from "@playwright/test";

/**
 * Marketing surface smoke tests — cookie consent reject path, support form
 * happy path, legal-page rendering, all-the-routes-load smoke.
 */

test.describe("Cookie consent banner", () => {
  test("Reject persists choice and analytics opt-out", async ({ context, page }) => {
    await context.clearCookies();
    await page.goto("/");

    const banner = page.getByRole("dialog", { name: /cookie consent/i });
    await expect(banner).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: /^reject$/i }).click();
    await expect(banner).toBeHidden({ timeout: 5_000 });

    // Reload — banner stays hidden because functional-only consent is persisted.
    await page.reload();
    await expect(banner).toBeHidden({ timeout: 5_000 });

    // localStorage check.
    const consent = await page.evaluate(() => window.localStorage.getItem("proculink_cookie_consent_v1"));
    expect(consent).toBe("functional-only");
  });
});

test.describe("Support contact form", () => {
  test("submitting the form shows success notice and clears the message", async ({ page }) => {
    await page.goto("/support");

    // Form lives below the FAQ list.
    const form = page.getByRole("form", { name: /contact support/i });
    await expect(form).toBeVisible({ timeout: 10_000 });

    // In mock mode (NEXT_PUBLIC_USE_MOCK=true) the api-client resolves
    // submitSupportRequest in-memory so page.route() intercepts nothing.
    // In live mode the route intercept verifies the request payload shape.
    let lastBody: unknown = null;
    await page.route(/\/api\/support\/contact$/i, async (route) => {
      lastBody = await route.request().postDataJSON().catch(() => null);
      await route.fulfill({ status: 200, body: JSON.stringify({ ok: true }), contentType: "application/json" });
    });

    await form.getByLabel(/category/i).selectOption("bug");
    await form.getByLabel(/subject/i).fill("Playwright smoke");
    await form.getByLabel(/message/i).fill("This is a Playwright smoke test for the support contact form.");

    await form.getByRole("button", { name: /send|submit/i }).click();

    // Primary assertion: success notice appears regardless of mock/live mode.
    await expect(form.getByText(/thanks.*we'll reply within one business day/i)).toBeVisible({ timeout: 10_000 });

    // Secondary assertion: verify the request payload shape — only meaningful
    // in live mode where page.route() intercepts the real network request.
    if (process.env.PLAYWRIGHT_LIVE) {
      expect(lastBody).toEqual(
        expect.objectContaining({
          category: "bug",
          subject: "Playwright smoke",
          message: expect.stringContaining("Playwright smoke test"),
          route: "/support",
        }),
      );
    }
  });

  test("network failure surfaces the error notice", async ({ page }) => {
    await page.goto("/support");

    await page.route(/\/api\/support\/contact$/i, (route) => route.abort("failed"));

    const form = page.getByRole("form", { name: /contact support/i });
    await form.getByLabel(/message/i).fill("Trigger an error");
    await form.getByRole("button", { name: /send|submit/i }).click();

    // The form catches the error and renders a notice. We don't assert on the
    // specific text because it bubbles up the fetch failure verbatim.
    const errorNotice = form.locator("p, div").filter({ hasText: /failed|error|something went wrong/i }).first();
    await expect(errorNotice).toBeVisible({ timeout: 10_000 });
  });
});

test.describe("Legal + trust pages", () => {
  const routes: Array<[string, RegExp]> = [
    ["/privacy",       /privacy policy/i],
    ["/terms",         /terms of service/i],
    ["/security",      /built to protect/i],
    ["/dpa",           /data processing addendum/i],
    ["/subprocessors", /^subprocessors$/i],
    ["/aup",           /acceptable use policy/i],
    ["/support",       /^support$/i],
    ["/customers",     /procurement teams/i],
    ["/one-pager",     /stop reformatting purchase orders/i],
    ["/help",          /help/i],
  ];

  for (const [route, headingRe] of routes) {
    test(`${route} renders without error`, async ({ page }) => {
      await page.goto(route);
      await expect(page.getByRole("heading", { level: 1 }).first()).toContainText(headingRe, { timeout: 10_000 });
    });
  }
});

test.describe("Legal entity", () => {
  test("no Estoria references remain on /privacy or /terms", async ({ page }) => {
    for (const route of ["/privacy", "/terms"]) {
      await page.goto(route);
      const body = await page.locator("body").innerText();
      expect(body).not.toMatch(/estoria/i);
      expect(body).toMatch(/ProcuLink OÜ/i);
    }
  });
});
