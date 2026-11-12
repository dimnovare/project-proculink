import { test, expect } from "@playwright/test";
import { MOCK_ENGINE_IDS } from "../../src/lib/api/mockEngine";

/**
 * The only real-browser check of the authenticated fetch -> Blob -> pdf.js -> canvas path that every
 * PDF document goes through. Unit tests stub pdf.js, and every other fixture document is a CSV, so a
 * break in pdf.js worker bundling or the CSP would otherwise be green everywhere. `doc-2` is the one
 * fixture document named `.pdf` (src/lib/api/mockEngine.ts), served with real PDF bytes.
 */
test("a PDF document renders through pdf.js onto a canvas", async ({ page }) => {
  await page.goto(`/flows/${MOCK_ENGINE_IDS.flow}/documents/doc-2`);
  const canvas = page.getByTestId("source-document-pdf-canvas").first();
  await expect(canvas).toBeVisible({ timeout: 20_000 });
  const box = await canvas.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(0);
  expect(box?.height ?? 0).toBeGreaterThan(0);
});
