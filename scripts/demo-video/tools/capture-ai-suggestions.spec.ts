import { test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DemoCursor, MarkerClock, holdBudgets, loadToolSpec, prepareDemoPage, soft } from "./demo-helpers";

/**
 * FEATURE-GUIDE capture — "AI suggestions" (/inbox/ord-002, 2 unresolved lines).
 *
 * Blockers banner → the suggestion card anatomy (real code + real % match) →
 * Accept the 84% suggestion (mock resolve works; banner drops to 1 blocker) →
 * Enter manually on the 72% one (input opens PRE-FILLED with the suggestion —
 * the on-camera proof of "correct rather than retype") → Save → the order flips
 * to 'Ready to send' with the green no-open-issues state.
 *
 * Honesty notes: the article's `reason`/`provenance` strings are not rendered
 * on this screen in the current UI, so the VO claims only what is visible (code
 * + match score) plus verified backend behavior (deterministic-first, catalog
 * grounding with post-hoc rejection, accept-writes-and-learns, soft AI budget).
 * Confidence bucket thresholds are NOT quoted (article says 70/85, the UI chip
 * ramps at 65/85 — the VO stays away from exact bucket numbers). Send is never
 * clicked.
 *
 *   bun run demo:tools:capture capture-ai-suggestions
 */

const here = dirname(fileURLToPath(import.meta.url));
const spec = loadToolSpec("ai-suggestions");
const holds = holdBudgets(spec);

test("tool capture: ai-suggestions", async ({ page }) => {
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

  // ── open — the order that needs review ────────────────────────────────────
  await soft("open", async () => {
    await page.goto(spec.route, { waitUntil: "domcontentloaded" });
    await page.getByText(/before you send/i).first().waitFor({ timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(1200);
  });

  // ── b1 — deterministic first; two blockers left ───────────────────────────
  await beat("b1-open", async () => {
    await cursor.glideTo(page.getByText(/review and send this order/i).first(), 1000);
    await page.waitForTimeout(1000);
    await cursor.glideTo(page.getByText(/needs review/i).first(), 800);
    await page.waitForTimeout(900);
    await cursor.glideTo(page.getByText(/2 blockers/i).first(), 900);
    await page.waitForTimeout(1000);
    await cursor.glideTo(page.getByText(/ai suggestion to review/i).first(), 800);
  });

  // ── b2 — the card: real code, real match score, two actions ──────────────
  await beat("b2-anatomy", async () => {
    await cursor.glideTo(page.getByText(/before you send/i).first(), 900);
    await page.waitForTimeout(900);
    await cursor.glideTo(page.getByText(/84% match/i).first(), 800);
    await page.waitForTimeout(1100);
    await cursor.glideTo(page.getByRole("button", { name: /accept suggestion/i }).first(), 700);
    await page.waitForTimeout(700);
    await cursor.glideTo(page.getByRole("button", { name: /enter manually/i }).first(), 600);
  });

  // ── b3 — accept the 84% suggestion ────────────────────────────────────────
  await beat("b3-accept", async () => {
    await cursor.click(page.getByRole("button", { name: /accept suggestion/i }).first(), 800);
    await page.waitForTimeout(1800); // card clears, banner recounts
    await cursor.glideTo(page.getByText(/1 blocker/i).first(), 900);
  });

  // ── b4 — enter manually (pre-filled), save, order goes ready ─────────────
  await beat("b4-manual", async () => {
    await cursor.click(page.getByRole("button", { name: /enter manually/i }).first(), 800);
    await page.waitForTimeout(1000);
    // The inline input opens pre-filled with ES-WIRE-22BK-100 — rest on it.
    await cursor.glideTo(page.locator("input[value='ES-WIRE-22BK-100']").first(), 700);
    await page.waitForTimeout(1300);
    await cursor.click(page.getByRole("button", { name: /^save$/i }).first(), 700);
    await page.waitForTimeout(2200); // Ready-to-send green state lands
    await cursor.glideTo(page.getByText(/no open issues/i).first(), 900);
  });

  // ── b5 — grounding narration over the resolved order + preview ───────────
  await beat("b5-grounding", async () => {
    const row = page.locator("[data-mapper-row]").filter({ hasText: "SupplierItemCode" }).last();
    await row.scrollIntoViewIfNeeded().catch(() => {});
    await cursor.glideTo(row, 1000);
    await page.waitForTimeout(1600);
    await cursor.click(page.getByRole("tab", { name: /^preview$/i }).first().or(page.getByText(/^Preview$/).first()), 900);
    await page.waitForTimeout(1400);
    await cursor.glideTo(page.getByText(/live preview/i).first(), 800);
  });

  // ── b6 — the soft budget close; Send never clicked ───────────────────────
  await beat("b6-budget", async () => {
    await cursor.glideTo(page.getByText(/ready to send/i).first(), 1000);
    await page.waitForTimeout(1600);
    await cursor.glideTo(page.getByRole("button", { name: /send to supplier/i }).first(), 1100);
  });

  clock.save(spec.id);
  const dest = resolve(here, "out", spec.id, "capture.webm");
  mkdirSync(dirname(dest), { recursive: true });
  await page.close();
  await page.video()?.saveAs(dest);
  console.log(`[tool-demo] footage → ${dest}`);
});
