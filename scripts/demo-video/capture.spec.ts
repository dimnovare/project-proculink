import { test, type Page } from "@playwright/test";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * ProcuLink walkthrough CAPTURE script (not a test).
 *
 * ── v13 (2026-06-13): faithful re-capture of the v5/v6 recipe on TODAY's UI. ──
 * Same six VO scenes, same scene order, same per-scene holds (scenes.json), same
 * cursor discipline as v5/v6 — the ONLY changes vs the original are the
 * selectors / routes / waits, because the review screen, upload, suppliers etc.
 * changed since June. Nothing about the choreography, pacing, or narration sync
 * was altered. Cursor style preserved verbatim from v6: the camera never pans a
 * page (no window.scrollTo); where a control is off-screen we use
 * element-targeted scrollIntoViewIfNeeded() ("element focus"), and there is NO
 * synthetic/drifting cursor.
 *
 * Drives the REAL ProcuLink frontend through ONE order, end to end, and lets
 * Playwright record the screen. MOCK mode (set by playwright.demo.config.ts) so
 * the footage is deterministic and needs no backend.
 *
 * KEY: mock state lives in an in-memory array, so a full page reload RESETS it.
 * There are exactly TWO loads (/upload, then the seeded order's preview); after
 * that EVERYTHING is client-side navigation (button clicks) — no page.goto — so
 * accept → commit → validate → send → delivered stays consistent and the order
 * actually reaches `delivered`.
 *
 * Flow (order ord-002 / PO-2024-005678, Nordic Electronics → ElectroSupply Co):
 *   /upload (empty drop zone → file arrives + format detect) → preview (parsed
 *   + AI mapping; accept each suggestion) → commit → order review (acceptance
 *   rules checked) → SEND (Generating… → Sent → Delivered) → Passport (audit + 200).
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

const SAMPLE_CSV =
  "po_number,buyer_name,line_no,item_code,description,quantity,unit_price,currency\n" +
  "PO-2024-005678,Nordic Electronics,1,TB-CAP-100,Capacitor 100µF,200,0.35,EUR\n" +
  "PO-2024-005678,Nordic Electronics,2,TB-RES-220,Resistor 220Ω,500,0.02,EUR\n" +
  "PO-2024-005678,Nordic Electronics,3,TB-WIRE-22,Wire 22AWG Black 100m,5,12.50,EUR\n";

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
  const mark = (id: string) => {
    markers[id] = (Date.now() - t0) / 1000;
    console.log(`[demo] ${id} @ ${markers[id].toFixed(1)}s`);
  };
  const beat = async (id: string) => {
    mark(id);
    await page.waitForTimeout(holdOf(id));
  };
  const click = async (loc: ReturnType<Page["getByRole"]>, ms = 0) => {
    if (await loc.isVisible().catch(() => false)) {
      if (ms) await page.waitForTimeout(ms);
      await loc.scrollIntoViewIfNeeded().catch(() => {});
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

  // ── s1 — intake: open /upload on the empty drop zone, then the file "arrives"
  //   (chip + format-detect pill) on camera while the VO explains intake. ─────
  await soft("s1.open", async () => {
    await page.goto("/upload", { waitUntil: "networkidle" });
    await dismissCookie(page);
  });
  mark("s1-intake");
  await page.waitForTimeout(1800); // show the empty upload drop zone first
  await soft("s1.drop", async () => {
    await page.setInputFiles('input[type="file"]', {
      name: "PO-2024-005678.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(SAMPLE_CSV),
    });
  });
  // dwell on the file chip + "Detected: CSV" pill for the rest of the hold.
  await page.waitForTimeout(Math.max(2500, holdOf("s1-intake") - 1800));

  // ── s2 — parse / review: parsed order, source→canonical→supplier ──────────
  //   This is the ONLY load after s1. From here everything is client-side.
  await soft("s2.preview", async () => {
    await page.goto("/inbox/ord-002", { waitUntil: "networkidle" });
    await page.getByText(/PO-2024-005678/).first().waitFor({ timeout: 15_000 }).catch(() => {});
  });
  await beat("s2-parse");

  // ── s3 — AI mapping: focus the AI suggestion, then accept each suggested
  //   code one by one (visible state change) before committing. ──────────────
  await soft("s3.focus", async () => {
    await page
      .getByText(/\b\d{2}\s*%/)
      .or(page.getByText(/suggest|confidence/i))
      .first()
      .scrollIntoViewIfNeeded()
      .catch(() => {});
  });
  mark("s3-ai");
  await page.waitForTimeout(5200); // VO explains the AI suggestion + confidence
  await soft("s3.acceptEach", async () => {
    // Per-row "Accept" buttons only (name is exactly "Accept", so the regex
    // anchors exclude the "Accept all AI suggestions" control).
    for (let i = 0; i < 2; i++) {
      const accept = page.getByRole("button", { name: /^accept$/i }).first();
      if (await accept.isVisible().catch(() => false)) {
        await accept.scrollIntoViewIfNeeded().catch(() => {});
        await accept.click().catch(() => {});
        await page.waitForTimeout(1600); // row resolves — visible motion
      }
    }
  });
  await soft("s3.acceptAllFallback", async () => {
    // Belt-and-suspenders: clear any suggestion a per-row click missed.
    await click(page.getByRole("button", { name: /accept all ai suggestions/i }));
    await page.getByText(/4\s*\/\s*4 mapped|all lines mapped/i).waitFor({ timeout: 4_000 }).catch(() => {});
  });
  await page.waitForTimeout(1200); // show all lines mapped
  await soft("s3.commit", async () => {
    const commit = page.getByRole("button", { name: /confirm mapping|continue to review/i });
    if (await commit.isVisible().catch(() => false)) {
      await Promise.all([
        page.waitForURL(/\/inbox\//i, { timeout: 15_000 }).catch(() => {}),
        commit.click().catch(() => {}),
      ]);
    }
  });

  // ── s4 — validate: the order review screen, where the order is checked
  //   against the supplier's acceptance rules before it can be sent. The
  //   standalone "Validate against profile" button was folded into automatic,
  //   debounced revalidation on this screen (today's UI), so instead of
  //   clicking a now-absent control we wait for the review to settle and dwell
  //   on the all-clear / send-readiness state while the VO explains the check.
  //   Same scene PURPOSE, ORDER and HOLD as v5/v6. ───────────────────────────
  await soft("s4.review", async () => {
    // The send CTA ("Send to supplier") only enables once the order passes the
    // acceptance check (exceptionCount === 0) — its presence is our proof the
    // order was checked against the supplier's rules.
    await page.getByRole("button", { name: /send to supplier/i }).first().waitFor({ timeout: 12_000 }).catch(() => {});
    // Bring the send-readiness / acceptance summary into view (element focus,
    // not a page pan) so the "checked against their rules" state is on camera.
    await page
      .getByText(/acceptance|exception|ready|checks out|no exceptions/i)
      .first()
      .scrollIntoViewIfNeeded()
      .catch(() => {});
    await page.waitForTimeout(1200);
  });
  await beat("s4-validate");

  // ── s5 — deliver: send → confirm → Generating… → (delivered during hold) ──
  await soft("s5.send", async () => {
    // Open the confirm dialog from the primary send CTA.
    await click(page.getByRole("button", { name: /^send to supplier$/i }).first());
    await page.locator("#confirm-check").waitFor({ timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(2400); // let the "Send order to supplier?" confirm be read
    await page.locator("#confirm-check").check().catch(() => {});
    await page.waitForTimeout(900); // show the box checked
    // Confirm — the LAST "send to supplier" control is the one inside the
    // confirm panel ("Send to supplier →").
    await page.getByRole("button", { name: /send to supplier/i }).last().click().catch(() => {});
    // Wait until the "Generating…" feedback appears, then mark (delivery
    // completes during the hold so the VO plays over the live send → delivered).
    await page.getByText(/generating/i).waitFor({ timeout: 8_000 }).catch(() => {});
  });
  await beat("s5-deliver");

  // ── s6 — audit: delivered timeline + delivery attempt + supplier output ───
  await soft("s6.passport", async () => {
    // by now the order is delivered; open the Passport tab (client-side)
    const passport = page
      .getByRole("tab", { name: /passport/i })
      .or(page.getByRole("button", { name: /passport/i }))
      .or(page.getByText(/^passport$/i))
      .first();
    await passport.click().catch(() => {});
    await page.waitForTimeout(1400);
  });
  await beat("s6-audit");

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
