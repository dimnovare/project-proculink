import { test, expect, type Page, type Locator } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sweepRoutes } from "./sweepRoutes";

/**
 * THE CLICK PASS — press every button on every route, at three widths.
 *
 * WHY THIS IS SEPARATE FROM control-sweep.spec.ts. That file ENUMERATES: it reads
 * every control's name and box without touching anything, which is fast and safe
 * and answers "does this control exist and is it reachable". It cannot answer the
 * question that actually gets asked — "does the button DO anything" — and in this
 * repo that is not a rhetorical question. Group I passes 6, 7 and 9 exist because
 * connector, webhook, mapping, rule and template buttons were opening nothing, or
 * closing silently, and each was found by a human clicking.
 *
 * WHAT COUNTS AS A FINDING. A click is DEAD when, within the settle window,
 * nothing observable happened: no DOM mutation, no URL change, no network
 * request, no scroll.
 *
 * A FILE CHOOSER counts too, and it is the fifth signal for the same reason the
 * fourth exists. `Upload invoice` on /inbound/invoices calls
 * `fileInputRef.current?.click()`, which opens the operating system's file
 * picker: no DOM mutation, no navigation, no request, no scroll. It read as dead
 * at two of three widths, and it works.
 *
 * A dead click is a LEAD, not a verdict, and it is reported rather than asserted.
 * A toggle that re-renders to an identical tree is legitimately silent, and so is
 * a control whose only effect is outside anything a page can observe. What IS
 * asserted is the pair that cannot be defended: a click that throws, and a click
 * that logs a console error.
 *
 * WHAT IS NOT CLICKED, and why each one:
 *
 *  • Links. `link-crawl.spec.ts` already resolves every href, and following them
 *    here would turn one route's pass into a walk of the whole app.
 *  • Anything matching DESTRUCTIVE. Sign-out ends the session for every
 *    subsequent route; delete/remove/revoke destroy the fixture the rest of the
 *    run depends on. In mock mode the data is in-memory so nothing real is lost,
 *    but the run after it would be measuring a different app.
 *  • Disabled controls. Clicking one is expected to do nothing; reporting that as
 *    a dead click would bury the real ones.
 *
 * ORDER DEPENDENCE IS REAL, AND THE FIRST VERSION OF THIS FILE GOT IT WRONG.
 *
 * That version re-read the control list before each click and reloaded only when
 * the URL moved. It reported 205 "threw" results out of 330 — every one a
 * 3-second click timeout — and not one of them was an app defect. The first
 * control on nearly every route is the topbar's "Open navigation", which opens
 * the mobile drawer: a modal with a focus trap and a scroll lock. Nothing behind
 * it is clickable, the run never closed it, and every remaining control on that
 * route timed out against an overlay.
 *
 * It is worth naming what that near-miss looked like: a run that had exercised
 * almost nothing, reporting 205 failures that a hurried reader would have taken
 * for 205 broken buttons.
 *
 * So the page is now RELOADED BEFORE EVERY CLICK. Slower, and deliberately so:
 * each control is pressed against the route's initial state, no click can inherit
 * an overlay, a scroll position or a filter from the one before it, and a failure
 * means something about that control rather than about click number seven.
 *
 * THE COST, STATED. A control that only appears AFTER another click — the field
 * inside a panel the panel-opening button reveals — is never pressed here. That
 * is a real coverage boundary, not an oversight, and closing it needs per-flow
 * specs (tests/e2e/upload-to-workshop.spec.ts is the shape) rather than a sweep.
 */

const OUT_DIR = join(process.cwd(), ".qa-sweep");

/**
 * Controls whose effect outlives the click. Matched against the accessible name,
 * case-insensitively.
 *
 * Deliberately broad. A false skip costs one control's coverage and is printed in
 * the report; a false CLICK on "Sign out" costs every route after it and reports
 * nothing about why.
 */
const DESTRUCTIVE =
  /sign out|log ?out|delete|remove|revoke|disconnect|cancel subscription|erase|reset|clear all|unsubscribe|deactivate/i;

/**
 * Chrome injected by the dev server, not by this app. The first run reported
 * "Open Next.js Dev Tools" as a dead click on three routes, which is true and
 * completely uninteresting.
 */
const NOT_OURS = /Next\.js Dev Tools|Next\.js logo|route announcer/i;

/**
 * Settle window after a click, in ms.
 *
 * 400 was enough for a state update to paint and NOT enough for a
 * `scrollIntoView({ behavior: "smooth" })` to travel far enough to register —
 * which is the third way the same "Jump to blockers" control nearly got reported
 * as broken. 900 covers a smooth scroll across a full page.
 */
