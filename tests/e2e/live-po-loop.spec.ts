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
      await expect(page.getByRole("button", { name: /^send to supplier$/i })).toBeVisible({ timeout: 30_000 });
      await page.getByRole("button", { name: /^send to supplier$/i }).click();

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
// Exercises both review compositions against the seeded mock order ord-002
// (PO-2024-005678, pending_review, 2 needs-review lines with AI suggestions).
// Live mode skips these — ord-002 only exists in the in-memory mock client.

test.describe("Review sub-views — mock parity subset", () => {
  test.skip(process.env.PLAYWRIGHT_LIVE === "1", "Mock subset requires mock mode (ord-002 is a mock seed)");
  test.setTimeout(60_000);

  test("classic view renders the triptych, not the triage rail", async ({ page }) => {
    await page.goto("/inbox/ord-002?view=classic");
    await expect(page.getByText(/PO-2024-005678/).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Canonical order").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("fix-queue-triage")).toHaveCount(0);
  });

  test("triage view resolves the queue keyboard-first and unblocks Send from server truth", async ({ page }) => {
    await page.goto("/inbox/ord-002?view=triage");
    await expect(page.getByTestId("fix-queue-triage")).toBeVisible({ timeout: 20_000 });

    // Queue + readiness reflect SERVER truth: 2 open AI cards, 2 of 4 lines resolved.
    await expect(page.getByText("0 of 2 resolved")).toBeVisible();
    await expect(page.getByTestId("readiness-lines")).toContainText("2 / 4");
    // Send is blocked while the server reports unresolved lines.
    await expect(page.getByRole("button", { name: /^send to supplier$/i })).toBeDisabled();

    // First open card (frozen order: severity, then line number) = line 2.
    await expect(page.getByTestId("stage-breadcrumb")).toContainText("Line 2");
    // Context Stage panels: source crop + output fragment + rules strip. The
    // fragment honours the same provenance rules as the full preview: line 2
    // is AI-suggested (not blank-unresolved), so it shows the violet AI state
    // with the backend confidence — never a fabricated resolved/green state.
    await expect(page.getByTestId("source-zone-crop")).toBeVisible();
    await expect(page.getByTestId("output-fragment")).toBeVisible();
    await expect(page.getByTestId("output-fragment")).toContainText("ES-RES-220R");
    await expect(page.getByTestId("output-fragment")).toContainText("AI mapped 84%");
    await expect(page.getByTestId("line-rules-strip")).toBeVisible();

    // A = accept the selected AI suggestion → server resolve → card collapses
    // ONLY after the refetch confirms, then selection auto-advances to line 4.
    await page.keyboard.press("a");
    await expect(page.getByText("1 of 2 resolved")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("stage-breadcrumb")).toContainText("Line 4", { timeout: 15_000 });
    await expect(page.getByTestId("readiness-lines")).toContainText("3 / 4");

    await page.keyboard.press("a");
    await expect(page.getByText("2 of 2 resolved")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/all issues resolved/i)).toBeVisible();
    await expect(page.getByTestId("readiness-lines")).toContainText("4 / 4");

    // Send unblocks from the refetched server state (gate G1).
    await expect(page.getByRole("button", { name: /^send to supplier$/i })).toBeEnabled({ timeout: 15_000 });
  });

  test("?fix= deep link selects that line's card (alias of &line=)", async ({ page }) => {
    await page.goto("/inbox/ord-002?view=triage&fix=4");
    await expect(page.getByTestId("fix-queue-triage")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("stage-breadcrumb")).toContainText("Line 4");
  });

  test("responsive compositions: zero overflow at 1280, lg band keeps the stage, md gets the disclosure, sm inlines the stage", async ({ page }) => {
    // 1280×800 — xl band: rail + sticky stage, ZERO horizontal overflow with
    // the expanded 220px sidebar.
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/inbox/ord-002?view=triage");
    const triage = page.getByTestId("fix-queue-triage");
    await expect(triage).toBeVisible({ timeout: 20_000 });
    await expect(triage).toHaveAttribute("data-band", "xl");
    const overflowAt = async () => page.evaluate(() => {
      let el = document.querySelector('[data-testid="fix-queue-triage"]')?.parentElement ?? null;
      while (el) {
        const s = getComputedStyle(el);
        if (s.overflowX === "auto" || s.overflowX === "scroll" || s.overflow === "auto") {
          return el.scrollWidth - el.clientWidth;
        }
        el = el.parentElement;
      }
      return 0;
    });
    expect(await overflowAt()).toBeLessThanOrEqual(1);
    await expect(page.getByTestId("context-stage")).toBeVisible();

    // 1024×800 — lg band: 320px rail + slim stage. This RESTORES resolution
    // workspace to the 1024–1279 band that previously lost all wiring.
    await page.setViewportSize({ width: 1024, height: 800 });
    await expect(triage).toHaveAttribute("data-band", "lg");
    await expect(page.getByTestId("context-stage")).toBeVisible();
    expect(await overflowAt()).toBeLessThanOrEqual(1);

    // 800×900 — md band: full-width queue + the stage behind a disclosure.
    await page.setViewportSize({ width: 800, height: 900 });
    await expect(triage).toHaveAttribute("data-band", "md");
    const disclosure = page.getByRole("button", { name: /context — line 2/i });
    await expect(disclosure).toBeVisible();
    await expect(page.getByTestId("context-stage")).toBeVisible();
    await disclosure.click();
    await expect(page.getByTestId("context-stage")).toHaveCount(0);
    await disclosure.click();
    await expect(page.getByTestId("context-stage")).toBeVisible();

    // 375×800 — sm band: accordion queue; the stage renders INLINE under the
    // selected card with the same handlers.
    await page.setViewportSize({ width: 375, height: 800 });
    await expect(triage).toHaveAttribute("data-band", "sm");
    await expect(page.getByTestId("context-stage")).toBeVisible();
    await expect(page.getByTestId("stage-breadcrumb")).toContainText("Line 2");

    // 1920×1000 — xxl band: stage panels side-by-side.
    await page.setViewportSize({ width: 1920, height: 1000 });
    await expect(triage).toHaveAttribute("data-band", "xxl");
    await expect(page.getByTestId("context-stage")).toBeVisible();
  });

  test("g-d / g-b hotkeys jump between Full document and Triage", async ({ page }) => {
    await page.goto("/inbox/ord-002?view=triage");
    await expect(page.getByTestId("fix-queue-triage")).toBeVisible({ timeout: 20_000 });

    // g then d → Full document (classic) sub-view.
    await page.keyboard.press("g");
    await page.keyboard.press("d");
    await expect(page.getByTestId("fix-queue-triage")).toHaveCount(0);
    await expect(page.getByText("Canonical order").first()).toBeVisible();
    await expect(page).toHaveURL(/view=classic/);

    // g then b → back to Triage.
    await page.keyboard.press("g");
    await page.keyboard.press("b");
    await expect(page.getByTestId("fix-queue-triage")).toBeVisible();
    await expect(page).toHaveURL(/view=triage/);
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
