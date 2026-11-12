import { test, expect } from "@playwright/test";
import { MOCK_ENGINE_IDS } from "../../src/lib/api/mockEngine";

/**
 * Error-recovery smoke tests for the document screen.
 *
 * Mock mode: `mockEngineFetch` THROWS for a path with no fixture (it never answers an unknown
 * id with an empty success), so an unknown document id must land on the screen's error state.
 * Asserted against MEANING, not sentences: the error notice offers a Retry, and none of the
 * fixture document's content is shown as if the read had worked.
 */

test.describe("Document screen error handling", () => {
  test("an unknown document shows the error state with a retry, not an empty success", async ({ page }) => {
    await page.goto(`/flows/${MOCK_ENGINE_IDS.flow}/documents/does-not-exist-1234`);

    await expect(page.getByRole("button", { name: /^retry$/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("INV-1001")).toHaveCount(0);
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
