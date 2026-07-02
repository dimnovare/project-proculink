import { test, expect } from "@playwright/test";

/**
 * Magic Mapping Preview e2e smoke tests — mock mode only.
 *
 * Strategy: direct navigation to /upload/preview/ord-002 rather than driving
 * the full upload flow. The mock store seeds `ord-002` (ElectroSupply Co order)
 * with 4 lines: 2 already resolved, 2 with AI suggestions pending review.
 * Driving the full upload would require waiting for a ~2.6s pipeline animation
 * and handling a dynamic order id — fragile in CI. Direct navigation is faster
 * and equally effective for verifying the preview component contract.
 *
 * Auth: relies on PROCULINK_QA_BYPASS_AUTH=true (set by webServer config in
 * playwright.config.ts) so no real Clerk session is required.
 * Mode: NEXT_PUBLIC_USE_MOCK=true (default in playwright.config.ts webServer).
 */

const PREVIEW_URL = "/upload/preview/ord-002";

test.describe("MagicMappingPreview — /upload/preview/[orderId]", () => {
  test("renders the page header breadcrumb and heading", async ({ page }) => {
    await page.goto(PREVIEW_URL);

    // Page heading — title is "Confirm item codes"
    await expect(
      page.getByRole("heading", { level: 1, name: /item codes/i }),
    ).toBeVisible({ timeout: 10_000 });

    // Breadcrumb: "Upload" link within main content (not the sidebar nav link)
    await expect(page.getByRole("main").getByRole("link", { name: /^upload$/i })).toBeVisible();
  });

  test("renders mapping rows with source, canonical, and supplier columns", async ({ page }) => {
    await page.goto(PREVIEW_URL);

    // Wait for the preview component header to resolve (after mock fetch)
    await expect(
      page.getByText(/review your order mapping/i),
    ).toBeVisible({ timeout: 10_000 });

    // Column headers — use exact column header text to avoid ambiguous matches.
    // "Canonical" was renamed to "Order field"; the rightmost column is
    // "{counterpartyNoun} code" (e.g. "Supplier code"), so we match loosely.
    await expect(page.getByText("Source field & value")).toBeVisible();
    await expect(page.getByText("Order field", { exact: true })).toBeVisible();
    await expect(page.getByText(/supplier code/i).first()).toBeVisible();

    // ord-002 has 4 lines; confirm multiple rows rendered
    // Line 1: TB-CAP-100 (resolved), Line 2: TB-RES-220 (AI suggestion),
    // Line 3: TB-LED-RED (resolved), Line 4: TB-WIRE-22 (AI suggestion)
    await expect(page.getByText("TB-CAP-100")).toBeVisible();
    await expect(page.getByText("TB-RES-220")).toBeVisible();
  });

  test("AI suggestion UI — badge, confidence pill, Accept/Edit/Reject buttons", async ({ page }) => {
    await page.goto(PREVIEW_URL);

    await expect(
      page.getByText(/review your order mapping/i),
    ).toBeVisible({ timeout: 10_000 });

    // AI badge (uppercase "AI" label)
    const aiBadge = page.getByText("AI").first();
    await expect(aiBadge).toBeVisible();

    // Confidence pill — ord-002 line 2 has 84% confidence
    await expect(page.getByText("84%")).toBeVisible();

    // Accept / Edit / Reject buttons for at least one unresolved row
    await expect(page.getByRole("button", { name: /^accept$/i }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /^edit$/i }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /^reject$/i }).first()).toBeVisible();
  });

  test("'Accept all AI suggestions' bulk button is present with a count badge", async ({ page }) => {
    await page.goto(PREVIEW_URL);

    await expect(
      page.getByText(/review your order mapping/i),
    ).toBeVisible({ timeout: 10_000 });

    const acceptAll = page.getByRole("button", { name: /accept all ai suggestions/i });
    await expect(acceptAll).toBeVisible();
    await expect(acceptAll).toBeEnabled();
  });

  test("commit button is present", async ({ page }) => {
    await page.goto(PREVIEW_URL);

    await expect(
      page.getByText(/review your order mapping/i),
    ).toBeVisible({ timeout: 10_000 });

    const commitBtn = page.getByRole("button", { name: /continue to review|confirm mapping/i });
    await expect(commitBtn).toBeVisible();
    await expect(commitBtn).toBeEnabled();
  });

  test("clicking 'Accept all' marks suggestions accepted then commit navigates to order detail", async ({ page }) => {
    test.setTimeout(60_000); // cold-compile of /inbox/[orderId] can exceed 30s default under CI load
    await page.goto(PREVIEW_URL);

    await expect(
      page.getByText(/review your order mapping/i),
    ).toBeVisible({ timeout: 10_000 });

    // Accept all suggestions
    const acceptAll = page.getByRole("button", { name: /accept all ai suggestions/i });
    await expect(acceptAll).toBeVisible();
    await acceptAll.click();

    // Wait for the mock API call to complete (400ms mock delay) and the "accepted" notice to appear.
    // This ensures the preview is re-fetched and all lines are shown as resolved before we commit.
    await expect(page.getByText(/suggestions? accepted and saved/i)).toBeVisible({ timeout: 10_000 });

    const commitBtn = page.getByRole("button", { name: /continue to review|confirm mapping/i });
    await expect(commitBtn).toBeVisible();
    await expect(commitBtn).toBeEnabled();

    // Dismiss any Clerk dev-mode tooltip that may have appeared (Clerk SDK renders a
    // "Configure your application" tooltip in dev/QA-bypass mode; Escape closes it).
    await page.keyboard.press("Escape");

    // Click commit and wait for navigation to /inbox/ord-002 (mock mode).
    // Use force:true to bypass any overlapping Clerk dev-mode panel.
    // /inbox/[orderId] is cold-compiled on first navigation — generous timeout.
    await Promise.all([
      page.waitForURL(/\/inbox\/ord-002/i, { timeout: 30_000 }),
      commitBtn.click({ force: true }),
    ]);

    // Confirm we landed on the order detail page
    expect(page.url()).toMatch(/\/inbox\/ord-002/i);
  });
});

