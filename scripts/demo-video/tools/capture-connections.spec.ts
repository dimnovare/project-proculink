import { test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DemoCursor, MarkerClock, holdBudgets, loadToolSpec, prepareDemoPage, soft } from "./demo-helpers";

/**
 * PER-TOOL capture — "Versioned connections" (/connections + detail).
 *
 * List → FastParts detail (live revision card) → revision history →
 * Run tests (evidence) → Run replay (impact preview) → Publish v2 (confirm
 * dialog, success notice, v1 → archived) → the Roll-back affordance.
 * The connections mock store is fully functional, so every click is real.
 *
 *   bun run demo:tools:capture capture-connections
 */

const here = dirname(fileURLToPath(import.meta.url));
const spec = loadToolSpec("connections");
const holds = holdBudgets(spec);

test("tool capture: connections", async ({ page }) => {
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

  // ── b1 — the connections list ─────────────────────────────────────────────
  await soft("open", async () => {
    await page.goto(spec.route, { waitUntil: "networkidle" });
    await page.getByText("FastParts Inc").first().waitFor({ timeout: 15_000 }).catch(() => {});
  });
  await beat("b1-open", async () => {
    await cursor.glideTo(page.getByText(/input mapping, output template/i).first(), 900);
    await page.waitForTimeout(1100);
    await cursor.glideTo(page.getByText("Published").first(), 900);
    await page.waitForTimeout(900);
    await cursor.glideTo(page.getByText("Draft").first(), 800);
  });

  // ── b2 — open FastParts: the live revision ────────────────────────────────
  await beat("b2-detail", async () => {
    await cursor.click(page.getByText("FastParts Inc").first(), 900);
    await page.waitForURL(/\/connections\/conn-/i, { timeout: 10_000 }).catch(() => {});
    await page.getByText(/live revision/i).first().waitFor({ timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(700);
    await cursor.glideTo(page.getByText(/what this supplier receives/i).first(), 900);
    await page.waitForTimeout(1100);
    await cursor.glideTo(page.getByText(/published revisions are immutable/i).first(), 1000);
  });

  // ── b3 — revision history ─────────────────────────────────────────────────
  await beat("b3-history", async () => {
    await cursor.glideTo(page.getByText(/revision history/i).first(), 1000);
    await page.waitForTimeout(1000);
    await cursor.glideTo(page.getByText(/immutable — create a draft/i).first(), 1000);
  });

  // ── b4 — Run tests on the v2 draft ────────────────────────────────────────
  await beat("b4-test", async () => {
    await cursor.click(page.getByRole("button", { name: /run tests/i }).first(), 1000);
    await page.getByText(/test pack passed/i).first().waitFor({ timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(600);
    await cursor.glideTo(page.getByText(/test pack passed/i).first(), 800);
  });

  // ── b5 — Replay & impact preview ──────────────────────────────────────────
  await beat("b5-replay", async () => {
    await page.mouse.wheel(0, 700);
    await page.waitForTimeout(600);
    await cursor.click(page.getByRole("button", { name: /run replay/i }).first(), 1000);
    await page.getByText(/output changed/i).first().waitFor({ timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(700);
    // open the riskiest order's diff (sorted first: would-start-failing)
    await cursor.click(page.getByText("PO-2026-0481").first(), 900);
    await page.waitForTimeout(900);
  });

  // ── b6 — Publish v2 (confirm dialog → live) ───────────────────────────────
  await beat("b6-publish", async () => {
    await page.mouse.wheel(0, -1200);
    await page.waitForTimeout(600);
    await cursor.click(page.getByRole("button", { name: /^publish$/i }).first(), 900);
    const dialog = page.getByRole("dialog");
    await dialog.waitFor({ timeout: 6_000 }).catch(() => {});
    await page.waitForTimeout(2200); // let the in-flight-orders copy be read
    await cursor.click(dialog.getByRole("button", { name: /^publish$/i }).first(), 800);
    await page.getByText(/now the live revision/i).first().waitFor({ timeout: 8_000 }).catch(() => {});
  });

  // ── b7 — the rollback affordance on the archived v1 ───────────────────────
  await beat("b7-rollback", async () => {
    await cursor.glideTo(page.getByRole("button", { name: /roll back to this/i }).first(), 1200);
  });

  clock.save(spec.id);
  const dest = resolve(here, "out", spec.id, "capture.webm");
  mkdirSync(dirname(dest), { recursive: true });
  await page.close();
  await page.video()?.saveAs(dest);
  console.log(`[tool-demo] footage → ${dest}`);
});
