import { test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DemoCursor, MarkerClock, holdBudgets, loadToolSpec, prepareDemoPage, soft } from "./demo-helpers";

/**
 * PER-TOOL capture — "Dashboard" (/bridge).
 *
 * Live topology → time windows → KPI strip → supplier health → the
 * Review-exceptions jump (client-side nav to /operations/exceptions).
 * ONE page load; everything after is client-side. Fail-soft footage.
 *
 *   bun run demo:tools:capture capture-dashboard
 */

const here = dirname(fileURLToPath(import.meta.url));
const spec = loadToolSpec("dashboard");
const holds = holdBudgets(spec);

test("tool capture: dashboard", async ({ page }) => {
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

  // ── b1 — land on the dashboard ────────────────────────────────────────────
  await soft("open", async () => {
    await page.goto(spec.route, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: /^dashboard$/i }).first().waitFor({ timeout: 15_000 }).catch(() => {});
  });
  await beat("b1-open", async () => {
    await cursor.glideTo(page.getByRole("heading", { name: /^dashboard$/i }).first(), 900);
  });

  // ── b2 — trace the live topology ──────────────────────────────────────────
  await beat("b2-topology", async () => {
    const topo = page.locator('section[aria-label="Order topology"]');
    await cursor.glideTo(topo.getByText(/heinrich/i).first(), 900);
    await page.waitForTimeout(900);
    await cursor.glideTo(topo.getByText(/boltworks/i).first(), 1400);
    await page.waitForTimeout(900);
    // rest near the amber at-risk route (Nordix)
    await cursor.glideTo(topo.getByText(/nordix/i).first(), 1100);
  });

  // ── b3 — time windows: click "All" ────────────────────────────────────────
  await beat("b3-windows", async () => {
    const windows = page.getByRole("group", { name: /time window/i });
    await cursor.glideTo(windows, 900);
    await page.waitForTimeout(600);
    await cursor.click(windows.getByRole("button", { name: "All", exact: true }), 500);
  });

  // ── b4 — scroll to the KPI strip ──────────────────────────────────────────
  await beat("b4-kpis", async () => {
    await page.mouse.wheel(0, 950);
    await page.waitForTimeout(900);
    await cursor.glideTo(page.getByText(/orders received/i).first(), 800);
    await page.waitForTimeout(800);
    await cursor.glideTo(page.getByText(/orders delivered/i).first(), 700);
    await page.waitForTimeout(800);
    await cursor.glideTo(page.getByText(/urgent exceptions/i).first(), 700);
    await page.waitForTimeout(700);
    await cursor.glideTo(page.getByText(/auto-processed/i).first(), 700);
  });

  // ── b5 — supplier health + in transit ─────────────────────────────────────
  await beat("b5-health", async () => {
    await cursor.glideTo(page.getByText(/supplier health/i).first(), 900);
    await page.waitForTimeout(1200);
    // .last() — the health-list row, NOT the topology node of the same name
    await cursor.glideTo(page.getByText(/medicasupply/i).last(), 900);
    await page.waitForTimeout(1200);
    await cursor.glideTo(page.getByText(/in transit/i).first(), 900);
  });

  // ── b6 — the exceptions jump (banner → /operations/exceptions) ────────────
  await beat("b6-exceptions", async () => {
    await page.mouse.wheel(0, -1400);
    await page.waitForTimeout(800);
    await cursor.click(page.getByText(/review exceptions/i).first(), 1000);
    await page.waitForURL(/\/operations\/exceptions/i, { timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(800);
    await cursor.glideToPoint(960, 480, 800);
  });

  clock.save(spec.id);
  const dest = resolve(here, "out", spec.id, "capture.webm");
  mkdirSync(dirname(dest), { recursive: true });
  await page.close();
  await page.video()?.saveAs(dest);
  console.log(`[tool-demo] footage → ${dest}`);
});
