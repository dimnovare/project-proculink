import { test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DemoCursor, MarkerClock, holdBudgets, loadToolSpec, prepareDemoPage, soft } from "./demo-helpers";

/**
 * FEATURE-GUIDE capture — "Validation rules" (3 surfaces, 3 page loads).
 *
 * /library/rules (the catalog + the 'not a gate' callout; a toggle flipped on
 * and back off — mock-local, documentation-only, exactly what the VO says) →
 * the supplier's Validation rules tab (?tab=acceptance: 'How validation works',
 * Add profile + two quick rules via selectOption — the quick-add is a NATIVE
 * select, never opened on camera; 'Save rules' is RESTED ON, never clicked —
 * the mock save's refetch would wipe the drafted rows on camera) → the
 * standards MAPS-TO panel on an active binding → /library/rule-definitions
 * (read-only reference).
 *
 * Multiple page loads are fine here (v7 precedent) — every surface is read-only
 * or mock-local; no cross-page state is claimed.
 *
 *   bun run demo:tools:capture capture-validation-rules
 */

const here = dirname(fileURLToPath(import.meta.url));
const spec = loadToolSpec("validation-rules");
const holds = holdBudgets(spec);

const SUPPLIER_ACCEPTANCE = "/library/suppliers/11111111-1111-1111-1111-111111111111?tab=acceptance";

test("tool capture: validation-rules", async ({ page }) => {
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

  // ── open — the rule catalog ───────────────────────────────────────────────
  await soft("open", async () => {
    await page.goto(spec.route, { waitUntil: "domcontentloaded" });
    await page.getByText(/rule catalog/i).first().waitFor({ timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(1000);
  });

  // ── b1 — surface one: the catalog ────────────────────────────────────────
  await beat("b1-catalog", async () => {
    await cursor.glideTo(page.getByText(/^rule catalog$/i).first(), 1000);
    await page.waitForTimeout(1100);
    await cursor.glideTo(page.getByText(/a catalog of the checks/i).first(), 800);
    await page.waitForTimeout(1000);
    await cursor.glideTo(page.getByText(/currency must be eur/i).first(), 900);
    await page.waitForTimeout(800);
    await cursor.glideTo(page.getByText(/order total mismatch/i).first(), 900);
  });

  // ── b2 — not a gate: toggle = documentation only ─────────────────────────
  await beat("b2-notgate", async () => {
    await cursor.glideTo(page.getByText(/this is a catalog, not a gate/i).first(), 900);
    await page.waitForTimeout(1200);
    const gtin = page.getByRole("switch", { name: /rule missing gtin/i }).first();
    await cursor.click(gtin, 900);
    await page.waitForTimeout(900);
    await cursor.click(gtin, 500);
    await page.waitForTimeout(700);
    await cursor.glideTo(page.getByText(/recommended to enforce/i).first(), 1000);
  });

  // ── b3 — surface two: the supplier's Validation rules tab ────────────────
  await beat("b3-supplier", async () => {
    await page.goto(SUPPLIER_ACCEPTANCE, { waitUntil: "domcontentloaded" });
    await page.getByText(/supplier validation rules/i).first().waitFor({ timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(900);
    await cursor.glideTo(page.getByText(/how validation works/i).first(), 1000);
    await page.waitForTimeout(1200);
    await cursor.glideTo(page.getByText(/rules block delivery until/i).first(), 800);
    await page.waitForTimeout(1000);
    await cursor.glideTo(page.getByText(/never changes the order/i).first(), 800);
  });

  // ── b4 — author rules (quick-add via selectOption; Save rested on) ───────
  await beat("b4-author", async () => {
    await cursor.click(page.getByRole("button", { name: /add profile/i }).first(), 900);
    await page.waitForTimeout(900);
    const quick = page.locator("select").filter({ hasText: "Add common rule" }).first();
    await cursor.glideTo(quick, 800);
    await quick.selectOption("0").catch(() => {}); // Currency must be EUR
    await page.waitForTimeout(900);
    await quick.selectOption("1").catch(() => {}); // Every line has a supplier code
    await page.waitForTimeout(900);
    await cursor.glideTo(page.getByText(/blocks delivery/i).first(), 900);
    await page.waitForTimeout(900);
    await cursor.glideTo(page.getByRole("button", { name: /^save rules$/i }).first(), 900); // rested on, never clicked
    await page.waitForTimeout(900);
    await cursor.glideTo(page.getByText(/every saved version is kept/i).first(), 900);
  });

  // ── b5 — the standards MAPS-TO panel ─────────────────────────────────────
  await beat("b5-standards", async () => {
    const bindings = page.getByText(/active rule bindings/i).first();
    await bindings.scrollIntoViewIfNeeded().catch(() => {});
    await cursor.glideTo(bindings, 900);
    await page.waitForTimeout(700);
    await cursor.click(page.getByRole("button", { name: /standards/i }).first(), 800);
    await page.waitForTimeout(1000);
    await cursor.glideTo(page.getByText(/maps to/i).first(), 700);
    await page.waitForTimeout(900);
    await cursor.glideTo(page.getByText(/cbc:DocumentCurrencyCode/i).first(), 800);
    await page.waitForTimeout(800);
    await cursor.glideTo(page.getByText(/CUR02/i).first(), 700);
  });

  // ── b6 — surface three: rule definitions (read-only) ─────────────────────
  await beat("b6-definitions", async () => {
    await page.goto("/library/rule-definitions", { waitUntil: "domcontentloaded" });
    await page.getByText(/rule definitions/i).first().waitFor({ timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(900);
    await cursor.glideTo(page.getByText(/built-in rule definitions/i).first(), 900);
    await page.waitForTimeout(1000);
    await cursor.glideTo(page.getByText(/order currency is present/i).first(), 800);
    await page.waitForTimeout(900);
    await cursor.glideTo(page.getByText(/every line has a supplier item code/i).first(), 800);
    await page.waitForTimeout(900);
    await cursor.glideTo(page.getByRole("button", { name: /standards/i }).first(), 800);
  });

  // ── b7 — close on the pointer back to enforcement ────────────────────────
  await beat("b7-close", async () => {
    await cursor.glideTo(page.getByText(/^rule definitions$/i).first(), 900);
    await page.waitForTimeout(1200);
    await cursor.glideTo(page.getByText(/bind and enforce them/i).first(), 900);
  });

  clock.save(spec.id);
  const dest = resolve(here, "out", spec.id, "capture.webm");
  mkdirSync(dirname(dest), { recursive: true });
  await page.close();
  await page.video()?.saveAs(dest);
  console.log(`[tool-demo] footage → ${dest}`);
});
