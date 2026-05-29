import { test, expect } from "@playwright/test";

/**
 * Standards matrix screen smoke tests.
 *
 * The /library/standards page renders each standard with the following
 * data-testid contract (agreed between agents):
 *   - Outer container per standard: data-testid="standard-<id>"
 *   - Parse badge:     data-testid="parse-badge"     + data-level ∈ {supported,partial,planned,none}
 *   - Transform badge: data-testid="transform-badge" + data-level ∈ {supported,partial,planned,none}
 *
 * Mock mode (NEXT_PUBLIC_USE_MOCK=true) and QA auth bypass
 * (PROCULINK_QA_BYPASS_AUTH=true) are set by the webServer config in
 * playwright.config.ts — not repeated here.
 */

test.describe("Standards matrix", () => {
  test("matrix renders all standards", async ({ page }) => {
    await page.goto("/library/standards");

    // Page heading must be visible — allow cold-start time.
    await expect(
      page.getByRole("heading", { level: 1, name: /standards/i }),
    ).toBeVisible({ timeout: 10_000 });

    // There are exactly 10 standards in the catalog.
    await expect(
      page.locator('[data-testid^="standard-"]'),
    ).toHaveCount(10);
  });

  test("UBL 2.1 shows supported transform", async ({ page }) => {
    await page.goto("/library/standards");

    const ublCard = page.locator('[data-testid="standard-ubl-2-1-order"]');

    await expect(ublCard).toBeVisible({ timeout: 10_000 });

    // Card must display the standard name and version.
    await expect(ublCard).toContainText(/UBL Order/i);
    await expect(ublCard).toContainText(/2\.1/);

    // Transform badge must reflect the honest supported status.
    const transformBadge = ublCard.locator('[data-testid="transform-badge"]');
    await expect(transformBadge).toHaveAttribute("data-level", "supported");
  });

  test("X12 850 is honestly marked planned", async ({ page }) => {
    await page.goto("/library/standards");

    const x12Card = page.locator('[data-testid="standard-x12-850"]');

    await expect(x12Card).toBeVisible({ timeout: 10_000 });

    // Transform badge must be "planned" — guards against over-claiming
    // in-progress work while the Group M parser is still in development.
    const transformBadge = x12Card.locator('[data-testid="transform-badge"]');
    await expect(transformBadge).toHaveAttribute("data-level", "planned");
  });
});
