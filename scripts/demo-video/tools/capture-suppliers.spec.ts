import { test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DemoCursor, MarkerClock, holdBudgets, loadToolSpec, prepareDemoPage, soft } from "./demo-helpers";

/**
 * PER-TOOL capture — "Supplier profiles" (supplier detail + tabs).
 *
 * Opens DIRECTLY on the supplier profile (in mock mode the detail renders a
 * staged "Acme Components" profile regardless of the routed id, while the
 * suppliers LIST shows different names — navigating list → detail on camera
 * would show the name flip, so the list is not filmed). Tabs are client-side.
 *
 * Mock-furniture hide: "Failed to fetch" (the Delivery tab's config GET has
 * no mock twin; visited briefly in b5).
 *
 *   bun run demo:tools:capture capture-suppliers
 */

const here = dirname(fileURLToPath(import.meta.url));
const spec = loadToolSpec("suppliers");
const holds = holdBudgets(spec);

const CATALOG_CSV =
  "code,name,unit,price,barcode\n" +
  "ES-CAP-100UF,Capacitor 100uF 25V,PCS,0.34,4006381001234\n" +
  "ES-RES-220R,Resistor 220 Ohm 0.25W,PCS,0.02,4006381002345\n" +
  "ES-LED-R5MM,LED Red 5mm,PCS,0.14,4006381003456\n" +
  "ES-WIRE-22BK-100,Wire 22AWG Black 100m,ROL,11.90,4006381004567\n" +
  "ES-CON-DSUB9,Connector D-SUB 9pin,PCS,0.88,4006381005678\n" +
  "ES-PSU-12V2A,Power supply 12V 2A,PCS,8.40,4006381006789\n";

test("tool capture: suppliers", async ({ page }) => {
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

  // ── b1 — the profile overview ─────────────────────────────────────────────
  await soft("open", async () => {
    await page.goto(spec.route, { waitUntil: "networkidle" });
    await page.getByText(/total orders/i).first().waitFor({ timeout: 15_000 }).catch(() => {});
  });
  await beat("b1-open", async () => {
    await cursor.glideTo(page.getByText(/auto-process/i).first(), 900);
    await page.waitForTimeout(1100);
    await cursor.glideTo(page.getByText(/total orders/i).first(), 800);
    await page.waitForTimeout(900);
    await cursor.glideTo(page.getByText(/delivery summary/i).first(), 900);
  });

  // ── b2 — Mappings: the translation table with provenance ──────────────────
  await beat("b2-mappings", async () => {
    await cursor.click(page.getByRole("button", { name: "Mappings" }).first(), 900);
    await page.waitForTimeout(1000);
    await cursor.glideTo(page.getByText(/saved sku mappings/i).first(), 800);
    await page.waitForTimeout(900);
    await cursor.glideTo(page.getByText("Inherited").first(), 900);
  });

  // ── b3 — Catalog: import from a file ──────────────────────────────────────
  await beat("b3-catalog", async () => {
    await cursor.click(page.getByRole("button", { name: "Catalog" }).first(), 900);
    await page.waitForTimeout(900);
    const importBtn = page.getByRole("button", { name: /import csv/i }).first();
    const chooserPromise = page.waitForEvent("filechooser", { timeout: 6_000 }).catch(() => null);
    await cursor.click(importBtn, 800);
    const chooser = await chooserPromise;
    if (chooser) {
      await chooser.setFiles({ name: "electrosupply_catalog.csv", mimeType: "text/csv", buffer: Buffer.from(CATALOG_CSV) });
    }
    await page.waitForTimeout(900);
    await cursor.glideTo(page.getByText("ES-RES-220R").first(), 900);
  });

  // ── b4 — Catalog: automatic import (scheduled pull + HTTP push) ───────────
  await beat("b4-sources", async () => {
    await cursor.click(page.getByText(/automatic import/i).first(), 900);
    await page.waitForTimeout(800);
    await page.mouse.wheel(0, 450);
    await page.waitForTimeout(600);
    await cursor.glideTo(page.getByText(/sftp/i).first(), 900);
    await page.waitForTimeout(1000);
    await cursor.glideTo(page.getByText(/push/i).last(), 1100);
  });

  // ── b5 — the PO Mapping + Delivery pointers ───────────────────────────────
  await beat("b5-tabs", async () => {
    await page.mouse.wheel(0, -800);
    await page.waitForTimeout(400);
    await cursor.click(page.getByRole("button", { name: "PO Mapping" }).first(), 900);
    await page.waitForTimeout(2200);
    await cursor.click(page.getByRole("button", { name: "Delivery" }).first(), 900);
    await page.waitForTimeout(1200);
  });

  // ── b6 — Validation rules: the gate ───────────────────────────────────────
  await beat("b6-validation", async () => {
    await cursor.click(page.getByRole("button", { name: "Validation rules" }).first(), 900);
    await page.waitForTimeout(1000);
    await cursor.glideTo(page.getByText(/how validation works/i).first(), 900);
    await page.waitForTimeout(1100);
    await cursor.glideTo(page.getByText(/blocks delivery/i).first(), 900);
  });

  clock.save(spec.id);
  const dest = resolve(here, "out", spec.id, "capture.webm");
  mkdirSync(dirname(dest), { recursive: true });
  await page.close();
  await page.video()?.saveAs(dest);
  console.log(`[tool-demo] footage → ${dest}`);
});
