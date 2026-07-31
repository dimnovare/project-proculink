import { expect, test, type Page } from "@playwright/test";

const API_BASE_URL = process.env.PLAYWRIGHT_API_URL ?? "http://localhost:5223";

// Batch 9 Phase C (parity gate G4): the review screen now has TWO compositions
// — classic (full-document triptych) and triage (Fix Queue + Context Stage) —
// selected via ?view=. Every journey that crosses the review screen runs once
// per view, and the selectors below are view-agnostic (header CTA, confirm
// dialog, failure panels are shared chrome).
const VIEWS = ["classic", "triage"] as const;

/** Re-open the current /inbox/{id} URL with the given review sub-view forced. */
async function gotoWithView(page: Page, view: (typeof VIEWS)[number]): Promise<void> {
  const url = new URL(page.url());
  url.searchParams.set("view", view);
  await page.goto(url.toString());
}

test.describe("Live PO loop — upload to delivery failure", () => {
  test.skip(process.env.PLAYWRIGHT_LIVE !== "1", "Live PO loop requires PLAYWRIGHT_LIVE=1");
  test.setTimeout(90_000);

  for (const view of VIEWS) {
    test(`uploads, resolves mappings, reviews, transforms, and surfaces missing delivery config [${view} view]`, async ({ page, request }) => {
      const supplier = await ensureSupplier(request);
      const stamp = Date.now();
      const csv = [
        "po_number,buyer_name,line_no,item_code,description,quantity,unit_price,currency",
        `QA-LIVE-${stamp},Browser QA Buyer,1,BQA-${stamp}-A,Blue terminal block,2,10.00,EUR`,
        `QA-LIVE-${stamp},Browser QA Buyer,2,BQA-${stamp}-B,Green relay module,3,15.50,EUR`,
        `QA-LIVE-${stamp},Browser QA Buyer,3,BQA-${stamp}-C,Panel cable set,1,28.20,EUR`,
      ].join("\n");

      await page.goto(`/upload?supplierId=${supplier.id}`);

      await expect(page.getByRole("heading", { level: 1, name: /upload/i }).first()).toBeVisible({ timeout: 10_000 });
      await page.setInputFiles('input[type="file"]', {
        name: `qa-live-${stamp}.csv`,
        mimeType: "text/csv",
        buffer: Buffer.from(csv),
      });

      const uploadButton = page.getByRole("button", { name: /upload.*(review|send)/i });
      await expect(uploadButton).toBeEnabled({ timeout: 10_000 });
      await uploadButton.click();

      await page.waitForURL(/\/upload\/preview\//i, { timeout: 30_000 });
      await expect(page.getByRole("heading", { level: 1, name: /review mapping/i })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(/review your order mapping/i)).toBeVisible({ timeout: 30_000 });

      const manualEntryButtons = page.getByRole("button", { name: /\+ enter supplier code/i });
      const count = await manualEntryButtons.count();
      expect(count).toBeGreaterThanOrEqual(1);

      for (let i = 0; i < count; i++) {
        await manualEntryButtons.first().click();
        const input = page.getByPlaceholder(/supplier item code/i);
        await input.fill(`SUP-${stamp}-${i + 1}`);
        await page.getByRole("button", { name: /^confirm$/i }).click();
      }

      await expect(page.getByText(/3 of 3 lines mapped/i)).toBeVisible({ timeout: 10_000 });

      const commitButton = page.getByRole("button", { name: /confirm mapping|continue to review/i });
      await expect(commitButton).toBeEnabled();
      await Promise.all([
        page.waitForURL(/\/inbox\//i, { timeout: 30_000 }),
        commitButton.click(),
      ]);

      // ── Force the sub-view under test (parity gate G4) ────────────────────
      await gotoWithView(page, view);
      if (view === "triage") {
        // Fully resolved order → triage shows the empty queue + the
        // Send-Readiness card with server-truth rows.
        await expect(page.getByTestId("fix-queue-triage")).toBeVisible({ timeout: 30_000 });
        await expect(page.getByTestId("send-readiness")).toBeVisible();
        await expect(page.getByTestId("readiness-lines")).toContainText("3 / 3");
      } else {
        await expect(page.getByTestId("fix-queue-triage")).toHaveCount(0);
      }

      // The send path (header CTA + confirm dialog) is shared chrome — the
      // SAME selectors must work in both compositions.
      await expect(page.getByRole("button", { name: /^send to supplier\b/i })).toBeVisible({ timeout: 30_000 });
      await page.getByRole("button", { name: /^send to supplier\b/i }).click();

      await expect(page.getByText(/this will deliver the transformed/i)).toBeVisible({ timeout: 10_000 });
      await page.locator("#confirm-check").check();
      await page.getByRole("button", { name: /send to supplier/i }).last().click();

      await expect(page.getByText(/generating the supplier-ready output/i)).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText(/delivery to supplier failed/i)).toBeVisible({ timeout: 60_000 });
      await expect(page.getByText(/supplier delivery config is missing/i)).toBeVisible();
      const retryButton = page.getByRole("button", { name: /retry delivery/i });
      await expect(retryButton).toBeVisible();
      await retryButton.click();
      await expect(page.getByText(/supplier delivery config is missing/i)).toBeVisible({ timeout: 30_000 });
    });
  }
});

// ── Mock-mode parity subset (runs in CI / `bun run test:e2e`, no backend) ─────
// Exercises the Order Workshop against the seeded mock order ord-002
// (PO-2024-005678, pending_review, 2 needs-review lines with AI suggestions).
// Live mode skips these — ord-002 only exists in the in-memory mock client.
//
// NOTE: The old ?view=triage / ?view=classic sub-view architecture was replaced
// by the unified OrderWorkshop in the Phase-6 output-restructuring. The workshop
// renders a single view: IssuesPanel on top + MapperWorkbench on desktop (lg+),
// or MobileTriage on smaller viewports. These tests verify the current behaviour.

test.describe("Order Workshop — mock parity subset", () => {
  test.skip(process.env.PLAYWRIGHT_LIVE === "1", "Mock subset requires mock mode (ord-002 is a mock seed)");
  test.setTimeout(60_000);

  test("workshop renders the order header and issues panel for a pending-review order", async ({ page }) => {
    await page.goto("/inbox/ord-002");
    // The PO number from mock seed ord-002 must be visible.
    await expect(page.getByText(/PO-2024-005678/).first()).toBeVisible({ timeout: 20_000 });
    // The workshop shell itself.
    await expect(page.getByTestId("order-workshop")).toBeVisible({ timeout: 20_000 });
    // Send is blocked while unresolved lines exist.
    await expect(page.getByRole("button", { name: /^send to supplier\b/i })).toBeDisabled();
  });

  test("issues panel shows unresolved AI-suggestion issues and blocks Send", async ({ page }) => {
    // Desktop viewport so the full mapper + IssuesPanel render (lg+).
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/inbox/ord-002");
    await expect(page.getByTestId("order-workshop")).toBeVisible({ timeout: 20_000 });

    // IssuesPanel: ord-002 has 2 open AI-suggestion issues.
    const panel = page.getByTestId("issues-panel");
    await expect(panel).toBeVisible({ timeout: 15_000 });
    // Header counts blocking issues (both AI-suggestion lines are blocking).
    await expect(panel).toContainText(/2 issues/i);
    // The panel shows the AI suggested supplier codes from the mock seed.
    // (Issue cards surface the suggestion.supplierItemCode: ES-RES-220R / ES-WIRE-22BK-100)
    await expect(panel).toContainText(/ES-RES-220R|AI suggestion/i);

    // Send stays gated while the issues panel reports open blockers.
    await expect(page.getByRole("button", { name: /^send to supplier\b/i })).toBeDisabled();
  });

  test("bulk-accept button is present on the issues panel for AI-suggestion lines", async ({ page }) => {
    // Desktop viewport so the full mapper + IssuesPanel render (lg+).
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/inbox/ord-002");
    await expect(page.getByTestId("order-workshop")).toBeVisible({ timeout: 20_000 });

    // The bulk-accept header renders when there are suggestable lines.
    // It appears inside the issues-bulk-accept slot in the IssuesPanel.
    await expect(page.getByTestId("issues-bulk-accept")).toBeVisible({ timeout: 15_000 });
    // The actual button must be visible and enabled. The one-click bulk accept
    // is labelled "Resolve all suggested" (renamed from "Accept all AI
    // suggestions" in the issues banner-actions redesign, f365aa0); it still
    // drives the same POST /accept-ai-suggestions path.
    const acceptAll = page.getByRole("button", { name: /resolve all suggested/i }).first();
    await expect(acceptAll).toBeVisible();
    await expect(acceptAll).toBeEnabled();
  });

  test("mobile view renders the mobile-triage surface with issues and Send bar", async ({ page }) => {
    // Narrow viewport: the full mapper is hidden, MobileTriage renders instead.
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/inbox/ord-002");
    await expect(page.getByTestId("order-workshop")).toBeVisible({ timeout: 20_000 });

    // MobileTriage is the honest reduced view on small screens.
    await expect(page.getByTestId("mobile-triage")).toBeVisible({ timeout: 15_000 });
    // The sticky send bar should be present.
    await expect(page.getByTestId("mobile-send-bar")).toBeVisible();
    // The mobile issue list shows open issues.
    await expect(page.getByTestId("mobile-issue-list")).toBeVisible();
  });

  test("zero overflow at 1280 wide viewport", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/inbox/ord-002");
    await expect(page.getByTestId("order-workshop")).toBeVisible({ timeout: 20_000 });

    // No horizontal overflow on the workshop shell at 1280×800.
    const overflow = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="order-workshop"]');
      if (!el) return 0;
      return el.scrollWidth - el.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

async function ensureSupplier(request: import("@playwright/test").APIRequestContext): Promise<{ id: string; name: string }> {
  const list = await request.get(`${API_BASE_URL}/api/suppliers`);
  expect(list.ok()).toBeTruthy();
  const suppliers = (await list.json()) as Array<{ id: string; name: string }>;
  const existing = suppliers.find(s => s.name === "Browser QA Supplier") ?? suppliers[0];
  if (existing) return existing;

  const created = await request.post(`${API_BASE_URL}/api/suppliers`, {
    data: { name: "Browser QA Supplier" },
  });
  expect(created.status()).toBe(201);
  return (await created.json()) as { id: string; name: string };
}
