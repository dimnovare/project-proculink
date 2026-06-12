import { test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DemoCursor, MarkerClock, holdBudgets, loadToolSpec, prepareDemoPage, soft } from "./demo-helpers";

/**
 * PER-TOOL capture — "Delivery setup" (supplier detail → Delivery tab).
 *
 * Protocol choice → output format → endpoint + auth → the delivery
 * state-boundary honesty card → Test-fire (rested on; firing/saving has no
 * mock backend) → auto-deliver. The form itself is local state, so filling
 * fields on camera is real product behaviour.
 *
 * Mock-furniture hide: "Failed to fetch" (delivery-config GET/PUT/test-fire
 * have no mock twins; the initial GET error banner would sit in frame).
 *
 *   bun run demo:tools:capture capture-delivery
 */

const here = dirname(fileURLToPath(import.meta.url));
const spec = loadToolSpec("delivery");
const holds = holdBudgets(spec);

test("tool capture: delivery", async ({ page }) => {
  test.setTimeout(420_000);

  const clock = new MarkerClock();
  const cursor = new DemoCursor(page);
  await prepareDemoPage(page, { hideTexts: ["Failed to fetch"] });

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

  // ── b1 — the protocol rail ────────────────────────────────────────────────
  await soft("open", async () => {
    await page.goto(spec.route, { waitUntil: "networkidle" });
    await page.getByText(/supplier delivery/i).first().waitFor({ timeout: 15_000 }).catch(() => {});
  });
  await beat("b1-open", async () => {
    await cursor.glideTo(page.getByText(/^HTTP$/).first(), 900);
    await page.waitForTimeout(800);
    await cursor.glideTo(page.getByText(/^SFTP$/).first(), 700);
    await page.waitForTimeout(700);
    await cursor.glideTo(page.getByText(/email \(smtp\)/i).first(), 700);
    await page.waitForTimeout(700);
    await cursor.glideTo(page.getByText(/erply erp/i).first(), 700);
    await page.waitForTimeout(700);
    await cursor.glideTo(page.getByText(/^HTTP$/).first(), 800);
  });

  // ── b2 — output format ────────────────────────────────────────────────────
  await beat("b2-format", async () => {
    const format = page.locator("select").first();
    await cursor.glideTo(format, 900);
    await page.waitForTimeout(700);
    await format.selectOption("csv").catch(() => {});
    await page.waitForTimeout(700);
    await cursor.glideTo(page.getByText(/auto-transforms/i).first(), 700);
  });

  // ── b3 — endpoint + auth ──────────────────────────────────────────────────
  await beat("b3-endpoint", async () => {
    const url = page.getByPlaceholder(/supplier\.example\/orders/i).first();
    await cursor.click(url, 900);
    await page.keyboard.type("https://orders.electrosupply.example/po", { delay: 45 });
    await page.waitForTimeout(700);
    const auth = page.locator("select").nth(2); // format, method, auth
    await cursor.glideTo(auth, 800);
    await page.waitForTimeout(500);
    await auth.selectOption("apikey").catch(() => {});
    await page.waitForTimeout(600);
  });

  // ── b4 — the delivery state boundary (honesty card) ───────────────────────
  await beat("b4-boundary", async () => {
    await cursor.glideTo(page.getByText(/delivery state boundary/i).first(), 1100);
  });

  // ── b5 — Test-fire (rested on; see header) ────────────────────────────────
  await beat("b5-testfire", async () => {
    await cursor.glideTo(page.getByRole("button", { name: /test-fire/i }).first(), 1200);
  });

  // ── b6 — auto-deliver ─────────────────────────────────────────────────────
  await beat("b6-auto", async () => {
    await cursor.click(page.getByText(/auto-deliver/i).first(), 1100);
  });

  clock.save(spec.id);
  const dest = resolve(here, "out", spec.id, "capture.webm");
  mkdirSync(dirname(dest), { recursive: true });
  await page.close();
  await page.video()?.saveAs(dest);
  console.log(`[tool-demo] footage → ${dest}`);
});
