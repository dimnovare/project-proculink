import { test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DemoCursor, MarkerClock, holdBudgets, loadToolSpec, prepareDemoPage, soft } from "./demo-helpers";

/**
 * FULL WALKTHROUGH v9 capture — a SINGLE-ORDER STORY (not a feature tour).
 *
 * We follow ONE real-looking purchase order — PO-2024-005678, from Nordic
 * Electronics, going to ElectroSupply Co — from the moment it lands in the
 * Inbox to "Delivered", the way a coordinator actually works it. Catalog-
 * grounded AI, manual override + learning, the pre-send readiness check, the
 * audit trail, and the exceptions/health safety net all appear as natural
 * BEATS INSIDE that one order's journey, not as separate "and also…" screens.
 *
 * Story beats (walkthrough-v9.json):
 *   s1 arrival  — open IN the product on the Inbox (the live queue); 1-line hook
 *   s2 open     — cut to the order in review; header (PO / buyer / supplier)
 *   s3 queue    — the Fix Queue: only the lines that need a decision
 *   s4 accept   — accept the AI suggestion (catalog-grounded, confidence+reason)
 *   s5 manual   — type the supplier code yourself; it's remembered
 *   s6 ready    — the honest pre-send readiness check, all green
 *   s7 send     — Send → confirm dialog → final send (exact supplier format)
 *   s8 delivered— Generating → Sent → Delivered + audit trail
 *   s9 safety   — quick aside: Exceptions + System health (nothing fails silent)
 *   s10 close   — Dashboard, calm close
 *
 * Page loads: warmup pass (trimmed by the assembler) → /inbox (the s1 hook) →
 * /inbox/ord-002 (the order we follow). MOCK GAP we work around: the Inbox
 * LIST renders the 50-row MSW seed dataset (src/mocks/data.ts), which does NOT
 * contain ord-002, and those rows route to ids the order-detail store
 * (mockOrders, 3 orders) returns null for — so clicking a list row would land
 * on a blank/altered order. We therefore use the inbox purely as the opening
 * HOOK (cursor over the live queue, generic VO) and CUT to the real order in
 * review via a page load — never claiming any specific list row is our order.
 * From /inbox/ord-002 on, every step (accept → manual → send → delivered) is
 * CLIENT-SIDE, so the one order stays consistent on camera; the ops aside and
 * dashboard close are sidebar (client-side) navigations.
 *
 *   bun run demo:tools:capture capture-walkthrough-v9
 */

const here = dirname(fileURLToPath(import.meta.url));
const spec = loadToolSpec("walkthrough-v9");
// A 10-beat single-order story is tighter than the 15-beat v7 tour, so a touch
// more reading pad per beat keeps the cursor calm without bloating the runtime.
const holds = holdBudgets(spec, 820);

const ORDER_PO = /PO-2024-005678/i; // the order we follow, end to end (in review)

