import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

/**
 * WP-02 regression guard (frontend half): a Playwright test must either assert something
 * or be skipped by a DECLARED condition. It may never quietly decide, mid-flight, that it
 * does not apply — and it may never swallow the failure of the step it is named after.
 *
 * Six shapes are banned in tests/e2e. The first two shipped in PR #45; the rest are the
 * shapes that walked straight past that guard.
 *
 *   1. `if (cond) { test.skip(true, "…"); return; }`
 *      An if-wrapped self-skip with a dead `return` after it. The condition belongs in the
 *      annotation — `test.skip(cond, "reason")` — so the skip and its reason are reported
 *      identically on every run instead of depending on control flow.
 *
 *   2. `test.skip(true, "…")` anywhere after the test has started doing work.
 *      This is the mid-body self-skip. It let a test navigate, click, call the API, and then
 *      declare itself inapplicable — so `GET /api/connections` returning 500 was reported as
 *      "skipped" and the suite still read clean. A failing dependency must fail the test.
 *
 *   3. A `test(...)` body with zero assertions.
 *      Playwright reports a body that only navigates and clicks as PASSED. Nothing was
 *      checked, so nothing can regress. Asserting through a named helper is fine — the
 *      helper has to be declared in ASSERT_HELPERS below, exactly as it is declared for
 *      `playwright/expect-expect` in eslint.config.js.
 *
 *   4. `test.fixme(...)`.
 *      A test annotated as known-broken. Playwright counts it as a non-failure forever, so
 *      the defect it documents has no deadline and no owner.
 *
 *   5. `test.only(...)` / `test.describe.only(...)`.
 *      Locally it focuses one test; committed, it deletes the rest of the file from the run.
 *      `forbidOnly` in playwright.config.ts catches this in CI, but only for a run that
 *      actually starts — this catches it in the unit suite, before the browser boots.
 *
 *   6. `await <interaction>().catch(() => {})`.
 *      The interaction the test is named after, with its failure discarded. "Supplier detail
 *      tabs" that cannot select a format still passes, because the selectOption that failed
 *      was wrapped in an empty catch. Waiting (`waitForLoadState`, `isVisible`, `count`) may
 *      be tolerant; ACTING may not.
 *
 * `test.skip(<condition>, "reason")` at the top of a body or at describe level is the correct
 * form and is explicitly allowed — see the allowed-fixture test for every rule below.
 *
 * The backend twin is ProcuLink.Api.Tests/Meta/NoVacuousTestPassTests.cs.
 */

const E2E_DIR = resolve(__dirname, "../../tests/e2e");

/**
 * Functions that count as an assertion when a test body contains no direct `expect(`.
 * Kept in lockstep with PLAYWRIGHT_ASSERT_HELPERS in eslint.config.js — two gates, one list,
 * so a helper can never be legal to one and vacuous to the other.
 */
const ASSERT_HELPERS = ["expect", "visitAndAssertHealthy"];

