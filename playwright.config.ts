import { defineConfig, devices } from "@playwright/test";

/**
 * ProcuLink Playwright config — focused on local smoke tests.
 *
 * Two modes:
 *  - MOCK mode (default in CI): NEXT_PUBLIC_USE_MOCK=true exercises the in-memory
 *    api-client mock so no backend is required.
 *  - LIVE mode: requires the backend stack (Postgres + Api + Worker) to be running
 *    per ProcuLink/README.md. Set PLAYWRIGHT_LIVE=1 to opt in.
 *
 * Auth: PROCULINK_QA_BYPASS_AUTH=true (set in webServer env below) lets Playwright
 * exercise (app) routes without a real Clerk session. Never used in production.
 *
 * Usage:
 *   bun run test:e2e         # mock mode
 *   bun run test:e2e:live    # live mode against running backend
 *   bun run test:e2e:ui      # interactive UI mode
 */

const isLive = process.env.PLAYWRIGHT_LIVE === "1";

// Dev-server port. Defaults to the project's 8082 (what CI uses); overridable so two
// git worktrees can run their own suites at once instead of one silently reusing the
// other's server and testing the wrong tree.
//
// THE OVERRIDE IS NOT FREE, measured 2026-08-27. The Clerk development instance
// allowlists origins, and localhost:8082 is the only one on it. At 8083 the same
// tree that passes 140/140 fails 23: /admin logs "[GSI_LOGGER]: The given origin
// is not allowed for the given client ID" plus a 403 and trips the console-error
// assertion, and the journey specs cannot find the controls they drive. So a
// second worktree running here in parallel gets FAILURES THAT ARE NOT ITS OWN.
// Re-run on 8082 before believing any of them.
const PORT = process.env.PLAYWRIGHT_PORT ?? "8082";
const ORIGIN = `http://localhost:${PORT}`;

/**
 * Rendering flags shared by the three visual-baseline projects (WP-41).
 *
 *  --force-color-profile=srgb   pins colour management, so the same #1E66C9 does
 *                               not resolve to two different RGB triples on two
 *                               machines with different display profiles.
 *  --hide-scrollbars            a scrollbar is 15px of layout on one machine and
 *                               0 on another; it also shifts every centred element.
 *  --font-render-hinting=none   removes the largest remaining host-dependent
 *                               difference in glyph rasterisation.
 *  --disable-lcd-text           subpixel antialiasing puts colour fringes on text
 *                               that differ per GPU. Greyscale AA is reproducible.
 *
 * deviceScaleFactor is pinned to 1 so a HiDPI host does not produce 2× baselines.
 */
const VISUAL_RENDERING = {
  deviceScaleFactor: 1,
  launchOptions: {
    args: [
      "--force-color-profile=srgb",
      "--hide-scrollbars",
      "--font-render-hinting=none",
      "--disable-lcd-text",
    ] as string[],
  },
};

