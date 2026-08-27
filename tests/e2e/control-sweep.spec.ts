import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sweepRoutes, type SweepRoute } from "./sweepRoutes";

/**
 * THE CONTROL SWEEP — every route, every visible control, three viewports.
 *
 * WHY THIS EXISTS. Before this file, the repo's automated interaction coverage
 * ran at exactly ONE width. playwright.config.ts says so in its own comment:
 * "the existing specs assert behaviour, which does not change with viewport
 * width." That is false in this codebase. 51 source files fork their DOM by
 * breakpoint (116 `lg:hidden` / `hidden lg:block` pairs): /inbox renders a mobile
 * card list AND a desktop table, order review renders MobileTriage AND the
 * three-pane workbench, mappings and rules render route cards AND tables. Those
 * are different trees carrying different controls. Every control that exists only
 * in the mobile tree had never been exercised by any automated test — the mobile
 * QA in Group I passes 3–10 was screenshots, which is looking, not clicking.
 *
 * 768 was the worst of the three: the `md` breakpoint where the trees flip, with
 * no interaction coverage and no axe coverage at all.
 *
 * WHAT IT MEASURES, AND WHY IN A BROWSER. Everything here needs layout — an
 * accessible name that resolves through `aria-labelledby`, a computed tap-target
 * box, whether a control was pushed outside the viewport. jsdom has no layout
 * engine (every getBoundingClientRect() is zeros) and a source lint cannot see a
 * size that a parent or a media query decides. See tests/e2e/tap-targets.spec.ts,
 * which makes the same argument at length and is the direct ancestor of this file.
 *
 * RELATIONSHIP TO tap-targets.spec.ts. That file measures ONE viewport (390) on
 * 6 routes and asserts a hard floor. This sweeps 40+ routes at 3 viewports and
 * REPORTS. They are not redundant: a passing tap-targets run tells you the mobile
 * floors are enforced; this tells you where else, and at which widths, they are
 * not. tap-targets' own header already documents the desktop gap it does not
 * cover — this measures it.
 *
 * REPORT, NOT VERDICT. This writes .qa-sweep/<project>/ and fails
 * only on findings the app cannot defend at any width: a page-level horizontal
 * scroll, a console error, an unhandled rejection, or a route that did not render.
 * Size and naming findings are collected and printed. That split is deliberate —
 * a gate that fails on 200 pre-existing findings gets disabled within a week, and
 * the ones worth fixing are then invisible. Convert findings into targeted guards
 * as they are fixed; do not turn this file into the guard.
 */

/**
 * NOT under test-results/. Playwright CLEARS that directory at the start of every
 * run — which destroyed the first sweep's data, and the copy of it kept alongside,
 * before either could be read.
 */
const OUT_DIR = join(process.cwd(), ".qa-sweep");

/** WCAG 2.2 SC 2.5.8 (AA) — the floor that applies at every width, pointer or touch. */
const WCAG_MIN = 24;
/** Apple HIG / Material touch floor. Applied only where the pointer is coarse. */
const TOUCH_MIN = 44;

interface ControlRecord {
  route: string;
  tag: string;
  role: string | null;
  name: string;
  width: number;
  height: number;
  disabled: boolean;
  /** Distance the control's right edge sits past the viewport's, in px. 0 if inside. */
  overflowRight: number;
  /**
   * WCAG 2.2 SC 2.5.8 exempts a link whose target is INLINE IN A SENTENCE — you
   * cannot enlarge a word in a paragraph without breaking the paragraph. Without
   * this flag the sweep reported every prose link on /terms, /privacy and /dpa as
   * a target-size failure, which is 90+ fabricated findings drowning the real
   * ones. Flagged rather than dropped, so the exemption is visible and arguable.
   */
  inlineInText: boolean;
  /**
   * Visually-hidden-until-focused controls — the skip link is the whole
   * population here. It measures 1px wide by design; reporting it as undersized
   * is reporting the pattern working.
   */
  visuallyHidden: boolean;
  /** Viewport-relative box, kept so a reviewer can see the geometry behind a verdict. */
  box: { x: number; y: number; w: number; h: number };
  /**
   * WCAG 2.2 SC 2.5.8's SPACING EXCEPTION, decided here rather than in the
   * report, because this is the only place the geometry of ONE PAGE exists at
   * one time. The report used to recompute it from the merged records and
   * compared every control against every other one IN THE PROJECT — so a
   * button on /inbox could be "crowded" by a link on /pricing, two pages that
   * never coexist. Deciding it once, next to the boxes, is what makes that
   * mistake unavailable.
   */
  crowded: boolean;
  /**
   * The control sits inside an ancestor that scrolls horizontally. This turns
   * "pushed off the viewport" from a defect into a question: a scroll strip is a
   * legitimate pattern, an accidentally-clipped row is not.
   */
  inScrollContainer: boolean;
}

