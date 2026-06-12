import { test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DemoCursor, MarkerClock, holdBudgets, loadToolSpec, prepareDemoPage, soft } from "./demo-helpers";

/**
 * PER-TOOL capture #2 — "Review & resolve" (/inbox/ord-002, the money screen).
 *
 * Order ord-002 (PO-2024-005678, Nordic Electronics → ElectroSupply Co) ships
 * in the mock store with 2 unresolved lines, both carrying AI suggestions —
 * so the Review tab opens in Triage. Flow: header → fix queue → accept an AI
 * suggestion → set a code manually → Full document triptych → send-readiness
 * card → send (confirm) → Generating → Delivered.
 *
 * ONE page load only; everything after is client-side so the in-memory mock
 * state survives (accept → resolve → send → delivered stays consistent).
 *
 *   bun run demo:tools:capture capture-review
 */

const here = dirname(fileURLToPath(import.meta.url));
const spec = loadToolSpec("review");
const holds = holdBudgets(spec);

test("tool capture: review & resolve", async ({ page }) => {
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

  // ── b1 — open the order; sweep the header ─────────────────────────────────
  await soft("open", async () => {
    await page.goto(spec.route, { waitUntil: "networkidle" });
    await page.getByText(/PO-2024-005678/i).first().waitFor({ timeout: 15_000 }).catch(() => {});
  });
  await beat("b1-open", async () => {
    await cursor.glideTo(page.getByText(/PO-2024-005678/i).first(), 900);
    await page.waitForTimeout(1300);
    await cursor.glideTo(page.getByText(/Nordic Electronics/i).first(), 800);
    await page.waitForTimeout(1100);
    await cursor.glideTo(page.getByText(/ElectroSupply Co/i).first(), 700);
  });

  // ── b2 — the Triage fix queue rail ────────────────────────────────────────
  await beat("b2-triage", async () => {
    await cursor.glideTo(page.getByRole("list", { name: /open issues/i }).first(), 900, { dy: -40 });
    await page.waitForTimeout(1500);
    // drift down the rail
    await cursor.glideTo(page.getByRole("list", { name: /open issues/i }).first(), 1200, { dy: 60 });
  });

  // ── b3 — accept the AI suggestion on the selected card (line 2) ───────────
  await beat("b3-accept", async () => {
    // While the VO explains code/confidence/reason, hover the suggestion card…
    const accept = page.getByRole("button", { name: /accept ai suggestion for line 2/i }).first();
    await cursor.glideTo(accept, 1100, { dy: -70 });
    await page.waitForTimeout(1800);
    // …then accept it ("If it's right, accept it" beat in the VO).
    await cursor.click(accept, 900);
  });

  // ── b4 — set the supplier code manually (line 4) ──────────────────────────
  await beat("b4-manual", async () => {
    const manual = page.getByRole("button", { name: /enter a supplier code manually for line 4/i }).first();
    await cursor.click(manual, 1000);
    const input = page.getByLabel(/supplier code for line 4/i).first();
    await input.waitFor({ timeout: 5_000 }).catch(() => {});
    await cursor.glideTo(input, 600);
    await page.waitForTimeout(400);
    // The input opens prefilled+selected with the AI code; type a deliberate
    // manual decision so the keystrokes read on camera.
    await input.click().catch(() => {});
    await page.keyboard.type("ES-WIRE-22BK-100", { delay: 85 });
    await page.waitForTimeout(500);
    await cursor.click(page.getByRole("button", { name: /^save$/i }).first(), 700);
  });

  // ── b5 — Full document: the source → canonical → output triptych ──────────
  await beat("b5-fulldoc", async () => {
    await cursor.click(page.getByRole("button", { name: /full document/i }).first(), 900);
    await page.waitForTimeout(1500);
    await cursor.glideToPoint(960, 600, 1200);
  });

  // ── b6 — back to Triage; the send-readiness card ──────────────────────────
  await beat("b6-readiness", async () => {
    await cursor.click(page.getByRole("button", { name: /^triage/i }).first(), 900);
    await page.waitForTimeout(900);
    await cursor.glideTo(page.getByText(/lines resolved/i).first(), 1100);
  });

  // ── b7 — send: CTA → confirm dialog → checkbox → final send ───────────────
  await beat("b7-send", async () => {
    await cursor.click(page.getByRole("button", { name: /^send to supplier$/i }).first(), 900);
    await page.locator("#confirm-check").waitFor({ timeout: 6_000 }).catch(() => {});
    await page.waitForTimeout(1400); // let the dialog be read
    await cursor.click(page.locator("#confirm-check"), 700);
    await page.waitForTimeout(600);
    await cursor.click(page.getByRole("button", { name: /send to supplier/i }).last(), 700);
  });

  // ── b8 — Generating → Sent → Delivered + audit-trail close ────────────────
  await beat("b8-delivered", async () => {
    await page
      .getByText(/generating|sending|sent/i)
      .first()
      .waitFor({ timeout: 8_000 })
      .catch(() => {});
    await cursor.glideToPoint(1180, 320, 1000);
    await page.getByText(/delivered/i).first().waitFor({ timeout: 15_000 }).catch(() => {});
  });

  // ── save markers + deterministic footage path ─────────────────────────────
  clock.save(spec.id);
  const dest = resolve(here, "out", spec.id, "capture.webm");
  mkdirSync(dirname(dest), { recursive: true });
  await page.close();
  await page.video()?.saveAs(dest);
  console.log(`[tool-demo] footage → ${dest}`);
});
