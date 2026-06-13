import { test, type Page } from "@playwright/test";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * ProcuLink walkthrough CAPTURE script (not a test).
 *
 * Drives the REAL ProcuLink frontend through ONE order, end to end, and lets
 * Playwright record the screen. MOCK mode (set by playwright.demo.config.ts) so
 * the footage is deterministic and needs no backend.
 *
 * KEY: mock state lives in an in-memory array, so a full page reload RESETS it.
 * After the single initial load of the order preview, EVERYTHING is client-side
 * navigation (button clicks) — no page.goto — so accept → commit → send →
 * delivered stays consistent and the order actually reaches `delivered`.
 *
 * Flow (order ord-002 / PO-2024-005678, Nordic Electronics → ElectroSupply Co):
 *   hero → value → upload (show file + format) → preview (parsed + AI) →
 *   accept AI → commit → order detail → validate → SEND (Generating… → Sent) →
 *   passport (delivered, with delivery attempt + supplier response).
 *
 * Footage, not verification: steps are fail-soft so a take never aborts. Scene
 * markers (out/markers.json) sync the narration in assemble.mjs.
 *
 *   bun run demo:capture
 */

const here = dirname(fileURLToPath(import.meta.url));
const scenes = JSON.parse(readFileSync(resolve(here, "scenes.json"), "utf8")) as Array<{
  id: string;
  holdMs: number;
  vo: string;
}>;
const holdOf = (id: string) => scenes.find((s) => s.id === id)?.holdMs ?? 8000;

