import { test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DemoCursor, MarkerClock, holdBudgets, loadToolSpec, prepareDemoPage, soft } from "./demo-helpers";

/**
 * FEATURE-GUIDE capture — "Editing the output" (/inbox/ord-001, fully resolved).
 *
 * Columns sweep → source picker (opened, Escaped — no change) → 'Remove extra
 * spaces' adjustment on Description (mock upsertMappingOverride works; '✓ Saved'
 * appears honestly) → custom field InternalRef with fixed value WEB-REF-01 →
 * preview hover-highlight + cXML format switch (the on-screen 'not the delivered
 * format' note carries the honesty) → 'Design the output' dialog (opened and
 * CANCELLED — 'Build from a sample' calls a real API with no mock twin, never
 * clicked) → close by the Send button (never clicked).
 *
 * Honesty notes: whole-document template mode IS reachable ("Edit as template"
 * in the order toolbar) but is deliberately not narrated — Scriban is the
 * power-user escape hatch, not the default path, and its mock preview is a
 * placeholder string. The promotion flow ("save for this supplier") is not
 * wired on this screen — dropped from the VO. In mock the right-hand preview
 * text does not re-render from rule edits, so the VO never claims "watch the
 * preview change from my edit" — the only preview changes shown are real ones
 * (hover highlight, format switch).
 *
 * TAKE-1 LESSON (frame-checked): the source picker popover does NOT close on
 * Escape; left open, it overlays the rows below and swallows the next beat's
 * click (take 1 accidentally remapped Buyer item code ← Order date). The picker
 * is now closed with an outside-click on dead space + a hidden-state wait.
 * Row targeting for the picker beat is by Auto-pill INDEX (hasText /^Buyer/
 * also matched "Buyer item code").
 *
 *   bun run demo:tools:capture capture-output-mapping-editor
 */

const here = dirname(fileURLToPath(import.meta.url));
const spec = loadToolSpec("output-mapping-editor");
const holds = holdBudgets(spec);

