import { test, expect } from "@playwright/test";

/**
 * The scroll cue is an AFFORDANCE, and the control sweep cannot score it.
 *
 * The sweep measures geometry: after this change the queue's "Failed" chip is
 * still 315px past the right edge, because a fade does not move anything. What
 * changed is that the edge now says "there is more here" instead of looking like
 * a clean end — and the only way to assert that is to read the computed mask.
 *
 * Both directions are checked. A cue that never appears is the defect this fixes;
 * a cue that appears at every width is decoration on a strip that fits, which is
 * why the rule is scoped below `sm`.
 */

const STRIPS = [
  { route: "/inbox", label: "order queue status filter" },
  { route: "/library/mappings", label: "mapping source filter" },
  { route: "/library/suppliers/s1", label: "supplier detail tabs" },
] as const;

async function maskOf(page: import("@playwright/test").Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.querySelector(".scroll-cue-x");
    if (!el) return "MISSING";
    const s = getComputedStyle(el);
    return s.maskImage || s.webkitMaskImage || "none";
  });
}

for (const { route, label } of STRIPS) {
  test(`${route} — the ${label} cues its overflow on a phone`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(route, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

    const mask = await maskOf(page);
    expect(mask, `${route} has no .scroll-cue-x element at all`).not.toBe("MISSING");
    expect(mask, `${route} renders no fade, so a clipped strip still reads as a clean edge`).toContain(
      "linear-gradient",
    );
  });

  test(`${route} — and does not cue it on a desktop, where it fits`, async ({ page }) => {
    // The negative control. Without it this file passes just as well against a
    // rule with no media query, which would fade a strip that has nothing hidden.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(route, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

    const mask = await maskOf(page);
    expect(mask, `${route} has no .scroll-cue-x element at all`).not.toBe("MISSING");
    expect(mask, `${route} fades its edge at a width where the strip fits`).not.toContain("linear-gradient");
  });
}