export default defineConfig({
  testDir: "./tests/e2e",
  // Warm /upload and the other heavy routes before the suite so the first test
  // that hits them doesn't eat the Next dev cold-compile and flake.
  globalSetup: "./tests/e2e/global-setup.ts",
  // Generous default assertion timeout — single-worker CI under load is slow.
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      // A visual gate is only worth having if a real change fails it and noise
      // does not. These two numbers are the whole difference.
      //
      // maxDiffPixelRatio 0.002 = 0.2% of the frame. On the 1440×900 baselines
      // that is ~2,600 pixels: enough to absorb antialiasing on a re-rasterised
      // glyph run, nowhere near enough to hide a moved button (the smallest
      // control in the app is ~44×44 = 1,936px, and a colour change to a single
      // 120px-wide label is ~2,000px of *changed* pixels at full threshold).
      // threshold 0.2 is Playwright's default per-pixel YIQ tolerance; it is what
      // makes subpixel text rendering survive while a token change does not.
      maxDiffPixelRatio: 0.002,
      threshold: 0.2,
      // CSS animations/transitions frozen at their end state. This is NOT
      // sufficient on its own — see tests/e2e/a11yHarness.ts for why SVG SMIL
      // needs `prefers-reduced-motion` instead.
      animations: "disabled",
      // Do not let a lazily-mounted element scroll into view mid-capture.
      caret: "hide",
      scale: "css",
    },
  },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // One retry everywhere. CI runs single-worker; local runs many workers against a
  // single `next dev`, so a heavy route's first cold compile can still exceed a
  // tight visibility timeout even after globalSetup warms it. A single retry absorbs
  // that residual cold-compile jitter (a genuine product failure fails both attempts).
  retries: 1,
  workers: process.env.CI ? 1 : undefined,
  // WP-02 — a skip must be LEGIBLE, not silent.
  //
  // CI ran with `reporter: "github"` alone. The GitHub reporter emits file annotations for
  // FAILURES and prints nothing else, and Playwright's runner counts `skipped` as a
  // non-failure — so 31 of 111 tests skipping in the default (mock) run produced a green
  // check and not one line of output saying so. The HTML report was uploaded only on
  // failure, so there was no artifact to go and look at either.
  //
  // Skipping is still not a failure — the declared-condition skips (live-backend gates) are
  // correct by design. It is now merely impossible to miss:
  //   github → failure annotations, as before
  //   list   → one line per test, with SKIPPED shown inline in the job log
  //   json   → machine-readable, consumed by the "Skipped Playwright tests" CI step
  //   html   → a real report to download; the artifact upload is now `if: always()`
  reporter: process.env.CI
    ? [
        ["github"],
        ["list"],
        ["json", { outputFile: "test-results/results.json" }],
        ["html", { open: "never" }],
      ]
    : "list",

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? ORIGIN,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: process.env.CI ? "off" : "retain-on-failure",
  },

  // Visual baselines are shared across every viewport project, so the platform
  // segment is dropped from the path. That is only safe because visual.spec.ts
  // refuses to run anywhere but Linux (see its header) — without that guard a
  // Windows run would overwrite Linux baselines with subtly different font
  // rasterisation and turn CI red for everyone.
  snapshotPathTemplate: "{testDir}/__screenshots__/{arg}{ext}",

  projects: [
    {
      name: "chromium",
      // Desktop Chrome, 1280×720. Everything except the visual baselines runs here.
      // The visual spec is excluded so it does not run a fourth time at a viewport
      // it has no baselines for.
      use: { ...devices["Desktop Chrome"] },
      testIgnore: /(visual|control-sweep|control-click)\.spec\.ts/,
    },

    // ── Viewport presets ──────────────────────────────────────────────────────
    //
    // WP-41 asked for "mobile viewport presets in playwright.config.ts". They are
    // projects rather than `test.use({ viewport })` inside a spec so the same spec
    // body produces one baseline per breakpoint, and so a future spec can opt into
    // a breakpoint by name.
    //
    // They are scoped with `testMatch` to the visual spec ONLY. Adding three
    // unscoped projects would have run the entire 100+ test suite four times and
    // taken the e2e job from ~4 minutes to ~16 for no extra signal — the existing
    // specs assert behaviour, which does not change with viewport width.
    //
    // 390 = iPhone 12/13/14 logical width, and the same number
    // tests/e2e/tap-targets.spec.ts measures at, so a mobile visual diff and a
    // mobile tap-target failure describe the same rendering.
    // 768 = the `md` Tailwind breakpoint exactly — the width where the sidebar and
    // the table/card switches flip, i.e. the one most likely to break.
    // 1440 = the common desktop width the design system is drawn at.
    {
      name: "visual-mobile",
      use: { ...devices["Desktop Chrome"], ...VISUAL_RENDERING, viewport: { width: 390, height: 844 } },
      testMatch: /visual\.spec\.ts/,
    },
    {
      name: "visual-tablet",
      use: { ...devices["Desktop Chrome"], ...VISUAL_RENDERING, viewport: { width: 768, height: 1024 } },
      testMatch: /visual\.spec\.ts/,
    },
    // ── The control sweep ─────────────────────────────────────────────────────
    //
    // Scoped with `testMatch` for the same reason the visual projects are: three
    // UNSCOPED projects would run the whole suite four times for no extra signal.
    // The sweep is the one spec where the extra signal is real, because it
    // enumerates the DOM — and 51 source files fork their DOM by breakpoint, so
    // the mobile tree and the desktop tree carry different controls.
    //
    // Widths match the visual projects exactly, so a sweep finding and a visual
    // diff describe the same rendering. `hasTouch` is set below 1024 because the
    // touch-target floors in globals.css are behind `(pointer: coarse)`, and a
    // sweep that measured them with a fine pointer would report the pre-fix
    // numbers and call the fix a failure.
    // ── Journey projects ──────────────────────────────────────────────────────
    //
    // The scenario specs — first run to delivered, upload to workshop, error
    // recovery, sample order — all ran at 1280 only. They are the new-client and
    // new-supplier paths, i.e. the flows that decide whether a pilot customer
    // gets anywhere, and they walk screens whose DOM forks by breakpoint.
    //
    // Scoped by testMatch to those four specs, so this is roughly a dozen tests
    // per width, not the whole suite three more times.
    {
      name: "journey-mobile",
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
      testMatch: /(first-run-to-delivered|upload-to-workshop|error-recovery|sample-order-happy-path)\.spec\.ts/,
    },
    {
      name: "journey-tablet",
      use: { ...devices["Desktop Chrome"], viewport: { width: 768, height: 1024 }, hasTouch: true },
      testMatch: /(first-run-to-delivered|upload-to-workshop|error-recovery|sample-order-happy-path)\.spec\.ts/,
    },

    {
      name: "sweep-mobile",
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
      testMatch: /control-sweep\.spec\.ts/,
    },
    {
      name: "sweep-tablet",
      use: { ...devices["Desktop Chrome"], viewport: { width: 768, height: 1024 }, hasTouch: true },
      testMatch: /control-sweep\.spec\.ts/,
    },
    {
      name: "sweep-desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
      testMatch: /control-sweep\.spec\.ts/,
    },

    // ── The click pass ────────────────────────────────────────────────────────
    //
    // Split out of the sweep projects when the sweep became a PR gate. They ran
    // the same two specs and the difference in cost is the whole reason:
    //
    //   control-sweep  enumerates          3 viewports ~ 3.5 min
    //   control-click  presses every button 3 viewports ~ 26 min
    //
    // 26 minutes on every pull request buys pressure to skip it, and a gate people
    // route around is worse than none. So the enumeration gates and the click pass
    // is run deliberately — `bun run sweep:click` — before a release or after a
    // change to a control-heavy screen.
    //
    // Deliberately NOT put on a nightly schedule. A scheduled job nobody is paged
    // about is exactly the failure this repo had on 2026-08-26: the production
    // smoke run died at 19:30 and nothing surfaced it for fourteen hours. Adding a
    // second unwatched schedule would repeat that, not fix it.
    {
      name: "click-mobile",
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
      testMatch: /control-click\.spec\.ts/,
    },
    {
      name: "click-tablet",
      use: { ...devices["Desktop Chrome"], viewport: { width: 768, height: 1024 }, hasTouch: true },
      testMatch: /control-click\.spec\.ts/,
    },
    {
      name: "click-desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
      testMatch: /control-click\.spec\.ts/,
    },

    {
      name: "visual-desktop",
      use: { ...devices["Desktop Chrome"], ...VISUAL_RENDERING, viewport: { width: 1440, height: 900 } },
      testMatch: /visual\.spec\.ts/,
    },
  ],

  webServer: {
    command: `next dev -p ${PORT}`,
    url: ORIGIN,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    env: {
      PROCULINK_QA_BYPASS_AUTH: "true",
      // Browser-visible twin of the backend bypass: lets the Next client enable
      // data queries without a Clerk session (see useQueriesEnabled / isQaBypass).
      // Test-only — never set in production builds.
      NEXT_PUBLIC_QA_BYPASS_AUTH: "true",
      NEXT_PUBLIC_USE_MOCK: isLive ? "false" : "true",
      // When live, point at the locally-running backend. Default falls back to
      // HTTPS dev profile; override with PLAYWRIGHT_API_URL for HTTP.
      NEXT_PUBLIC_API_BASE_URL: process.env.PLAYWRIGHT_API_URL
        ?? (isLive ? "https://localhost:7230" : "http://localhost:5223"),
      // In mock/QA mode there is no real Clerk session. Clear the publishable key
      // so ClerkProvider runs in its graceful degraded (no-session) state.
      // CRITICAL: also disable Clerk KEYLESS mode. In `next dev` (development) with
      // no/empty publishable key, @clerk/nextjs auto-provisions a throwaway Clerk
      // app and redirects to its "claim your application" page on any navigation to
      // a protected route — which hijacks router.push and breaks every e2e nav test.
      // NEXT_PUBLIC_CLERK_KEYLESS_DISABLED=true keeps Clerk fully dormant: hooks
      // return safe no-session defaults and the router is NOT patched.
      ...(isLive ? {} : { NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "", NEXT_PUBLIC_CLERK_KEYLESS_DISABLED: "true" }),
    },
  },
});
