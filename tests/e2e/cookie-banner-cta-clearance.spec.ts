import { test, expect, type Page } from "@playwright/test";

/**
 * Regression: the fixed cookie-consent banner must never cover a bottom-anchored
 * primary CTA on first visit.
 *
 * History: the banner (position: fixed; bottom: 16) is an out-of-flow overlay
 * that reserves no layout space, so a bottom-pinned action bar slid underneath it
 * and intercepted clicks — the "Confirm mapping → review order" commit CTA on
 * /upload/preview was the reported case (a Playwright click was swallowed, the
 * commit never fired, and navigation timed out). The other e2e specs pre-seed
 * consent to dodge the banner; THIS spec deliberately leaves it visible and
 * proves the CTA clears it.
 *
 * Fix (product side): CookieConsentBanner publishes its occupied height as the
 * CSS var --plk-bottom-inset while visible; PageShell reserves matching scroll
 * room and bottom-pinned bars lift by that inset, so the CTA sits above the
 * banner. The var collapses to 0 the moment consent is chosen.
 *
 * A plain (non-force) click asserts Playwright actionability incl. "receives
 * pointer events" — if the banner overlapped the CTA the click would time out,
 * so a passing click is the proof.
 */

const PREVIEW_URL = "/upload/preview/ord-002";

async function assertCommitClearsBanner(page: Page) {
  await page.goto(PREVIEW_URL);
  await expect(page.getByText(/review your order mapping/i)).toBeVisible({ timeout: 15_000 });

  // The banner MUST be visible — no consent pre-seeded in this spec.
  const banner = page.getByRole("dialog", { name: /cookie consent/i });
  await expect(banner).toBeVisible();

  const commit = page.getByRole("button", { name: /continue to review|confirm mapping/i });
  await expect(commit).toBeVisible();

  // Worst case: scroll the CTA's scroll container to its maximum, where an
  // unlifted bar would rest at the very bottom, under the banner.
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) =>
      /continue to review|confirm mapping/i.test(b.textContent ?? ""),
    );
    let el: HTMLElement | null = btn?.parentElement ?? null;
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

  // Geometry: the CTA's bottom edge sits at/above the banner's top, and the CTA
  // is the topmost element at its own centre (not obscured).
  const geom = await page.evaluate(() => {
    const banner = document.querySelector('[role="dialog"][aria-label="Cookie consent"]')!.getBoundingClientRect();
    const btn = [...document.querySelectorAll("button")].find((b) =>
      /continue to review|confirm mapping/i.test(b.textContent ?? ""),
    )!;
    const r = btn.getBoundingClientRect();
    const hit = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
    const inset = getComputedStyle(document.documentElement).getPropertyValue("--plk-bottom-inset").trim();
    return { bannerTop: banner.top, ctaBottom: r.bottom, topmostIsButton: !!hit && (hit === btn || btn.contains(hit)), inset };
  });
  expect(geom.inset).not.toBe("0px"); // banner is publishing its height
  expect(geom.ctaBottom).toBeLessThanOrEqual(geom.bannerTop + 1);
  expect(geom.topmostIsButton).toBe(true);

  // Decisive proof: a plain click reaches the CTA and navigates.
  await Promise.all([
    page.waitForURL(/\/inbox\/ord-002/i, { timeout: 60_000 }),
    commit.click(),
  ]);
  expect(page.url()).toMatch(/\/inbox\/ord-002/i);
}

test.describe("cookie banner never covers the commit CTA", () => {
  test("desktop — commit CTA clears the banner and is clickable", async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1280, height: 800 });
    await assertCommitClearsBanner(page);
  });

  test("mobile 390 — commit CTA clears the compact banner and is clickable", async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await assertCommitClearsBanner(page);
  });
});
