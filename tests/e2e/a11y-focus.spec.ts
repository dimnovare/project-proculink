import { test, expect } from "@playwright/test";

import { CORE_SCREENS } from "./coreScreens";
import { preparePage, settle, DEV_OVERLAY_SELECTORS } from "./a11yHarness";

/**
 * Keyboard focus visibility, MEASURED — WCAG 2.4.7 (Focus Visible, AA).
 *
 * WHY THIS IS NOT COVERED BY THE AXE SPEC. Axe has no rule for it. It cannot
 * have one: whether a focused control is *visibly distinguishable* is a question
 * about two rendered states of the same element, and axe inspects one static
 * tree. Delete `outline` from `:focus-visible` in globals.css and axe stays
 * green on all ten screens — verified. So the packet's "an introduced focus
 * regression fails a PR" needs its own measurement, and this is it.
 *
 * WHY NOT A SOURCE LINT. Same reason WP-31 measured tap targets instead of
 * linting them: `focus-visible:outline-none` in a component, an `outline: none`
 * in a third-party stylesheet, a `!important` that out-ranks the global rule, or
 * a transparent outline colour are all invisible to a text scan and all produce
 * the same defect. This drives a real keyboard in a real browser.
 *
 * HOW "VISIBLE" IS DECIDED. Not "has an outline" — plenty of controls carry a
 * permanent border or shadow, and asserting on the presence of one would pass on
 * a button that looks identical focused and unfocused. Instead every focusable
 * control's computed appearance is recorded BEFORE anything is focused, then the
 * page is tabbed through and each focused control is compared against its own
 * baseline. A control whose outline, box-shadow, border, background and text
 * colour are all unchanged under focus is, by definition, not visibly focused.
 */

/**
 * The repo's focus contract, from `src/app/globals.css`:
 *   :focus-visible { outline: 2px solid var(--brand-blue); outline-offset: 2px;
 *                    box-shadow: 0 0 0 4px rgba(30,102,201,0.15); }
 * WCAG 2.4.11 (AAA) wants 2px; 2.4.7 (AA) only requires "visible". The floor
 * asserted here is 1px, because the thing being defended is the difference
 * between an indicator and no indicator.
 */
const MIN_OUTLINE_PX = 1;

/** How far to walk. Long enough to leave the chrome and reach page content. */
const MAX_TAB_STOPS = 45;

/**
 * Anti-vacuity floor. A walk that focuses two controls and finds no problem has
 * not tested the screen. Every core screen has sidebar/topbar chrome plus its own
 * content, so twelve distinct stops is comfortably reachable — and a walk that
 * cannot reach it is reporting that focus is escaping the page, which is itself
 * the bug.
 */
const MIN_DISTINCT_STOPS = 12;

interface Appearance {
  outlineStyle: string;
  outlineWidth: number;
  outlineColor: string;
  boxShadow: string;
  borderColor: string;
  borderWidth: string;
  backgroundColor: string;
  color: string;
  textDecoration: string;
}

interface Stop {
  index: number;
  tag: string;
  label: string;
  focusVisible: boolean;
  now: Appearance;
  before: Appearance;
}

/** `rgba(x, y, z, 0)` and `transparent` are outlines you cannot see. */
function outlineIsVisible(a: Appearance): boolean {
  if (a.outlineStyle === "none" || a.outlineWidth < MIN_OUTLINE_PX) return false;
  const alpha = /rgba?\([^)]*?,\s*([\d.]+)\s*\)$/.exec(a.outlineColor);
  if (a.outlineColor === "transparent") return false;
  if (alpha && Number(alpha[1]) === 0) return false;
  return true;
}

/** Did *anything* about this control change when it took focus? */
function changedUnderFocus(s: Stop): boolean {
  const keys: (keyof Appearance)[] = [
    "boxShadow",
    "borderColor",
    "borderWidth",
    "backgroundColor",
    "color",
    "textDecoration",
    "outlineStyle",
    "outlineColor",
  ];
  if (s.now.outlineWidth !== s.before.outlineWidth) return true;
  return keys.some((k) => s.now[k] !== s.before[k]);
}

