import { test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DemoCursor, MarkerClock, holdBudgets, loadToolSpec, prepareDemoPage, soft } from "./demo-helpers";

/**
 * PER-TOOL capture — "PO field mapping" (supplier detail → PO Mapping tab).
 *
 * Sample-based mapping spine → evidence (sample values) → per-field change
 * controls (hover only: matches auto-seed as accepted in mock, so Accept all
 * would flash "Nothing new to accept") → starter-template menu (opened +
 * hovered, NOT applied: applying replaces the auto-detected demo mapping on
 * camera) → Show standards → Save (rested on, not clicked: upsertPoMapping
 * has no mock twin and would error on camera).
 *
 *   bun run demo:tools:capture capture-po-mapping
 */

const here = dirname(fileURLToPath(import.meta.url));
const spec = loadToolSpec("po-mapping");
const holds = holdBudgets(spec);

test("tool capture: po-mapping", async ({ page }) => {
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

  // ── b1 — the mapping spine ────────────────────────────────────────────────
  await soft("open", async () => {
    await page.goto(spec.route, { waitUntil: "networkidle" });
    await page.getByText(/po field mapping/i).first().waitFor({ timeout: 15_000 }).catch(() => {});
  });
  await beat("b1-open", async () => {
    await cursor.glideTo(page.getByText(/we detected/i).first(), 1000);
    await page.waitForTimeout(1200);
    await cursor.glideTo(page.getByText(/detected columns/i).first(), 900);
    await page.waitForTimeout(900);
    await cursor.glideTo(page.getByText(/proculink fields/i).first(), 1100);
  });

  // ── b2 — evidence: sample values on the detected columns ──────────────────
  await beat("b2-evidence", async () => {
    const samples = page.getByText(/e\.g\. /i);
    await cursor.glideTo(samples.first(), 900);
    await page.waitForTimeout(1100);
    await cursor.glideTo(samples.nth(2), 1000);
    await page.waitForTimeout(1000);
    await cursor.glideTo(samples.nth(4), 1000);
  });

  // ── b3 — per-field change control + required markers (hover only) ─────────
  await beat("b3-adjust", async () => {
    const buyerItemCode = page.getByText("Buyer Item Code").first();
    await cursor.glideTo(buyerItemCode, 900);
    await page.waitForTimeout(900);
    // its "change" control sits in the same card, to the right
    await cursor.glideTo(page.getByText(/^change$/).nth(5), 800);
    await page.waitForTimeout(1100);
    // the required-field marker on PO Number
    await cursor.glideTo(page.getByText("PO Number").first(), 1000);
  });

  // ── b4 — starter templates: open the menu, hover, close (no apply) ────────
  await beat("b4-templates", async () => {
    await cursor.click(page.getByRole("button", { name: /apply starter template/i }).first(), 900);
    await page.getByRole("listbox", { name: /starter templates/i }).waitFor({ timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(600);
    await cursor.glideTo(page.getByRole("option", { name: /erply/i }).first(), 800);
    await page.waitForTimeout(900);
    await cursor.glideTo(page.getByRole("option", { name: /directo/i }).first(), 700);
    await page.waitForTimeout(900);
    // close without applying — outside pointerdown closes the menu
    await cursor.click(page.getByText(/we detected/i).first(), 800);
  });

  // ── b5 — Show standards ───────────────────────────────────────────────────
  await beat("b5-standards", async () => {
    await cursor.click(page.getByRole("button", { name: /show standards/i }).first(), 900);
    await page.waitForTimeout(1000);
    await cursor.glideTo(page.getByText(/UBL/i).first(), 900);
    await page.waitForTimeout(900);
    await cursor.glideTo(page.getByText(/EDIFACT/i).first(), 800);
  });

  // ── b6 — rest on Save mapping (claim is product behaviour; no mock save) ──
  await beat("b6-save", async () => {
    await cursor.glideTo(page.getByRole("button", { name: /save mapping/i }).first(), 1100);
  });

  clock.save(spec.id);
  const dest = resolve(here, "out", spec.id, "capture.webm");
  mkdirSync(dirname(dest), { recursive: true });
  await page.close();
  await page.video()?.saveAs(dest);
  console.log(`[tool-demo] footage → ${dest}`);
});