test.describe("UploadWorkbench — post-upload routes to the Order Workshop", () => {
  /**
   * STRUCT-2: the post-upload navigation now lands on /inbox/<id> (the Order
   * Workshop), NOT /upload/preview/<id>. The workshop is a strict superset of the
   * old "Confirm item codes" preview step — same issues list + the same bulk-accept
   * parity — so upload routes straight to it. The /upload/preview route stays
   * resolvable as a fallback (the first describe block above still tests it directly).
   *
   * The mock uploadPurchaseOrder has a 1500ms delay; the pipeline animation
   * adds 4×600ms + 200ms = 2.6s. Total wait budget: 15 s.
   */
  test("upload a file and land on the Order Workshop (/inbox/<id>)", async ({ page }) => {
    await page.goto("/upload");

    await expect(
      page.getByRole("heading", { level: 1, name: /upload/i }).first(),
    ).toBeVisible({ timeout: 10_000 });

    // Wait for the form to hydrate (supplier list loaded) before selecting a file,
    // so the file input's React onChange is attached (hydration race).
    await expect(page.getByRole("option", { name: /FastParts Inc/i })).toBeAttached({ timeout: 10_000 });

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
    await page.waitForURL(/\/inbox\/[^/]+$/i, { timeout: 15_000 });
    expect(page.url()).not.toMatch(/\/upload\/preview\//i);
  });
});

test.describe("Order Workshop — bulk-accept parity (the /upload/preview superset)", () => {
  /**
   * STRUCT-2 acceptance: at /inbox/<id> (the Order Workshop), an order with
   * unresolved AI-suggested lines surfaces the SAME one-click bulk-accept
   * control the /upload/preview step had, and accepting clears those issues.
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

    // The bulk-accept control (parity with /upload/preview) is present for the
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
