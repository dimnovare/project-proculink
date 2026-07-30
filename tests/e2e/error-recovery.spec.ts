import { test, expect } from "@playwright/test";

/**
 * Error-recovery smoke tests for the order-detail route.
 *
 * NOTE: /orders/:id now permanently redirects to /inbox/:id (next.config.ts),
 * so these tests land on SpineReview (the canonical detail view), not the legacy
 * OrderDetailPage. SpineReview's error/load gate (SpineReview.tsx) shows:
 *   - order === null  → "Order not found"
 *   - network error   → "Failed to load order"
 * and a single "← Back to inbox" button in both cases (no Retry button).
 *
 * Mock mode: drives the in-memory api-client mock, so these run without a
 * backend.
 */

test.describe("SpineReview error handling", () => {
  test("real 404 shows 'Order not found' with Back to inbox only (no Retry)", async ({ page }) => {
    // The mock returns null for unknown ids, surfacing the 404 path.
    await page.goto("/inbox/does-not-exist-1234");

    await expect(page.getByText(/order not found/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: /back to inbox/i })).toBeVisible();
    // No Retry button on a true 404.
    await expect(page.getByRole("button", { name: /^retry$/i })).toHaveCount(0);
  });

  test("network failure shows 'Failed to load order' with Back to inbox", async ({ page }) => {
    // Declared conditional skip, not an if-wrapped self-skip with a dead `return` after it:
    // the condition is the annotation, so the reason is reported the same way every run.
    test.skip(
      process.env.PLAYWRIGHT_LIVE !== "1",
      "network-interception test requires PLAYWRIGHT_LIVE=1 (the mock api-client bypasses fetch)",
    );

    // Force /api/orders/:id to fail with a network-shaped error.
    await page.route(/\/api\/orders\/[^/]+$/i, async (route) => {
      await route.abort("failed");
    });

    await page.goto("/inbox/some-id-that-would-otherwise-resolve");

    await expect(page.getByText(/failed to load order/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/check your connection and try again/i)).toBeVisible();

    const back = page.getByRole("button", { name: /back to inbox/i });
    await expect(back).toBeVisible();
    await expect(back).toBeEnabled();
  });
});

test.describe("Onboarding wizard error handling", () => {
  test("network failure on Add supplier shows the humanised error", async ({ page }) => {
    // Live-only for the same structural reason as the sibling test above: this asserts a
    // humanised NETWORK error, produced by intercepting the POST /api/suppliers fetch. In
    // mock mode api-client routes createSupplier to an in-memory function that never calls
    // fetch, so page.route() has nothing to abort and the assertion is unreachable.
    //
    // This previously ran in mock mode and self-skipped MID-BODY ("Wizard didn't auto-open")
    // after navigating and clicking — so the default CI sweep reported it as exercised-then-
    // skipped when in truth it could never have tested anything. Declaring the condition up
    // front makes the coverage gap visible instead of discovering it at runtime.
    test.skip(
      process.env.PLAYWRIGHT_LIVE !== "1",
      "network-interception test requires PLAYWRIGHT_LIVE=1 (the mock api-client bypasses fetch)",
    );

    // The wizard auto-opens when the org has no supplier; /bridge triggers it.
    await page.goto("/bridge");

    // Some states surface it behind an explicit "Get started" instead of auto-opening.
    const getStarted = page.getByRole("button", { name: /get started/i });
    if (await getStarted.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await getStarted.click();
    }

    // No self-skip: reaching here means the environment supports the test, so a wizard that
    // does not open is a real failure of the onboarding path.
    const supplierInput = page.getByLabel(/supplier name/i);
    await expect(supplierInput).toBeVisible({ timeout: 10_000 });

    // Force the supplier-create call to fail at the network layer.
    await page.route(/\/api\/suppliers(\?.*)?$/i, async (route) => {
      if (route.request().method() === "POST") return route.abort("failed");
      return route.continue();
    });

    await supplierInput.fill("Smoke Test Supplier");
    await page.getByRole("button", { name: /add supplier/i }).click();

    // Humanised error from OnboardingWizard.humaniseSupplierError mentions the
    // API URL + the Railway env var + the dev-certs command.
    await expect(page.getByText(/couldn't reach the proculink api/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/Frontend:Url/i)).toBeVisible();
  });
});
