import { expect, test } from "@playwright/test";

const API_BASE_URL = process.env.PLAYWRIGHT_API_URL ?? "http://localhost:5223";

test.describe("Live PO loop — upload to delivery failure", () => {
  test.skip(process.env.PLAYWRIGHT_LIVE !== "1", "Live PO loop requires PLAYWRIGHT_LIVE=1");
  test.setTimeout(90_000);

  test("uploads, resolves mappings, reviews, transforms, and surfaces missing delivery config", async ({ page, request }) => {
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

    const uploadButton = page.getByRole("button", { name: /upload.*send/i });
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
