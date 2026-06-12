import { test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DemoCursor, MarkerClock, holdBudgets, loadToolSpec, prepareDemoPage, soft } from "./demo-helpers";

/**
 * FULL WALKTHROUGH v7 capture — the refreshed ~3-minute successor to v5
 * (real-UI footage, current product). One continuous take across:
 *
 *   /how-it-works (animated pipeline = the problem) → /upload (detect + route)
 *   → /inbox/ord-002 (review: accept AI, manual code, readiness, SEND →
 *   Delivered) → supplier Catalog tab (import + automatic sources incl. the
 *   HTTP endpoint) → /connections (versioned: run tests → publish → rollback
 *   affordance) → Exceptions + System health → the "?" help slideover →
 *   Dashboard close.
 *
 * Page loads (mock state resets on each, so loads only sit BETWEEN sections):
 *   warmup pass (trimmed by the assembler) → /how-it-works → /upload →
 *   /inbox/ord-002 → /library/suppliers/…?tab=catalog. Everything else is
 *   client-side, so accept → send → delivered and run-tests → publish →
 *   rollback stay consistent on camera.
 *
 *   bun run demo:tools:capture capture-walkthrough
 */

const here = dirname(fileURLToPath(import.meta.url));
const spec = loadToolSpec("walkthrough");
// Slightly tighter reading pad than the per-tool default (16 beats × pad adds
// up on a full walkthrough; v5's pacing target is 2:45–3:15 total).
const holds = holdBudgets(spec, 750);

const SUPPLIER_ID = "22222222-2222-2222-2222-222222222222"; // ElectroSupply Co route (mock detail stages Acme profile data; tabs are what's filmed)

// Same order story as v5: the uploaded file mirrors ord-002's lines.
const ORDER_CSV =
  "po_number,buyer_name,line_no,item_code,description,quantity,unit_price,currency\n" +
  "PO-2024-005678,Nordic Electronics,1,TB-CAP-100,Capacitor 100uF,200,0.35,EUR\n" +
  "PO-2024-005678,Nordic Electronics,2,TB-RES-220,Resistor 220R,500,0.02,EUR\n" +
  "PO-2024-005678,Nordic Electronics,3,TB-WIRE-22,Wire 22AWG Black 100m,5,12.50,EUR\n";

const CATALOG_CSV =
  "code,name,unit,price,barcode\n" +
  "ES-CAP-100UF,Capacitor 100uF 25V,PCS,0.34,4006381001234\n" +
  "ES-RES-220R,Resistor 220 Ohm 0.25W,PCS,0.02,4006381002345\n" +
  "ES-LED-R5MM,LED Red 5mm,PCS,0.14,4006381003456\n" +
  "ES-WIRE-22BK-100,Wire 22AWG Black 100m,ROL,11.90,4006381004567\n" +
  "ES-CON-DSUB9,Connector D-SUB 9pin,PCS,0.88,4006381005678\n" +
  "ES-PSU-12V2A,Power supply 12V 2A,PCS,8.40,4006381006789\n";

