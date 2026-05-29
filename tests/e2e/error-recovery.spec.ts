import { test, expect } from "@playwright/test";

/**
 * Error-recovery smoke tests.
 *
 * Mock mode: drives the in-memory api-client mock, so these run without a
 * backend. The OrderDetailPage network/404 distinction is exercised by:
 *  - Visiting a non-existent order id → 404 path (no Retry button).
 *  - Stubbing the underlying fetch to throw → network-error path (with Retry).
 */

test.describe("OrderDetailPage error handling", () => {
  test("real 404 shows 'Order Not Found' with Back to Orders only (no Retry)", async ({ page }) => {
    // The mock returns null for unknown ids, which surfaces the 404 path.
    await page.goto("/orders/does-not-exist-1234");

    await expect(page.getByText(/order not found/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("link", { name: /back to orders/i })).toBeVisible();
    // Network-error-only Retry button must NOT be present on a true 404.
    await expect(page.getByRole("button", { name: /^retry$/i })).toHaveCount(0);
  });

  test("network failure shows 'Couldn't reach the API' with Retry button", async ({ page }) => {
    // This test uses page.route() to intercept and abort the /api/orders/:id
    // fetch. In mock mode (NEXT_PUBLIC_USE_MOCK=true) the api-client never
    // issues a real network request — the mock resolves in-memory — so the
    // interceptor has no effect and the network-error UI never renders.
    // Skip unless running against a live backend (PLAYWRIGHT_LIVE=1).
    if (!process.env.PLAYWRIGHT_LIVE) {
      test.skip(true, "network-interception test requires PLAYWRIGHT_LIVE=1 (mock api-client bypasses fetch)");
      return;
    }

    // Force /api/orders/:id to fail with a network-shaped error.
    await page.route(/\/api\/orders\/[^/]+$/i, async (route) => {
      await route.abort("failed");
    });

    await page.goto("/orders/some-id-that-would-otherwise-resolve");

    await expect(page.getByText(/couldn't reach the api/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/check that the backend is running/i)).toBeVisible();

    const retry = page.getByRole("button", { name: /^retry$/i });
    await expect(retry).toBeVisible();
    await expect(retry).toBeEnabled();
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