const SETTLE_MS = 900;

interface ClickResult {
  route: string;
  name: string;
  index: number;
  outcome:
    | "changed"
    | "navigated"
    | "dead"
    | "threw"
    | "unclickable"
    | "already-active"
    | "skipped-destructive"
    | "vanished";
  detail?: string;
  consoleErrors: string[];
}

/**
 * Press one control and report what observably happened.
 *
 * The signals are deliberately different in kind — a DOM mutation, a URL change,
 * a network request, and a SCROLL — because a button can legitimately do exactly
 * one of them. Requiring all of them would flag every working button; requiring a
 * DOM mutation alone would flag every button whose only job is to fetch.
 *
 * Scroll is the fourth because the first run without it called the dashboard's
 * "Jump to blockers" link dead. That link works: it scrolls. It mutates nothing,
 * navigates nowhere and fetches nothing, so three signals could not see it, and
 * a report calling a working control broken is worse than no report.
 *
 * And `window.scrollY` was the WRONG WAY to measure it, which is the second
 * near-miss on the same control. This app shell scrolls an inner container, not
 * the document — `scrollY` is 0 on every app route no matter what moves — so the
 * scroll signal was armed and blind, and "Jump to blockers" was still going to be
 * reported as a broken founder-approved feature. `scrollFingerprint` therefore
 * sums scrollTop/scrollLeft across EVERY scrollable element on the page.
 */
/**
 * Total scroll offset across the whole page, document AND inner containers.
 *
 * `window.scrollY` alone is useless here: every app route puts its content in a
 * `min-h-0 flex-1` shell whose child scrolls, so the document itself never moves.
 * Summing is enough — the value only has to CHANGE, it does not have to identify
 * which container moved.
 */
async function scrollFingerprint(page: Page): Promise<number> {
  return page
    .evaluate(() => {
      let total = window.scrollY + window.scrollX;
      for (const el of Array.from(document.querySelectorAll("*"))) {
        const e = el as HTMLElement;
        if (e.scrollHeight > e.clientHeight || e.scrollWidth > e.clientWidth) {
          total += e.scrollTop + e.scrollLeft;
        }
      }
      return total;
    })
    .catch(() => 0);
}

