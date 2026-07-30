import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

/**
 * WP-02 regression guard (frontend half): a Playwright test must be skipped by a DECLARED
 * condition, never by deciding mid-flight that it does not apply.
 *
 * Two patterns are banned in tests/e2e:
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
 * `test.skip(<condition>, "reason")` at the top of a body or at describe level is the correct
 * form and is explicitly allowed.
 *
 * The backend twin is ProcuLink.Api.Tests/Meta/NoVacuousTestPassTests.cs.
 */

const E2E_DIR = resolve(__dirname, "../../tests/e2e");

/** Literal `test.skip(true, …)` — the self-skip, as opposed to `test.skip(cond, …)`. */
const UNCONDITIONAL_SKIP = /\btest\.skip\(\s*true\b/;

/** `if (…) {` on one line and a `test.skip(` within the next few — the if-wrapped self-skip. */
const IF_LINE = /^\s*if\s*\(/;

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

function scan(source: string, file: string): Offence[] {
  const lines = source.split(/\r?\n/);
  const found: Offence[] = [];

  lines.forEach((line, i) => {
    if (UNCONDITIONAL_SKIP.test(line)) {
      found.push({
        file,
        line: i + 1,
        text: line.trim(),
        rule: "test.skip(true, …) — a self-skip. Use test.skip(<condition>, \"reason\") instead.",
      });
      return;
    }

    // if (...) on this line, with a test.skip( inside the next 3 lines.
    if (IF_LINE.test(line)) {
      const window = lines.slice(i + 1, i + 4).join("\n");
      if (/\btest\.skip\(/.test(window)) {
        found.push({
          file,
          line: i + 1,
          text: line.trim(),
          rule: "if-wrapped test.skip — hoist the condition into test.skip(<condition>, \"reason\").",
        });
      }
    }
  });

  return found;
}

describe("no vacuous Playwright skips", () => {
  it("reads the e2e specs it claims to check", () => {
    // Without this the suite below passes trivially if the path ever moves — the same
    // vacuous-pass failure mode this file exists to prevent.
    const files = specFiles(E2E_DIR);
    expect(files.length).toBeGreaterThan(10);
    expect(files.map((f) => relative(E2E_DIR, f))).toContain("error-recovery.spec.ts");
  });

  it("has no self-skip or if-wrapped skip in tests/e2e", () => {
    const offences = specFiles(E2E_DIR).flatMap((file) =>
      scan(readFileSync(file, "utf8"), relative(E2E_DIR, file).split(sep).join("/")),
    );

    const report = offences
      .map((o, i) => `  ${i + 1}. ${o.file}:${o.line}  ${o.text}\n      ${o.rule}`)
      .join("\n");

    expect(offences, `Playwright tests that skip themselves at runtime:\n${report}`).toEqual([]);
  });

  it("flags a synthetic self-skip", () => {
    const offender = [
      'test("does a thing", async ({ page }) => {',
      '  await page.goto("/x");',
      '  test.skip(true, "nothing to see");',
      "});",
    ].join("\n");

    expect(scan(offender, "Synthetic.spec.ts")).toHaveLength(1);
  });

  it("flags a synthetic if-wrapped skip", () => {
    const offender = [
      'test("does a thing", async () => {',
      "  if (!process.env.PLAYWRIGHT_LIVE) {",
      '    test.skip(true, "needs live");',
      "    return;",
      "  }",
      "});",
    ].join("\n");

    // The `if (` line and the `test.skip(true` line are both reported.
    expect(scan(offender, "Synthetic.spec.ts").length).toBeGreaterThan(0);
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
});
