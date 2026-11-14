import { test, expect } from "@playwright/test";

/**
 * New-surface e2e smoke tests — mock mode only.
 *
 * Covers the surfaces shipped in the 2026-07-09/10 push:
 *  1. /book-demo — our own book-a-demo tool (feat 0a75a41) + the success-state
 *     focus behavior from the adversarial-review fixes (e792875 §4).
 *  2. Marketing nav focus safety on /pricing (e792875 §2 — the fallback→loaded
 *     Suspense swap used to silently drop keyboard focus from "Sign in").
 *
 * Auth: PROCULINK_QA_BYPASS_AUTH=true (webServer env in playwright.config.ts).
 * Mode: NEXT_PUBLIC_USE_MOCK=true — the api-client resolves in-memory, so e.g.
 * submitSupportRequest succeeds ({ delivered: true }) without a backend.
 */

// Suppress the cookie-consent banner across this file (same pattern as
// magic-mapping-preview.spec.ts): it is a fixed bottom-of-viewport overlay that
// intercepts pointer events aimed at bottom-anchored controls. Pre-seed a
// decided consent so the banner never renders (same key the app persists).
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("proculink_cookie_consent_v1", "functional-only");
    } catch {
      /* private mode — banner may still show; keyboard-driven steps are unaffected */
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. /book-demo — the marketing book-a-demo request page
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Book a 20-minute call — /book-demo", () => {
  test("renders the H1 and every required field resolves by accessible name", async ({ page }) => {
    await page.goto("/book-demo");

    // Reframed from a generic demo to a 20-minute call about one of the visitor's documents.
    await expect(
      page.getByRole("heading", { level: 1, name: "Show us one of your documents" }),
    ).toBeVisible({ timeout: 15_000 });

    // Required fields are bound label→input (htmlFor/id) — resolvable by
    // accessible name. Labels render as "Name *" etc., so anchor the regex.
    await expect(page.getByLabel(/^name\b/i)).toBeVisible();
    await expect(page.getByLabel(/work email/i)).toBeVisible();
    await expect(page.getByLabel(/^company\b/i)).toBeVisible();
  });

  test("submit stays disabled until required fields are filled; success notice appears AND receives focus", async ({ page }) => {
    await page.goto("/book-demo");

    const form = page.getByRole("form", { name: /request a 20-minute call/i });
    await expect(form).toBeVisible({ timeout: 15_000 });

    const submit = form.getByRole("button", { name: /request a call/i });
    await expect(submit).toBeDisabled();

    // Partial fill — still gated (all three of Name / Work email / Company are required).
    await form.getByLabel(/^name\b/i).fill("Playwright Smoke");
    await form.getByLabel(/work email/i).fill("smoke@example.com");
    await expect(submit).toBeDisabled();

    await form.getByLabel(/^company\b/i).fill("Example GmbH");
    await expect(submit).toBeEnabled();

    await submit.click();

    // Mock submitSupportRequest resolves { delivered: true } after ~400ms; the
    // form unmounts and the confirmation renders as a role="status" live region.
    const status = page
      .getByRole("status")
      .filter({ hasText: /we'll reply within 1 business day/i });
    await expect(status).toBeVisible({ timeout: 10_000 });
    await expect(status).toContainText(/request received/i);

    // Focus-on-success (e792875 §4): the confirmation div (tabIndex -1) receives
    // focus when the form unmounts, so keyboard focus never drops to <body> and
    // screen readers get the announcement. Pin document.activeElement to it.
    await expect(status).toBeFocused({ timeout: 5_000 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Marketing nav focus safety — /pricing
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Marketing nav focus safety — /pricing", () => {
  test("'Sign in' keeps keyboard focus across the post-hydration window (no DOM swap)", async ({ page }) => {
    await page.goto("/pricing");

    // Scope to the nav: the pricing page body has its own "Start free Pilot" CTA.
    const nav = page.locator("nav").first();
    const signIn = nav.getByRole("link", { name: "Sign in", exact: true });
    const startFree = nav.getByRole("link", { name: "Start free", exact: true });
    await expect(signIn).toBeVisible({ timeout: 15_000 });
    await expect(startFree).toBeVisible();

    // Place keyboard focus on "Sign in" (locator.focus() dispatches the same
    // DOM focus a Tab stop would land) and verify it took.
    await signIn.focus();
    await expect(signIn).toBeFocused();

    // Regression guard for e792875 §2: the nav used to lazy-swap the signed-out
    // links (dynamic Clerk module fallback→loaded replaced pixel-identical DOM),
    // silently dropping focus after hydration. The static links are now a
    // persistent sibling — focus must survive the async-chunk window. The fixed
    // 2s wait IS the test: we are asserting nothing happens during it.
    await page.waitForTimeout(2_000);
    await expect(signIn).toBeFocused();

    // And the links are still the same live DOM (not a re-rendered replacement
    // that happens to be focused): href intact.
    await expect(signIn).toHaveAttribute("href", "/sign-in");
    await expect(startFree).toHaveAttribute("href", "/sign-up");
  });
});
