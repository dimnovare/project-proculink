import { expect, test } from "@playwright/test";
import { createServer } from "node:http";

const API_BASE_URL = process.env.PLAYWRIGHT_API_URL ?? "http://localhost:5223";

test.describe("Live PO loop — failure-state guidance", () => {
  test.skip(process.env.PLAYWRIGHT_LIVE !== "1", "Live PO failure-state QA requires PLAYWRIGHT_LIVE=1");
  test.describe.configure({ mode: "serial" });
  test.setTimeout(90_000);

  test("blocks upload when no supplier is available", async ({ page }) => {
    await page.route(`${API_BASE_URL}/api/suppliers`, async route => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: "[]",
        });
        return;
      }
      await route.continue();
    });

    await page.goto("/upload");

    await expect(page.getByText(/no suppliers yet/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("link", { name: /add a supplier/i })).toBeVisible();

    await page.setInputFiles('input[type="file"]', {
      name: "no-supplier.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("po_number,item_code,quantity\nPO-NO-SUP,ABC,1\n"),
    });
    await expect(page.getByRole("button", { name: /upload.*send/i })).toBeDisabled();
  });

  test("shows supported-format guidance for unsupported files", async ({ page, request }) => {
    const supplier = await createSupplier(request, "Browser QA Unsupported");

    await page.goto(`/upload?supplierId=${supplier.id}`);
    await page.setInputFiles('input[type="file"]', {
      name: "purchase-order.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: Buffer.from("not a supported PO upload"),
    });

    const uploadButton = page.getByRole("button", { name: /upload.*send/i });
    await expect(uploadButton).toBeEnabled({ timeout: 10_000 });
    await uploadButton.click();

    await expect(page.getByText(/upload could not start/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/supported formats: csv, xlsx, pdf, xml/i)).toBeVisible();
  });

  test("routes scanned or image-only PDF failures to the parse-failure card", async ({ page, request }) => {
    const supplier = await createSupplier(request, "Browser QA OCR Disabled");

    await page.goto(`/upload?supplierId=${supplier.id}`);
    await page.setInputFiles('input[type="file"]', {
      name: "blank-scanned-like.pdf",
      mimeType: "application/pdf",
      buffer: blankPdfBuffer(),
    });

    const uploadButton = page.getByRole("button", { name: /upload.*send/i });
    await expect(uploadButton).toBeEnabled({ timeout: 10_000 });
    await uploadButton.click();

    await page.waitForURL(/\/inbox\//i, { timeout: 60_000 });
    await expect(page.getByText(/parsing failed/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/pdf looks scanned or image-only/i)).toBeVisible();
    await expect(page.getByRole("link", { name: /re-upload/i })).toBeVisible();
  });

  test("surfaces supplier rejection response and next action after delivery", async ({ page, request }) => {
    const rejectingEndpoint = await startRejectingEndpoint();
    try {
      const supplier = await createSupplier(request, "Browser QA Rejecting Supplier");
      const previousConfig = await getDeliveryConfig(request, supplier.id);
      try {
        await upsertHttpDeliveryConfig(request, supplier.id, rejectingEndpoint.url);

        const orderId = await uploadResolveAndSend(page, supplier.id, Date.now());

        await expect(page).toHaveURL(new RegExp(`/inbox/${orderId}`), { timeout: 30_000 });
        await expect(page.getByText(/supplier rejected the order/i)).toBeVisible({ timeout: 60_000 });
        await expect(page.getByText(/invalid supplier sku/i).first()).toBeVisible();

        await page.getByRole("button", { name: /supplier response/i }).click();
        await expect(page.getByText(/supplier rejected this order/i)).toBeVisible();
        await expect(page.getByText(/invalid supplier sku/i).first()).toBeVisible();
      } finally {
        await restoreDeliveryConfig(request, supplier.id, previousConfig);
      }
    } finally {
      await rejectingEndpoint.close();
    }
  });
});

async function createSupplier(
  request: import("@playwright/test").APIRequestContext,
  prefix: string,
): Promise<{ id: string; name: string }> {
  const stamp = Date.now();
  const created = await request.post(`${API_BASE_URL}/api/suppliers`, {
    data: { name: `${prefix} ${stamp}` },
  });
  if (created.status() === 429) {
    const list = await request.get(`${API_BASE_URL}/api/suppliers`);
    expect(list.ok()).toBeTruthy();
    const suppliers = (await list.json()) as Array<{ id: string; name: string }>;
    const match = suppliers.find(s => s.name.startsWith(prefix)) ?? suppliers[0];
    if (!match) throw new Error("Supplier limit reached and no existing supplier is available for QA.");
    return match;
  }
  expect(created.status()).toBe(201);
  return (await created.json()) as { id: string; name: string };
}