interface PageRecord {
  route: string;
  ok: boolean;
  status: number | null;
  /** document.scrollWidth - innerWidth, clamped at 0. Non-zero = horizontal scroll. */
  horizontalOverflow: number;
  h1Count: number;
  headingSkips: string[];
  controls: ControlRecord[];
  /** Console errors the app itself produced. */
  appConsoleErrors: string[];
  /**
   * Requests refused because the local backend is not running. Split out because
   * it is a DIFFERENT finding: in mock mode a route is supposed to be servable
   * with no API at all, so a route appearing here is a route that ignores
   * `USE_MOCK` and cannot be QA'd, demoed, or screenshotted offline.
   */
  backendRefused: string[];
  pageErrors: string[];
}

/**
 * Collect every visible interactive control with its computed geometry and
 * accessible name.
 *
 * The accessible-name computation here is an APPROXIMATION of the full accname
 * algorithm — enough to answer "does this control have any name at all", which is
 * the finding that matters, and deliberately not enough to be quoted as a
 * conformance result. Where it differs from a real AT, it errs toward finding a
 * name, so a control this reports as unnamed is unnamed.
 */
async function collect(page: Page, route: string): Promise<Omit<PageRecord, "appConsoleErrors" | "backendRefused" | "pageErrors" | "ok" | "status">> {
  return page.evaluate(
    ({ route }) => {
      const SELECTOR = [
        "button", "a[href]", "input:not([type=hidden])", "select", "textarea",
        "summary", "[role=button]", "[role=link]", "[role=tab]", "[role=switch]",
        "[role=menuitem]", "[role=checkbox]", "[role=radio]", "[tabindex]:not([tabindex='-1'])",
      ].join(", ");

      const text = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

      function accName(el: Element): string {
        const aria = el.getAttribute("aria-label");
        if (aria?.trim()) return aria.trim();

        const labelledby = el.getAttribute("aria-labelledby");
        if (labelledby) {
          const joined = labelledby.split(/\s+/).map((id) => text(document.getElementById(id))).filter(Boolean).join(" ");
          if (joined) return joined;
        }

        if (el.id) {
          const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
          if (text(label)) return text(label);
        }
        const wrapping = el.closest("label");
        if (wrapping && text(wrapping)) return text(wrapping);

        if (text(el)) return text(el);

        // An icon-only control often carries its name on the inner <svg> or <img>.
        const inner = el.querySelector("[aria-label], img[alt], title");
        if (inner) {
          const n = inner.getAttribute("aria-label") ?? inner.getAttribute("alt") ?? text(inner);
          if (n?.trim()) return n.trim();
        }

        const title = el.getAttribute("title");
        if (title?.trim()) return title.trim();

        // Placeholder and value are NOT accessible names in the spec sense, but a
        // control carrying one is a different (weaker) finding than a control
        // carrying nothing, so mark it rather than calling it unnamed.
        const ph = el.getAttribute("placeholder");
        if (ph?.trim()) return `«placeholder: ${ph.trim()}»`;
        const val = (el as HTMLInputElement).value;
        if (typeof val === "string" && val.trim()) return `«value: ${val.trim()}»`;

        return "";
      }

      /**
       * A link sitting among text in a prose block — the SC 2.5.8 inline exception.
       *
       * DIV IS IN THE LIST, and the display guard below is why it can be. Without
       * DIV this reported the "email legal@proculink.eu with your organisation's
       * legal name" link on /dpa as a failure: the sentence lives in a callout
       * <div>, not a <p>, and the tag allowlist could not see that. Enlarging that
       * link would break the line it sits in — which is the exact thing the SC
       * exempts — so the finding was mine, not the product's.
       *
       * DIV alone would be too broad: a link ROW is usually a <div> too, and one
       * stray text node ("Filters", a separator) would exempt every link in it. So
       * the parent must also be in NORMAL TEXT FLOW. A sentence is; a flex or grid
       * row is not, and that is what separates the two cases.
       */
      function isInlineInText(el: Element): boolean {
        if (el.tagName !== "A") return false;
        const PROSE = ["P", "LI", "TD", "TH", "DD", "DT", "BLOCKQUOTE", "FIGCAPTION", "SPAN", "SMALL", "EM", "STRONG", "LABEL", "DIV"];
        const FLOW = ["block", "inline", "inline-block", "list-item", "table-cell"];
        let parent = el.parentElement;
        while (parent && PROSE.includes(parent.tagName) && FLOW.includes(getComputedStyle(parent).display)) {
          // Text belonging to the parent but NOT to this link = the link is in a sentence.
          const own = Array.from(parent.childNodes)
            .filter((n) => n.nodeType === Node.TEXT_NODE)
            .map((n) => n.textContent ?? "")
            .join("")
            .trim();
          if (own.length > 0) return true;
          parent = parent.parentElement;
        }
        return false;
      }

      function hasScrollingAncestor(el: Element): boolean {
        let node: Element | null = el.parentElement;
        while (node && node !== document.body) {
          const s = getComputedStyle(node);
          if (/auto|scroll/.test(s.overflowX) && node.scrollWidth > node.clientWidth + 1) return true;
          node = node.parentElement;
        }
        return false;
      }

      const vw = window.innerWidth;
      const controls: ControlRecord[] = [];
      const seen = new Set<Element>();

      for (const el of Array.from(document.querySelectorAll(SELECTOR))) {
        if (seen.has(el)) continue;
        seen.add(el);

        const style = getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") continue;
        // SC 2.5.8 measures "the region that would accept a pointer action" for the
        // control, and a wrapping <label> forwards its clicks to the control — so
        // the label's box IS the target, not the input's. Two real cases: the
        // /library/standards search box, where the <input> is 18.8px inside a 32px
        // <label>, and the inbox checkboxes, which are 13px by design inside a 24px
        // one. Measuring the input reported both as failures when neither is.
        //
        // Only ever GROWS the measured box, and only for a label that really
        // contains this control, so it cannot hide a small target that has none.
        let rect = el.getBoundingClientRect();
        const label = el.closest("label");
        if (label && label !== el) {
          const lr = label.getBoundingClientRect();
          if (lr.width >= rect.width && lr.height >= rect.height) rect = lr;
        }
        if (rect.width === 0 || rect.height === 0) continue;

        controls.push({
          route,
          tag: el.tagName.toLowerCase(),
          role: el.getAttribute("role"),
          name: accName(el),
          width: Math.round(rect.width * 10) / 10,
          height: Math.round(rect.height * 10) / 10,
          disabled: el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true",
          overflowRight: Math.max(0, Math.round(rect.right - vw)),
          box: {
            x: Math.round(rect.x * 10) / 10,
            y: Math.round(rect.y * 10) / 10,
            w: Math.round(rect.width * 10) / 10,
            h: Math.round(rect.height * 10) / 10,
          },
          inlineInText: isInlineInText(el),
          visuallyHidden: rect.width <= 1 || rect.height <= 1 || /inset\(50%\)|rect\(0/.test(style.clipPath + style.clip),
          inScrollContainer: hasScrollingAncestor(el),
          crowded: false, // filled in below, once every control on the page is known
        });
      }

      // The spacing exception. The SC does not require a 24px target: it requires
      // that a 24px circle centred on the target does not touch another target's
      // circle. A row of 20px icons with real gaps passes; two jammed together
      // does not. On this app the exception carries almost everything: 17
      // controls are still under 24px at desktop and NONE of them has a
      // neighbour inside its circle, so size alone would report 17 failures
      // where the SC has none.
      //
      // Two circles of equal diameter intersect when their centres are closer
      // than one diameter, so centre distance is the honest test. Where the
      // NEIGHBOUR is already 24px or wider the SC would use its own bounds, and
      // this is slightly stricter than that — stricter is the safe direction for
      // a gate, and saying which way it errs is the point of writing it down.
      //
      // NOT implemented: the `enclosed`, `essential` and `user-agent control`
      // exceptions. All three would only ever REDUCE the count, so this stays an
      // upper bound.
      const boxed = controls.filter((c) => c.box.w > 0 && c.box.h > 0);
      for (const c of controls) {
        const cx = (b: { x: number; y: number; w: number; h: number }) => b.x + b.w / 2;
        const cy = (b: { x: number; y: number; w: number; h: number }) => b.y + b.h / 2;
        c.crowded = boxed.some(
          (o) => o !== c && Math.hypot(cx(c.box) - cx(o.box), cy(c.box) - cy(o.box)) < 24,
        );
      }

      // Heading order. A skipped level (h2 → h4) is a real screen-reader
      // navigation defect and is invisible to every other check in this repo.
      const headings = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6"));
      const skips: string[] = [];
      let prev = 0;
      for (const h of headings) {
        const level = Number(h.tagName[1]);
        if (prev && level > prev + 1) skips.push(`h${prev} → h${level} ("${text(h).slice(0, 40)}")`);
        prev = level;
      }

      return {
        route,
        horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - vw),
        h1Count: document.querySelectorAll("h1").length,
        headingSkips: skips,
        controls,
      };
    },
    { route },
  );
}

