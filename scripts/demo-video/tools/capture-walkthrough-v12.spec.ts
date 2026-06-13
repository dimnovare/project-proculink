import { test, type Locator, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MarkerClock, holdBudgets, loadToolSpec, prepareDemoPage, soft } from "./demo-helpers";

/**
 * FULL WALKTHROUGH v12 capture — the SIMPLE, HONEST re-cut.
 *
 * v6–v11 were rejected. The named, decisive defect in v11 (founder):
 *   "at some point the voice speaks while the mouse is just hovering from left
 *    to right" — the synthetic drift-filler / "keep the cursor moving" motion
 *    looked fake and cheap.
 *
 * v12 is the fix, by RULE:
 *
 *   1. NO SYNTHETIC CURSOR MOTION — EVER. The v11 `beat()` had a residual-drift
 *      while-loop that glided the cursor between (880,500)↔(1040,580) to "fill"
 *      any VO budget the scripted action didn't cover, plus decorative
 *      glideToPoint() "sweep the triptych / trace across" moves in s5–s8. ALL OF
 *      THAT IS DELETED. The cursor is STILL by default. It is HIDDEN except in
 *      the ~0.5s window around a real click. It moves ONLY to perform a real
 *      click: it appears at the target, clicks (pulse), then hides and parks. It
 *      never drifts, hovers, or wanders between actions.
 *
 *   2. REAL MOTION ONLY — the only things that move are a real click, real
 *      typing, a real state change (Generating→Sent→Delivered). No motion is
 *      ever invented to fill a narration line.
 *
 *   3. NARRATION 1:1 WITH ACTION — the VO (walkthrough-v12.json) is ~6 short
 *      lines, one per real action. When a line ends and there's no more real
 *      action, the beat CUTS promptly — it does NOT hold a stale frame and does
 *      NOT fake-move. The per-beat hold = measured VO + a tiny 120ms cut pad.
 *
 *   4. SIMPLE — no abstract 5-step map card. Just the real flow:
 *      open the order → accept the AI suggestion → type the second code + save →
 *      send → delivered. Target 1:30–2:00.
 *
 * Same real-UI mock-mode pipeline as v9–v11 (port 8090, placeholder Clerk key),
 * same Daniel voice + low music bed + brand intro/outro cards (assembler).
 *
 *   bun run demo:tools:capture capture-walkthrough-v12
 */

const here = dirname(fileURLToPath(import.meta.url));
const spec = loadToolSpec("walkthrough-v12");
// tiny cut pad only — no padding-as-dead-air. The VO governs each beat length.
const holds = holdBudgets(spec, 120);

const ORDER_PO = /PO-2024-005678/i; // the one order we follow, end to end

