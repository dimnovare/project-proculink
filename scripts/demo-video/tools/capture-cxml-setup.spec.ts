import { test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DemoCursor, MarkerClock, holdBudgets, loadToolSpec, prepareDemoPage, soft } from "./demo-helpers";

/**
 * SETUP-GUIDE capture — "cXML setup" (supplier Delivery tab, output = cXML).
 *
 * Output format → the three cXML party identities (From / To / Sender) →
 * shared secret (write-only; per-field keep-on-blank is backend-verified) →
 * Test-fire rested on → the endpoint-answered ≠ accepted honesty card.
 *
 * Mock plumbing: getDeliveryConfig has no mock twin and the editor now shows
 * a blocking "Couldn't load delivery config" card on a failed GET — so this
 * capture answers the GET with 204, the API's REAL "no config yet" response,
 * and the form renders in its genuine fresh state. Save/Test-fire are never
 * clicked (no mock backend). "Loading connector requirements" is hidden
 * (manifest endpoint has no mock twin; the panel itself degrades to null).
 *
 *   bun run demo:tools:capture capture-cxml-setup
 */

const here = dirname(fileURLToPath(import.meta.url));
const spec = loadToolSpec("cxml-setup");
const holds = holdBudgets(spec);

test("tool capture: cxml-setup", async ({ page }) => {
  test.setTimeout(420_000);

  const clock = new MarkerClock();
  const cursor = new DemoCursor(page);
  await prepareDemoPage(page, { hideTexts: ["Loading connector requirements", "Failed to fetch"] });
  // The API's real "no delivery config yet" answer (204) — form renders fresh.
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
    await page.keyboard.type(text, { delay: 42 });
    await page.waitForTimeout(350);
  };

  // ── open ───────────────────────────────────────────────────────────────────
  await soft("open", async () => {
    await page.goto(spec.route, { waitUntil: "domcontentloaded" });
    await page.getByText(/output format — the format/i).first().waitFor({ timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(900);
  });

  // ── b1 — pick cXML as the output format ───────────────────────────────────
  await beat("b1-open", async () => {
    await cursor.glideTo(page.getByText(/^HTTP$/).first(), 900);
    await page.waitForTimeout(700);
    const format = page.locator("select").first();
    await cursor.glideTo(format, 800);
    await page.waitForTimeout(500);
    await format.selectOption("cxml").catch(() => {});
    await page.waitForTimeout(700);
    await cursor.glideTo(page.getByText(/cxml network credentials/i).first(), 900);
  });

  // ── b2 — the three party rows ──────────────────────────────────────────────
  await beat("b2-parties", async () => {
    await cursor.glideTo(page.getByLabel(/^from domain/i).first(), 900);
    await page.waitForTimeout(1000);
    await cursor.glideTo(page.getByLabel(/^to domain/i).first(), 800);
    await page.waitForTimeout(1000);
    await cursor.glideTo(page.getByLabel(/^sender domain/i).first(), 800);
  });

  // ── b3 — From + To (sample values) ─────────────────────────────────────────
  await beat("b3-from-to", async () => {
    await type(/^from domain/i, "DUNS", 800);
    await type(/from identity/i, "812345678", 600);
    await type(/^to domain/i, "NetworkId", 700);
    await type(/to identity/i, "AN01000012345", 600);
  });

  // ── b4 — Sender + the write-only shared secret ─────────────────────────────
  await beat("b4-secret", async () => {
    await type(/^sender domain/i, "NetworkId", 800);
    await type(/^sender identity/i, "NordicElectronics_SE", 600);
    await cursor.glideTo(page.getByLabel(/sender shared secret/i).first(), 700);
    await page.waitForTimeout(900); // let the "Optional — supplier-issued" placeholder read
    await cursor.click(page.getByLabel(/sender shared secret/i).first(), 300);
    await page.keyboard.type("demo-shared-secret-2026", { delay: 40 });
  });

  // ── b5 — Test-fire (rested on; dimmed until saved) ─────────────────────────
  await beat("b5-test", async () => {
    await cursor.glideTo(page.getByRole("button", { name: /test-fire/i }).first(), 1200);
  });

  // ── b6 — the honesty card ──────────────────────────────────────────────────
  await beat("b6-outcome", async () => {
    await cursor.glideTo(page.getByText(/how sending works/i).first(), 1100);
    await page.waitForTimeout(1200);
    await cursor.glideTo(page.getByText(/only this delivery setup can mark it as sent/i).first(), 700);
  });

  clock.save(spec.id);
  const dest = resolve(here, "out", spec.id, "capture.webm");
  mkdirSync(dirname(dest), { recursive: true });
  await page.close();
  await page.video()?.saveAs(dest);
  console.log(`[tool-demo] footage → ${dest}`);
});