test("tool capture: full walkthrough v7", async ({ page }) => {
  test.setTimeout(600_000);

  const clock = new MarkerClock();
  const cursor = new DemoCursor(page);
  // "Failed to fetch" is a safety hide only (no API without a mock twin is
  // visited deliberately in this take — documented in tools/PRODUCTION.md).
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

  // Attach a file to the upload dropzone via the Browse filechooser (falls
  // back to the raw input) — same mechanism the upload pilot proved.
  const attachOrderFile = async () => {
    const browse = page.getByRole("button", { name: /browse files/i }).first();
    const chooserPromise = page.waitForEvent("filechooser", { timeout: 6_000 }).catch(() => null);
    await cursor.click(browse, 700, 150);
    const chooser = await chooserPromise;
    const file = { name: "PO-2024-005678.csv", mimeType: "text/csv", buffer: Buffer.from(ORDER_CSV) };
    if (chooser) await chooser.setFiles(file);
    else await page.setInputFiles('input[type="file"]', file);
  };

  // ── warmup: compile every route used by the take (assembler trims this) ───
  await soft("warmup", async () => {
    for (const r of [
      "/how-it-works",
      "/upload",
      "/inbox/ord-002",
      `/library/suppliers/${SUPPLIER_ID}?tab=catalog`,
      "/connections",
      "/operations/exceptions",
      "/operations/health",
      "/bridge",
    ]) {
      await page.goto(r, { waitUntil: "networkidle" }).catch(() => {});
    }
    // Warm the dynamic routes only reachable by interaction: the upload
    // preview (upload a file once) and the connection detail (open a row).
    await page.goto("/upload", { waitUntil: "networkidle" }).catch(() => {});
    await page.setInputFiles('input[type="file"]', {
      name: "warmup.csv", mimeType: "text/csv", buffer: Buffer.from(ORDER_CSV),
    }).catch(() => {});
    await page.waitForTimeout(800);
    await page.getByRole("button", { name: /upload & review/i }).first().click({ timeout: 5_000 }).catch(() => {});
    await page.waitForURL(/\/upload\/preview\//i, { timeout: 25_000 }).catch(() => {});
    await page.goto("/connections", { waitUntil: "networkidle" }).catch(() => {});
    await page.getByText("FastParts Inc").first().click({ timeout: 5_000 }).catch(() => {});
    await page.waitForURL(/\/connections\/conn-/i, { timeout: 15_000 }).catch(() => {});
  });

  // ── p1 — the problem, on the animated how-it-works pipeline ───────────────
  await soft("open", async () => {
    await page.goto("/how-it-works", { waitUntil: "networkidle" });
    await page.evaluate(() => window.scrollTo({ top: 150, behavior: "instant" as ScrollBehavior })).catch(() => {});
    await page.waitForTimeout(400);
  });
  await beat("p1-problem", async () => {
    await cursor.glideTo(page.getByText(/^Receive$/).first(), 1100);
    await page.waitForTimeout(1600);
    await cursor.glideTo(page.getByText(/^Validate$/).first(), 2200);
    await page.waitForTimeout(1200);
    await cursor.glideTo(page.getByText(/^Deliver$/).first(), 1400);
  });

  // ── u1 — upload: file arrives, format detect (page load = scene cut) ──────
  await beat("u1-upload", async () => {
    await page.goto("/upload", { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: /upload an order/i }).first().waitFor({ timeout: 10_000 }).catch(() => {});
    await cursor.glideTo(page.getByText(/drop a purchase order here/i).first(), 800);
    await page.waitForTimeout(500);
    await attachOrderFile();
    await page.waitForTimeout(700);
    await cursor.glideTo(page.getByText(/detected:/i).first(), 800);
  });

  // ── u2 — route to the supplier ────────────────────────────────────────────
  await beat("u2-supplier", async () => {
    const select = page.locator("select").first();
    await cursor.glideTo(select, 900);
    await page.waitForTimeout(600);
    await select.selectOption({ label: "ElectroSupply Co" }).catch(() => {});
    await page.waitForTimeout(700);
    await cursor.glideTo(page.getByText(/routes to/i).first(), 800);
  });

  // ── u3 — Upload & review → Parse / Normalize / Validate → preview ─────────
  await beat("u3-go", async () => {
    await cursor.click(page.getByRole("button", { name: /upload & review/i }).first(), 900);
    await page.waitForURL(/\/upload\/preview\//i, { timeout: 20_000 }).catch(() => {});
  });

  // ── r1 — review: header + fix queue (page load = scene cut) ───────────────
  await beat("r1-review", async () => {
    await page.goto("/inbox/ord-002", { waitUntil: "domcontentloaded" });
    await page.getByText(/PO-2024-005678/i).first().waitFor({ timeout: 15_000 }).catch(() => {});
    await cursor.glideTo(page.getByText(/PO-2024-005678/i).first(), 800);
    await page.waitForTimeout(600);
    await cursor.glideTo(page.getByRole("list", { name: /open issues/i }).first(), 900, { dy: -30 });
  });

  // ── r2 — accept the AI suggestion (line 2) ────────────────────────────────
  await beat("r2-accept", async () => {
    const accept = page.getByRole("button", { name: /accept ai suggestion for line 2/i }).first();
    await cursor.glideTo(accept, 1100, { dy: -70 });
    await page.waitForTimeout(1600);
    await cursor.click(accept, 900);
  });

  // ── r3 — manual code (line 4) ─────────────────────────────────────────────
  await beat("r3-manual", async () => {
    const manual = page.getByRole("button", { name: /enter a supplier code manually for line 4/i }).first();
    await cursor.click(manual, 900);
    const input = page.getByLabel(/supplier code for line 4/i).first();
    await input.waitFor({ timeout: 5_000 }).catch(() => {});
    await cursor.glideTo(input, 500);
    await input.click().catch(() => {});
    await page.keyboard.type("ES-WIRE-22BK-100", { delay: 80 });
    await page.waitForTimeout(400);
    await cursor.click(page.getByRole("button", { name: /^save$/i }).first(), 600);
  });

  // ── r4 — the send-readiness card ──────────────────────────────────────────
  await beat("r4-readiness", async () => {
    await cursor.glideTo(page.getByText(/lines resolved/i).first(), 1100);
  });

  // ── d1 — send: CTA → confirm dialog → checkbox → final send ───────────────
  await beat("d1-send", async () => {
    await cursor.click(page.getByRole("button", { name: /^send to supplier$/i }).first(), 900);
    await page.locator("#confirm-check").waitFor({ timeout: 6_000 }).catch(() => {});
    await page.waitForTimeout(1300);
    await cursor.click(page.locator("#confirm-check"), 700);
    await page.waitForTimeout(500);
    await cursor.click(page.getByRole("button", { name: /send to supplier/i }).last(), 700);
  });

  // ── d2 — Generating → Sent → Delivered + audit trail ──────────────────────
  await beat("d2-delivered", async () => {
    await page.getByText(/generating|sending|sent/i).first().waitFor({ timeout: 8_000 }).catch(() => {});
    await cursor.glideToPoint(1180, 320, 1000);
    await page.getByText(/delivered/i).first().waitFor({ timeout: 15_000 }).catch(() => {});
  });

  // ── m1 — supplier catalog: import + automatic sources (page load cut) ─────
  await beat("m1-catalog", async () => {
    await page.goto(`/library/suppliers/${SUPPLIER_ID}?tab=catalog`, { waitUntil: "domcontentloaded" });
    const importBtn = page.getByRole("button", { name: /import csv/i }).first();
    await importBtn.waitFor({ timeout: 10_000 }).catch(() => {});
    const chooserPromise = page.waitForEvent("filechooser", { timeout: 6_000 }).catch(() => null);
    await cursor.click(importBtn, 700);
    const chooser = await chooserPromise;
    if (chooser) {
      await chooser.setFiles({ name: "electrosupply_catalog.csv", mimeType: "text/csv", buffer: Buffer.from(CATALOG_CSV) });
    }
    await page.waitForTimeout(600);
    await cursor.glideTo(page.getByText("ES-RES-220R").first(), 700);
    await page.waitForTimeout(400);
    await cursor.click(page.getByText(/automatic import/i).first(), 700);
    await page.waitForTimeout(400);
    await page.mouse.wheel(0, 420);
    await page.waitForTimeout(400);
    await cursor.glideTo(page.getByText(/push/i).last(), 900);
  });

  // ── m2 — versioned connections: detail + run tests (client-side nav) ──────
  await beat("m2-connections", async () => {
    await cursor.click(page.getByRole("link", { name: /^connections$/i }).first(), 800);
    await page.getByText("FastParts Inc").first().waitFor({ timeout: 10_000 }).catch(() => {});
    await cursor.click(page.getByText("FastParts Inc").first(), 800);
    await page.waitForURL(/\/connections\/conn-/i, { timeout: 10_000 }).catch(() => {});
    await page.getByText(/live revision/i).first().waitFor({ timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(500);
    await cursor.glideTo(page.getByText(/revision history/i).first(), 900);
    await page.waitForTimeout(500);
    await cursor.click(page.getByRole("button", { name: /run tests/i }).first(), 900);
    await page.getByText(/test pack passed/i).first().waitFor({ timeout: 10_000 }).catch(() => {});
  });

  // ── m3 — publish v2 → success → the rollback affordance on v1 ─────────────
  await beat("m3-publish", async () => {
    await cursor.click(page.getByRole("button", { name: /^publish$/i }).first(), 800);
    const dialog = page.getByRole("dialog");
    await dialog.waitFor({ timeout: 6_000 }).catch(() => {});
    await page.waitForTimeout(1800); // let the in-flight-orders copy be read
    await cursor.click(dialog.getByRole("button", { name: /^publish$/i }).first(), 700);
    await page.getByText(/now the live revision/i).first().waitFor({ timeout: 8_000 }).catch(() => {});
    await page.waitForTimeout(500);
    await cursor.glideTo(page.getByRole("button", { name: /roll back to this/i }).first(), 1100);
  });

  // ── m4 — exceptions + system health (client-side via the sidebar) ─────────
  await beat("m4-ops", async () => {
    await cursor.click(page.getByRole("link", { name: /^exceptions$/i }).first(), 700);
    await page.getByText(/UNRESOLVED_SUPPLIER_CODE/i).first().waitFor({ timeout: 10_000 }).catch(() => {});
    const firstRow = page.locator("tbody tr").first();
    await cursor.glideTo(firstRow, 700, { dx: -300 });
    await cursor.glideTo(firstRow, 900, { dx: 300 });
    await page.waitForTimeout(300);
    await cursor.click(page.getByRole("link", { name: /system health/i }).first(), 700);
    await page.getByText(/worker online/i).first().waitFor({ timeout: 10_000 }).catch(() => {});
    await cursor.glideTo(page.getByText(/worker online/i).first(), 700);
    await page.waitForTimeout(300);
    await cursor.glideTo(page.getByRole("button", { name: /requeue delivery/i }).first(), 800);
  });

  // ── m5 — the "?" help slideover: this screen's guide ──────────────────────
  await beat("m5-help", async () => {
    await cursor.click(page.getByRole("button", { name: /^help/i }).first(), 900);
    await page.getByText(/this screen/i).first().waitFor({ timeout: 6_000 }).catch(() => {});
    await page.waitForTimeout(700);
    await cursor.glideTo(page.getByText(/what you can do here/i).first(), 900);
    await page.waitForTimeout(800);
    await cursor.glideTo(page.getByText(/open help center/i).first(), 1000);
  });

  // ── c1 — close on the dashboard ───────────────────────────────────────────
  await beat("c1-close", async () => {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    await cursor.click(page.getByRole("link", { name: /^dashboard$/i }).first(), 800);
    await page.getByRole("heading", { name: /^dashboard$/i }).first().waitFor({ timeout: 10_000 }).catch(() => {});
    await cursor.glideToPoint(960, 540, 1300);
  });

  // ── save markers + deterministic footage path ─────────────────────────────
  clock.save(spec.id);
  const dest = resolve(here, "out", spec.id, "capture.webm");
  mkdirSync(dirname(dest), { recursive: true });
  await page.close();
  await page.video()?.saveAs(dest);
  console.log(`[tool-demo] footage → ${dest}`);
});