test("tool capture: full walkthrough v12 (simple, still cursor)", async ({ page }) => {
  test.setTimeout(600_000);

  const clock = new MarkerClock();
  await prepareDemoPage(page, { hideTexts: ["Failed to fetch"] });

  // ── STILL-CURSOR control ───────────────────────────────────────────────────
  // The shared demo cursor (prepareDemoPage) shows itself on the FIRST mousemove
  // and never hides. v12 overrides that: the cursor is gated by a body
  // data-attribute (`data-plk-cursor="on"`). When OFF it is fully hidden AND its
  // mousemove handler is suppressed, so even if Playwright emits a stray move the
  // dot does not appear. We only flip it ON for the brief window around a real
  // click, then OFF again. Result: the cursor is invisible and motionless during
  // every pure-narration span; it exists only to perform a real click.
  await page.addInitScript(() => {
    const apply = () => {
      const c = document.getElementById("plk-demo-cursor");
      if (!c) return;
      const on = document.body?.getAttribute("data-plk-cursor") === "on";
      c.style.display = on ? "block" : "none";
      if (!on) c.style.opacity = "0";
    };
    // Re-assert hidden state whenever the attribute changes or the dot is (re)added.
    const obs = new MutationObserver(apply);
    const start = () => {
      document.body.setAttribute("data-plk-cursor", "off");
      obs.observe(document.body, { attributes: true, attributeFilter: ["data-plk-cursor"], childList: true, subtree: true });
      apply();
    };
    if (document.body) start();
    else document.addEventListener("DOMContentLoaded", start);
  });

  const cursorOn = () => page.evaluate(() => document.body.setAttribute("data-plk-cursor", "on")).catch(() => {});
  const cursorOff = () => page.evaluate(() => document.body.setAttribute("data-plk-cursor", "off")).catch(() => {});

  // Track the logical cursor position WITHOUT moving the visible dot (it's hidden
  // while OFF). Used so the appear-glide before a click starts from a sensible
  // point — but no move is ever emitted between actions.
  let cx = 960, cy = 600;

  /**
   * Glide the (now-visible) cursor to a point with an eased, human path. Only
   * ever called inside `realClick` — never as filler.
   */
  const glideToPoint = async (tx: number, ty: number, ms = 520) => {
    const frames = Math.max(8, Math.round(ms / 16));
    const x0 = cx, y0 = cy;
    for (let i = 1; i <= frames; i++) {
      const t = i / frames;
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // easeInOutQuad
      await page.mouse.move(x0 + (tx - x0) * e, y0 + (ty - y0) * e);
      await page.waitForTimeout(14);
    }
    cx = tx; cy = ty;
  };

  /**
   * The ONLY thing that moves the cursor: a REAL click.
   *   show cursor → glide directly to target → settle → press (pulse) → release
   *   → settle on the result → HIDE the cursor and park.
   * After this returns the cursor is invisible and will not move until the next
   * realClick. No drift, no hover, ever.
   */
  const realClick = async (loc: Locator, glideMs = 520): Promise<boolean> => {
    await loc.scrollIntoViewIfNeeded().catch(() => {});
    const box = await loc.boundingBox().catch(() => null);
    if (!box) return false;
    const tx = box.x + box.width / 2;
    const ty = box.y + box.height / 2;
    await cursorOn();
    await glideToPoint(tx, ty, glideMs);
    await page.waitForTimeout(180);         // settle on target before the click
    await page.mouse.down();
    await page.waitForTimeout(110);         // pulse
    await page.mouse.up();
    await page.waitForTimeout(360);         // brief settle so the click reads
    await cursorOff();                      // hide + park — STILL until next click
    return true;
  };

  /**
   * Type into a focused field as a real action. The cursor stays parked at the
   * field (visible during the type, since this immediately follows a realClick),
   * then hides. Real keystrokes are the only motion.
   */
  const realType = async (input: Locator, text: string) => {
    await input.click().catch(() => {});
    await page.keyboard.type(text, { delay: 60 });
    await page.waitForTimeout(150);
    await cursorOff();
  };

  /**
   * Beat: mark, run the (real) action, then hold the STILL frame for exactly the
   * remaining VO budget — NO motion, NO drift. If the action overruns the budget
   * that's fine (real action wins); otherwise we wait out the rest on a frozen,
   * settled frame and cut. This is the deliberate opposite of v11's drift-fill.
   */
  const beat = async (id: string, actions?: () => Promise<void>) => {
    clock.mark(id);
    if (actions) await soft(id, actions);
    const left = holds[id] - clock.since(id);
    if (left > 0) await page.waitForTimeout(left);
  };

  // Re-seed cookie consent + WAIT OUT first-paint flashes so no cut ever lands on
  // a consent banner, a "Loading…" workspace name, or a "Checking plan limits…"
  // placeholder.
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

  // ── warmup: compile the one route we use (assembler trims this) ─────────────
  await soft("warmup", async () => {
    await page.goto("/inbox/ord-002", { waitUntil: "domcontentloaded" }).catch(() => {});
    await page.waitForTimeout(1200);
  });

  // ── OPEN the order in review — settle to a STILL frame, cursor hidden ───────
  await soft("open", async () => {
    await page.goto("/inbox/ord-002", { waitUntil: "domcontentloaded" });
    await page.getByText(ORDER_PO).first().waitFor({ timeout: 15_000 }).catch(() => {});
    await page.getByRole("list", { name: /open issues/i }).first().waitFor({ timeout: 15_000 }).catch(() => {});
    await settlePage();
    await page.waitForTimeout(300);
  });

  // s1-open — VO describes the parsed order over a STILL frame (no cursor).
  await beat("s1-open");

  // s2-accept — cursor appears, accepts the AI suggestion on line 2, then parks.
  await beat("s2-accept", async () => {
    const accept = page.getByRole("button", { name: /accept ai suggestion for line 2/i }).first();
    await realClick(accept, 560);
    await page.waitForTimeout(300); // let the queue advance animate (real state change)
  });

  // s3-type — cursor opens manual entry on line 4, TYPES the code, saves, parks.
  await beat("s3-type", async () => {
    const manual = page.getByRole("button", { name: /enter a supplier code manually for line 4/i }).first();
    await realClick(manual, 520);
    const input = page.getByLabel(/supplier code for line 4/i).first();
    await input.waitFor({ timeout: 5_000 }).catch(() => {});
    // keep the cursor visible through the type (it just clicked), then hide
    await cursorOn();
    await realType(input, "ES-WIRE-22BK-100");
    await realClick(page.getByRole("button", { name: /^save$/i }).first(), 460);
    await page.waitForTimeout(300); // line resolves (real state change)
  });

  // s4-convert — toggle Full document: a REAL UI change to the source/canonical/
  //   supplier-output view. Cursor clicks, then parks. No trace/sweep filler.
  await beat("s4-convert", async () => {
    const fullDoc = page.getByRole("button", { name: /full document/i }).first();
    if (await fullDoc.isVisible().catch(() => false)) {
      await realClick(fullDoc, 540);
      await page.waitForTimeout(400); // the triptych builds — real state change
    }
  });

  // s5-send — Send → confirm → Generating → Sent → Delivered (real states only).
  await beat("s5-send", async () => {
    await soft("back-to-triage", async () => {
      const triage = page.getByRole("button", { name: /^triage(\s*\(\d+\))?$/i }).first();
      if (await triage.isVisible().catch(() => false)) await realClick(triage, 460);
    });
    await realClick(page.getByRole("button", { name: /^send to supplier$/i }).first(), 540);
    await page.locator("#confirm-check").waitFor({ timeout: 6_000 }).catch(() => {});
    await realClick(page.locator("#confirm-check"), 380);
    await realClick(page.getByRole("button", { name: /send to supplier/i }).last(), 380);
    // Real state machine: Generating → Sent → Delivered. No cursor motion — the
    // UI itself is the motion here.
    await page.getByText(/generating|sending|sent/i).first().waitFor({ timeout: 8_000 }).catch(() => {});
    await page.getByText(/delivered/i).first().waitFor({ timeout: 15_000 }).catch(() => {});
  });

  // s6-delivered — settle on the Delivered/audit STILL frame (cursor hidden).
  await beat("s6-delivered", async () => {
    await cursorOff();
    await page.getByText(/delivered/i).first().waitFor({ timeout: 8_000 }).catch(() => {});
    await page.waitForTimeout(200); // settle the delivered state, then hold still
  });

  // s7-close — VO plays over the assembler's outro card; nothing to do on-UI.
  // (Mark only so the assembler syncs the line; the outro card is the visual.)
  clock.mark("s7-close");

  // ── save markers + deterministic footage path ─────────────────────────────
  clock.save(spec.id);
  const dest = resolve(here, "out", spec.id, "capture.webm");
  mkdirSync(dirname(dest), { recursive: true });
  await page.close();
  await page.video()?.saveAs(dest);
  console.log(`[tool-demo] footage → ${dest}`);
});
