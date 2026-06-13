import { test } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DemoCursor, MarkerClock, holdBudgets, loadToolSpec, prepareDemoPage, soft } from "./demo-helpers";

/**
 * FULL WALKTHROUGH v11 capture — a PACING RE-CUT of v10.
 *
 * v10 was founder-approved on SCRIPT ("the text itself is GOOD") but rejected on
 * PACING: "too slow, too much talking, too many stale screens without doing
 * much". v11 keeps the v10 8-beat script VERBATIM (walkthrough-v11.json) and
 * fixes ONLY the choreography + timing:
 *
 *   1. FASTER VO — generated with ELEVENLABS_SPEED=1.12 + stability 0.55 and
 *      hard silence-trim (see generate-tool-vo.mjs). Clips are ~10–15% shorter.
 *   2. NO STALE SCREENS — every beat is choreographed so the UI is DOING
 *      something for the WHOLE narration: continuous cursor glides, list/page
 *      scrolls, hovers, clicks, typing, panel transitions. The instant a beat's
 *      action finishes, the beat dwell is tiny (pad 120ms, no extraMs) so the
 *      cut lands immediately — no lingering on a static end-state.
 *   3. TIGHTER — pad 900→120ms, extraMs→0, shorter intro/outro cards. Target
 *      total 2:00–2:20 (v10 was 2:53).
 *
 * The per-beat hold = measured (faster) VO duration + 120ms pad. The beat's
 * action loop is written to KEEP MOVING right up to that budget via the shared
 * `keepMoving` helper (a slow idle drift fills any residual gap so the frame is
 * never frozen), then the cut happens. Because actions run inside the budget,
 * there is no idle stretch where narration plays over a static screen.
 *
 * Same real-UI mock-mode pipeline as v9/v10 (port 8090, placeholder Clerk key).
 * Same Daniel voice + music bed + brand intro/outro cards (assembler-appended).
 *
 *   bun run demo:tools:capture capture-walkthrough-v11
 */

const here = dirname(fileURLToPath(import.meta.url));
const spec = loadToolSpec("walkthrough-v11");
// v11: tiny reading pad — the VO is faster and the choreography fills the beat,
// so we don't pad the hold. 120ms is just cut latency, not dead air.
const holds = holdBudgets(spec, 120);

const ORDER_PO = /PO-2024-005678/i; // the one order we follow, end to end

// A small, realistic CSV for the READ beat (same shape proven by capture-upload).
const SAMPLE_CSV =
  "po_number,buyer_name,line_no,item_code,description,quantity,unit_price,currency\n" +
  "PO-2026-004417,Nordic Electronics,1,TB-CAP-100,Capacitor 100uF,200,0.35,EUR\n" +
  "PO-2026-004417,Nordic Electronics,2,TB-RES-220,Resistor 220R,500,0.02,EUR\n" +
  "PO-2026-004417,Nordic Electronics,3,TB-WIRE-22,Wire 22AWG Black 100m,5,12.50,EUR\n";

const MAP_HTML = readFileSync(resolve(here, "map-card-v11.html"), "utf8");

