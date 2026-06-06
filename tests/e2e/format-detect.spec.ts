import { test, expect } from "@playwright/test";

// Format auto-detect pill smoke test.
//
// IMPORTANT: This test always runs in MOCK mode (NEXT_PUBLIC_USE_MOCK=true per
// playwright.config.ts webServer defaults). In mock mode the frontend calls
// mockDetectFormat directly and does NOT hit the network, so page.route stubs
// would have no effect.
//
// Instead the test asserts that the FIXED SYNTHETIC response returned by
// mockDetectFormat renders correctly in the UI:
//   format: csv, confidence: 0.92, detectedPoNumber: PO-DETECT-DEMO,
//   estimatedLineCount: 12
//
// A future maintainer switching to NEXT_PUBLIC_USE_MOCK=false for this test
// should replace the assertions below with the real API stub approach using
// page.route with a catch-all glob for the detect-format endpoint.
//
// Auth: relies on PROCULINK_QA_BYPASS_AUTH=true (set by webServer config in
// playwright.config.ts) so no real Clerk session is required.

test("format detection pill appears after file selection", async ({ page }) => {
  await page.goto("/upload");

  // Wait for the upload heading to confirm the page has loaded.
  await expect(
    page.getByRole("heading", { level: 1, name: /upload/i }).first(),
  ).toBeVisible({ timeout: 10_000 });

  // Wait for the form to hydrate (supplier list loaded) so the file input's
  // React onChange is attached before we set a file — otherwise the detection
  // handler is missed and the pill never renders (hydration race).
  await expect(page.getByRole("option", { name: /FastParts Inc/i })).toBeAttached({ timeout: 10_000 });

  // Select a minimal CSV file using the hidden file input.
  // The mock returns a fixed synthetic detection regardless of file content.
  await page.setInputFiles('input[type="file"]', {
    name: "sample.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("PO,SKU,Qty\nPO-1,SKU-A,10\n"),
  });

  // The mock detectFormat has a 400 ms artificial delay.
  // Pill should become visible within 2 seconds of file selection.

  // During the delay we may briefly see "Detecting format…"
  // We don't assert on it — it might flash too fast to catch reliably.

  // Assert the fully-rendered detection pill is visible.
  await expect(page.getByText(/Detected:/)).toBeVisible({ timeout: 8_000 });

  // The mock returns 92% confidence — assert the percentage renders.
  await expect(page.getByText(/92%/)).toBeVisible({ timeout: 8_000 });

  // The mock detectedPoNumber is "PO-DETECT-DEMO" — the secondary line renders.
  await expect(page.getByText(/PO-DETECT-DEMO/)).toBeVisible({ timeout: 8_000 });
});

test("upload button stays enabled while detection is in-flight", async ({ page }) => {
  await page.goto("/upload");

  await expect(
    page.getByRole("heading", { level: 1, name: /upload/i }).first(),
  ).toBeVisible({ timeout: 10_000 });

  await page.setInputFiles('input[type="file"]', {
    name: "sample.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("PO,SKU,Qty\nPO-1,SKU-A,10\n"),
  });

  // Immediately after file selection (before the mock 400 ms delay completes),
  // the "Upload & send" button must NOT be disabled.
  // Detection must never block submission.
  const bridgeBtn = page.getByRole("button", { name: /upload.*(review|send)|choose a file/i });
  // Give the page a short tick to process the file event — still before 400 ms.
  await page.waitForTimeout(50);
  await expect(bridgeBtn).not.toBeDisabled();
});
