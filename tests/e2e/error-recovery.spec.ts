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
    if (!process.env.PLAYWRIGHT_LIVE) {
      test.skip(true, "network-interception test requires PLAYWRIGHT_LIVE=1 (mock api-client bypasses fetch)");
      return;
    }

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
    // The wizard auto-opens when the org has no supplier. In mock mode the
    // onboarding status is read from mockBilling/mockSuppliers — we visit
    // /bridge to trigger it.
    await page.goto("/bridge");

    // The wizard might be opt-in via the "Get started" button rather than
    // auto-open in mock mode. Click it if visible.
    const getStarted = page.getByRole("button", { name: /get started/i });
    if (await getStarted.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await getStarted.click();
    }

    const supplierInput = page.getByLabel(/supplier name/i);
    if (!(await supplierInput.isVisible({ timeout: 5_000 }).catch(() => false))) {
      test.skip(true, "Wizard didn't auto-open in mock mode — backend-dependent path");
      return;
    }

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
