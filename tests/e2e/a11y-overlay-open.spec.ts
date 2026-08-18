import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

import { preparePage, settle, DEV_OVERLAY_SELECTORS } from "./a11yHarness";

/**
 * The state `a11y-axe.spec.ts` cannot reach: an overlay that is OPEN.
 *
 * That gate visits ten routes, settles them and scans. Every overlay in this
 * product renders behind an `open` flag, so at scan time none of them is in the
 * DOM — the marketing mobile menu, the app shell drawer, LaneDrawer, the
 * delete-supplier confirmation. Ten green screens, and not one of them had ever
 * had an overlay scanned inside it. The baseline file says `{}` for `landing`
 * and `pricing`, and that was true and also silent about the sheet.
 *
 * WHY THAT PARTICULAR HOLE IS WORTH A FILE. #221 shipped an a11y regression that
 * took one screen from 1 violation to 55, all `nested-interactive`, by making a
 * container interactive while it still held focusable children. That rule can
 * only fire where an interactive ancestor and focusable descendants coexist —
 * which, for every overlay here, is a state that exists ONLY while it is open.
 * Then #224, #226 and #228 each added `role="dialog"` + `aria-modal` to a
 * container full of links and buttons: three consecutive commits writing the
 * exact precondition, into the exact blind spot.
 *
 * SCOPE. The marketing mobile menu only. It is public, unauthenticated, stable,
 * and it is the overlay whose fix (#228) was merged with no browser-level proof
 * at all — its own tests are jsdom. The other three overlays deserve the same
 * treatment and do not have it; that is named here rather than quietly implied,
 * and it is not this file's job.
 *
 * WHAT THIS ADDS OVER `MarketingNav.a11y.test.tsx`, which already checks focus
 * move-in, Escape, focus restore and Tab cycling: that file runs in jsdom, where
 * no Tailwind is applied. `sm:hidden` is inert there, so BOTH breakpoint trees
 * mount and the sheet is "present" at every width. jsdom cannot tell you the
 * sheet is really hidden at 640px+, cannot tell you the scrim really covers the
 * page, and cannot run axe against rendered geometry. The last case below is the
 * one a unit test structurally cannot own.
 */

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/** iPhone 12/13/14 logical width — the narrow viewport the visual gate uses. */
const PHONE = { width: 390, height: 844 };

/** The sheet, addressed by its accessible name. */
const SHEET = { role: "dialog" as const, name: "Menu" };

/**
 * The cookie banner is ALSO `role="dialog"` (non-modal, `aria-label="Cookie
 * consent"`), so an unnamed `getByRole("dialog")` resolves to two elements here
 * and fails strict mode. Naming it is not a style preference — it is what makes
 * these locators address the sheet at all.
 */

