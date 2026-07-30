import { test, expect } from "@playwright/test";

/**
 * Regression: the fixed cookie-consent banner must never cover a bottom-anchored
 * primary CTA on first visit.
 *
 * History: the banner (position: fixed; bottom: 16) is an out-of-flow overlay
 * that reserves no layout space, so a bottom-pinned action bar slid underneath it
 * and intercepted clicks — the commit CTA on the old /upload/preview screen was
 * the reported case (a Playwright click was swallowed, the commit never fired,
 * and navigation timed out). That screen has since been retired; the surviving
 * bottom-pinned primary action is the mobile Order Workshop send bar, which is
 * what this spec now guards. The other e2e specs pre-seed consent to dodge the
 * banner; THIS spec deliberately leaves it visible and proves the CTA clears it.
 *
 * Fix (product side): CookieConsentBanner publishes its occupied height as the
 * CSS var --plk-bottom-inset while visible; PageShell reserves matching scroll
 * room and bottom-pinned bars lift by that inset, so the CTA sits above the
 * banner. The var collapses to 0 the moment consent is chosen.
 */

const ORDER_URL = "/inbox/ord-002";

test.describe("cookie banner never covers a bottom-anchored primary action", () => {
  test("mobile 390 — the workshop send bar clears the compact banner", async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(ORDER_URL);

    // The banner MUST be visible — no consent pre-seeded in this spec.
    const banner = page.getByRole("dialog", { name: /cookie consent/i });
    await expect(banner).toBeVisible({ timeout: 15_000 });

    const sendBar = page.getByTestId("mobile-send-bar");
    await expect(sendBar).toBeVisible({ timeout: 20_000 });

    // Worst case: scroll the triage list to its maximum, where an unlifted bar
    // would rest at the very bottom of the viewport, under the banner.
    await page.evaluate(() => {
      let el = document.querySelector('[data-testid="mobile-send-bar"]')?.parentElement ?? null;
      while (el) {
        const oy = getComputedStyle(el).overflowY;
        if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight) {
          el.scrollTop = el.scrollHeight;
          return;
        }
        el = el.parentElement;
      }
      if (document.scrollingElement) {
        document.scrollingElement.scrollTop = document.scrollingElement.scrollHeight;
      }
    });

    // Geometry: the bar's bottom edge sits at/above the banner's top, the bar is
    // the topmost element at its own centre, and the inset is actually published.
    const geom = await page.evaluate(() => {
      const bannerRect = document
        .querySelector('[role="dialog"][aria-label="Cookie consent"]')!
        .getBoundingClientRect();
      const bar = document.querySelector('[data-testid="mobile-send-bar"]')!;
      const r = bar.getBoundingClientRect();
      const hit = document.elementFromPoint(
        Math.round(r.left + r.width / 2),
        Math.round(r.top + r.height / 2),
      );
      const inset = getComputedStyle(document.documentElement)
        .getPropertyValue("--plk-bottom-inset")
        .trim();
      return {
        bannerTop: bannerRect.top,
        barBottom: r.bottom,
        topmostIsBar: !!hit && bar.contains(hit),
        inset,
      };
    });

    expect(geom.inset).not.toBe("0px"); // banner is publishing its height
    expect(geom.barBottom).toBeLessThanOrEqual(geom.bannerTop + 1);
    expect(geom.topmostIsBar).toBe(true);
  });

  test("desktop — PageShell reserves scroll room so page-bottom content clears the banner", async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/upload");

    const banner = page.getByRole("dialog", { name: /cookie consent/i });
    await expect(banner).toBeVisible({ timeout: 15_000 });

    // PageShell's spacer is the desktop half of the same mechanism: it grows to
    // the banner's published height so nothing anchored at the end of a page can
    // end up underneath it.
    const reserved = await page.evaluate(() => {
      const inset = getComputedStyle(document.documentElement)
        .getPropertyValue("--plk-bottom-inset")
        .trim();
      const spacer = [...document.querySelectorAll("div[aria-hidden]")].find(
        (d) => (d as HTMLElement).style.height === "var(--plk-bottom-inset, 0px)",
      );
      return { inset, spacerHeight: spacer ? spacer.getBoundingClientRect().height : -1 };
    });

    expect(reserved.inset).not.toBe("0px");
    expect(reserved.spacerHeight).toBeGreaterThan(0);
    expect(reserved.spacerHeight).toBeCloseTo(parseFloat(reserved.inset), 0);
  });
});
