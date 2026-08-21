import { test, expect, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

import { preparePage, settle, errorBoundaryMarker, DEV_OVERLAY_SELECTORS } from "./a11yHarness";

/**
 * axe-core over overlays in their OPEN state.
 *
 * WHY THIS FILE EXISTS. `a11y-axe.spec.ts` navigates to ten routes and scans what
 * renders. Every dialog in this product renders nothing until it is opened, so the
 * ten-screen sweep has only ever scanned these overlays CLOSED — which is to say it
 * has never scanned them at all. A dialog's accessibility defects (an unlabelled
 * dialog, a nested interactive control, text placed on a scrim-tinted panel that
 * fails contrast) exist only in the open state, and a green closed-state scan says
 * nothing whatsoever about them.
 *
 * That gap is not theoretical here. `LaneDrawer` shipped for months as a scrimmed
 * 400px panel of plain `<div>`s that no screen reader could identify as a dialog,
 * and it was fixed by a source-shape guard (`src/test/unmarked-modal.test.ts`),
 * never by the axe job — because the axe job could not see it.
 *
 * THE THREE. Chosen because each is a different opening mechanism, and because each
 * is a layer a keyboard or screen-reader user is *stuck inside* while it is up:
 *   • the app-shell mobile nav drawer — the only way to navigate below `md`
 *   • LaneDrawer — opened by clicking a wire on the dashboard's System map
 *   • the delete-supplier confirmation — a destructive confirm
 *
 * WHY THE SCAN IS SCOPED TO THE OVERLAY. `AxeBuilder.include()` narrows the scan to
 * the open layer's own subtree. Scanning the whole document instead would re-report
 * every violation the ten-screen sweep already ratchets on the page underneath, and
 * — for the mobile drawer — would report the dashboard at 390px wide, which is a
 * different question from "is this drawer accessible". A regression introduced in
 * the page behind an overlay belongs to that page's baseline, not to this file.
 *
 * WHAT THE FIRST RUN FOUND: nothing. All three overlays scan clean at WCAG 2.1
 * A/AA, and no product code was changed for this file. That is stated plainly
 * rather than dressed up, because the tempting alternative — inventing a fix to
 * justify the packet — is worse than a green scan. It is also not luck: both
 * `LaneDrawer` and the delete-supplier confirmation were marked up in recent
 * packets (`role=dialog` + `aria-modal` + `useDialogA11y`) after
 * `src/test/unmarked-modal.test.ts` caught them by source shape. This spec is the
 * runtime half of that work: the source guard proves a marking exists, and only an
 * open-state scan proves the marked-up layer is actually clean.
 *
 * WHY A HARD ZERO AND NOT A RATCHET. `a11y-baseline.json` holds debt that predates
 * that gate. These scans are new and start at zero, so there is no debt to record.
 * A hard zero is the strictest honest assertion and it cannot drift; if a future
 * finding genuinely cannot be fixed, it belongs in this file with a written reason,
 * not in a number.
 *
 * ANTI-VACUITY. The failure mode of a spec like this one is a selector that quietly
 * stops opening the overlay, leaving axe to scan a closed page and report zero. So
 * every case asserts, in order: the overlay is ABSENT before the open action, the
 * overlay is VISIBLE after it, its selector matches exactly ONE element, and the
 * visible overlay carries real text and real controls. A scan only runs once all
 * four hold. Checked by mutation: deleting the `trigger.click()` from the
 * delete-supplier case fails with "the overlay did not open" instead of passing a
 * scan of the closed page.
 */

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/** Floors on the opened layer itself, so an empty shell cannot pass as an overlay. */
const MIN_OVERLAY_TEXT_CHARS = 40;
const MIN_OVERLAY_CONTROLS = 2;

interface ViolationNode {
  rule: string;
  impact: string;
  help: string;
  target: string;
  summary: string;
}

function formatNodes(nodes: ViolationNode[]): string {
  return nodes
    .map(
      (n) =>
        `  [${n.impact}] ${n.rule} — ${n.help}\n` +
        `      at: ${n.target}\n` +
        `      ${n.summary.replace(/\n/g, "\n      ")}`,
    )
    .join("\n");
}

/** Navigate, and refuse to continue if the screen did not actually render. */
async function openScreen(page: Page, path: string): Promise<void> {
  const response = await page.goto(path);
  expect(
    response?.status(),
    `${path} did not serve a page — an overlay cannot be opened on an error page`,
  ).toBeLessThan(400);
  await settle(page);
  const boundary = await errorBoundaryMarker(page);
  expect(
    boundary,
    `${path} rendered an error boundary ("${boundary}"), not the screen. ` +
      "No overlay opened on a recovery panel is the overlay under test.",
  ).toBeNull();
}

/**
 * Assert the layer is genuinely open and substantial, then run axe inside it.
 *
 * `overlay` must resolve to exactly one element — a selector that matches the
 * closed-state placeholder as well as the open panel would defeat the point.
 */
async function scanOpenOverlay(
  page: Page,
  overlay: Locator,
  selector: string,
  label: string,
  testInfo: { attach: (name: string, o: { body: string; contentType: string }) => Promise<void> },
): Promise<void> {
  await expect(overlay, `${label}: the overlay did not open`).toBeVisible();
  expect(await overlay.count(), `${label}: "${selector}" matched more than one element`).toBe(1);

  const size = await overlay.evaluate((el) => ({
    text: (el as HTMLElement).innerText.trim().length,
    controls: el.querySelectorAll(
      'a[href], button, input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex^="-"])',
    ).length,
  }));
  expect(
    size.text,
    `${label}: the open overlay holds ${size.text} chars of text — the scan would be vacuous`,
  ).toBeGreaterThan(MIN_OVERLAY_TEXT_CHARS);
  expect(
    size.controls,
    `${label}: the open overlay holds ${size.controls} controls — did it finish rendering?`,
  ).toBeGreaterThanOrEqual(MIN_OVERLAY_CONTROLS);

  let builder = new AxeBuilder({ page }).withTags(AXE_TAGS).include(selector);
  for (const dev of DEV_OVERLAY_SELECTORS) builder = builder.exclude(dev);
  const results = await builder.analyze();

  const nodes: ViolationNode[] = results.violations.flatMap((v) =>
    v.nodes.map((n) => ({
      rule: v.id,
      impact: n.impact ?? v.impact ?? "n/a",
      help: v.help,
      target: n.target.join(" "),
      summary: n.failureSummary ?? "",
    })),
  );

  await testInfo.attach(`axe-open-${label}.txt`, {
    body:
      `${label} (OPEN) — ${nodes.length} violating node(s)\n` +
      `scanned subtree: ${selector}\n` +
      `text: ${size.text} chars · controls: ${size.controls}\n\n` +
      (nodes.length ? formatNodes(nodes) : "  (none)"),
    contentType: "text/plain",
  });

  expect(
    nodes.length ? `\n${formatNodes(nodes)}` : "",
    `${label}: WCAG 2.1 A/AA violations inside the OPEN overlay`,
  ).toBe("");
}

test.describe("axe-core — overlays in their open state", { tag: "@a11y" }, () => {
  test.describe.configure({ timeout: 120_000 });

  /**
   * The app-shell mobile drawer (`src/app/(app)/layout.tsx`, rendering
   * `BridgeSidebar` full-width). It is `md:hidden`, so it needs a narrow viewport:
   * at the suite's default 1280 the trigger is display:none and every click below
   * would time out — which is the honest failure, not a silent skip.
   */
  test.describe("mobile nav drawer", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test("the open mobile nav drawer has no WCAG A/AA violations", async ({ page }, testInfo) => {
      await preparePage(page);
      await openScreen(page, "/bridge");

      const drawer = page.locator('[role="dialog"][aria-label="Navigation"]');
      await expect(drawer, "the drawer was already open before it was opened").toHaveCount(0);

      await page.getByRole("button", { name: "Open navigation" }).click();
      await page.waitForTimeout(400);

      await scanOpenOverlay(
        page,
        drawer,
        '[role="dialog"][aria-label="Navigation"]',
        "mobile-nav-drawer",
        testInfo,
      );
    });
  });

  /**
   * LaneDrawer, reached by clicking a wire on the dashboard's "System map" tab.
   * The wire hit target is an SVG `<g>` on desktop and a card in the mobile lane
   * list; the desktop canvas is what the default viewport renders.
   */
  test("the open LaneDrawer has no WCAG A/AA violations", async ({ page }, testInfo) => {
    await preparePage(page);
    await openScreen(page, "/bridge");

    await page.getByRole("tab", { name: /System map/i }).click();
    await page.waitForTimeout(600);

    const map = page.locator('svg[aria-label="Order routing map"]');
    await expect(map, "the System map canvas never rendered — no wire to click").toBeVisible();

    const opened = page.locator('[role="dialog"][aria-modal="true"]');
    await expect(opened, "a modal dialog was open before any wire was clicked").toHaveCount(0);

    const wire = map.locator("g[style*='cursor']").first();
    await expect(wire, "the topology drew no clickable wire").toBeVisible();
    await wire.click({ force: true });
    await page.waitForTimeout(600);

    await scanOpenOverlay(
      page,
      opened,
      '[role="dialog"][aria-modal="true"]',
      "lane-drawer",
      testInfo,
    );
  });

  /**
   * The delete-supplier confirmation on `/library/suppliers/[id]`. That route is
   * deliberately absent from CORE_SCREENS (see coreScreens.ts), so neither this
   * dialog nor the screen behind it has ever been scanned.
   */
  test("the open delete-supplier confirmation has no WCAG A/AA violations", async ({
    page,
  }, testInfo) => {
    await preparePage(page);
    await openScreen(page, "/library/suppliers/11111111-1111-1111-1111-111111111111");

    const trigger = page.getByRole("button", { name: /^Delete supplier$/i });
    await expect(trigger, "the delete control is missing — the mock supplier did not load").toBeVisible();

    const confirm = page.locator('[role="dialog"][aria-modal="true"]');
    await expect(confirm, "the confirmation was open before Delete was clicked").toHaveCount(0);

    await trigger.click();
    await page.waitForTimeout(400);

    await scanOpenOverlay(
      page,
      confirm,
      '[role="dialog"][aria-modal="true"]',
      "delete-supplier-confirm",
      testInfo,
    );
  });
});