test("tool capture: full walkthrough v9 (single-order story)", async ({ page }) => {
  test.setTimeout(600_000);

  const clock = new MarkerClock();
  const cursor = new DemoCursor(page);
  // "Failed to fetch" is a safety hide only — no API without a mock twin is
  // visited deliberately in this take (documented in tools/PRODUCTION.md).
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

  // ── warmup: compile every route used by the take (assembler trims this) ────
  await soft("warmup", async () => {
    for (const r of ["/inbox", "/inbox/ord-002", "/operations/exceptions", "/operations/health", "/bridge"]) {
      await page.goto(r, { waitUntil: "networkidle" }).catch(() => {});
    }
  });

  // ── s1 — open IN the product on the Inbox (the live queue); 1-line hook ────
  await soft("open", async () => {
    await page.goto("/inbox", { waitUntil: "networkidle" });
    // Let the order table paint (no mock "Loading…" left in frame at the cut).
    await page.getByRole("heading", { name: /^inbox$/i }).first().waitFor({ timeout: 15_000 }).catch(() => {});
    await page.locator("tbody tr").first().waitFor({ timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(600);
  });
  await beat("s1-arrival", async () => {
    // Settle the cursor over the top "needs review" order — generic queue shot,
    // no claim that this row IS our order (it's the MSW seed list).
    await cursor.glideTo(page.locator("tbody tr").first(), 1100, { dx: -260 });
    await page.waitForTimeout(700);
  });

  // ── s2 — cut to the order in review: header (PO / buyer / supplier) ────────
  await beat("s2-open", async () => {
    await page.goto("/inbox/ord-002", { waitUntil: "domcontentloaded" });
    await page.getByText(ORDER_PO).first().waitFor({ timeout: 15_000 }).catch(() => {});
    // Wait for the review body (the fix queue) to paint — no spinner at the cut.
    await page.getByRole("list", { name: /open issues/i }).first().waitFor({ timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(500);
    await cursor.glideTo(page.getByText(ORDER_PO).first(), 800);
  });

  // ── s3 — the Fix Queue: only the lines that need a decision ────────────────
  await beat("s3-queue", async () => {
    await cursor.glideTo(page.getByRole("list", { name: /open issues/i }).first(), 1000, { dy: -20 });
  });

  // ── s4 — accept the AI suggestion (line 2, resistor) ───────────────────────
  await beat("s4-accept", async () => {
    const accept = page.getByRole("button", { name: /accept ai suggestion for line 2/i }).first();
    await cursor.glideTo(accept, 1100, { dy: -80 });
    await page.waitForTimeout(1700);
    await cursor.click(accept, 900);
  });

  // ── s5 — type the supplier code yourself (line 4, wire) ────────────────────
  await beat("s5-manual", async () => {
    const manual = page.getByRole("button", { name: /enter a supplier code manually for line 4/i }).first();
    await cursor.click(manual, 900);
    const input = page.getByLabel(/supplier code for line 4/i).first();
    await input.waitFor({ timeout: 5_000 }).catch(() => {});
    await cursor.glideTo(input, 500);
    await input.click().catch(() => {});
    await page.keyboard.type("ES-WIRE-22BK-100", { delay: 85 });
    await page.waitForTimeout(450);
    await cursor.click(page.getByRole("button", { name: /^save$/i }).first(), 600);
  });

  // ── s6 — the honest pre-send readiness check, all green ────────────────────
  await beat("s6-ready", async () => {
    await cursor.glideTo(page.getByText(/lines resolved/i).first(), 1100);
  });

  // ── s7 — send: CTA → confirm dialog → checkbox → final send ────────────────
  await beat("s7-send", async () => {
    await cursor.click(page.getByRole("button", { name: /^send to supplier$/i }).first(), 900);
    await page.locator("#confirm-check").waitFor({ timeout: 6_000 }).catch(() => {});
    await page.waitForTimeout(1300);
    await cursor.click(page.locator("#confirm-check"), 700);
    await page.waitForTimeout(500);
    await cursor.click(page.getByRole("button", { name: /send to supplier/i }).last(), 700);
  });

  // ── s8 — Generating → Sent → Delivered + audit trail ───────────────────────
  await beat("s8-delivered", async () => {
    await page.getByText(/generating|sending|sent/i).first().waitFor({ timeout: 8_000 }).catch(() => {});
    await cursor.glideToPoint(1180, 320, 1000);
    await page.getByText(/delivered/i).first().waitFor({ timeout: 15_000 }).catch(() => {});
  });

  // ── s9 — quick aside: Exceptions + System health (nothing fails silently) ──
  await beat("s9-safety", async () => {
    await cursor.click(page.getByRole("link", { name: /^exceptions$/i }).first(), 800);
    await page.getByText(/UNRESOLVED_SUPPLIER_CODE/i).first().waitFor({ timeout: 10_000 }).catch(() => {});
    const firstRow = page.locator("tbody tr").first();
    await cursor.glideTo(firstRow, 700, { dx: -260 });
    await cursor.glideTo(firstRow, 800, { dx: 260 });
    await page.waitForTimeout(250);
    await cursor.click(page.getByRole("link", { name: /system health/i }).first(), 700);
    await page.getByText(/worker online/i).first().waitFor({ timeout: 10_000 }).catch(() => {});
    await cursor.glideTo(page.getByText(/worker online/i).first(), 700);
    await page.waitForTimeout(250);
    await cursor.glideTo(page.getByRole("button", { name: /requeue delivery/i }).first(), 700);
  });

  // ── s10 — close on the dashboard ───────────────────────────────────────────
  await beat("s10-close", async () => {
    await cursor.click(page.getByRole("link", { name: /^dashboard$/i }).first(), 800);
    await page.getByRole("heading", { name: /^dashboard$/i }).first().waitFor({ timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(600); // let the topology paint — no spinner at the close cut
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