test("tool capture: output-mapping-editor", async ({ page }) => {
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

  const sendRow = (label: string | RegExp) =>
    page.locator("[data-mapper-row]").filter({ hasText: label }).last();
  const receivedRow = (label: string | RegExp) =>
    page.locator("[data-mapper-row]").filter({ hasText: label }).first();

  // ── open — the resolved order's workshop ─────────────────────────────────
  await soft("open", async () => {
    await page.goto(spec.route, { waitUntil: "domcontentloaded" });
    await page.getByText(/what we'll send/i).first().waitFor({ timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(1200); // settle wires + preview first paint
  });

  // ── b1 — the three columns ────────────────────────────────────────────────
  await beat("b1-open", async () => {
    await cursor.glideTo(page.getByText(/review and send this order/i).first(), 1000);
    await page.waitForTimeout(1100);
    await cursor.glideTo(page.getByText(/what we received/i).first(), 900);
    await page.waitForTimeout(900);
    await cursor.glideTo(page.getByText(/what we'll send/i).first(), 900);
    await page.waitForTimeout(900);
    await cursor.glideTo(page.getByText(/live preview/i).first(), 900);
  });

  // ── b2 — where a field's value comes from (picker opened, nothing changed) ─
  await beat("b2-source", async () => {
    // nth(2) = the Buyer row's Auto pill (0=PO number, 1=Order date, 2=Buyer) —
    // hasText targeting is ambiguous ("Buyer" also prefixes "Buyer item code").
    const auto = page.getByRole("button", { name: /auto \(1:1\)/i }).nth(2);
    await cursor.click(auto, 900);
    await page.waitForTimeout(900);
    // Glide down the option list to the honest bottom action (hover only).
    await cursor.glideTo(page.getByPlaceholder(/search incoming fields/i).first(), 700);
    await page.waitForTimeout(700);
    await cursor.glideTo(page.getByRole("button", { name: /fixed value/i }).first(), 1000);
    await page.waitForTimeout(1100);
    // Close WITHOUT selecting: outside-click on dead space (Escape does NOT
    // close this popover — take-1 lesson), then verify it is really gone.
    await cursor.glideToPoint(760, 250, 500);
    await page.mouse.down(); await page.waitForTimeout(90); await page.mouse.up();
    await page.getByPlaceholder(/search incoming fields/i).waitFor({ state: "hidden", timeout: 4000 }).catch(async () => {
      await page.keyboard.press("Escape");
    });
    await page.waitForTimeout(400);
  });

  // ── b3 — an adjustment chain on Description ───────────────────────────────
  await beat("b3-adjust", async () => {
    const row = sendRow(/^Description/);
    await row.scrollIntoViewIfNeeded().catch(() => {});
    await cursor.glideTo(row, 700);
    await page.waitForTimeout(400);
    await cursor.click(row.locator('button[title*="Adjust this value"]').first(), 800);
    await page.waitForTimeout(900);
    const sel = page.getByLabel(/add an adjustment/i).first();
    await cursor.glideTo(sel, 700);
    await sel.selectOption("Trim").catch(() => {});
    await page.waitForTimeout(900);
    await cursor.glideTo(page.getByText(/remove extra spaces/i).first(), 700);
    await page.waitForTimeout(900);
    await cursor.click(page.getByRole("button", { name: /^done$/i }).first(), 700);
    await page.waitForTimeout(500);
  });

  // ── b4 — custom field + fixed value ───────────────────────────────────────
  await beat("b4-custom", async () => {
    await cursor.click(page.getByRole("button", { name: /add output field/i }).first(), 900);
    await page.waitForTimeout(700);
    await page.keyboard.type("InternalRef", { delay: 55 });
    await page.waitForTimeout(500);
    await cursor.click(page.getByRole("button", { name: /add custom field/i }).first(), 800);
    await page.waitForTimeout(1200);
    const row = sendRow(/InternalRef/);
    await row.scrollIntoViewIfNeeded().catch(() => {});
    await cursor.click(row.locator('button[title*="click to change"]').first(), 800);
    await page.waitForTimeout(800);
    await cursor.click(page.getByRole("button", { name: /fixed value/i }).first(), 800);
    await page.waitForTimeout(600);
    await page.keyboard.type("WEB-REF-01", { delay: 60 });
    await page.keyboard.press("Enter");
    await page.waitForTimeout(900);
  });

  // ── b5 — the live preview: hover highlight + honest format switch ─────────
  await beat("b5-preview", async () => {
    const po = receivedRow(/^PO number/);
    await po.scrollIntoViewIfNeeded().catch(() => {});
    await cursor.glideTo(po, 900);
    await page.waitForTimeout(1600); // value lights up in the preview
    await cursor.click(page.getByRole("button", { name: /^cxml$/i }).first(), 900);
    await page.waitForTimeout(1300);
    await cursor.glideTo(page.getByText(/not the delivered format/i).first(), 800);
    await page.waitForTimeout(1300);
    await cursor.click(page.getByRole("button", { name: /^csv$/i }).first(), 700);
    await page.waitForTimeout(500);
  });

  // ── b6 — Design the output (opened, swept, cancelled) ─────────────────────
  await beat("b6-structure", async () => {
    await cursor.click(page.getByRole("button", { name: /customize output layout/i }).first(), 900);
    await page.waitForTimeout(1200);
    await cursor.glideTo(page.getByText(/start from a supplier sample/i).first(), 800);
    await page.waitForTimeout(1100);
    await cursor.glideTo(page.getByText(/what the supplier receives/i).first(), 800);
    await page.waitForTimeout(1100);
    await cursor.glideTo(page.getByText(/bind each value/i).first(), 800);
    await page.waitForTimeout(1000);
    await cursor.click(page.getByRole("button", { name: /^cancel$/i }).first(), 700);
    await page.waitForTimeout(500);
  });

  // ── b7 — close: valid badge, then rest by Send (never clicked) ────────────
  await beat("b7-close", async () => {
    await cursor.glideTo(page.getByText(/^valid$/i).first(), 900);
    await page.waitForTimeout(1400);
    await cursor.glideTo(page.getByRole("button", { name: /send to supplier/i }).first(), 1100);
  });

  clock.save(spec.id);
  const dest = resolve(here, "out", spec.id, "capture.webm");
  mkdirSync(dirname(dest), { recursive: true });
  await page.close();
  await page.video()?.saveAs(dest);
  console.log(`[tool-demo] footage → ${dest}`);
});
