import { test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DemoCursor, MarkerClock, holdBudgets, loadToolSpec, prepareDemoPage, soft } from "./demo-helpers";

/**
 * PER-TOOL capture — "The Inbox" (/inbox).
 *
 * Work queue → status filter → search → j/k keyboard nav → bulk select →
 * Send selected. ONE page load; all filtering is client-side in mock mode.
 *
 * Mock-furniture hides (documented in PRODUCTION.md): the header summary line
 * and the filter-chip count badges are computed from the 3-order base mock
 * store, while the table shows the ~25 staged demo rows — the numbers
 * contradict the rows on camera, so they are hidden. The chips, filtering,
 * search, selection and bulk-send behaviour are the real product.
 *
 *   bun run demo:tools:capture capture-inbox
 */

const here = dirname(fileURLToPath(import.meta.url));
const spec = loadToolSpec("inbox");
const holds = holdBudgets(spec);

test("tool capture: inbox", async ({ page }) => {
  test.setTimeout(420_000);

  const clock = new MarkerClock();
  const cursor = new DemoCursor(page);
  await prepareDemoPage(page, { hideTexts: ["need review · "] });
  // Hide the chip COUNT badges only (the span inside each chip button) — the
  // labels and the filtering stay. See header comment.
  await page.addInitScript(() => {
    const css = ".no-scrollbar > button > span{display:none!important}";
    const add = () => {
      const s = document.createElement("style");
      s.textContent = css;
      (document.head || document.documentElement).appendChild(s);
    };
    if (document.head) add();
    else document.addEventListener("DOMContentLoaded", add);
  });

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

  // ── b1 — land on the inbox; sweep a row ───────────────────────────────────
  await soft("open", async () => {
    await page.goto(spec.route, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: /^inbox$/i }).first().waitFor({ timeout: 15_000 }).catch(() => {});
  });
  await beat("b1-open", async () => {
    await cursor.glideTo(page.getByRole("heading", { name: /^inbox$/i }).first(), 800);
    await page.waitForTimeout(1000);
    const firstRow = page.locator("tbody tr").first();
    await cursor.glideTo(firstRow, 900, { dx: -420 });
    await cursor.glideTo(firstRow, 1600, { dx: 380 });
  });

  // ── b2 — status filter: Needs review ──────────────────────────────────────
  await beat("b2-statuses", async () => {
    await cursor.click(page.getByRole("button", { name: /needs review/i }).first(), 900);
    await page.waitForTimeout(900);
    await cursor.glideTo(page.locator("tbody tr").first(), 800, { dy: 30 });
  });

  // ── b3 — search-as-you-type ───────────────────────────────────────────────
  await beat("b3-search", async () => {
    await cursor.click(page.getByRole("button", { name: /all orders/i }).first(), 700);
    await page.waitForTimeout(500);
    const search = page.locator('input[placeholder*="Search"]').first();
    await cursor.click(search, 800);
    await page.keyboard.type("Steelhouse", { delay: 95 });
    await page.waitForTimeout(1400);
    await search.fill("");
    await page.waitForTimeout(300);
  });

  // ── b4 — keyboard nav: j/j/j then k ───────────────────────────────────────
  await beat("b4-keyboard", async () => {
    // blur the search box so the global j/k handler is active
    await cursor.click(page.getByRole("heading", { name: /^inbox$/i }).first(), 700);
    await page.waitForTimeout(500);
    for (const key of ["j", "j", "j", "k"]) {
      await page.keyboard.press(key);
      await page.waitForTimeout(650);
    }
  });

  // ── b5 — bulk selection on the Failed bucket ──────────────────────────────
  await beat("b5-bulk", async () => {
    await cursor.click(page.getByRole("button", { name: /^failed/i }).first(), 800);
    await page.waitForTimeout(800);
    const boxes = page.locator('tbody input[type="checkbox"]');
    await cursor.click(boxes.nth(0), 800);
    await page.waitForTimeout(500);
    await cursor.click(boxes.nth(1), 600);
  });

  // ── b6 — Send selected (selection clears as the orders are handed off) ────
  await beat("b6-send", async () => {
    await cursor.click(page.getByRole("button", { name: /send selected/i }).first(), 900);
    await page.waitForTimeout(800);
  });

  // ── b7 — back to the full queue ───────────────────────────────────────────
  await beat("b7-close", async () => {
    await cursor.click(page.getByRole("button", { name: /all orders/i }).first(), 800);
    await page.waitForTimeout(600);
    await cursor.glideToPoint(960, 560, 900);
  });

  clock.save(spec.id);
  const dest = resolve(here, "out", spec.id, "capture.webm");
  mkdirSync(dirname(dest), { recursive: true });
  await page.close();
  await page.video()?.saveAs(dest);
  console.log(`[tool-demo] footage → ${dest}`);
});
