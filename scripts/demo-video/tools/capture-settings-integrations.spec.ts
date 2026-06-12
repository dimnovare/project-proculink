import { test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DemoCursor, MarkerClock, holdBudgets, loadToolSpec, prepareDemoPage, soft } from "./demo-helpers";

/**
 * PER-TOOL capture — "Settings & integrations" (/settings).
 *
 * Org direction → Email intake (IMAP) → SFTP pull → S3/R2 pull → API keys
 * (create one on camera; the mock returns a real-shaped one-time plk_ key) →
 * Connectors (webhooks + the honest "coming soon" on native Zapier/Make).
 * All tab switches are client-side.
 *
 * Mock-furniture hide: "Loading members" (the members query has no mock twin
 * and would spin forever in frame).
 *
 *   bun run demo:tools:capture capture-settings-integrations
 */

const here = dirname(fileURLToPath(import.meta.url));
const spec = loadToolSpec("settings-integrations");
const holds = holdBudgets(spec);

test("tool capture: settings-integrations", async ({ page }) => {
  test.setTimeout(420_000);

  const clock = new MarkerClock();
  const cursor = new DemoCursor(page);
  await prepareDemoPage(page, { hideTexts: ["Loading members"] });

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

  // ── b1 — org direction ────────────────────────────────────────────────────
  await soft("open", async () => {
    await page.goto(spec.route, { waitUntil: "networkidle" });
    await page.getByText(/how do you use proculink/i).first().waitFor({ timeout: 15_000 }).catch(() => {});
  });
  await beat("b1-direction", async () => {
    await cursor.glideTo(page.getByText(/how do you use proculink/i).first(), 1000);
    await page.waitForTimeout(1200);
    await cursor.glideTo(page.getByText(/we send purchase orders/i).first(), 900);
    await page.waitForTimeout(1100);
    await cursor.glideTo(page.getByText(/we receive purchase orders/i).first(), 800);
  });

  // ── b2 — email intake ─────────────────────────────────────────────────────
  await beat("b2-email", async () => {
    await cursor.click(page.getByRole("button", { name: /email intake/i }).first(), 900);
    await page.waitForTimeout(900);
    const host = page.getByPlaceholder(/imap\.company\.com/i).first();
    await cursor.click(host, 800);
    await page.keyboard.type("imap.nordic-electronics.example", { delay: 42 });
    await page.waitForTimeout(600);
    await cursor.glideTo(page.getByText(/attachments are imported/i).first(), 900);
  });

  // ── b3 — SFTP pull ────────────────────────────────────────────────────────
  await beat("b3-sftp", async () => {
    await cursor.click(page.getByRole("button", { name: /sftp pull/i }).first(), 900);
    await page.waitForTimeout(900);
    await cursor.glideTo(page.getByText(/poll a supplier/i).first(), 800);
    await page.waitForTimeout(900);
    await cursor.glideTo(page.getByText(/secrets are encrypted/i).first(), 1000);
  });

  // ── b4 — S3 / R2 pull ─────────────────────────────────────────────────────
  await beat("b4-s3", async () => {
    await cursor.click(page.getByRole("button", { name: /s3 \/ r2 pull/i }).first(), 900);
    await page.waitForTimeout(900);
    await cursor.glideToPoint(1180, 480, 800);
  });

  // ── b5 — API keys: ingress endpoint + create a one-time key ───────────────
  await beat("b5-apikeys", async () => {
    await cursor.click(page.getByRole("button", { name: /api keys/i }).first(), 900);
    await page.waitForTimeout(900);
    await cursor.glideTo(page.getByText(/ingress endpoint/i).first(), 800);
    await page.waitForTimeout(900);
    await cursor.click(page.getByRole("button", { name: /create key/i }).first(), 900);
    await page.waitForTimeout(500);
    await page.keyboard.type("ERP integration", { delay: 70 });
    await page.waitForTimeout(400);
    await cursor.click(page.getByRole("button", { name: /create key/i }).first(), 700);
    await page.getByText(/api key created/i).first().waitFor({ timeout: 8_000 }).catch(() => {});
    await page.waitForTimeout(600);
    await cursor.glideTo(page.getByText(/cannot be retrieved again/i).first(), 900);
  });

  // ── b6 — connectors: webhooks + the honest coming-soon ────────────────────
  await beat("b6-connectors", async () => {
    await cursor.click(page.getByRole("button", { name: /^connectors$/i }).first(), 900);
    await page.waitForTimeout(900);
    await cursor.glideTo(page.getByText(/rest api & webhooks/i).first(), 800);
    await page.waitForTimeout(1000);
    await cursor.glideTo(page.getByText(/coming soon/i).first(), 900);
    await page.waitForTimeout(1000);
    await cursor.glideTo(page.getByRole("button", { name: /add webhook/i }).last(), 900);
  });

  clock.save(spec.id);
  const dest = resolve(here, "out", spec.id, "capture.webm");
  mkdirSync(dirname(dest), { recursive: true });
  await page.close();
  await page.video()?.saveAs(dest);
  console.log(`[tool-demo] footage → ${dest}`);
});