/** Literal `test.skip(true, …)` — the self-skip, as opposed to `test.skip(cond, …)`. */
const UNCONDITIONAL_SKIP = /\btest\.skip\(\s*true\b/;

/** `if (…) {` on one line and a `test.skip(` within the next few — the if-wrapped self-skip. */
const IF_LINE = /^\s*if\s*\(/;

/** `test.fixme(` / `.fixme(` on any test or describe. */
const FIXME = /\btest(\.\w+)*\.fixme\s*\(/;

/** `test.only(` / `test.describe.only(` — a committed focus deletes the rest of the file. */
const ONLY = /\btest(\.\w+)*\.only\s*\(/;

/** The opening line of a `test("name", …)` block (NOT test.describe / test.skip / test.only). */
const TEST_OPEN = /^(\s*)test\s*\(\s*["'`]/;

/** Verbs that CHANGE the page. Waiting and querying are allowed to be tolerant; acting is not. */
const INTERACTION =
  /\.(click|dblclick|fill|press|check|uncheck|selectOption|setInputFiles|type|hover|tap|dragTo|focus|clear|goto)\s*\(/;

/** A catch handler that discards the error: `() => {`, `() => null`, `() => false`, … */
const SWALLOWING_CATCH = /\.catch\s*\(\s*\(\s*\)\s*=>\s*(\{|null\b|false\b|undefined\b|void\b)/;

/**
 * Offenders that exist in tests/e2e TODAY and are NOT fixed here.
 *
 * **Currently empty, and that is the goal state.** It briefly held the two swallowed interactions
 * in `live-full-e2e.spec.ts` — `selectOption(fmt).catch(() => {})` and `expandable.click().catch(() => {})`
 * — while that file belonged to a concurrent work packet. Both are now fixed: the format selector
 * pins its six options and asserts the selection took, and the row toggle is targeted by its
 * accessible name and asserts `aria-expanded` flips.
 *
 * Entries are keyed on exact source text, not line number, so a concurrent edit above them cannot
 * invalidate one. The count assertion below makes this a ratchet in both directions: a NEW
 * swallowed interaction fails the guard, and fixing a listed one fails the guard until its entry
 * is deleted.
 *
 * This list may only ever shrink. Do not add to it.
 */
const KNOWN_UNFIXED: { file: string; text: string }[] = [];

interface Offence {
  file: string;
  line: number;
  text: string;
  rule: string;
}

function specFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return specFiles(full);
    return full.endsWith(".spec.ts") ? [full] : [];
  });
}

/**
 * The lines of a `test("…", …)` body, found by matching the closer at the SAME indentation
 * as the opener. The repo is prettier-formatted, so `  test(` closes on `  });` — nested
 * blocks always close deeper and cannot terminate the scan early.
 */
function testBody(lines: string[], openIndex: number, indent: string): string[] {
  const closer = new RegExp(`^${indent}\\}\\s*\\)\\s*;?\\s*$`);
  for (let j = openIndex + 1; j < lines.length; j++) {
    if (closer.test(lines[j])) return lines.slice(openIndex, j + 1);
  }
  // Unterminated — hand back the rest of the file rather than silently reporting "no body".
  return lines.slice(openIndex);
}

/**
 * `expect.soft(...)` and `expect.poll(...)` are assertions, and this gate could not
 * see either of them.
 *
 * The pattern was a literal call — `expect` followed by `(` — so a MEMBER form put
 * a `.` where the `(` had to be, and the body read as having no assertion at all.
 * Found 2026-08-26 by the first spec in the repo to use soft assertions: a
 * fully-asserting 40-route sweep was reported as "navigating and clicking without
 * checking anything".
 *
 * That is the one-directional shape this repo keeps producing — the gate encoded
 * the call form of the day and went blind to the same assertion rotated. The two
 * modifiers are listed explicitly rather than matched as `.\w+`, so a member that
 * is NOT an assertion (`expect.configure(...)`) still does not count.
 *
 * eslint's `playwright/expect-expect` already understands these forms, so the
 * lockstep note on ASSERT_HELPERS still holds: the list of helper NAMES is
 * unchanged, and only this gate's call-shape pattern was too narrow.
 */
const ASSERT_MODIFIERS = ["soft", "poll"];

function hasAssertion(body: string[]): boolean {
  const text = body.join("\n");
  const modifier = `(?:\\.(?:${ASSERT_MODIFIERS.join("|")}))?`;
  return ASSERT_HELPERS.some((fn) => new RegExp(`\\b${fn}${modifier}\\s*\\(`).test(text));
}

function scan(source: string, file: string): Offence[] {
  const lines = source.split(/\r?\n/);
  const found: Offence[] = [];
  const push = (i: number, rule: string) =>
    found.push({ file, line: i + 1, text: lines[i].trim(), rule });

  lines.forEach((line, i) => {
    if (FIXME.test(line)) {
      push(i, "test.fixme — a known-broken test Playwright never fails. Fix it or delete it.");
    }

    if (ONLY.test(line)) {
      push(i, "test.only — committed, this deletes every other test in the file from the run.");
    }

    if (line.includes("await") && SWALLOWING_CATCH.test(line) && INTERACTION.test(line)) {
      push(
        i,
        "an awaited interaction with an empty .catch — the step the test is named after " +
          "can fail and the test still passes. Let it throw, or assert the fallback.",
      );
    }

    const open = TEST_OPEN.exec(line);
    if (open && !hasAssertion(testBody(lines, i, open[1]))) {
      push(
        i,
        `test body has no assertion (none of ${ASSERT_HELPERS.join("/")}). Navigating and ` +
          "clicking without checking anything reports PASSED and guards nothing.",
      );
    }

    if (UNCONDITIONAL_SKIP.test(line)) {
      push(i, 'test.skip(true, …) — a self-skip. Use test.skip(<condition>, "reason") instead.');
      return;
    }

    // if (...) on this line, with a test.skip( inside the next 3 lines.
    if (IF_LINE.test(line)) {
      const window = lines.slice(i + 1, i + 4).join("\n");
      if (/\btest\.skip\(/.test(window)) {
        push(i, 'if-wrapped test.skip — hoist the condition into test.skip(<condition>, "reason").');
      }
    }
  });

  return found;
}

function scanAll(): Offence[] {
  return specFiles(E2E_DIR).flatMap((file) =>
    scan(readFileSync(file, "utf8"), relative(E2E_DIR, file).split(sep).join("/")),
  );
}

const isKnownUnfixed = (o: Offence) =>
  KNOWN_UNFIXED.some((k) => k.file === o.file && k.text === o.text);

const report = (offences: Offence[]) =>
  offences.map((o, i) => `  ${i + 1}. ${o.file}:${o.line}  ${o.text}\n      ${o.rule}`).join("\n");

describe("no vacuous Playwright tests", () => {
  it("reads the e2e specs it claims to check", () => {
    // Without this the suite below passes trivially if the path ever moves — the same
    // vacuous-pass failure mode this file exists to prevent.
    const files = specFiles(E2E_DIR);
    expect(files.length).toBeGreaterThan(10);
    expect(files.map((f) => relative(E2E_DIR, f))).toContain("error-recovery.spec.ts");
  });

  it("scans every rule against real source, not just its own fixtures", () => {
    // The second half of the self-check: the scanner must actually be looking at each
    // banned shape. A rule that was accidentally unreachable — a bad regex, a renamed
    // constant — would report zero offences forever and read exactly like a clean tree.
    // Every rule below is proved live against the real e2e sources.
    const source = specFiles(E2E_DIR)
      .map((f) => readFileSync(f, "utf8"))
      .join("\n");
    expect(source.length).toBeGreaterThan(10_000);
    // The declared-condition skip is present and is NOT reported — proof rule 1/2 ran.
    expect(source).toMatch(/test\.skip\(\s*(!?)process\.env\.PLAYWRIGHT_LIVE/);
    // Real test blocks exist for rule 3 to walk.
    expect(source.match(/^\s*test\s*\(\s*["'`]/gm)?.length ?? 0).toBeGreaterThan(50);
    // The swallowed-interaction rule has live input AND its discrimination is exercised: the real
    // specs do contain an empty .catch on a tolerated waiting call, which must be present and must
    // NOT be reported. (This used to assert the two known offenders were found — which stopped
    // proving anything the moment they were fixed and the list emptied to zero. A self-check that
    // goes vacuous when the tree gets clean is the bug this file exists to catch.)
    expect(source).toMatch(/waitForLoadState\([^)]*\)\s*\.catch\(\s*\(\s*\)\s*=>/);
    expect(scanAll().filter((o) => o.rule.startsWith("an awaited interaction"))).toEqual([]);
  });

  it("has no vacuous test in tests/e2e", () => {
    const offences = scanAll().filter((o) => !isKnownUnfixed(o));

    expect(
      offences,
      `Playwright tests that cannot fail:\n${report(offences)}`,
    ).toEqual([]);
  });

  it("keeps the known-unfixed list a ratchet — it may only shrink", () => {
    // Fixing one of these must delete its entry. Left behind, a stale entry would go on
    // exempting a shape that no longer exists and could silently re-admit it later.
    const live = scanAll();
    const stale = KNOWN_UNFIXED.filter(
      (k) => !live.some((o) => o.file === k.file && o.text === k.text),
    );
    expect(
      stale,
      `KNOWN_UNFIXED entries no longer present in tests/e2e — delete them:\n` +
        stale.map((s) => `  ${s.file}  ${s.text}`).join("\n"),
    ).toEqual([]);
    // Never grow. Both original entries are fixed, so the ratchet is now pinned at zero: a future
    // exemption has to change this line, in a diff a reviewer can see.
    expect(KNOWN_UNFIXED.length).toBe(0);
  });

  // ── Rule 1/2: self-skip ─────────────────────────────────────────────────────

  it("flags a synthetic self-skip", () => {
    const offender = [
      'test("does a thing", async ({ page }) => {',
      '  await page.goto("/x");',
      '  expect(1).toBe(1);',
      '  test.skip(true, "nothing to see");',
      "});",
    ].join("\n");

    const rules = scan(offender, "Synthetic.spec.ts").map((o) => o.rule);
    expect(rules.some((r) => r.includes("self-skip"))).toBe(true);
  });

  it("flags a synthetic if-wrapped skip", () => {
    const offender = [
      'test("does a thing", async () => {',
      "  if (!process.env.PLAYWRIGHT_LIVE) {",
      '    test.skip(true, "needs live");',
      "    return;",
      "  }",
      "  expect(1).toBe(1);",
      "});",
    ].join("\n");

    const rules = scan(offender, "Synthetic.spec.ts").map((o) => o.rule);
    expect(rules.some((r) => r.includes("if-wrapped"))).toBe(true);
  });

  it("allows a declared conditional skip", () => {
    const fine = [
      'test.describe("live only", () => {',
      '  test.skip(process.env.PLAYWRIGHT_LIVE !== "1", "requires a backend");',
      '  test("works", async () => { expect(1).toBe(1); });',
      "});",
    ].join("\n");

    expect(scan(fine, "Synthetic.spec.ts")).toEqual([]);
  });

  // ── Rule 3: a body with no assertion ────────────────────────────────────────

  it("flags a test body with no assertion", () => {
    const offender = [
      'test("uploads a file", async ({ page }) => {',
      '  await page.goto("/upload");',
      '  await page.getByRole("button", { name: "Upload" }).click();',
      "});",
    ].join("\n");

    const rules = scan(offender, "Synthetic.spec.ts").map((o) => o.rule);
    expect(rules.some((r) => r.includes("no assertion"))).toBe(true);
  });

  it("counts expect.soft and expect.poll — an assertion wearing a modifier", () => {
    // The regression this pins. The pattern used to be a literal `expect(` call, so
    // a MEMBER form put a `.` exactly where the `(` had to be and the whole body
    // read as unasserted. tests/e2e/control-sweep.spec.ts — 40 routes, four soft
    // assertions each — was reported as "navigating and clicking without checking
    // anything" on the day it was written.
    const soft = [
      'test("sweeps a route", async ({ page }) => {',
      '  await page.goto("/inbox");',
      "  expect.soft(await page.title()).toContain(\"ProcuLink\");",
      "});",
    ].join("\n");
    expect(scan(soft, "Synthetic.spec.ts")).toEqual([]);

    const poll = [
      'test("waits for a count", async ({ page }) => {',
      "  await expect.poll(() => page.locator(\"tr\").count()).toBeGreaterThan(0);",
      "});",
    ].join("\n");
    expect(scan(poll, "Synthetic.spec.ts")).toEqual([]);
  });

  it("still refuses a non-asserting member of expect", () => {
    // The other direction, and the reason the modifiers are listed explicitly
    // instead of matched as `.\\w+`: `expect.configure` returns a configured expect,
    // it does not assert anything, so a body containing only that call is vacuous.
    const configured = [
      'test("configures and does nothing", async ({ page }) => {',
      "  const e = expect.configure({ timeout: 1000 });",
      '  await page.goto("/inbox");',
      "});",
    ].join("\n");
    expect(scan(configured, "Synthetic.spec.ts").some((o) => o.rule.includes("no assertion"))).toBe(true);
  });

  it("allows a body that asserts directly, or through a declared helper", () => {
    const direct = [
      'test("uploads a file", async ({ page }) => {',
      '  await page.goto("/upload");',
      '  await expect(page.getByRole("heading")).toBeVisible();',
      "});",
    ].join("\n");
    expect(scan(direct, "Synthetic.spec.ts")).toEqual([]);

    const viaHelper = [
      'test("renders cleanly", async ({ page }) => {',
      '  await visitAndAssertHealthy(page, "/bridge");',
      "});",
    ].join("\n");
    expect(scan(viaHelper, "Synthetic.spec.ts")).toEqual([]);
  });

  it("does not mistake a nested block's closer for the end of the body", () => {
    // The body-finder matches indentation, so the inner `});` must not truncate the scan
    // and make an asserting test look assertion-free.
    const nested = [
      '  test("iterates", async ({ page }) => {',
      '    await page.goto("/x");',
      "    await page.waitForFunction(() => {",
      "      return true;",
      "    });",
      '    await expect(page.getByRole("main")).toBeVisible();',
      "  });",
    ].join("\n");

    expect(scan(nested, "Synthetic.spec.ts")).toEqual([]);
  });

  // ── Rule 4: fixme ───────────────────────────────────────────────────────────

  it("flags test.fixme", () => {
    const offender = [
      'test.fixme("known broken", async ({ page }) => {',
      '  await page.goto("/x");',
      '  expect(1).toBe(1);',
      "});",
    ].join("\n");

    const rules = scan(offender, "Synthetic.spec.ts").map((o) => o.rule);
    expect(rules.some((r) => r.includes("fixme"))).toBe(true);
  });

  it("allows a test whose NAME merely mentions fixme", () => {
    const fine = [
      'test("fixme banner is not shown to operators", async ({ page }) => {',
      '  await expect(page.getByText("fixme")).toHaveCount(0);',
      "});",
    ].join("\n");

    expect(scan(fine, "Synthetic.spec.ts")).toEqual([]);
  });

  // ── Rule 5: only ────────────────────────────────────────────────────────────

  it("flags test.only and test.describe.only", () => {
    const offender = [
      'test.only("just this one", async ({ page }) => {',
      '  await expect(page).toHaveTitle(/x/);',
      "});",
      'test.describe.only("just this block", () => {});',
    ].join("\n");

    const rules = scan(offender, "Synthetic.spec.ts").map((o) => o.rule);
    expect(rules.filter((r) => r.includes("test.only"))).toHaveLength(2);
  });

  it("allows the ordinary test and describe forms", () => {
    const fine = [
      'test.describe("a block", () => {',
      '  test("a test", async ({ page }) => { await expect(page).toHaveTitle(/x/); });',
      "});",
    ].join("\n");

    expect(scan(fine, "Synthetic.spec.ts")).toEqual([]);
  });

  // ── Rule 6: an awaited interaction with its failure swallowed ───────────────

  it("flags an awaited interaction wrapped in an empty catch", () => {
    const offender = [
      'test("expands the row", async ({ page }) => {',
      "  await row.click().catch(() => {});",
      "  await select.selectOption(fmt).catch(() => {",
      "    // tolerate",
      "  });",
      "  await input.fill(\"x\").catch(() => null);",
      '  await expect(page.getByRole("main")).toBeVisible();',
      "});",
    ].join("\n");

    const rules = scan(offender, "Synthetic.spec.ts").map((o) => o.rule);
    expect(rules.filter((r) => r.includes("empty .catch"))).toHaveLength(3);
  });

  it("allows a tolerant WAIT or QUERY — only acting must be strict", () => {
    const fine = [
      'test("settles", async ({ page }) => {',
      '  await page.goto("/x");',
      '  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});',
      "  if (await banner.isVisible({ timeout: 2_000 }).catch(() => false)) {",
      "    await banner.click();",
      "  }",
      "  const body = await res.json().catch(() => null);",
      '  await expect(page.getByRole("main")).toBeVisible();',
      "});",
    ].join("\n");

    expect(scan(fine, "Synthetic.spec.ts")).toEqual([]);
  });
});
