import { test, expect, type Page } from "@playwright/test";

/**
 * Tap-target + iOS-zoom floors, MEASURED.
 *
 * WHY PLAYWRIGHT AND NOT A SOURCE LINT. A lint that reads source cannot see a
 * computed size: `className="h-8"` is 32px only if nothing overrides it, an
 * inline `height: 32` loses to a `min-height` in a stylesheet, and a control can
 * be sized entirely by its parent. Every one of those is present in this
 * codebase — the whole fix in globals.css works by out-ranking inline heights,
 * so a source lint would have reported the pre-fix numbers and called the fix a
 * failure. jsdom is no better: it has no layout engine, so every
 * `getBoundingClientRect()` there returns zeros and a jsdom tap-target test
 * asserts nothing at all.
 *
 * So this measures. Real browser, real viewport, real `getBoundingClientRect()`.
 *
 * VIEWPORT. 390×844 (iPhone 12/13/14 logical size). The floors in globals.css
 * are `@media (pointer: coarse), (max-width: 639px)`; the `pointer: coarse` half
 * is the technically correct predicate for the iOS focus-zoom behaviour, and the
 * `max-width` half exists so the rule is reproducible in Desktop Chrome — which
 * is what this project runs.
 *
 * PORT HAZARD. `playwright.config.ts` sets `reuseExistingServer: !CI`, so a dev
 * server another workspace left on :8082 would be measured instead of this one.
 * `expects the touch floors to be in effect` below is the canary: it fails loudly
 * if the app under test is not carrying this branch's globals.css.
 */

const MOBILE = { width: 390, height: 844 };

test.use({ viewport: MOBILE });

/** WCAG 2.5.5 / Apple HIG. */
const TAP_MIN = 44;
/** Below this, iOS Safari zooms the page on focus and never zooms back. */
const INPUT_FONT_MIN = 16;

/**
 * Sub-pixel slack. Browsers round layout to 1/64px and a 44px box can measure
 * 43.99. Anything a whole pixel short is a real miss.
 */
const EPSILON = 0.5;

interface Measured {
  tag: string;
  role: string | null;
  label: string;
  height: number;
  width: number;
  fontSize: number;
  isTextEntry: boolean;
  exempt: string | null;
}

/**
 * Measure every visible interactive control on the page.
 *
 * EXEMPTIONS, and why each one is in the WCAG text rather than convenience:
 *
 *  • INLINE links. SC 2.5.8 exempts a target "in a sentence or its size is
 *    otherwise constrained by the line-height of non-target text". A link inside
 *    a paragraph is that case; forcing it to 44px would break the prose.
 *  • CHECKBOX / RADIO. `min-height` on those scales the rendered control, not
 *    just its hit box — a 44px checkbox looks broken. Their target is the
 *    adjacent <label>, which is measured like any other control.
 *  • Zero-size / 1×1 clipped. The sr-only skip link is 1×1 until focused; it is
 *    not on screen, so it is not a tap target.
 */
async function measureControls(page: Page): Promise<Measured[]> {
  return page.evaluate(() => {
      const SELECTOR =
        'button, a[href], input, select, textarea, summary, [role="button"], [role="tab"], [role="radio"], [role="switch"]';
      const out: {
        tag: string;
        role: string | null;
        label: string;
        height: number;
        width: number;
        fontSize: number;
        isTextEntry: boolean;
        exempt: string | null;
      }[] = [];

      for (const el of Array.from(document.querySelectorAll<HTMLElement>(SELECTOR))) {
        const style = getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden") continue;
        const rect = el.getBoundingClientRect();
        // Visually-hidden controls (the 1×1 clipped "Skip to main content" link)
        // are not on screen until focused, so they are not tap targets.
        if (rect.width <= 1 || rect.height <= 1) continue;
        // Off-screen (skip-links, closed drawers parked outside the viewport).
        if (rect.bottom < 0 || rect.top > window.innerHeight * 4) continue;

        const tag = el.tagName.toLowerCase();
        const type = (el.getAttribute("type") ?? "").toLowerCase();
        const isTextEntry =
          (tag === "input" && !["checkbox", "radio", "hidden", "button", "submit", "reset", "range"].includes(type)) ||
          tag === "select" ||
          tag === "textarea";

        let exempt: string | null = null;
        if (tag === "a" && style.display === "inline") exempt = "inline link in text flow (SC 2.5.8 inline exception)";
        if (tag === "input" && (type === "checkbox" || type === "radio")) exempt = "checkbox/radio — target is the label";
        if (el.closest("[data-plk-tap-exempt]")) exempt = "explicitly exempt subtree";

        const label =
          el.getAttribute("aria-label") ??
          (el.textContent ?? "").trim().slice(0, 40) ??
          "";

        out.push({
          tag,
          role: el.getAttribute("role"),
          label,
          height: rect.height,
          width: rect.width,
          fontSize: parseFloat(style.fontSize),
          isTextEntry,
          exempt,
        });
      }
    return out;
  });
}

