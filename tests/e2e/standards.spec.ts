import { test, expect } from "@playwright/test";

/**
 * Standards reference screen smoke tests.
 *
 * The /library/standards page renders the canonical-PO-field → standards
 * cross-reference TABLE (FIELD_STANDARDS × STANDARD_REF_COLUMNS from
 * src/lib/standards/catalog.ts): one row per canonical field, one column per
 * standard (UBL / Peppol BIS / EDIFACT / X12 / cXML), each cell showing the
 * element path that field maps to in that standard.
 *
 * Note: the earlier per-standard capability-card matrix (data-testid="standard-*"
 * with parse/transform "honesty" badges) was replaced by this field-reference
 * table in the redesign. The support-level data still lives in catalog.ts
 * `STANDARDS` and powers the StandardsFieldPopover, but is no longer rendered on
 * this route, so these specs validate the table contract instead.
 *
 * Mock mode (NEXT_PUBLIC_USE_MOCK=true) and QA auth bypass
 * (PROCULINK_QA_BYPASS_AUTH=true) are set by the webServer config in
 * playwright.config.ts — not repeated here.
 */

test.describe("Standards reference", () => {
  test("renders the heading, every standard column, and all canonical fields", async ({ page }) => {
    await page.goto("/library/standards");

    // Page heading must be visible — allow cold-start time.
    await expect(
      page.getByRole("heading", { level: 1, name: /standards reference/i }),
    ).toBeVisible({ timeout: 10_000 });

    // All five standards are columns in the matrix (always-on visibility).
    for (const col of ["UBL", "Peppol BIS", "EDIFACT", "X12", "cXML"]) {
      await expect(page.getByRole("columnheader", { name: col, exact: true })).toBeVisible();
    }

    // One row per canonical field — 11 fields in the catalog (5 header + 6 line).
    await expect(page.locator("tbody tr")).toHaveCount(11);

    // Spot-check a header field and a line field render by label.
    await expect(page.getByText("PO number", { exact: true })).toBeVisible();
    await expect(page.getByText("Unit price", { exact: true })).toBeVisible();
  });

  test("canonical field rows show their UBL and X12 reference paths", async ({ page }) => {
    await page.goto("/library/standards");

    // PO number → UBL cbc:ID, X12 BEG03 (honest, transcribed from the matrix).
    const poRow = page.locator("tbody tr", { hasText: "PO number" });
    await expect(poRow).toBeVisible({ timeout: 10_000 });
    await expect(poRow).toContainText("cbc:ID");
    await expect(poRow).toContainText("BEG03");

    // Unit price → UBL cac:Price/cbc:PriceAmount, X12 PO104.
    const priceRow = page.locator("tbody tr", { hasText: "Unit price" });
    await expect(priceRow).toContainText("cac:Price/cbc:PriceAmount");
    await expect(priceRow).toContainText("PO104");
  });

  test("field search narrows the table", async ({ page }) => {
    await page.goto("/library/standards");

    await expect(page.getByText("PO number", { exact: true })).toBeVisible({ timeout: 10_000 });

    // Filtering to "unit price" keeps the Unit price row and drops PO number.
    await page.getByPlaceholder(/search fields/i).fill("unit price");

    await expect(page.getByText("Unit price", { exact: true })).toBeVisible();
    await expect(page.getByText("PO number", { exact: true })).toHaveCount(0);
  });
});
