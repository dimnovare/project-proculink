import { test, expect } from "@playwright/test";

/**
 * Upload → Order Workshop e2e smoke tests — mock mode only.
 *
 * Uploading routes straight to /inbox/<id> (the Order Workshop). It used to stop
 * at /upload/preview/<id> first; that screen was a subset of the workshop and was
 * retired, so the workshop is now the only review surface and these tests are the
 * end-to-end proof of both halves: that upload lands there, and that the workshop
 * carries the bulk-accept control the preview step used to own.
 *
 * The mock store seeds `ord-002` (ElectroSupply Co order) with 4 lines: 2 already
 * resolved, 2 with AI suggestions pending review.
 *
 * Auth: relies on PROCULINK_QA_BYPASS_AUTH=true (set by webServer config in
 * playwright.config.ts) so no real Clerk session is required.
 * Mode: NEXT_PUBLIC_USE_MOCK=true (default in playwright.config.ts webServer).
 */

// Suppress the cookie-consent banner across this file. It's a fixed bottom-of-
// viewport overlay; when a bottom-anchored control sits under it, a Playwright
// click dispatches at coordinates the banner intercepts, so the action never
// fires and the navigation times out. Pre-seed a decided consent so the banner
// never renders (same key the app persists). The banner-clearance contract
// itself is proved deliberately, with the banner visible, in
// cookie-banner-cta-clearance.spec.ts.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("proculink_cookie_consent_v1", "functional-only");
    } catch {
      /* private mode — banner may still show; the tests that don't click a
         bottom-anchored control are unaffected */
    }
  });
});

test.describe("UploadWorkbench — post-upload routes to the Order Workshop", () => {
  /**
   * STRUCT-2: the post-upload navigation lands on /inbox/<id> (the Order
   * Workshop), NOT /upload/preview/<id>. The workshop is a strict superset of the
   * old "Confirm item codes" preview step — same issues list + the same bulk-accept
   * parity — so upload routes straight to it. /upload/preview/<id> now 308s here,
   * which tests/e2e/retired-routes.spec.ts pins.
   *
   * The mock uploadPurchaseOrder has a 1500ms delay; the pipeline animation
   * adds 4×600ms + 200ms = 2.6s. Total wait budget: 15 s.
   */
  test("upload a file and land on the Order Workshop (/inbox/<id>)", async ({ page }) => {
    // Insurance for a cold /inbox/[orderId] compile if this runs before the
    // warm-up test above (test order/sharding): give the navigation room.
    test.setTimeout(90_000);
    await page.goto("/upload");

    await expect(
      page.getByRole("heading", { level: 1, name: /upload/i }).first(),
    ).toBeVisible({ timeout: 10_000 });

    // Wait for the form to hydrate (supplier list loaded) before selecting a file,
    // so the file input's React onChange is attached (hydration race). The "Send to"
    // control is a searchable combobox: open it to confirm the list loaded, then close.
    await page.locator("#upload-supplier").click();
    await expect(page.getByRole("option", { name: /FastParts Inc/i })).toBeAttached({ timeout: 10_000 });
    await page.keyboard.press("Escape");

    // Attach a minimal CSV file
    await page.setInputFiles('input[type="file"]', {
      name: "test-po.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("PO,SKU,Qty\nPO-TEST-1,SKU-A,10\nPO-TEST-1,SKU-B,5\n"),
    });

    // Click the upload button (supplier is pre-selected from mock store)
    const uploadBtn = page.getByRole("button", { name: /upload.*(review|send)/i });
    await expect(uploadBtn).toBeVisible({ timeout: 5_000 });
    await expect(uploadBtn).toBeEnabled();
    await uploadBtn.click();

    // Wait for navigation to the Order Workshop at /inbox/<dynamic-id>
    // (NOT /upload/preview — STRUCT-2 routes upload straight to the superset workshop).
    await page.waitForURL(/\/inbox\/[^/]+$/i, { timeout: 45_000 });
    expect(page.url()).not.toMatch(/\/upload\/preview\//i);
  });
});

test.describe("Order Workshop — bulk-accept parity (the retired preview step's superset)", () => {
  /**
   * STRUCT-2 acceptance: at /inbox/<id> (the Order Workshop), an order with
   * unresolved AI-suggested lines surfaces the SAME one-click bulk-accept
   * control the retired /upload/preview step had, and accepting clears those issues.
   * The workshop's control is labelled "Resolve all suggested" (renamed from
   * "Accept all AI suggestions" in the issues banner-actions redesign,
   * f365aa0); it still drives the same POST /accept-ai-suggestions path.
   *
   * ord-002 is seeded with 2 lines carrying pending AI suggestions (84% + 72%),
   * so the workshop's IssuesPanel renders the bulk-accept header.
   */
  test("the workshop exposes 'Resolve all suggested' and clicking it clears issues", async ({ page }) => {
    await page.goto("/inbox/ord-002");

    // The workshop shell renders (desktop mapper view).
    await expect(page.getByTestId("order-workshop")).toBeVisible({ timeout: 15_000 });

    // The bulk-accept control (parity with the retired preview step) is present for the
    // unresolved AI-suggested lines.
    const acceptAll = page.getByRole("button", { name: /resolve all suggested/i }).first();
    await expect(acceptAll).toBeVisible({ timeout: 10_000 });
    await acceptAll.click();

    // After accepting, the AI-suggestion issues clear — the bulk-accept control
    // (which only renders while suggestable lines remain) disappears.
    await expect(
      page.getByRole("button", { name: /resolve all suggested/i }),
    ).toHaveCount(0, { timeout: 15_000 });
  });
});
