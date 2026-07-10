import { test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DemoCursor, MarkerClock, holdBudgets, loadToolSpec, prepareDemoPage, soft } from "./demo-helpers";

/**
 * SETUP-GUIDE capture — "Email polling" (/settings?tab=email).
 *
 * Card + paid-plan notice → host/port/SSL → username + app password (the
 * Gmail/Outlook app-password helper is the on-camera anchor) → folder +
 * default supplier (native select → selectOption; the popup never renders in
 * headless) → what-gets-picked-up helper line + Save RESTED ON (no mock twin
 * for updateEmailSettings) → last-poll footer + the toggle (disabled on the
 * Pilot mock plan; never clicked).
 *
 * Honesty notes: the help article's "alert on Settings → Email polling and
 * polling pauses" claim has NO backend surface (only LastPolledAt exists) —
 * the VO instead teaches the verified check: watch the last-poll time and
 * re-check host/app-password if it isn't moving.
 *
 *   bun run demo:tools:capture capture-email-polling
 */

const here = dirname(fileURLToPath(import.meta.url));
const spec = loadToolSpec("email-polling");
const holds = holdBudgets(spec);

test("tool capture: email-polling", async ({ page }) => {
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

  const host = () => page.getByPlaceholder(/imap\.company\.com/i).first();

  // ── open — deep-link straight onto the Email intake tab ──────────────────
  await soft("open", async () => {
    await page.goto(spec.route, { waitUntil: "domcontentloaded" });
    await host().waitFor({ timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(900);
  });

  // ── b1 — the card: title, 5-minute cadence, plan notice ──────────────────
  await beat("b1-open", async () => {
    await cursor.glideTo(page.getByText(/^email intake$/i).first(), 1000);
    await page.waitForTimeout(1100);
    await cursor.glideTo(page.getByText(/imap polling every 5 minutes/i).first(), 800);
    await page.waitForTimeout(1100);
    await cursor.glideTo(page.getByText(/included on every paid plan/i).first(), 900);
  });

  // ── b2 — host / port / SSL ────────────────────────────────────────────────
  await beat("b2-conn", async () => {
    await cursor.click(host(), 900);
    await page.keyboard.type("imap.nordic-electronics.example", { delay: 38 });
    await page.waitForTimeout(500);
    await cursor.glideTo(page.getByText(/^port$/i).first(), 700); // 993 stays
    await page.waitForTimeout(700);
    await cursor.glideTo(page.getByText(/^SSL$/).first(), 700);
  });

  // ── b3 — credentials: app password + encrypted at rest ───────────────────
  await beat("b3-creds", async () => {
    await cursor.click(page.getByPlaceholder(/orders@company\.com/i).first(), 800);
    await page.keyboard.type("po-inbox@nordic-electronics.example", { delay: 34 });
    await page.waitForTimeout(400);
    await cursor.click(page.getByPlaceholder(/app password/i).first(), 700);
    await page.keyboard.type("demo-not-a-real-secret", { delay: 40 }); // renders as dots
    await page.waitForTimeout(500);
    await cursor.glideTo(page.getByText(/app-specific password/i).first(), 900);
  });

  // ── b4 — folder + default supplier ────────────────────────────────────────
  await beat("b4-folder-supplier", async () => {
    await cursor.glideTo(page.getByText(/^folder$/i).first(), 800);
    await page.waitForTimeout(900);
    const supplier = page.locator("select").first(); // the only select on this tab
    await cursor.glideTo(supplier, 800);
    await page.waitForTimeout(600);
    await supplier.selectOption({ label: "ElectroSupply Co" }).catch(() => {});
    await page.waitForTimeout(600);
    await cursor.glideTo(page.getByText(/^default supplier/i).first(), 700);
  });

  // ── b5 — what gets picked up; Save rested on ─────────────────────────────
  await beat("b5-what", async () => {
    await cursor.glideTo(page.getByText(/unseen messages with csv/i).first(), 900);
    await page.waitForTimeout(1600);
    await cursor.glideTo(page.getByRole("button", { name: /save email/i }).first(), 1000); // never clicked
  });

  // ── b6 — the last-poll footer + the (disabled) toggle ────────────────────
  await beat("b6-lastpoll", async () => {
    await cursor.glideTo(page.getByText(/last poll: not run yet/i).first(), 900);
    await page.waitForTimeout(1600);
    await cursor.glideTo(page.getByRole("switch", { name: /poll inbox for orders/i }).first(), 1000); // rested on, never clicked
  });

  clock.save(spec.id);
  const dest = resolve(here, "out", spec.id, "capture.webm");
  mkdirSync(dirname(dest), { recursive: true });
  await page.close();
  await page.video()?.saveAs(dest);
  console.log(`[tool-demo] footage → ${dest}`);
});