const { routes, skipped } = sweepRoutes();

test.describe("control sweep", () => {
  // PARALLEL, and the first attempt at this file got it wrong. `mode: "serial"`
  // looked right — one page's console listener must not catch another page's
  // noise — but listeners are bound to the per-test `page` fixture, so they are
  // already isolated. What serial actually bought was: the first failing route
  // SKIPPED the other 39. A sweep that stops at its first finding is not a sweep.
  //
  // Records are therefore written one file per route rather than accumulated in a
  // module-level array: with parallel workers each worker has its own module
  // instance, so an in-memory array would silently report a fraction of the run.

  for (const route of routes) {
    test(`${route.path}`, async ({ page }, testInfo) => {
      const appConsoleErrors: string[] = [];
      const backendRefused: string[] = [];
      const pageErrors: string[] = [];

      page.on("console", (m) => {
        if (m.type() !== "error") return;
        const t = m.text();
        // Next.js dev overlay and HMR chatter are not app defects.
        if (/Failed to load resource.*favicon|\[Fast Refresh\]|Download the React DevTools/.test(t)) return;
        if (/ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET|Failed to fetch/.test(t)) {
          backendRefused.push(t);
          return;
        }
        appConsoleErrors.push(t);
      });
      page.on("pageerror", (e) => pageErrors.push(String(e)));

      const response = await page.goto(route.path, { waitUntil: "domcontentloaded" });
      // Give client-side data a beat to resolve. Mock mode is in-memory, so this
      // is generous rather than tight.
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

      const status = response?.status() ?? null;
      const collected = await collect(page, route.path);
      const record: PageRecord = {
        ...collected,
        ok: status !== null && status < 400,
        status,
        appConsoleErrors,
        backendRefused,
        pageErrors,
      };
      mkdirSync(join(OUT_DIR, testInfo.project.name), { recursive: true });
      writeFileSync(
        join(OUT_DIR, testInfo.project.name, `${route.pattern.replace(/\W+/g, "_") || "root"}.json`),
        JSON.stringify(record, null, 2),
      );

      await testInfo.attach(`${route.pattern.replace(/\W+/g, "_")}.json`, {
        body: JSON.stringify(record, null, 2),
        contentType: "application/json",
      });

      // ── SOFT, deliberately ──────────────────────────────────────────────────
      // `expect.soft` records the failure and keeps going, so one bad route
      // reports its finding without costing the rest of the sweep. The run still
      // ends red, which is what makes it a gate rather than a log.
      expect.soft(record.ok, `${route.path} did not render (HTTP ${status})`).toBe(true);
      expect.soft(record.pageErrors, `${route.path} threw during render`).toEqual([]);
      expect.soft(record.appConsoleErrors, `${route.path} logged console errors`).toEqual([]);
      expect
        .soft(
          record.horizontalOverflow,
          `${route.path} scrolls horizontally by ${record.horizontalOverflow}px at this viewport`,
        )
        .toBe(0);

      // WCAG 2.2 SC 2.5.8, level AA. Zero failures now — and, the part worth
      // recording, zero on the day the sweep first ran too. The report that said
      // 49 on desktop, 10 on mobile and 7 on tablet was comparing each control
      // against every control IN THE PROJECT rather than on its own page, so a
      // button on /inbox came back crowded by a link on /pricing that happened to
      // sit 5px away in viewport coordinates. All 66 were ghosts. Deciding the
      // verdict here, per page, is what makes that mistake unavailable.
      //
      // Asserted anyway, because the CAUSE is real and shipped even though this
      // SC never caught it: a standalone <Link> inside a <p> renders as an inline
      // box, and `min-height` does not apply to one (CSS 2.1 §10.7) — so the 44px
      // floor in globals.css was silently inert on the sign-in link of 19
      // marketing routes, five legal pages' cross-link rows and both topbar
      // breadcrumbs. tap-targets.spec.ts is what measured that; it checks HEIGHT
      // at 390px, which is why the width shortfalls here were invisible to it.
      //
      // MUTATION-PROVED 2026-08-27, and the first attempt was the useful one:
      // reverting one of those links to `inline` does NOT fail this, because it
      // is under 24px with nothing inside its circle — the exception working, not
      // the check failing. Widening the diameter to 200 turns / and the admin
      // guide routes red, which is what proves the field is recorded, the filter
      // selects, and the expectation bites.
      const tooSmall = record.controls.filter(
        (c) =>
          c.crowded &&
          !c.disabled &&
          !c.inlineInText &&
          !c.visuallyHidden &&
          (c.width < 24 || c.height < 24),
      );
      expect
        .soft(
          tooSmall.map((c) => `<${c.tag}> "${c.name}" ${c.width}x${c.height}`),
          `${route.path}: target under 24px with another target inside its 24px circle (WCAG 2.2 SC 2.5.8)`,
        )
        .toEqual([]);
    });
  }

  // Playwright REQUIRES the object-destructuring pattern for the fixtures
  // argument and rejects `(_fixtures, testInfo)` at load time with "First
  // argument must use the object destructuring pattern". eslint's
  // no-empty-pattern objects to the `{}` that satisfies it, so the rule is
  // disabled for this one line rather than the framework being fought. Found by
  // running the spec after "fixing" the lint error, which is the only way this
  // surfaces — it is a runtime load error, not a type error.
  // eslint-disable-next-line no-empty-pattern
  test.afterAll(async ({}, testInfo) => {
    // Aggregation deliberately does NOT live here. With parallel workers this hook
    // runs once per worker and can only see that worker's routes, so an aggregate
    // printed from here would under-report and look authoritative doing it. Each
    // route writes its own file above; `bun run sweep:report` merges them.
    console.log(`[${testInfo.project.name}] per-route records in .qa-sweep/${testInfo.project.name}/ — merge with: node scripts/sweep-report.mjs`);
  });
});