async function getDeliveryConfig(
  request: import("@playwright/test").APIRequestContext,
  supplierId: string,
): Promise<unknown | null> {
  const res = await request.get(`${API_BASE_URL}/api/suppliers/${supplierId}/delivery-config`);
  if (res.status() === 204 || res.status() === 404) return null;
  expect(res.ok()).toBeTruthy();
  return res.json();
}

async function restoreDeliveryConfig(
  request: import("@playwright/test").APIRequestContext,
  supplierId: string,
  previousConfig: unknown | null,
) {
  if (previousConfig === null) {
    const deleted = await request.delete(`${API_BASE_URL}/api/suppliers/${supplierId}/delivery-config`);
    expect([204, 404]).toContain(deleted.status());
    return;
  }

  const cfg = previousConfig as {
    protocol: string;
    autoDeliver: boolean;
    configJson: string;
  };

  const restored = await request.put(`${API_BASE_URL}/api/suppliers/${supplierId}/delivery-config`, {
    data: {
      protocol: cfg.protocol,
      autoDeliver: cfg.autoDeliver,
      configJson: cfg.configJson,
      credentialsJson: null,
    },
  });
  expect(restored.ok()).toBeTruthy();
}

async function upsertHttpDeliveryConfig(
  request: import("@playwright/test").APIRequestContext,
  supplierId: string,
  url: string,
) {
  const saved = await request.put(`${API_BASE_URL}/api/suppliers/${supplierId}/delivery-config`, {
    data: {
      protocol: "http",
      autoDeliver: false,
      configJson: JSON.stringify({ url, method: "POST", timeoutSeconds: 10 }),
      credentialsJson: JSON.stringify({ type: "none" }),
    },
  });
  expect(saved.ok()).toBeTruthy();
}

async function uploadResolveAndSend(page: import("@playwright/test").Page, supplierId: string, stamp: number): Promise<string> {
  const csv = [
    "po_number,buyer_name,line_no,item_code,description,quantity,unit_price,currency",
    `QA-REJECT-${stamp},Browser QA Buyer,1,BQA-REJECT-${stamp},Rejected test item,1,12.00,EUR`,
  ].join("\n");

  await page.goto(`/upload?supplierId=${supplierId}`);
  await page.setInputFiles('input[type="file"]', {
    name: `qa-reject-${stamp}.csv`,
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  await page.getByRole("button", { name: /upload.*send/i }).click();

  await page.waitForURL(/\/upload\/preview\//i, { timeout: 30_000 });
  const orderId = new URL(page.url()).pathname.split("/").pop()!;

  await expect(page.getByRole("heading", { level: 1, name: /review mapping/i })).toBeVisible({ timeout: 20_000 });

  await page.getByRole("button", { name: /\+ enter supplier code/i }).first().click();
  await page.getByPlaceholder(/supplier item code/i).fill(`BAD-SKU-${stamp}`);
  await page.getByRole("button", { name: /^confirm$/i }).click();

  const commitButton = page.getByRole("button", { name: /confirm mapping|continue to review/i });
  await expect(commitButton).toBeEnabled();
  await Promise.all([
    page.waitForURL(/\/inbox\//i, { timeout: 30_000 }),
    commitButton.click(),
  ]);

  await expect(page.getByRole("button", { name: /^send to supplier$/i })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: /^send to supplier$/i }).click();
  await page.locator("#confirm-check").check();
  await page.getByRole("button", { name: /send to supplier/i }).last().click();

  return orderId;
}

async function startRejectingEndpoint(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    if (req.method !== "POST") {
      res.writeHead(405, { "content-type": "text/plain" });
      res.end("method not allowed");
      return;
    }

    req.resume();
    res.writeHead(422, { "content-type": "application/json" });
    res.end(JSON.stringify({
      error: "Invalid supplier SKU",
      detail: "Line 1 BAD-SKU is not active in this supplier catalogue",
    }));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("Could not allocate rejecting endpoint port.");
  }

  return {
    url: `http://127.0.0.1:${address.port}/reject`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close(err => err ? reject(err) : resolve());
    }),
  };
}

function blankPdfBuffer(): Buffer {
  return Buffer.from(
    `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>
endobj
xref
0 4
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
trailer
<< /Size 4 /Root 1 0 R >>
startxref
186
%%EOF`,
    "utf8",
  );
}