async function clickAndObserve(page: Page, control: Locator): Promise<{ outcome: ClickResult["outcome"]; detail?: string }> {
  const before = page.url();
  const scrollBefore = await scrollFingerprint(page);

  // Arm a MutationObserver BEFORE the click. Reading innerHTML before and after
  // instead would miss a change that reverts inside the settle window, and would
  // compare two multi-megabyte strings on every one of a thousand clicks.
  await page.evaluate(() => {
    const w = window as unknown as { __sweepMutated?: boolean; __sweepObserver?: MutationObserver };
    w.__sweepMutated = false;
    w.__sweepObserver?.disconnect();
    const observer = new MutationObserver(() => {
      w.__sweepMutated = true;
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    w.__sweepObserver = observer;
  });

  let requests = 0;
  const countRequest = () => {
    requests += 1;
  };
  page.on("request", countRequest);

  // A file chooser must be consumed or it blocks the page. Listening for it both
  // records the signal and dismisses it.
  let openedFileChooser = false;
  const onFileChooser = () => {
    openedFileChooser = true;
  };
  page.on("filechooser", onFileChooser);

  try {
    await control.click({ timeout: 3_000, noWaitAfter: true });
  } catch (error) {
    page.off("request", countRequest);
    page.off("filechooser", onFileChooser);
    const message = String(error);
    // A control that left the DOM between being listed and being clicked is a
    // consequence of the previous click, not a defect in this one.
    if (/not attached|not visible|element is not stable/i.test(message)) {
      return { outcome: "vanished", detail: message.slice(0, 120) };
    }
    // A click timeout on a FRESH page means the control genuinely cannot be
    // pressed — covered by something, zero-sized, or outside the viewport with
    // no way to scroll to it. That is a real finding, and a different one from
    // a handler that threw, so it is not folded into "threw".
    if (/Timeout .* exceeded/i.test(message)) {
      return { outcome: "unclickable", detail: message.split("\n")[0].slice(0, 160) };
    }
    return { outcome: "threw", detail: message.slice(0, 200) };
  }

  await page.waitForTimeout(SETTLE_MS);
  page.off("request", countRequest);
  page.off("filechooser", onFileChooser);

  if (openedFileChooser) return { outcome: "changed", detail: "opened a file chooser" };

  if (page.url() !== before) return { outcome: "navigated", detail: page.url() };

  const mutated = await page
    .evaluate(() => (window as unknown as { __sweepMutated?: boolean }).__sweepMutated === true)
    .catch(() => false);

  if (mutated) return { outcome: "changed" };
  if (requests > 0) return { outcome: "changed", detail: `${requests} request(s), no DOM change` };

  const scrollAfter = await scrollFingerprint(page);
  if (Math.abs(scrollAfter - scrollBefore) > 4) {
    return { outcome: "changed", detail: `scrolled ${Math.round(scrollAfter - scrollBefore)}px` };
  }

  return { outcome: "dead" };
}

const { routes } = sweepRoutes();

test.describe("control click pass", () => {
  for (const route of routes) {
    test(`${route.path}`, async ({ page }, testInfo) => {
      // Generous, because reload-before-every-click is the point: a route with 40
      // controls costs 40 page loads, and /inbox has more than that.
      testInfo.setTimeout(420_000);

      const consoleErrors: string[] = [];
      page.on("console", (m) => {
        if (m.type() !== "error") return;
        const t = m.text();
        if (/favicon|\[Fast Refresh\]|React DevTools|ERR_CONNECTION_REFUSED|Failed to fetch/.test(t)) return;
        consoleErrors.push(t);
      });

      const results: ClickResult[] = [];

      await page.goto(route.path, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

      // Buttons only — see the header for why links are out of scope.
      const selector = 'button:not([disabled]), [role="button"]:not([aria-disabled="true"]), [role="tab"], [role="switch"]';
      const total = await page.locator(selector).count();

      for (let index = 0; index < total; index += 1) {
        // Fresh page for every control — see the header. The list is re-read
        // after the reload rather than reused, because a reload can legitimately
        // produce a different count (a query that resolved, a banner that
        // dismissed itself) and indexing a stale list would press the wrong
        // control while reporting the old one's name.
        if (index > 0) {
          await page.goto(route.path, { waitUntil: "domcontentloaded" });
          await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
        }

        const live = page.locator(selector);
        if (index >= (await live.count())) break;

        const control = live.nth(index);
        const name = ((await control.textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim()
          || (await control.getAttribute("aria-label").catch(() => ""))
          || "(unnamed)";

        if (NOT_OURS.test(name)) continue;

        // A tab or filter chip that is ALREADY the current selection is supposed
        // to do nothing when pressed. Recording it as a dead click would put
        // "Pipeline" and the already-active date range in the same bucket as a
        // handler that was never wired — which is exactly what the first run did
        // on /bridge, two false positives out of three.
        const selected = await control.evaluate((el) => {
          const aria = el.getAttribute("aria-selected") === "true"
            || el.getAttribute("aria-current") === "true"
            || el.getAttribute("aria-current") === "page"
            || el.getAttribute("aria-pressed") === "true"
            || el.getAttribute("data-state") === "active";
          return aria;
        }).catch(() => false);
        if (selected) {
          results.push({ route: route.path, name: name.slice(0, 60), index, outcome: "already-active", consoleErrors: [] });
          continue;
        }
        if (DESTRUCTIVE.test(name)) {
          results.push({ route: route.path, name, index, outcome: "skipped-destructive", consoleErrors: [] });
          continue;
        }
        if (!(await control.isVisible().catch(() => false))) continue;

        const errorsBefore = consoleErrors.length;
        const { outcome, detail } = await clickAndObserve(page, control);
        results.push({
          route: route.path,
          name: name.slice(0, 60),
          index,
          outcome,
          detail,
          consoleErrors: consoleErrors.slice(errorsBefore),
        });

      }

      mkdirSync(join(OUT_DIR, `${testInfo.project.name}-clicks`), { recursive: true });
      writeFileSync(
        join(OUT_DIR, `${testInfo.project.name}-clicks`, `${route.pattern.replace(/\W+/g, "_") || "root"}.json`),
        JSON.stringify({ route: route.path, clicked: results.length, results }, null, 2),
      );

      // ── The two that cannot be defended ──────────────────────────────────────
      // Dead clicks are reported, not asserted: a control that re-renders to an
      // identical tree is legitimately silent, and failing on those would make
      // this file noise inside a week.
      const threw = results.filter((r) => r.outcome === "threw");
      expect.soft(threw, `${route.path}: a click threw`).toEqual([]);
      expect.soft(consoleErrors, `${route.path}: a click logged console errors`).toEqual([]);
    });
  }
});
