import { test } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DemoCursor, MarkerClock, holdBudgets, loadToolSpec, prepareDemoPage, soft } from "./demo-helpers";

/**
 * FULL WALKTHROUGH v10 capture — a CALM EXPLAINER (not a feature tour, not a
 * sales race). v7, v8 and v9 were all rejected; the founder diagnosed the issue
 * as STORY & STRUCTURE, not voice/pacing-as-speed. v10 TEACHES how the product
 * works: give the viewer the mental MAP first (the new beat 2 — the five steps),
 * then walk that map calmly, one step at a time, each with its purpose.
 *
 * The narration (walkthrough-v10.json) is the founder-APPROVED script, verbatim.
 * The capture only TIMES the visuals to it.
 *
 * Beats:
 *   s1 problem  — open IN the product on the Inbox (the live queue); the problem
 *   s2 map      — the 5-step MAP: an on-brand HTML/CSS motion card (map-card.html)
 *                 served via page.setContent and captured in-take (the NEW thing)
 *   s3 read     — /upload: drop a CSV, format auto-detected, PO + lines found
 *   s4 check    — /inbox/ord-002: the heart — accept AI suggestion + manual code
 *   s5 convert  — Full document: source / canonical / supplier-output side by side
 *   s6 deliver  — Send → confirm → Generating → Sent → Delivered + audit trail
 *   s7 payoff   — rest on the delivered order (it learns; less work next time)
 *   s8 close    — outro card (appended by the assembler; VO plays over it)
 *
 * Page loads: warmup pass (trimmed by the assembler) → /inbox (s1) → the map
 * card via setContent (s2) → /upload (s3) → /inbox/ord-002 (s4); everything
 * after that (accept → manual → full-doc → send → delivered) is CLIENT-SIDE so
 * the one order stays consistent on camera.
 *
 *   bun run demo:tools:capture capture-walkthrough-v10
 */

const here = dirname(fileURLToPath(import.meta.url));
const spec = loadToolSpec("walkthrough-v10");
// An 8-beat calm explainer reads slower than the v9 tour, so a generous reading
// pad per beat keeps the cursor unhurried.
const holds = holdBudgets(spec, 900);

const ORDER_PO = /PO-2024-005678/i; // the one order we follow, end to end

// A small, realistic CSV for the READ beat (same shape proven by capture-upload).
const SAMPLE_CSV =
  "po_number,buyer_name,line_no,item_code,description,quantity,unit_price,currency\n" +
  "PO-2026-004417,Nordic Electronics,1,TB-CAP-100,Capacitor 100uF,200,0.35,EUR\n" +
  "PO-2026-004417,Nordic Electronics,2,TB-RES-220,Resistor 220R,500,0.02,EUR\n" +
  "PO-2026-004417,Nordic Electronics,3,TB-WIRE-22,Wire 22AWG Black 100m,5,12.50,EUR\n";

const MAP_HTML = readFileSync(resolve(here, "map-card.html"), "utf8");