test("tool capture: full walkthrough v11 (pacing re-cut)", async ({ page }) => {
  test.setTimeout(600_000);

  const clock = new MarkerClock();
  const cursor = new DemoCursor(page);
  await prepareDemoPage(page, { hideTexts: ["Failed to fetch"] });

  /**
   * Run `actions()` but guarantee the screen is NEVER idle for the remainder of
   * the beat budget: if the scripted action finishes early, fill the rest with a
   * slow continuous cursor drift so there is always motion under the VO. The cut
   * still lands at the budget — no extra dwell.
   */
  const beat = async (id: string, actions?: () => Promise<void>) => {
    const b = spec.beats.find((x) => x.id === id)!;
    clock.mark(id);
    if (actions) {
      if (b.actionLeadMs) await page.waitForTimeout(b.actionLeadMs);
      await soft(id, actions);
    }
    // Fill any residual budget with continuous gentle motion (never a frozen
    // frame), then cut. Drift in short eased hops toward alternating points with
    // a wider travel so consecutive sampled frames always visibly differ
    // (motion, not a hold). Threshold 180ms keeps the cursor essentially always
    // moving right up to the cut.
    let left = holds[id] - clock.since(id);
    let toggle = false;
    while (left > 180) {
      const x = toggle ? 880 : 1040;
      const y = toggle ? 500 : 580;
      toggle = !toggle;
      await cursor.glideToPoint(x, y, Math.min(left - 40, 460));
      left = holds[id] - clock.since(id);
    }
    if (left > 0) await page.waitForTimeout(left);
  };

  // ── warmup: compile every route used by the take (assembler trims this) ────
  // domcontentloaded (not networkidle) — mock-mode long-polls never go idle.
  await soft("warmup", async () => {
    for (const r of ["/inbox", "/upload", "/inbox/ord-002", "/bridge"]) {
      await page.goto(r, { waitUntil: "domcontentloaded" }).catch(() => {});
      await page.waitForTimeout(800); // let the route paint before the next compile
    }
  });

  // Re-seed cookie consent + WAIT for first-paint flashes to clear, so no cut
  // ever lands on the consent banner, a "Loading…" workspace name, or a
  // "Checking plan limits…" placeholder. (The consent banner reads localStorage
  // in a mount effect, so on every fresh load it flashes for ~1 frame before
  // hiding — we wait it out rather than ship a spinner at the cut.)
  const settlePage = async () => {
    await page.evaluate(() => {
      try {
        window.localStorage.setItem("proculink_cookie_consent_v1", "functional-only");
        window.dispatchEvent(new CustomEvent("proculink:cookie-consent", { detail: "functional-only" }));
      } catch { /* ignore */ }
    }).catch(() => {});
    await page.getByText(/We don't use advertising/i).first().waitFor({ state: "hidden", timeout: 6_000 }).catch(() => {});
    await page.getByText(/Checking plan limits/i).first().waitFor({ state: "hidden", timeout: 8_000 }).catch(() => {});
    await page.getByText(/^Loading\.\.\.$/).first().waitFor({ state: "hidden", timeout: 6_000 }).catch(() => {});
  };

  // ── s1 — PROBLEM: open IN the product on the Inbox; SCROLL under the hook ──
  await soft("open", async () => {
    await page.goto("/inbox", { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: /^inbox$/i }).first().waitFor({ timeout: 15_000 }).catch(() => {});
    await page.locator("tbody tr").first().waitFor({ timeout: 15_000 }).catch(() => {});
    await settlePage();
    await page.waitForTimeout(250);
  });
  await beat("s1-problem", async () => {
    // Constant motion over the live queue: cursor sweeps the rows WHILE the list
    // scrolls down and back, so the frame is alive the whole hook — never the
    // frozen inbox v10 rested on. No claim any row IS our order (MSW seed list).
    await cursor.glideTo(page.locator("tbody tr").first(), 900, { dx: -300 });
    await page.mouse.wheel(0, 280);
    await cursor.glideTo(page.locator("tbody tr").nth(3), 900, { dx: -120 }).catch(() => {});
    await page.mouse.wheel(0, 300);
    await cursor.glideTo(page.locator("tbody tr").nth(6), 900, { dx: -300 }).catch(() => {});
    await page.mouse.wheel(0, -260);
    await cursor.glideTo(page.locator("tbody tr").nth(2), 850, { dx: -160 }).catch(() => {});
    await page.mouse.wheel(0, -320);
  });

  // ── s2 — THE MAP: the 5-step motion card (brisk reveal, keeps moving) ──────
  await beat("s2-map", async () => {
    // Self-contained brand card — instant paint, no spinner. v11 card reveals
    // the steps fast (gap 400ms, line draws in 2.4s) so it NEVER sits.
    await page.setContent(MAP_HTML, { waitUntil: "load" });
    await page.getByText(/^Deliver$/).first().waitFor({ timeout: 8_000 }).catch(() => {});
    // The CSS reveal IS the motion for this beat; the residual-drift filler in
    // `beat()` keeps the (cursorless) card alive if VO outlasts the reveal.
  });

  // ── s3 — READ: /upload — cursor to dropzone, CSV drops, detect, route ──────
  // NOTE: `domcontentloaded` (NOT networkidle) — in mock mode a long-poll keeps
  // the network "busy" forever, so networkidle hung ~23s on a fully-painted but
  // STATIC upload screen between the map beat and s3 (a stale screen at the cut).
  // domcontentloaded + an element wait lands the page fast and deterministically.
  await soft("goto-upload", async () => {
    await page.goto("/upload", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /browse files/i }).first().waitFor({ timeout: 15_000 }).catch(() => {});
    // The cut must NOT land on first-paint flashes (cookie-consent banner,
    // "Loading…" workspace, "Checking plan limits…") — wait them all out.
    await settlePage();
    await page.waitForTimeout(150);
  });
  await beat("s3-read", async () => {
    const browse = page.getByRole("button", { name: /browse files/i }).first();
    await cursor.glideTo(browse, 700);
    const chooserPromise = page.waitForEvent("filechooser", { timeout: 6_000 }).catch(() => null);
    await cursor.click(browse, 150, 80);
    const chooser = await chooserPromise;
    if (chooser) {
      await chooser.setFiles({ name: "orders_june.csv", mimeType: "text/csv", buffer: Buffer.from(SAMPLE_CSV) });
    } else {
      await page.setInputFiles('input[type="file"]', {
        name: "orders_june.csv", mimeType: "text/csv", buffer: Buffer.from(SAMPLE_CSV),
      }).catch(() => {});
    }
    // Move straight onto the detect pill as it lands, then keep gliding down the
    // parsed summary — no rest on a static pill.
    await cursor.glideTo(page.getByText(/detected:/i).first(), 700).catch(() => {});
    await cursor.glideTo(page.getByText(/line/i).first(), 650).catch(() => {});
    await cursor.glideTo(page.getByText(/PO[-\s]?2026|purchase order/i).first(), 650).catch(() => {});
  });

  // ── s4 — CHECK & RESOLVE: the heart — busy, never idle ─────────────────────
  await soft("goto-review", async () => {
    await page.goto("/inbox/ord-002", { waitUntil: "domcontentloaded" });
    await page.getByText(ORDER_PO).first().waitFor({ timeout: 15_000 }).catch(() => {});
    await page.getByRole("list", { name: /open issues/i }).first().waitFor({ timeout: 15_000 }).catch(() => {});
    await settlePage();
    await page.waitForTimeout(200);
  });
  await beat("s4-check", async () => {
    // Glide the fix queue into view (motion), then straight to the AI suggestion.
    await cursor.glideTo(page.getByRole("list", { name: /open issues/i }).first(), 700, { dy: -20 });
    const accept = page.getByRole("button", { name: /accept ai suggestion for line 2/i }).first();
    await cursor.glideTo(accept, 700, { dy: -80 });
    await cursor.click(accept, 320);
    await page.waitForTimeout(250); // let the queue advance animate
    // Then type the supplier code yourself on line 4 (wire) and Save — typing IS
    // the motion here; faster keystrokes than v10 (delay 55ms) to keep moving.
    const manual = page.getByRole("button", { name: /enter a supplier code manually for line 4/i }).first();
    await cursor.click(manual, 500);
    const input = page.getByLabel(/supplier code for line 4/i).first();
    await input.waitFor({ timeout: 5_000 }).catch(() => {});
    await cursor.glideTo(input, 360);
    await input.click().catch(() => {});
    await page.keyboard.type("ES-WIRE-22BK-100", { delay: 55 });
    await page.waitForTimeout(180);
    await cursor.click(page.getByRole("button", { name: /^save$/i }).first(), 450);
  });

  // ── s5 — CONVERT: Full document (source / canonical / supplier output) ─────
  await beat("s5-convert", async () => {
    const fullDoc = page.getByRole("button", { name: /full document/i }).first();
    await cursor.click(fullDoc, 650);
    await page.waitForTimeout(250);
    // Trace across the triptych so the supplier-output column build is on camera
    // — a moving sweep, not a rest.
    await cursor.glideToPoint(560, 520, 600);
    await cursor.glideToPoint(1020, 540, 650);
    await cursor.glideToPoint(1480, 560, 650);
  });

  // ── s6 — DELIVER: Send → confirm → Generating → Sent → Delivered ───────────
  await beat("s6-deliver", async () => {
    await soft("back-to-triage", async () => {
      const triage = page.getByRole("button", { name: /^triage(\s*\(\d+\))?$/i }).first();
      await cursor.click(triage, 500);
      await page.waitForTimeout(200);
    });
    await cursor.click(page.getByRole("button", { name: /^send to supplier$/i }).first(), 600);
    await page.locator("#confirm-check").waitFor({ timeout: 6_000 }).catch(() => {});
    await cursor.click(page.locator("#confirm-check"), 450);
    await cursor.click(page.getByRole("button", { name: /send to supplier/i }).last(), 450);
    await page.getByText(/generating|sending|sent/i).first().waitFor({ timeout: 8_000 }).catch(() => {});
    // Track the status as it ticks over the states — keep the cursor moving.
    await cursor.glideToPoint(1180, 320, 600);
    await page.getByText(/delivered/i).first().waitFor({ timeout: 15_000 }).catch(() => {});
    await cursor.glideTo(page.getByText(/delivered/i).first(), 600).catch(() => {});
  });

  // ── s7 — PAYOFF: a quick confident sweep of the delivered order, then cut ──
  await beat("s7-payoff", async () => {
    // Sweep the completed Parse→Deliver stepper (the "it's done" proof) then the
    // delivered banner — confident motion across the proof, not a hold.
    await cursor.glideTo(page.getByText(/^Deliver$/i).first(), 600).catch(() => {});
    await cursor.glideTo(page.getByText(/delivered to supplier/i).first(), 650).catch(() => {});
    await cursor.glideToPoint(1080, 560, 650);
  });

  // ── s8 — CLOSE: VO plays over the live UI before the assembler's outro card.
  // Keep the screen MOVING the whole time — gentle scroll of the delivered order
  // + cursor sweeps — so there is no stale closing screen (the v10 complaint). ──
  await beat("s8-close", async () => {
    await cursor.glideTo(page.getByRole("list", { name: /open issues/i }).first(), 600).catch(() => {});
    await page.mouse.wheel(0, 220);
    await cursor.glideToPoint(900, 520, 600);
    await page.mouse.wheel(0, 220);
    await cursor.glideToPoint(1180, 360, 650);
    await page.mouse.wheel(0, -260);
    await cursor.glideToPoint(620, 520, 650);
    await page.mouse.wheel(0, -200);
  });

  // ── save markers + deterministic footage path ─────────────────────────────
  clock.save(spec.id);
  const dest = resolve(here, "out", spec.id, "capture.webm");
  mkdirSync(dirname(dest), { recursive: true });
  await page.close();
  await page.video()?.saveAs(dest);
  console.log(`[tool-demo] footage → ${dest}`);
});
