import type { Page } from "@playwright/test";

/**
 * Shared page preparation for the a11y and visual gates.
 *
 * Both gates need the same thing: a page that has finished becoming itself. They
 * differ in what they do afterwards, not in how they get there, so the settling
 * lives here once.
 */

/** localStorage key read by `useCookieConsent` (src/lib/cookie-consent.ts). */
const CONSENT_KEY = "proculink_cookie_consent_v1";

/**
 * Chrome that belongs to `next dev`, not to the product. Excluded from axe and
 * hidden from screenshots — gating on Next.js's own error-overlay markup would
 * mean a Next upgrade could fail an accessibility check.
 */
export const DEV_OVERLAY_SELECTORS = [
  "nextjs-portal",
  "[data-next-badge-root]",
  "[data-nextjs-toast]",
  "[data-nextjs-dev-tools-button]",
  "[data-nextjs-dialog-overlay]",
  "#__next-build-watcher",
];

/**
 * The instant every visual baseline is captured at.
 *
 * Arbitrary, but FIXED and in the past, and that is the whole point. A dozen
 * components in this app render a relative age against the wall clock —
 * `InboxView.tsx:435` computes `Date.now() - createdAt` and renders "{age} ago",
 * `BridgeTopbar.tsx:246` has its own `timeAgo`, `BridgeDashboard.tsx:341` another,
 * `DashboardContextLine.tsx:45` renders both a date and a time-of-day greeting.
 * Against the mock fixtures (fixed at Jan 2024) those strings change EVERY DAY.
 * A visual baseline taken without this is red by tomorrow morning, and a gate
 * that is red for a reason nobody caused is a gate that gets deleted.
 */
export const FROZEN_CLOCK = new Date("2026-06-01T09:30:00Z");

export interface PreparePageOptions {
  /**
   * Seed cookie consent so the banner never renders.
   *
   * Default FALSE. The banner is real product UI and axe should see it. Screenshots
   * turn it on, because a fixed-position overlay across the bottom of three of the
   * ten baselines is noise, not signal.
   */
  dismissCookieBanner?: boolean;
  /** Pin `Date.now()` / `new Date()` to FROZEN_CLOCK. Screenshots only. */
  freezeClock?: boolean;
  /**
   * Replace `Math.random` with a seeded PRNG. Screenshots only.
   *
   * `src/components/ui/sidebar.tsx:536` sizes its skeleton bars with
   * `Math.floor(Math.random() * 40) + 50`%, and `api-client.ts` mints ids the same
   * way. Either one is a guaranteed pixel diff on every run.
   */
  seedRandom?: boolean;
}

/**
 * Install everything that must be in place BEFORE the first byte of page script
 * runs. Call once per page, before the first `goto`.
 */
export async function preparePage(page: Page, options: PreparePageOptions = {}): Promise<void> {
  // `prefers-reduced-motion: reduce` is doing more work here than it looks.
  //
  // Playwright's own `animations: "disabled"` screenshot option freezes CSS
  // animations and transitions, and NOTHING ELSE. The two most-animated surfaces
  // in this product — WireTopology's travelling dots and the marketing hero's
  // pulses — are SVG SMIL (`<animateMotion repeatCount="indefinite">`), which CSS
  // cannot reach. They are removed from the DOM entirely by `useReducedMotion`,
  // and this is what triggers it. It also stops the `setInterval` driving
  // AnimatedPipelinePanel, which no screenshot option can touch either.
  await page.emulateMedia({ reducedMotion: "reduce" });

  if (options.dismissCookieBanner) {
    await page.addInitScript(
      ([key]) => {
        try {
          window.localStorage.setItem(key, "functional-only");
        } catch {
          /* storage disabled — the banner shows; the screenshot will say so */
        }
      },
      [CONSENT_KEY],
    );
  }

  if (options.seedRandom) {
    // mulberry32 — three lines, no dependency, identical sequence every run.
    await page.addInitScript(() => {
      let seed = 0x9e3779b9;
      Math.random = () => {
        seed = (seed + 0x6d2b79f5) >>> 0;
        let t = seed;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    });
  }

  if (options.freezeClock) {
    // setFixedTime, NOT clock.install(). `install()` swaps in fake timers that
    // only advance when the test advances them — under it, every setTimeout in
    // React, TanStack Query and the app's own polling stops, and the page never
    // finishes rendering. `setFixedTime` pins only the CLOCK READS
    // (Date.now / new Date / performance.timeOrigin) and leaves timers real,
    // which is exactly the difference between a frozen string and a frozen app.
    await page.clock.setFixedTime(FROZEN_CLOCK);
  }
}

/**
 * Wait for a navigated page to stop changing.
 *
 * `networkidle` is best-effort on purpose: several app screens hold a poll open
 * and would never reach it, so it is capped and its failure swallowed. The fixed
 * settle afterwards covers the React commit that follows the last response.
 */
export async function settle(page: Page, extraMs = 700): Promise<void> {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  // Webfonts (Inter / Bricolage / JetBrains Mono) change metrics when they swap
  // in. Both gates care: axe measures contrast against rendered text, and a
  // screenshot taken mid-swap captures fallback metrics.
  await page.evaluate(() => document.fonts.ready).catch(() => {});
  await page.waitForTimeout(extraMs);
}
