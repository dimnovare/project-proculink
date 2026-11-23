import { test, expect } from "@playwright/test";
import { MOCK_DOCUMENT_NUMBER, MOCK_ENGINE_IDS } from "../../src/lib/api/mockEngine";

/**
 * Error-recovery smoke tests for the document screen.
 *
 * Mock mode: `mockEngineFetch` rejects with a 404 for a path with no fixture (it never answers an unknown
 * id with an empty success), so an unknown document id must land on the screen's error state.
 * Asserted against MEANING, not sentences: the error notice offers Try again, and none of the
 * fixture document's content is shown as if the read had worked.
 */

test.describe("Document screen error handling", () => {
  test("an unknown document says it isn't here, with a way back, not an empty success", async ({ page }) => {
    await page.goto(`/flows/${MOCK_ENGINE_IDS.flow}/documents/does-not-exist-1234`);

    await expect(page.getByText("This document isn't here any more. It may have been removed.")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("link", { name: "Go to Documents", exact: true })).toHaveAttribute("href", "/documents");
    await expect(page.getByText(MOCK_DOCUMENT_NUMBER)).toHaveCount(0);
  });
});
