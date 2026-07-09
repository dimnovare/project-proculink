import { test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DemoCursor, MarkerClock, holdBudgets, loadToolSpec, prepareDemoPage, soft } from "./demo-helpers";

/**
 * SETUP-GUIDE capture — "SFTP polling" (/settings?tab=sftp).
 *
 * Host/port/path → username+password (password-only: the polling channel has
 * no key auth — VO adapted from the script doc accordingly) → default
 * supplier → import-once/never-deletes narration over the form → the honest
 * silent-empty-folder failure back on the path field.
 *
 * Mock notes: getSftpSettings HAS a mock twin (clean empty form, no error
 * banner, no hideTexts needed). updateSftpSettings does NOT — Save is rested
 * on, never clicked. The mock org is on Pilot, so the amber "included on any
 * paid plan" notice sits honestly in frame (it supports the b1 narration) and
 * the enable toggle is disabled — it is never clicked.
 *
 *   bun run demo:tools:capture capture-sftp-polling-setup
 */

const here = dirname(fileURLToPath(import.meta.url));
const spec = loadToolSpec("sftp-polling-setup");
const holds = holdBudgets(spec);

test("tool capture: sftp-polling-setup", async ({ page }) => {
  test.setTimeout(420_000);

  const clock = new MarkerClock();
  const cursor = new DemoCursor(page);
  await prepareDemoPage(page);

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

  const host = () => page.getByPlaceholder(/sftp\.supplier\.example/i).first();
  const remoteDir = () => page.getByPlaceholder(/\/incoming\/orders/i).first();

  // ── open — deep-link straight onto the SFTP pull tab ─────────────────────
  await soft("open", async () => {
    await page.goto(spec.route, { waitUntil: "domcontentloaded" });
    // Wait past the loading skeleton: the real form (Host field) must be up.
    await host().waitFor({ timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(900); // settle first paint (badges, fonts)
  });

  // ── b1 — the card: title, subtitle, paid-plan notice ──────────────────────
  await beat("b1-open", async () => {
    await cursor.glideTo(page.getByText(/^SFTP pull$/).first(), 1000);
    await page.waitForTimeout(1100);
    await cursor.glideTo(page.getByText(/import them automatically/i).first(), 800);
    await page.waitForTimeout(1100);
    await cursor.glideTo(page.getByText(/included on any paid plan/i).first(), 900);
  });

  // ── b2 — host / port / the all-important path ─────────────────────────────
  await beat("b2-conn", async () => {
    await cursor.click(host(), 900);
    await page.keyboard.type("sftp.nordic-electronics.example", { delay: 38 });
    await page.waitForTimeout(500);
    await cursor.glideTo(page.getByLabel(/^port$/i).first(), 700); // 22 stays
    await page.waitForTimeout(700);
    await cursor.click(remoteDir(), 800);
    await page.keyboard.type("/exports/orders", { delay: 55 });
    await page.waitForTimeout(400);
  });

  // ── b3 — credentials (password-only; encrypted at rest) ───────────────────
  await beat("b3-creds", async () => {
    await cursor.click(page.getByLabel(/^username/i).first(), 800);
    await page.keyboard.type("proculink-pull", { delay: 48 });
    await page.waitForTimeout(400);
    await cursor.click(page.getByLabel(/^password$/i).first(), 700);
    await page.keyboard.type("demo-not-a-real-secret", { delay: 40 }); // renders as dots
    await page.waitForTimeout(500);
    await cursor.glideTo(page.getByText(/secrets are encrypted/i).first(), 900);
  });

  // ── b4 — fixed cadence + the default supplier ─────────────────────────────
  await beat("b4-supplier", async () => {
    await cursor.glideTo(page.getByText(/every few minutes/i).first(), 800);
    await page.waitForTimeout(1000);
    const supplier = page.locator("select").first(); // only select on this tab
    await cursor.glideTo(supplier, 900);
    await page.waitForTimeout(600);
    await supplier.selectOption({ label: "ElectroSupply Co" }).catch(() => {});
    await page.waitForTimeout(600);
    await cursor.glideTo(page.getByText(/attributed to this supplier/i).first(), 800);
  });

  // ── b5 — import-once + never-deletes (calm sweep; Save rested on) ─────────
  await beat("b5-processed", async () => {
    await cursor.glideTo(page.getByText(/poll this sftp folder for orders/i).first(), 1000);
    await page.waitForTimeout(1500);
    await cursor.glideTo(page.getByRole("button", { name: /^save$/i }).first(), 1100);
    await page.waitForTimeout(1500);
    await cursor.glideTo(page.getByText(/available on any paid plan/i).first(), 900);
  });

  // ── b6 — the silent empty-folder failure: back to the path ────────────────
  await beat("b6-silent", async () => {
    await cursor.click(remoteDir(), 1000);
    await page.waitForTimeout(1600);
    await cursor.glideTo(remoteDir(), 600, { dx: -160 });
    await page.waitForTimeout(400);
    await cursor.glideTo(remoteDir(), 900, { dx: 160 });
    await page.waitForTimeout(1400);
    await cursor.glideTo(page.getByText(/sftp polling guide/i).first(), 1000); // rested on, never clicked
  });

  clock.save(spec.id);
  const dest = resolve(here, "out", spec.id, "capture.webm");
  mkdirSync(dirname(dest), { recursive: true });
  await page.close();
  await page.video()?.saveAs(dest);
  console.log(`[tool-demo] footage → ${dest}`);
});
