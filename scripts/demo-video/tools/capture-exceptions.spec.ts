import { test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DemoCursor, MarkerClock, holdBudgets, loadToolSpec, prepareDemoPage, soft } from "./demo-helpers";

/**
 * PER-TOOL capture — "Exceptions & health" (/operations/exceptions + /health).
 *
 * Exception queue → expanded what/why/fix/status panel → the delivered-but-
 * acceptance-unconfirmed honesty line (the product's own "a 2xx is not
 * business acceptance" copy, on screen) → the deliberate Ignored record →
 * System health (worker heartbeat + tiles) → dead-letter requeue.
 * Health is reached client-side via the sidebar.
 *
 *   bun run demo:tools:capture capture-exceptions
 */

const here = dirname(fileURLToPath(import.meta.url));
const spec = loadToolSpec("exceptions");
const holds = holdBudgets(spec);

test("tool capture: exceptions", async ({ page }) => {
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

  // ── b1 — the queue ────────────────────────────────────────────────────────
  await soft("open", async () => {
    await page.goto(spec.route, { waitUntil: "networkidle" });
    await page.getByText(/UNRESOLVED_SUPPLIER_CODE/i).first().waitFor({ timeout: 15_000 }).catch(() => {});
  });
  await beat("b1-open", async () => {
    await cursor.glideTo(page.getByText(/human decision/i).first(), 900);
    await page.waitForTimeout(1000);
    const firstRow = page.locator("tbody tr").first();
    await cursor.glideTo(firstRow, 900, { dx: -380 });
    await cursor.glideTo(firstRow, 1500, { dx: 320 });
  });

  // ── b2 — expand: what's wrong / why / how to fix / status ─────────────────
  await beat("b2-expand", async () => {
    const row = page.locator("tr", { hasText: "UNRESOLVED_SUPPLIER_CODE" }).first();
    await cursor.click(row.locator("button").first(), 900);
    await page.getByText(/what's wrong/i).first().waitFor({ timeout: 6_000 }).catch(() => {});
    await page.waitForTimeout(700);
    await cursor.glideTo(page.getByText(/how to fix/i).first(), 900);
    await page.waitForTimeout(900);
    await cursor.glideTo(page.getByRole("button", { name: /open order to fix/i }).first(), 800);
  });

  // ── b3 — delivery honesty: sent ≠ accepted ────────────────────────────────
  await beat("b3-honesty", async () => {
    // collapse the first panel, expand the critical deliver-stage row
    const first = page.locator("tr", { hasText: "UNRESOLVED_SUPPLIER_CODE" }).first();
    await cursor.click(first.locator("button").first(), 700);
    await page.waitForTimeout(500);
    const row = page.locator("tr", { hasText: "SUPPLIER_HTTP_422" }).first();
    await cursor.click(row.locator("button").first(), 900);
    await page.getByText(/acceptance unconfirmed/i).first().waitFor({ timeout: 6_000 }).catch(() => {});
    await page.waitForTimeout(800);
    await cursor.glideTo(page.getByText(/not the same as business acceptance/i).first(), 1100);
  });

  // ── b4 — the deliberate Ignored record ────────────────────────────────────
  await beat("b4-ignored", async () => {
    await cursor.click(page.getByRole("button", { name: /^ignored$/i }).first(), 900);
    await page.waitForTimeout(900);
    await cursor.glideTo(page.getByText(/DUPLICATE_PO_NUMBER/i).first(), 900);
  });

  // ── b5 — System health (client-side via the sidebar) ──────────────────────
  await beat("b5-health", async () => {
    await cursor.click(page.getByRole("link", { name: /system health/i }).first(), 1000);
    await page.getByText(/worker online/i).first().waitFor({ timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(700);
    await cursor.glideTo(page.getByText(/worker online/i).first(), 800);
    await page.waitForTimeout(900);
    await cursor.glideTo(page.getByText(/dead-letter$/i).first(), 900);
  });

  // ── b6 — requeue a dead-lettered delivery ─────────────────────────────────
  await beat("b6-requeue", async () => {
    await cursor.glideTo(page.getByText(/dead-letter queue/i).first(), 800);
    await page.waitForTimeout(800);
    await cursor.click(page.getByRole("button", { name: /requeue delivery/i }).first(), 900);
    await page.getByText(/re-queued delivery/i).first().waitFor({ timeout: 8_000 }).catch(() => {});
  });

  clock.save(spec.id);
  const dest = resolve(here, "out", spec.id, "capture.webm");
  mkdirSync(dirname(dest), { recursive: true });
  await page.close();
  await page.video()?.saveAs(dest);
  console.log(`[tool-demo] footage → ${dest}`);
});