test("ProcuLink walkthrough capture", async ({ page }) => {
  test.setTimeout(300_000);

  const t0 = Date.now();
  const markers: Record<string, number> = {};

  const soft = async (label: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      console.log(`[demo] soft-skip ${label}: ${(e as Error).message}`);
    }
  };
  const beat = async (id: string) => {
    markers[id] = (Date.now() - t0) / 1000;
    console.log(`[demo] ${id} @ ${markers[id].toFixed(1)}s`);
    await page.waitForTimeout(holdOf(id));
  };
  const click = async (loc: ReturnType<Page["getByRole"]>, ms = 0) => {
    if (await loc.isVisible().catch(() => false)) {
      if (ms) await page.waitForTimeout(ms);
      await loc.click().catch(() => {});
      return true;
    }
    return false;
  };

  // Hide the mock-mode "Demo data" badge AND the Next.js dev-server overlay
  // (the "N / 1 Issue" chip — dev-only, absent in production) for a clean
  // marketing look. Runs on every navigation, surviving the page.goto loads.
  await page.addInitScript(() => {
    const css =
      'span[title^="You are viewing mock data"]{display:none!important;}' +
      "nextjs-portal,[data-next-badge-root],[data-nextjs-toast]," +
      "[data-nextjs-dev-tools-button],#__next-build-watcher," +
      "[data-nextjs-dialog-overlay]{display:none!important;}";
    const add = () => {
      const s = document.createElement("style");
      s.textContent = css;
      (document.head || document.documentElement).appendChild(s);
    };
    if (document.head) add();
    else document.addEventListener("DOMContentLoaded", add);
  });

  // ── s1 — hook: the ANIMATED how-it-works pipeline (motion, on-topic) ──────
  //   The how-it-works hero runs a live "order pipeline" (Receive→…→Deliver
  //   dots cycling + data cells fading in), so the opening isn't a static hero.
  await soft("s1.goto", async () => {
    await page.goto("/how-it-works", { waitUntil: "networkidle" });
    await dismissCookie(page);
    // Frame the terminal/pipeline nicely in view.
    await page.evaluate(() => window.scrollTo({ top: 150, behavior: "instant" as ScrollBehavior })).catch(() => {});
  });
  await beat("s1-hook");

  // ── s2 — promise: stay on the animating pipeline (no scroll) ─────────────
  await soft("s2.hero", async () => {
    await page.waitForTimeout(200);
  });
  await beat("s2-promise");

  // ── s3 — upload: choose a file, dwell on the format-detect pill ──────────
  await soft("s3.upload", async () => {
    await page.goto("/upload", { waitUntil: "networkidle" });
    await page.setInputFiles('input[type="file"]', {
      name: "PO-2024-005678.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        "po_number,buyer_name,line_no,item_code,description,quantity,unit_price,currency\n" +
          "PO-2024-005678,Nordic Electronics,1,TB-CAP-100,Capacitor 100µF,200,0.35,EUR\n" +
          "PO-2024-005678,Nordic Electronics,2,TB-RES-220,Resistor 220Ω,500,0.02,EUR\n" +
          "PO-2024-005678,Nordic Electronics,3,TB-WIRE-22,Wire 22AWG Black 100m,5,12.50,EUR\n",
      ),
    });
    // Let the file chip + format-detection pill render and be seen (no submit —
    // we route to the seeded order's preview next so the rest stays consistent).
    await page.waitForTimeout(2600);
  });
  await beat("s3-upload");

  // ── s4 — parse / review: the parsed order, source→canonical→supplier ─────
  //   This is the ONLY load after s3. From here everything is client-side.
  await soft("s4.preview", async () => {
    await page.goto("/upload/preview/ord-002", { waitUntil: "networkidle" });
    await page.getByText(/review your order mapping/i).waitFor({ timeout: 15_000 }).catch(() => {});
  });
  await beat("s4-parse");

  // ── s5 — AI mapping: linger on the confidence + reason ───────────────────
  //   The AI suggestion rows are already on screen from s4; a gentle page-level
  //   scroll (can't hang) keeps them centered while the narration explains them.
  await soft("s5.ai", async () => {
    await page.evaluate(() => window.scrollTo({ top: 140, behavior: "smooth" })).catch(() => {});
    await page.waitForTimeout(1200);
  });
  await beat("s5-ai");

  // ── s6 — accept AI + commit + validate (all client-side) ─────────────────
  await soft("s6.acceptCommitValidate", async () => {
    await click(page.getByRole("button", { name: /accept all ai suggestions/i }), 600);
    await page.getByText(/4\s*\/\s*4 mapped|all lines mapped/i).waitFor({ timeout: 5_000 }).catch(() => {});
    const commit = page.getByRole("button", { name: /confirm mapping|continue to review/i });
    if (await commit.isVisible().catch(() => false)) {
      await Promise.all([
        page.waitForURL(/\/inbox\//i, { timeout: 15_000 }).catch(() => {}),
        commit.click().catch(() => {}),
      ]);
    }
    // Order detail is now showing — surface validation against the supplier profile.
    await page.getByRole("button", { name: /send to supplier/i }).first().waitFor({ timeout: 10_000 }).catch(() => {});
    await click(page.getByRole("button", { name: /validate against profile|^validate$/i }).first(), 600);
    await page.waitForTimeout(1200);
  });
  await beat("s6-validate");

  // ── s7 — SEND: confirm → Generating… → (delivered during the hold) ───────
  await soft("s7.send", async () => {
    // open the confirm
    await click(page.getByRole("button", { name: /^send to supplier$/i }).first());
    await page.locator("#confirm-check").waitFor({ timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(2600); // let the "Send order to supplier?" confirm be read
    await page.locator("#confirm-check").check().catch(() => {});
    await page.waitForTimeout(1000); // show the box checked
    // confirm — the last "send to supplier" control is the one inside the confirm panel
    await page.getByRole("button", { name: /send to supplier/i }).last().click().catch(() => {});
    // wait until the "Generating…" feedback appears, then mark (delivery completes
    // during the hold so the VO plays over the live send → delivered).
    await page.getByText(/generating the supplier-ready output|generating/i).waitFor({ timeout: 6_000 }).catch(() => {});
  });
  await beat("s7-deliver");

  // ── s8 — passport: delivered timeline + delivery attempt + response ──────
  await soft("s8.passport", async () => {
    // by now the order is delivered; open the Passport tab (client-side)
    const passport = page
      .getByRole("tab", { name: /passport/i })
      .or(page.getByRole("button", { name: /passport/i }))
      .or(page.getByText(/^passport$/i))
      .first();
    await passport.click().catch(() => {});
    await page.waitForTimeout(1200);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" })).catch(() => {});
  });
  await beat("s8-passport");

  mkdirSync(resolve(here, "out"), { recursive: true });
  writeFileSync(resolve(here, "out", "markers.json"), JSON.stringify(markers, null, 2), "utf8");
  console.log("[demo] markers:", JSON.stringify(markers));
});

async function dismissCookie(page: Page) {
  const dlg = page.getByRole("dialog", { name: /cookie/i });
  await dlg.waitFor({ state: "visible", timeout: 6_000 }).catch(() => {});
  for (const name of [/reject|decline|necessary only/i, /accept analytics|accept all|accept/i]) {
    const btn = page.getByRole("button", { name }).first();
    if (await btn.isVisible().catch(() => false)) {
      await btn.click().catch(() => {});
      break;
    }
  }
  await dlg.waitFor({ state: "hidden", timeout: 5_000 }).catch(() => {});
}