function describeFailure(m: Measured, what: string): string {
  return `${what}: <${m.tag}${m.role ? ` role="${m.role}"` : ""}> "${m.label}" — ${Math.round(m.height)}×${Math.round(m.width)}px, font ${m.fontSize}px`;
}

/**
 * Routes reachable in mock mode. `(app)` routes go through
 * PROCULINK_QA_BYPASS_AUTH, which playwright.config.ts sets on the dev server.
 */
const ROUTES = [
  "/",
  "/pricing",
  "/upload",
  "/settings",
  "/operations/webhooks",
  "/operations/connectors",
  "/library/buyers",
  "/library/suppliers",
  "/inbox",
];

test.describe("touch floors at a phone viewport", () => {
  test("expects the touch floors to be in effect (canary — catches measuring the wrong dev server)", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    const probe = await page.evaluate(() => {
      const b = document.createElement("button");
      b.textContent = "probe";
      document.body.appendChild(b);
      const h = parseFloat(getComputedStyle(b).minHeight);
      const tapMin = getComputedStyle(document.documentElement).getPropertyValue("--tap-min").trim();
      b.remove();
      return { minHeight: h, tapMin };
    });
    expect(probe.tapMin, "--tap-min token missing").toBe("44px");
    expect(
      probe.minHeight,
      "A plain <button> has no 44px floor at 390px wide. Either globals.css does not carry the " +
        "WP-31 touch-floor block, or this run is measuring a DIFFERENT dev server on :8082.",
    ).toBeGreaterThanOrEqual(TAP_MIN - EPSILON);
  });

  for (const route of ROUTES) {
    test(`${route} — no control under ${TAP_MIN}px, no text field under ${INPUT_FONT_MIN}px`, async ({ page }) => {
      await page.goto(route);
      await page.waitForLoadState("domcontentloaded");
      // Give client-rendered surfaces (mock queries, hydration) a beat to settle.
      await page.waitForTimeout(900);

      const controls = await measureControls(page);
      expect(controls.length, `${route} rendered no interactive controls — did it load?`).toBeGreaterThan(0);

      const tooShort = controls
        .filter((m) => !m.exempt && m.height < TAP_MIN - EPSILON)
        .map((m) => describeFailure(m, "below the 44px tap floor"));

      const tooSmallFont = controls
        .filter((m) => !m.exempt && m.isTextEntry && m.fontSize < INPUT_FONT_MIN - 0.01)
        .map((m) => describeFailure(m, `below the ${INPUT_FONT_MIN}px iOS-zoom floor`));

      expect(tooSmallFont, `${route}: text fields that make iOS zoom on focus`).toEqual([]);
      expect(tooShort, `${route}: controls too small to tap reliably`).toEqual([]);
    });
  }
});

test.describe("the landing hero toggle — WP-30 left this at 22px", () => {
  test("is at least 44px tall on a phone", async ({ page }) => {
    await page.goto("/");
    const toggle = page.getByRole("button", { name: "Topology" });
    await expect(toggle).toBeVisible();
    const box = await toggle.boundingBox();
    expect(box, "hero toggle not laid out").not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(TAP_MIN - EPSILON);
  });

  test("clears WCAG 2.2 SC 2.5.8's 24px floor on a desktop viewport too", async ({ page }) => {
    // SC 2.5.8 (AA) applies to ALL pointer types, so 22px failed on desktop as
    // well — the touch floor alone would not have fixed it.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    const toggle = page.getByRole("button", { name: "Topology" });
    await expect(toggle).toBeVisible();
    const box = await toggle.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(24);
  });
});
