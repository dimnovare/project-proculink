// Local QA screenshots for the supplier delivery editor at 1440 and 390.
// Not part of any gate — run by hand against the mock QA server:
//   NEXT_PUBLIC_USE_MOCK=true PROCULINK_QA_BYPASS_AUTH=true bunx next dev -p 8107
//   bunx playwright test tests/e2e/p6-supplier-delivery-shots.spec.ts --project=chromium
import { test, expect } from "@playwright/test";

const BASE = process.env.QA_BASE_URL ?? "http://127.0.0.1:8107";
/** Non-mock server — see the catalog test for why it cannot share the mock one. */
const CATALOG_BASE = process.env.QA_NONMOCK_BASE_URL ?? "http://127.0.0.1:8108";
const OUT = ".qa-screenshots";

/** A saved HTTP config WITH a credential — the state whose auth type is unknowable. */
const SAVED_WITH_CREDENTIAL = {
  supplierId: "S01",
  protocol: "http",
  autoDeliver: true,
  configJson: JSON.stringify({
    url: "https://orders.supplier.example/v2/purchase-orders",
    method: "POST",
    timeoutSeconds: 30,
  }),
  outputFormat: "cxml",
  hasCredentials: true,
  credentialsDisplay: "********",
  createdAt: "2026-08-01T00:00:00Z",
  updatedAt: "2026-08-10T00:00:00Z",
  cxmlCredentials: null,
};

const VIEWPORTS = [
  { name: "1440", width: 1440, height: 1000 },
  { name: "390", width: 390, height: 844 },
  { name: "768", width: 768, height: 1024 },
];

for (const vp of VIEWPORTS) {
  test(`supplier delivery tab @ ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });

    await page.route("**/api/suppliers/*/delivery-config", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(SAVED_WITH_CREDENTIAL) });
    });

    await page.goto(`${BASE}/library/suppliers/S01?tab=delivery`, { waitUntil: "domcontentloaded" });
    await expect(page.getByLabel(/Auth type/i)).toBeVisible({ timeout: 20_000 });

    // The state this packet is about: a stored credential whose type the API never reports.
    await expect(page.getByRole("option", { name: /Keep the saved sign-in/i })).toHaveCount(1);

    await page.screenshot({ path: `${OUT}/p6-delivery-saved-credential-${vp.name}.png`, fullPage: true });

    // …and the refusal that replaces the silent overwrite.
    await page.getByLabel(/Auth type/i).selectOption("apikey");
    await page.getByLabel(/^Value$/i).fill("sk_live_rotated");
    // `p[role=alert]` — Next's route announcer is also role=alert, so a bare getByRole is ambiguous.
    await expect(page.locator("p[role=alert]")).toContainText(/Header/);
    await expect(page.getByRole("button", { name: /Save delivery/i })).toBeDisabled();
    await page.screenshot({ path: `${OUT}/p6-delivery-replace-blocked-${vp.name}.png`, fullPage: true });
  });

  // No populated-catalog capture here, deliberately. Mock mode answers getSupplierCatalog from an
  // in-memory map with no request to intercept, and the non-mock server disables every useQuery
  // through useQueriesEnabled() until a real org is signed in — so the tab sits on "Loading
  // catalog…" either way. The catalog table's scroll/stack change is covered instead by
  // SupplierDockProfile.unfetchedClaims.test.tsx, which asserts both renderings carry the code.
}