test.describe("keyboard focus is visible on every core screen", () => {
  test.describe.configure({ timeout: 120_000 });

  test("the global :focus-visible contract is in effect (canary)", async ({ page }) => {
    await preparePage(page);
    await page.goto("/");
    await settle(page, 300);
    // One real Tab first: Chromium only applies `:focus-visible` to a
    // programmatically focused <button> when the last interaction modality was
    // the keyboard. Without this the probe below reports no outline and the
    // canary fails for a reason that has nothing to do with the stylesheet.
    await page.keyboard.press("Tab");

    const probe = await page.evaluate(() => {
      const b = document.createElement("button");
      b.textContent = "focus probe";
      document.body.appendChild(b);
      b.focus();
      const style = getComputedStyle(b);
      const out = {
        matchesFocusVisible: b.matches(":focus-visible"),
        outlineWidth: parseFloat(style.outlineWidth) || 0,
        outlineStyle: style.outlineStyle,
        boxShadow: style.boxShadow,
      };
      b.remove();
      return out;
    });

    expect(
      probe.matchesFocusVisible,
      "a keyboard-focused <button> does not match :focus-visible — the browser, not the CSS, is wrong",
    ).toBe(true);
    expect(
      probe.outlineStyle !== "none" && probe.outlineWidth >= MIN_OUTLINE_PX,
      `a keyboard-focused <button> has no focus outline (outline: ${probe.outlineWidth}px ${probe.outlineStyle}). ` +
        "Either globals.css lost its :focus-visible rule, or this run is measuring a DIFFERENT dev server.",
    ).toBe(true);
  });

  for (const screen of CORE_SCREENS) {
    test(`${screen.path} (${screen.label})`, async ({ page }) => {
      await preparePage(page);
      const response = await page.goto(screen.path);
      expect(response?.status(), `${screen.path} did not serve a page`).toBeLessThan(400);
      await settle(page);

      // Record every focusable control's resting appearance BEFORE anything is
      // focused. Indexed by a data attribute so the tab walk can find its way
      // back to the right baseline even as the DOM reorders around it.
      const probed = await page.evaluate((devOverlay: string[]) => {
        const SELECTOR =
          'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), ' +
          "select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex^='-'])";
        const read = (el: Element) => {
          const s = getComputedStyle(el);
          return {
            outlineStyle: s.outlineStyle,
            outlineWidth: parseFloat(s.outlineWidth) || 0,
            outlineColor: s.outlineColor,
            boxShadow: s.boxShadow,
            borderColor: s.borderColor,
            borderWidth: s.borderWidth,
            backgroundColor: s.backgroundColor,
            color: s.color,
            textDecoration: s.textDecorationLine,
          };
        };
        const store: Record<string, ReturnType<typeof read>> = {};
        let i = 0;
        for (const el of Array.from(document.querySelectorAll(SELECTOR))) {
          // `next dev` injects its own toolbar button. It is not product UI, and
          // holding it to the product's focus contract would mean a Next.js
          // upgrade fails an accessibility gate.
          if (devOverlay.some((sel) => el.closest(sel))) continue;
          const id = String(i++);
          el.setAttribute("data-plk-focusprobe", id);
          store[id] = read(el);
        }
        (window as unknown as { __plkFocusBaseline: typeof store }).__plkFocusBaseline = store;
        return i;
      }, DEV_OVERLAY_SELECTORS);

      expect(
        probed,
        `${screen.path} exposed no focusable controls — nothing to walk`,
      ).toBeGreaterThan(0);

      const stops: Stop[] = [];
      const seen = new Set<string>();
      let escaped = 0;

      for (let i = 0; i < MAX_TAB_STOPS; i++) {
        await page.keyboard.press("Tab");
        const stop = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          if (!el || el === document.body || el === document.documentElement) return null;
          const id = el.getAttribute("data-plk-focusprobe");
          if (id === null) return null; // focus landed on something added after probing
          const store = (window as unknown as { __plkFocusBaseline: Record<string, unknown> })
            .__plkFocusBaseline;
          const s = getComputedStyle(el);
          return {
            index: Number(id),
            tag: el.tagName.toLowerCase(),
            label: (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 48),
            focusVisible: el.matches(":focus-visible"),
            now: {
              outlineStyle: s.outlineStyle,
              outlineWidth: parseFloat(s.outlineWidth) || 0,
              outlineColor: s.outlineColor,
              boxShadow: s.boxShadow,
              borderColor: s.borderColor,
              borderWidth: s.borderWidth,
              backgroundColor: s.backgroundColor,
              color: s.color,
              textDecoration: s.textDecorationLine,
            },
            before: store[id],
          } as unknown;
        });

        if (!stop) {
          // Focus left the document (tabbed into browser chrome) or landed on an
          // element that did not exist when the baseline was taken. Two in a row
          // means the walk is done.
          if (++escaped >= 2) break;
          continue;
        }
        escaped = 0;
        const typed = stop as Stop;
        if (seen.has(String(typed.index))) break; // wrapped around
        seen.add(String(typed.index));
        stops.push(typed);
      }

      expect(
        stops.length,
        `${screen.path}: the keyboard walk reached only ${stops.length} distinct controls ` +
          `(floor ${MIN_DISTINCT_STOPS}). Either focus is escaping the page or the screen did not render.`,
      ).toBeGreaterThanOrEqual(MIN_DISTINCT_STOPS);

      const invisible = stops
        .filter((s) => s.focusVisible)
        .filter((s) => !outlineIsVisible(s.now) && !changedUnderFocus(s))
        .map(
          (s) =>
            `<${s.tag}> "${s.label}" — nothing changes when it takes keyboard focus ` +
            `(outline: ${s.now.outlineWidth}px ${s.now.outlineStyle} ${s.now.outlineColor}; ` +
            `box-shadow unchanged: ${s.now.boxShadow === s.before.boxShadow})`,
        );

      expect(
        invisible,
        `${screen.path}: controls with no visible keyboard-focus indicator (WCAG 2.4.7)`,
      ).toEqual([]);
    });
  }
});
