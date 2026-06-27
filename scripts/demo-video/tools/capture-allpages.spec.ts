import { test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { prepareDemoPage } from "./demo-helpers";

/**
 * One-off: screenshot EVERY current page of the live app for the Claude Design
 * polish handoff. Renders the real UI in mock mode with auth bypassed (the same
 * dev:demo server the per-tool captures use), strips dev overlays + the mock
 * badge via prepareDemoPage, then saves a full-page PNG per route.
 *
 *   bun run demo:tools:capture capture-allpages
 *
 * Output lands in the BACKEND repo next to the design briefs so the whole
 * handoff package (briefs + screenshots + per-page notes) is in one place.
 */

const OUT = resolve(
  "C:/Users/Dmitri.MARKIT/source/repos/ProcuLink/docs/design-system/current-ui-screenshots-2026-06-26",
);
mkdirSync(OUT, { recursive: true });

const SUP = "22222222-2222-2222-2222-222222222222"; // mock supplier id

// [order, slug, url] — desktop capture for every product + key marketing page.
const DESKTOP: Array<[string, string, string]> = [
  ["01", "dashboard-bridge", "/bridge"],
  ["02", "inbox-order-list", "/inbox"],
  ["03", "order-review-mapper", "/inbox/ord-002"],
  ["04", "upload-import", "/upload"],
  ["05", "suppliers-list", "/library/suppliers"],
  ["06", "supplier-detail", `/library/suppliers/${SUP}`],
  ["07", "supplier-po-mapping", `/library/suppliers/${SUP}?tab=po-mapping`],
  ["08", "supplier-delivery-config", `/library/suppliers/${SUP}?tab=delivery`],
  ["09", "connections-list", "/connections"],
  ["10", "library-mappings", "/library/mappings"],
  ["11", "library-rules", "/library/rules"],
  ["12", "library-rule-definitions", "/library/rule-definitions"],
  ["13", "library-templates", "/library/templates"],
  ["14", "library-buyers", "/library/buyers"],
  ["15", "library-standards", "/library/standards"],
  ["16", "operations-exceptions", "/operations/exceptions"],
  ["17", "operations-health", "/operations/health"],
  ["18", "operations-delivery-log", "/operations/log"],
  ["19", "operations-connectors", "/operations/connectors"],
  ["20", "operations-webhooks", "/operations/webhooks"],
  ["21", "inbound-invoices", "/inbound/invoices"],
  ["22", "inbound-asns", "/inbound/asns"],
  ["23", "drafts", "/drafts"],
  ["24", "settings", "/settings"],
  ["25", "admin", "/admin"],
  ["26", "marketing-landing", "/"],
  ["27", "marketing-pricing", "/pricing"],
  ["28", "marketing-how-it-works", "/how-it-works"],
  ["29", "welcome-onboarding", "/welcome"],
];

// Core product screens worth a mobile capture too.
const MOBILE: Array<[string, string, string]> = [
  ["01", "dashboard-bridge", "/bridge"],
  ["02", "inbox-order-list", "/inbox"],
  ["03", "order-review-mapper", "/inbox/ord-002"],
  ["04", "upload-import", "/upload"],
  ["07", "supplier-po-mapping", `/library/suppliers/${SUP}?tab=po-mapping`],
  ["24", "settings", "/settings"],
];

async function shoot(page: import("@playwright/test").Page, url: string, file: string) {
  await prepareDemoPage(page); // adds init scripts → must run before goto
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(2200); // let mock data + the BridgeLoader settle
  await page.screenshot({ path: resolve(OUT, file), fullPage: true });
  console.log(`[allpages] ${file}`);
}

// One test PER route — a slow/erroring route can't abort the others, and each
// gets its own timeout instead of one cumulative budget for all 29.
test.describe("capture all current pages", () => {
  for (const [n, slug, url] of DESKTOP) {
    test(`desktop ${n} ${slug}`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await shoot(page, url, `${n}-desktop-${slug}.png`);
    });
  }
  for (const [n, slug, url] of MOBILE) {
    test(`mobile ${n} ${slug}`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await shoot(page, url, `${n}-mobile-${slug}.png`);
    });
  }
});