/** Every focusable descendant, by the same selector `useDialogA11y` traps on. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), ' +
  'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

test.describe("the marketing mobile menu, scanned while it is open @a11y", () => {
  // `next dev` compiles the marketing routes on first hit.
  test.describe.configure({ timeout: 120_000 });

  for (const path of ["/", "/pricing"]) {
    test(`${path} — axe finds nothing wrong with the open sheet`, async ({ page }, testInfo) => {
      await preparePage(page);
      await page.setViewportSize(PHONE);

      const response = await page.goto(path);
      expect(
        response?.status(),
        `${path} did not serve a page — scanning an error page proves nothing`,
      ).toBeLessThan(400);
      await settle(page);

      // Open it the way a user does, from the real trigger.
      const burger = page.getByRole("button", { name: "Menu", exact: true });
      await expect(
        burger,
        `the hamburger is not visible at ${PHONE.width}px — the sheet can never open, and every ` +
          "assertion below would be vacuous",
      ).toBeVisible();
      await burger.click();

      const sheet = page.getByRole(SHEET.role, { name: SHEET.name });
      await expect(sheet, "the sheet did not open").toBeVisible();

      // ANTI-VACUITY 1: the sheet must actually hold focusable content. An empty
      // container has no `nested-interactive` to find, and would report zero
      // violations forever while looking exactly like this passing run.
      const stops = await sheet.locator(FOCUSABLE).count();
      expect(
        stops,
        "the open sheet contains no focusable descendants — with nothing to nest, a " +
          "`nested-interactive` scan of it cannot fail and this gate is decoration",
      ).toBeGreaterThan(1);

      // ANTI-VACUITY 2: scope a scan INSIDE the sheet. If `#marketing-mobile-menu`
      // stopped existing, axe would error rather than quietly scan nothing, and
      // `passes` proves rules were really evaluated against those nodes.
      let scoped = new AxeBuilder({ page }).withTags(AXE_TAGS).include("#marketing-mobile-menu");
      for (const selector of DEV_OVERLAY_SELECTORS) scoped = scoped.exclude(selector);
      const inside = await scoped.analyze();
      expect(
        inside.passes.length,
        "axe evaluated no rules inside the sheet — the include selector matched nothing",
      ).toBeGreaterThan(0);

      // The whole page, with the sheet up. Scoping alone would miss what the
      // overlay does TO the page behind it — `aria-modal` on a container that is
      // itself inside a landmark, a scrim that hides the document from AT.
      let full = new AxeBuilder({ page }).withTags(AXE_TAGS);
      for (const selector of DEV_OVERLAY_SELECTORS) full = full.exclude(selector);
      const results = await full.analyze();

      const report = results.violations
        .map((v) => `${v.id} (${v.impact}) × ${v.nodes.length}\n  ${v.nodes.map((n) => n.target.join(" ")).join("\n  ")}`)
        .join("\n\n");
      // Attached pass or fail: a green run somebody has to trust is a run they
      // should be able to read.
      await testInfo.attach(`axe-menu-open-${path === "/" ? "landing" : "pricing"}.txt`, {
        body: report || "no violations",
        contentType: "text/plain",
      });

      expect(
        results.violations.map((v) => `${v.id} × ${v.nodes.length}`),
        `Opening the mobile menu on ${path} introduced axe violations:\n\n${report}`,
      ).toEqual([]);

      // The named regression from #221, asserted by name as well as by the
      // aggregate above — the aggregate would also pass if axe silently scanned
      // nothing, and this is the rule three consecutive overlay commits risked.
      expect(
        results.violations.filter((v) => v.id === "nested-interactive"),
        "An interactive element in the open sheet contains focusable descendants (WCAG 4.1.2). " +
          "This is the #221 regression: do not put an interactive role on a container that " +
          "holds links or buttons.",
      ).toEqual([]);
    });
  }

  test("the keyboard gets in and back out, in a real browser", async ({ page }) => {
    await preparePage(page);
    await page.setViewportSize(PHONE);
    await page.goto("/pricing");
    await settle(page);

    const burger = page.getByRole("button", { name: "Menu", exact: true });
    await burger.focus();
    await burger.click();

    const sheet = page.getByRole(SHEET.role, { name: SHEET.name });
    await expect(sheet).toBeVisible();
    await expect(sheet).toHaveAttribute("aria-modal", "true");
    // `aria-expanded` without `aria-controls` names no target.
    await expect(burger).toHaveAttribute("aria-expanded", "true");
    expect(await burger.getAttribute("aria-controls")).toBe(await sheet.getAttribute("id"));

    expect(
      await sheet.evaluate((el) => el.contains(document.activeElement)),
      "focus did not move into the sheet — a keyboard user is left behind an opaque cover",
    ).toBe(true);

    // Scroll lock, which jsdom has no layout to have.
    expect(
      await page.evaluate(() => getComputedStyle(document.body).overflow),
      "the page behind the sheet still scrolls",
    ).toBe("hidden");

    await page.keyboard.press("Escape");
    await expect(page.getByRole(SHEET.role, { name: SHEET.name })).toHaveCount(0);

    expect(
      await burger.evaluate((el) => el === document.activeElement),
      "focus was not returned to the hamburger — Escape dropped the keyboard user at <body>",
    ).toBe(true);
    expect(
      await page.evaluate(() => getComputedStyle(document.body).overflow),
      "the scroll lock outlived the sheet",
    ).not.toBe("hidden");
  });

  test("the sheet is really gone at tablet and desktop widths", async ({ page }) => {
    // THE CASE jsdom CANNOT OWN. `MarketingNav.a11y.test.tsx` renders the same
    // component with no Tailwind, so `sm:hidden` does nothing and the sheet is
    // "present" at every width. Only a browser applies the breakpoint. If the
    // burger ever escaped `sm:hidden`, a desktop user could open a `fixed
    // inset-0` cover with a focus trap in it and unit tests would stay green.
    await preparePage(page);

    for (const width of [768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/pricing");
      await settle(page, 300);

      const burger = page.getByRole("button", { name: "Menu", exact: true });
      if ((await burger.count()) > 0) {
        await expect(burger, `the hamburger is visible at ${width}px`).toBeHidden();
      }
      await expect(
        page.getByRole(SHEET.role, { name: SHEET.name }),
        `a mobile menu sheet exists at ${width}px`,
      ).toHaveCount(0);

      // The desktop links are the reason the sheet is allowed to be hidden.
      await expect(
        page.locator('nav a[href="/pricing"]').first(),
        `no desktop nav links at ${width}px — hiding the burger stranded the user`,
      ).toBeVisible();

      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
        `the marketing page overflows horizontally at ${width}px`,
      ).toBeLessThanOrEqual(0);
    }
  });
});
