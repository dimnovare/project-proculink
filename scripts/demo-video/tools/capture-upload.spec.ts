import { test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DemoCursor, MarkerClock, holdBudgets, loadToolSpec, prepareDemoPage, soft } from "./demo-helpers";

/**
 * PER-TOOL capture #1 — "Upload an order" (/upload).
 *
 * Drives the REAL upload workbench in MOCK mode while Playwright records the
 * screen. Beats (markers) sync the ElevenLabs narration in assemble-tool.mjs;
 * per-beat holds are the measured VO durations (run demo:tools:vo FIRST).
 *
 * Footage, not verification: everything is fail-soft. ONE page load only —
 * after /upload, navigation is client-side (mock state resets on reload).
 *
 *   bun run demo:tools:capture capture-upload
 */

const here = dirname(fileURLToPath(import.meta.url));
const spec = loadToolSpec("upload");
const holds = holdBudgets(spec);

const SAMPLE_CSV =
  "po_number,buyer_name,line_no,item_code,description,quantity,unit_price,currency\n" +
  "PO-2026-004417,Nordic Electronics,1,TB-CAP-100,Capacitor 100uF,200,0.35,EUR\n" +
  "PO-2026-004417,Nordic Electronics,2,TB-RES-220,Resistor 220R,500,0.02,EUR\n" +
  "PO-2026-004417,Nordic Electronics,3,TB-WIRE-22,Wire 22AWG Black 100m,5,12.50,EUR\n";

test("tool capture: upload", async ({ page }) => {
  test.setTimeout(420_000);

  const clock = new MarkerClock();
  const cursor = new DemoCursor(page);
  await prepareDemoPage(page);

  // Beat = mark + (actions while the VO plays) + dwell out the remaining hold.
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

  // ── b1 — open the workbench (the ONLY page load) ──────────────────────────
  await soft("open", async () => {
    await page.goto(spec.route, { waitUntil: "networkidle" });
  });
  await beat("b1-open", async () => {
    await cursor.glideTo(page.getByRole("heading", { name: /upload an order/i }).first(), 900);
  });

  // ── b2 — the dropzone + accepted formats ──────────────────────────────────
  await beat("b2-formats", async () => {
    await cursor.glideTo(page.getByText(/drop a purchase order here/i).first(), 800);
    await page.waitForTimeout(700);
    // trace the format line slowly, left to right
    const formats = page.getByText(/CSV, XLSX, PDF/i).first();
    await cursor.glideTo(formats, 700, { dx: -260 });
    await cursor.glideTo(formats, 1600, { dx: 240 });
    await page.waitForTimeout(500);
    await cursor.glideTo(page.getByRole("button", { name: /browse files/i }).first(), 700);
  });

  // ── b3 — the sample-order chip (hover only; never click on camera) ────────
  await beat("b3-sample", async () => {
    await cursor.glideTo(page.getByText(/start with a sample order/i).first(), 900);
    await page.waitForTimeout(900);
    await cursor.glideTo(page.getByRole("button", { name: /try with a sample order/i }).first(), 700);
  });

  // ── b4 — a file arrives; format auto-detect + layout fingerprint ──────────
  await beat("b4-file", async () => {
    const browse = page.getByRole("button", { name: /browse files/i }).first();
    await cursor.glideTo(browse, 900);
    await page.waitForTimeout(400);
    const chooserPromise = page.waitForEvent("filechooser", { timeout: 6_000 }).catch(() => null);
    await cursor.click(browse, 200, 100);
    const chooser = await chooserPromise;
    if (chooser) {
      await chooser.setFiles({ name: "orders_june.csv", mimeType: "text/csv", buffer: Buffer.from(SAMPLE_CSV) });
    } else {
      await page.setInputFiles('input[type="file"]', {
        name: "orders_june.csv", mimeType: "text/csv", buffer: Buffer.from(SAMPLE_CSV),
      });
    }
    // settle on the detect pill while it does its work
    await page.waitForTimeout(900);
    await cursor.glideTo(page.getByText(/detected:/i).first(), 900);
  });

  // ── b5 — the supplier picker (routes-to updates live) ─────────────────────
  await beat("b5-supplier", async () => {
    const select = page.locator("select").first();
    await cursor.glideTo(select, 1000);
    await page.waitForTimeout(800);
    await select.selectOption({ label: "ElectroSupply Co" }).catch(() => {});
    await page.waitForTimeout(900);
    // show the routes-to line acknowledging the choice
    await cursor.glideTo(page.getByText(/routes to/i).first(), 800);
  });

  // ── b6 — Upload & review → Parse / Normalize / Validate animation ─────────
  await beat("b6-upload", async () => {
    await cursor.click(page.getByRole("button", { name: /upload & review/i }).first(), 900);
  });

  // ── b7 — what happens after upload: the mapping preview (client-side nav) ──
  await beat("b7-after", async () => {
    await page.waitForURL(/\/upload\/preview\//i, { timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(1200);
    await cursor.glideToPoint(960, 560, 900);
  });

  // ── save markers + deterministic footage path ─────────────────────────────
  clock.save(spec.id);
  const dest = resolve(here, "out", spec.id, "capture.webm");
  mkdirSync(dirname(dest), { recursive: true });
  await page.close();
  await page.video()?.saveAs(dest);
  console.log(`[tool-demo] footage → ${dest}`);
});
