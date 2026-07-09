import { test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DemoCursor, MarkerClock, holdBudgets, loadToolSpec, prepareDemoPage, soft } from "./demo-helpers";

/**
 * SETUP-GUIDE capture — "OAuth2 delivery" (supplier Delivery tab, HTTP +
 * OAuth2 fetch-token auth).
 *
 * Endpoint + auth type → token URL / client id / client secret → scope +
 * grant type → the Advanced wire-format fields (Client auth / Request format /
 * Token response field — the UI's names for authStyle / requestStyle /
 * tokenResponsePath) → the on-screen fetched-fresh-per-send bearer note →
 * Test-fire rested on with the acceptance caveat.
 *
 * Mock plumbing: same as capture-cxml-setup — getDeliveryConfig answered with
 * 204 (the API's real "no config yet" response) so the form renders fresh;
 * Save/Test-fire never clicked; connector-manifest loading line hidden.
 *
 *   bun run demo:tools:capture capture-oauth2-delivery-setup
 */

const here = dirname(fileURLToPath(import.meta.url));
const spec = loadToolSpec("oauth2-delivery-setup");
const holds = holdBudgets(spec);

test("tool capture: oauth2-delivery-setup", async ({ page }) => {
  test.setTimeout(420_000);

  const clock = new MarkerClock();
  const cursor = new DemoCursor(page);
  await prepareDemoPage(page, { hideTexts: ["Loading connector requirements", "Failed to fetch"] });
  await page.route("**/api/suppliers/*/delivery-config", (route) => route.fulfill({ status: 204, body: "" }));

  const beat = async (id: string, actions?: () => Promise<void>) => {
    const b = spec.beats.find((x) => x.id === id)!;
    clock.mark(id);
    if (actions) {
      if (b.actionLeadMs) await page.waitForTimeout(b.actionLeadMs);
      await soft(id, actions);
    }
    const left = holds[id] - clock.since(id);
    if (left > 0) await page.waitForTimeout(left);
  };

  const type = async (label: RegExp, text: string, glideMs = 700) => {
    await cursor.click(page.getByLabel(label).first(), glideMs);
    await page.keyboard.type(text, { delay: 40 });
    await page.waitForTimeout(350);
  };

  // ── open ───────────────────────────────────────────────────────────────────
  await soft("open", async () => {
    await page.goto(spec.route, { waitUntil: "domcontentloaded" });
    await page.getByText(/output format — the format/i).first().waitFor({ timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(900);
  });

  // ── b1 — endpoint URL + pick the OAuth2 auth type ──────────────────────────
  await beat("b1-open", async () => {
    const url = page.getByPlaceholder(/supplier\.example\/orders/i).first();
    await cursor.click(url, 900);
    await page.keyboard.type("https://api.supplier.example/orders", { delay: 34 });
    await page.waitForTimeout(500);
    const auth = page.locator("select").nth(2); // format, method, auth
    await cursor.glideTo(auth, 800);
    await page.waitForTimeout(500);
    await auth.selectOption("oauth2").catch(() => {});
    await page.waitForTimeout(700);
    await cursor.glideTo(page.getByLabel(/token url/i).first(), 800);
  });

  // ── b2 — token URL + client credentials ────────────────────────────────────
  await beat("b2-token", async () => {
    await type(/token url/i, "https://api.supplier.example/oauth/token", 700);
    await type(/client id/i, "proculink-orders", 600);
    await type(/client secret/i, "demo-not-a-real-secret", 600);
  });

  // ── b3 — scope + grant type (open Advanced) ────────────────────────────────
  await beat("b3-scope-grant", async () => {
    await type(/scope/i, "orders.write", 700);
    await cursor.click(page.getByText(/advanced — grant type/i).first(), 800);
    await page.waitForTimeout(600);
    await cursor.glideTo(page.getByLabel(/grant type/i).first(), 700);
  });

  // ── b4 — the wire-format fields ────────────────────────────────────────────
  await beat("b4-styles", async () => {
    const clientAuth = page.locator("select").nth(4); // format, method, auth, request-format, client-auth
    await cursor.glideTo(clientAuth, 800);
    await page.waitForTimeout(400);
    await clientAuth.selectOption("basic").catch(() => {});
    await page.waitForTimeout(900);
    await clientAuth.selectOption("body").catch(() => {});
    await page.waitForTimeout(600);
    const reqFormat = page.locator("select").nth(3);
    await cursor.glideTo(reqFormat, 700);
    await page.waitForTimeout(400);
    await reqFormat.selectOption("json").catch(() => {});
    await page.waitForTimeout(900);
    await reqFormat.selectOption("form").catch(() => {});
    await page.waitForTimeout(600);
    await cursor.glideTo(page.getByLabel(/token response field/i).first(), 800);
  });

  // ── b5 — the fetched-fresh bearer flow (printed on screen) ─────────────────
  await beat("b5-flow", async () => {
    await cursor.glideTo(page.getByPlaceholder(/supplier\.example\/orders/i).first(), 1000);
    await page.waitForTimeout(1100);
    await cursor.glideTo(page.getByText(/fetched\s+fresh each time and never stored/i).first(), 1000);
  });

  // ── b6 — Test-fire (rested on) ─────────────────────────────────────────────
  await beat("b6-test", async () => {
    await cursor.glideTo(page.getByRole("button", { name: /test-fire/i }).first(), 1200);
  });

  clock.save(spec.id);
  const dest = resolve(here, "out", spec.id, "capture.webm");
  mkdirSync(dirname(dest), { recursive: true });
  await page.close();
  await page.video()?.saveAs(dest);
  console.log(`[tool-demo] footage → ${dest}`);
});
