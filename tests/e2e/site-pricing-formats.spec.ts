import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page } from "@playwright/test";
import { euro } from "../../src/lib/billingWords";
import { DOCUMENT_PLANS, cheapestDocumentPlan } from "../../src/lib/plans";
import { preparePage } from "./a11yHarness";

/**
 * /pricing and /formats in a real browser: every width, the price helper by keyboard,
 * the annual toggle, reduced motion and the page with no script. Expected answers are
 * computed from cheapestDocumentPlan, never typed.
 */

/** The smallest computed font-size over visible elements that hold text. */
const smallestFont = (page: Page) =>
  page.evaluate(() => {
    let min = Infinity;
    for (const el of document.querySelectorAll("body *")) {
      const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim());
      const box = (el as HTMLElement).getBoundingClientRect();
      if (hasText && box.width > 0 && box.height > 0) min = Math.min(min, parseFloat(getComputedStyle(el).fontSize));
    }
    return min;
  });

test.describe("/pricing and /formats", () => {
  test.describe.configure({ timeout: 180_000 });

  test("/pricing and /formats at phone, tablet and desktop widths", async ({ page }) => {
    for (const [width, path] of [[375, "/pricing"], [390, "/pricing"], [768, "/pricing"], [1440, "/pricing"], [390, "/formats"], [1440, "/formats"]] as const) {
      await page.setViewportSize({ width, height: 900 });
      await preparePage(page, { dismissCookieBanner: width !== 375 }); // 375 keeps the banner showing
      await page.goto(path);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${path} at ${width}: sideways scroll`).toBe(true);
      expect(await smallestFont(page), `${path} at ${width}`).toBeGreaterThanOrEqual(12.5);
      // A link inside a sentence is exempt (SC 2.5.8), the same rule as tap-targets.spec.ts.
      if (width <= 390) for (const el of await page.locator("main a:visible, main button:visible, main summary:visible").all())
        if (!(await el.evaluate((e) => e.tagName === "A" && getComputedStyle(e).display === "inline")))
          expect((await el.boundingBox())!.height, `${path} at ${width}: ${await el.textContent()}`).toBeGreaterThanOrEqual(44);
      if (path === "/pricing") {
        const boxes = await Promise.all(DOCUMENT_PLANS.map((p) => page.locator(`article[data-plans="${p.id}"]`).boundingBox()));
        const xs = new Set(boxes.map((b) => Math.round(b!.x)));
        expect(xs.size, `plans at ${width}`).toBe(width < 660 ? 1 : width >= 1100 ? 4 : 2); // one column on phones, two at 768, four from 1100
        await expect(page.locator("[data-cheapest]")).toHaveCount(1);
        await expect(page.getByText("Cheapest for your volume", { exact: true }).filter({ visible: true })).toHaveCount(1);
      } else {
        for (const id of ["read", "outputs", "ways-in", "ways-out", "limits"]) {
          await page.getByRole("navigation", { name: "On this page" }).locator(`a[href="#${id}"]`).click();
          const top = await page.locator(`#${id}`).evaluate((el) => el.getBoundingClientRect().top);
          expect(top, `#${id} lands under the header`).toBeGreaterThanOrEqual(60);
        }
      }
      const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      expect(violations.map((v) => `${v.id}: ${v.nodes.length}`), `axe on ${path} at ${width}`).toEqual([]);
    }
  });

  test("the helper by keyboard, the toggle, and reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await preparePage(page, { dismissCookieBanner: true });
    await page.goto("/pricing");
    const slider = page.getByLabel("About how many documents a month?");
    await slider.focus();
    await page.keyboard.press("ArrowRight");
    await expect(slider).toHaveAttribute("aria-valuetext", "300 documents a month");
    await expect(page.getByTestId("price-answer")).toContainText(`300 a month fits in ${cheapestDocumentPlan(300, "monthly").plan.name}.`);
    await page.getByRole("button", { name: /^Annual, \d+ months free$/ }).click();
    await expect(page.locator(`article[data-plans="${cheapestDocumentPlan(300, "yearly").plan.id}"]`)).toHaveAttribute("data-cheapest", "");
    const second = page.locator("details").nth(1);
    await second.locator("summary").click();
    await expect(second).toHaveAttribute("open", "");
    // globals.css's reduced-motion reset sets every transition to 0.01ms (not 0s), so an
    // opening question starts a 0.01ms transition; two frames later nothing may still run.
    expect(await page.evaluate(async () => {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return document.getAnimations().map((a) => {
        const t = (a.effect as KeyframeEffect | null)?.target;
        return `${(a as CSSAnimation).animationName ?? (a as CSSTransition).transitionProperty} on ${t?.tagName}.${t?.getAttribute("class")}`;
      });
    })).toEqual([]);
    // The chevron's own transition-transform is motion-safe only, and so is off here.
    expect(await second.locator("summary svg").evaluate((el) => getComputedStyle(el).transitionProperty)).not.toContain("transform");
    expect(parseFloat(await second.locator("summary svg").evaluate((el) => getComputedStyle(el).transitionDuration))).toBeLessThanOrEqual(0.00001);
  });

  test.describe("with JavaScript off", () => {
    test.use({ javaScriptEnabled: false });
    test("/pricing works with JavaScript off", async ({ page }) => {
      await page.goto("/pricing");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Start free. Pay for the documents you process.");
      const first = cheapestDocumentPlan(200, "monthly");
      await expect(page.getByTestId("price-answer")).toContainText(`${first.plan.name} is cheapest, about ${euro(first.euros)}`);
      for (const p of DOCUMENT_PLANS) await expect(page.locator(`article[data-plans="${p.id}"]`)).toContainText(euro(p.priceMonthly!));
      const cancel = page.locator("details", { hasText: "What happens if I cancel?" });
      await cancel.locator("summary").click();
      await expect(cancel).toContainText("tell your senders before you cancel");
    });
  });
});