test("tool capture: full walkthrough v10 (calm explainer)", async ({ page }) => {
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
    for (const r of ["/inbox", "/upload", "/inbox/ord-002", "/bridge"]) {
      await page.goto(r, { waitUntil: "networkidle" }).catch(() => {});
    }
  });

  // ── s1 — PROBLEM: open IN the product on the Inbox (the live queue) ────────
  await soft("open", async () => {
    await page.goto("/inbox", { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: /^inbox$/i }).first().waitFor({ timeout: 15_000 }).catch(() => {});
    await page.locator("tbody tr").first().waitFor({ timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(600);
  });
  await beat("s1-problem", async () => {
    // Calm settle over the live queue — context for the problem statement; no
    // claim that any row IS our order (it's the MSW seed list).
    await cursor.glideTo(page.locator("tbody tr").first(), 1300, { dx: -260 });
    await page.waitForTimeout(900);
    await cursor.glideTo(page.locator("tbody tr").nth(2), 1200, { dx: -260 });
  });

  // ── s2 — THE MAP: the 5-step motion card (the NEW beat) ────────────────────
  await beat("s2-map", async () => {
    // Self-contained brand card — instant paint, no spinner, no dev-server dep.
    // CSS reveals Read → Check → Resolve → Convert → Deliver one at a time while
    // the VO names them. We hold for the whole reveal (driven by holds[s2-map]).
    await page.setContent(MAP_HTML, { waitUntil: "load" });
    // Confirm the last step painted before the beat dwell decides the cut.
    await page.getByText(/^Deliver$/).first().waitFor({ timeout: 8_000 }).catch(() => {});
  });

  // ── s3 — READ: /upload — a CSV arrives, format auto-detected ───────────────
  await soft("goto-upload", async () => {
    await page.goto("/upload", { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: /upload an order/i }).first().waitFor({ timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(400);
  });
  await beat("s3-read", async () => {
    const browse = page.getByRole("button", { name: /browse files/i }).first();
    await cursor.glideTo(browse, 1000);
    await page.waitForTimeout(400);
    const chooserPromise = page.waitForEvent("filechooser", { timeout: 6_000 }).catch(() => null);
    await cursor.click(browse, 200, 100);
    const chooser = await chooserPromise;
    if (chooser) {
      await chooser.setFiles({ name: "orders_june.csv", mimeType: "text/csv", buffer: Buffer.from(SAMPLE_CSV) });
    } else {
      await page.setInputFiles('input[type="file"]', {
        name: "orders_june.csv", mimeType: "text/csv", buffer: Buffer.from(SAMPLE_CSV),
      }).catch(() => {});
    }
    await page.waitForTimeout(900);
    await cursor.glideTo(page.getByText(/detected:/i).first(), 1000);
    await page.waitForTimeout(700);
    // Rest on the parsed PO/line summary, calmly.
    await cursor.glideTo(page.getByText(/line/i).first(), 900).catch(() => {});
  });

  // ── s4 — CHECK & RESOLVE: the heart (accept AI + manual code) ──────────────
  await soft("goto-review", async () => {
    await page.goto("/inbox/ord-002", { waitUntil: "domcontentloaded" });
    await page.getByText(ORDER_PO).first().waitFor({ timeout: 15_000 }).catch(() => {});
    await page.getByRole("list", { name: /open issues/i }).first().waitFor({ timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(500);
  });
  await beat("s4-check", async () => {
    // First, rest on the fix queue so the viewer sees "only the few it isn't sure of".
    await cursor.glideTo(page.getByRole("list", { name: /open issues/i }).first(), 1100, { dy: -20 });
    await page.waitForTimeout(900);
    // Accept the AI suggestion on line 2 (resistor) — confidence + reason on screen.
    const accept = page.getByRole("button", { name: /accept ai suggestion for line 2/i }).first();
    await cursor.glideTo(accept, 1000, { dy: -80 });
    await page.waitForTimeout(1400);
    await cursor.click(accept, 900);
    await page.waitForTimeout(900);
    // Then type the supplier code yourself on line 4 (wire) and Save.
    const manual = page.getByRole("button", { name: /enter a supplier code manually for line 4/i }).first();
    await cursor.click(manual, 900);
    const input = page.getByLabel(/supplier code for line 4/i).first();
    await input.waitFor({ timeout: 5_000 }).catch(() => {});
    await cursor.glideTo(input, 500);
    await input.click().catch(() => {});
    await page.keyboard.type("ES-WIRE-22BK-100", { delay: 80 });
    await page.waitForTimeout(450);
    await cursor.click(page.getByRole("button", { name: /^save$/i }).first(), 700);
  });

  // ── s5 — CONVERT: Full document (source / canonical / supplier output) ─────
  await beat("s5-convert", async () => {
    // Switch to the full-document triptych so the supplier output is on camera.
    const fullDoc = page.getByRole("button", { name: /full document/i }).first();
    await cursor.click(fullDoc, 1000);
    await page.waitForTimeout(900);
    // Rest on the supplier-output side of the triptych.
    await cursor.glideToPoint(1480, 560, 1100);
  });

  // ── s6 — DELIVER: Send → confirm → Generating → Sent → Delivered ───────────
  await beat("s6-deliver", async () => {
    // Back to triage to send (the send CTA lives there).
    await soft("back-to-triage", async () => {
      const triage = page.getByRole("button", { name: /^triage(\s*\(\d+\))?$/i }).first();
      await cursor.click(triage, 800);
      await page.waitForTimeout(500);
    });
    await cursor.click(page.getByRole("button", { name: /^send to supplier$/i }).first(), 900);
    await page.locator("#confirm-check").waitFor({ timeout: 6_000 }).catch(() => {});
    await page.waitForTimeout(1100);
    await cursor.click(page.locator("#confirm-check"), 700);
    await page.waitForTimeout(500);
    await cursor.click(page.getByRole("button", { name: /send to supplier/i }).last(), 700);
    await page.getByText(/generating|sending|sent/i).first().waitFor({ timeout: 8_000 }).catch(() => {});
    await cursor.glideToPoint(1180, 320, 1000);
    await page.getByText(/delivered/i).first().waitFor({ timeout: 15_000 }).catch(() => {});
  });

  // ── s7 — PAYOFF: rest on the delivered/resolved order (it learns) ──────────
  await beat("s7-payoff", async () => {
    await cursor.glideTo(page.getByText(/delivered/i).first(), 1100).catch(() => {});
    await page.waitForTimeout(700);
    await cursor.glideToPoint(960, 520, 1200);
  });

  // ── s8 — CLOSE: the outro card is appended by the assembler; hold the UI ───
  await beat("s8-close", async () => {
    await cursor.glideToPoint(960, 540, 1000);
  });

  // ── save markers + deterministic footage path ─────────────────────────────
  clock.save(spec.id);
  const dest = resolve(here, "out", spec.id, "capture.webm");
  mkdirSync(dirname(dest), { recursive: true });
  await page.close();
  await page.video()?.saveAs(dest);
  console.log(`[tool-demo] footage → ${dest}`);
});
