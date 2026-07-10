import { test, expect } from "@playwright/test";

/**
 * New-surface e2e smoke tests — mock mode only.
 *
 * Covers the surfaces shipped in the 2026-07-09/10 push:
 *  1. /book-demo — our own book-a-demo tool (feat 0a75a41) + the success-state
 *     focus behavior from the adversarial-review fixes (e792875 §4).
 *  2. Guided delivery setup — the opt-in "Set up step by step" wizard on the
 *     supplier delivery tab (DeliveryGuidedSetup).
 *  3. The Order Workshop's "Customize output layout" designer (the reachable
 *     output-editing surface; see the fixme below re the expression tester).
 *  4. Marketing nav focus safety on /pricing (e792875 §2 — the fallback→loaded
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

test.describe("Book a demo — /book-demo", () => {
  test("renders the H1 and every required field resolves by accessible name", async ({ page }) => {
    await page.goto("/book-demo");

    await expect(
      page.getByRole("heading", { level: 1, name: "Book a demo" }),
    ).toBeVisible({ timeout: 15_000 });

    // Required fields are bound label→input (htmlFor/id) — resolvable by
    // accessible name. Labels render as "Name *" etc., so anchor the regex.
    await expect(page.getByLabel(/^name\b/i)).toBeVisible();
    await expect(page.getByLabel(/work email/i)).toBeVisible();
    await expect(page.getByLabel(/^company\b/i)).toBeVisible();
  });

  test("submit stays disabled until required fields are filled; success notice appears AND receives focus", async ({ page }) => {
    await page.goto("/book-demo");

    const form = page.getByRole("form", { name: /request a demo/i });
    await expect(form).toBeVisible({ timeout: 15_000 });

    const submit = form.getByRole("button", { name: /request a demo/i });
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
// 2. Guided delivery setup — supplier delivery tab
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Guided delivery setup — /library/suppliers/[id]?tab=delivery", () => {
  // In mock mode SupplierDockProfile renders DEMO_MOCK ("Acme Components",
  // id s1) for any id — the supplier-list query is disabled (enabled:
  // !isApiMockMode). ?tab=delivery deep-links straight to the delivery tab,
  // where the opt-in wizard entry point sits above the DeliveryConfigEditor.
  const DELIVERY_URL = "/library/suppliers/s1?tab=delivery";

  test("wizard opens, Email channel advances to recipients, Escape closes cleanly", async ({ page }) => {
    // First compile of the supplier-detail route under load can be slow.
    test.setTimeout(90_000);
    await page.goto(DELIVERY_URL);

    const setupBtn = page.getByRole("button", { name: /set up step by step/i });
    await expect(setupBtn).toBeVisible({ timeout: 20_000 });
    await setupBtn.click();

    // Step 1 — channel picker. Mock org direction defaults to outbound, so the
    // counterparty noun is "supplier".
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await expect(
      dialog.getByText("How does this supplier receive orders?"),
    ).toBeVisible();

    // Pick "Email" (the channel card's accessible name starts with its label).
    await dialog.getByRole("button", { name: /^email\b/i }).click();

    // Step 2 — destination for the email channel: the recipients field.
    await expect(dialog.getByText("Where does it go?")).toBeVisible();
    await expect(dialog.getByLabel(/send to/i)).toBeVisible();
    await expect(dialog.getByText(/step 2 of 4/i)).toBeVisible();

    // Escape closes the wizard without crashing the page (Radix dialog handles
    // Escape at the document level; onOpenChange(false) unmounts the modal).
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 5_000 });

    // The delivery tab is still intact underneath: the wizard entry point and
    // its intro strip are both present (no crash, no blank surface).
    await expect(setupBtn).toBeVisible();
    await expect(page.getByText(/we can walk you through it/i)).toBeVisible();
  });

  test("Cancel on step 1 also closes the wizard", async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto(DELIVERY_URL);

    const setupBtn = page.getByRole("button", { name: /set up step by step/i });
    await expect(setupBtn).toBeVisible({ timeout: 20_000 });
    await setupBtn.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await dialog.getByRole("button", { name: /^cancel$/i }).click();

    await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 5_000 });
    await expect(setupBtn).toBeVisible();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Output editing surface — Order Workshop "Customize output layout"
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Order Workshop output surface — /inbox/ord-002", () => {
  // HONESTY NOTE (investigated 2026-07-10): the "Try an expression" tester
  // (d729a39) lives inside OutputMappingEditor's Formula-help disclosure — but
  // OutputMappingEditor has had NO mount point since c424755 (2026-06-25)
  // deleted the dead review/OutputPreview.tsx that hosted it. No route, palette
  // entry, or workshop control renders it, so no e2e can reach the tester
  // through the UI. Its draft-assembly logic is pinned by unit tests
  // (OutputMappingEditor.test.ts). Re-enable this once the editor is remounted.
  test.fixme(
    "Formula-help discloses the 'Try an expression' tester (UNREACHABLE: OutputMappingEditor is unmounted since c424755)",
    async ({ page }) => {
      // Intended flow once a mount exists: open the editor surface at
      // /inbox/ord-002, expand the "Formula help" disclosure, and assert the
      // "Try an expression" box with its expression input is present.
      await page.goto("/inbox/ord-002");
      await page.getByText("Formula help").click();
      await expect(page.getByText("Try an expression")).toBeVisible();
      await expect(page.getByLabel("Expression to test")).toBeVisible();
    },
  );

  test("'Customize output layout' opens the output designer and closes cleanly", async ({ page }) => {
    // /inbox/[orderId] is a heavy route; first cold-compile under CI load can
    // exceed 30s (same budget rationale as magic-mapping-preview.spec.ts).
    test.setTimeout(90_000);
    await page.goto("/inbox/ord-002");

    await expect(page.getByTestId("order-workshop")).toBeVisible({ timeout: 30_000 });

    // The reachable output-editing surface on the workshop toolbar (desktop).
    const customize = page.getByRole("button", { name: /customize output layout/i });
    await expect(customize).toBeVisible({ timeout: 10_000 });
    await customize.click();

    const designer = page.getByRole("dialog", { name: /design output structure/i });
    await expect(designer).toBeVisible({ timeout: 10_000 });
    await expect(designer.getByText("Design the output", { exact: true })).toBeVisible();

    // Cancel (unedited → closes without a confirm prompt); workshop intact.
    await designer.getByRole("button", { name: /^cancel$/i }).click();
    await expect(designer).toBeHidden({ timeout: 5_000 });
    await expect(page.getByTestId("order-workshop")).toBeVisible();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Marketing nav focus safety — /pricing
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
