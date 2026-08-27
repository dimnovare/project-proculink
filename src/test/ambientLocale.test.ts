import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * No formatter may resolve its locale from the host.
 *
 * WHAT THIS PREVENTS, AND WHY IT IS NOT HYPOTHETICAL. `n.toLocaleString()` with no
 * locale argument uses whatever locale the RUNTIME defaults to. On the Node server
 * that is the container's ICU default; in the browser it is the user's. Grouping
 * separators differ — `1,284` (en-GB) vs `1.284` (de-DE) vs `1 284` (fr-FR) — so
 * the SSR pass and the hydration pass produce two different strings and React
 * throws the server tree away.
 *
 * `src/lib/format-date.ts` has said exactly this since it was written:
 *
 *   "Passing `undefined` as the locale (the old per-component helpers did)
 *    resolves to the host's runtime locale, which differs between the server
 *    process and the user's browser — the classic source of hydration drift on
 *    dates. Do NOT swap this back to the ambient locale."
 *
 * The lesson was learned, written down, and applied to dates only. Forty numeric
 * call sites went on calling the ambient locale, and the three-viewport control
 * sweep caught two of them failing in production code on 2026-08-26:
 *
 *   /library/suppliers/s1 — server "1284", client "1,284"
 *   /library/buyers       — server "1820", client "1,820"
 *
 * This guard exists so the other half of the lesson cannot be un-learned. It is
 * the shape of guard this repo keeps needing: the defect was not a wrong value,
 * it was an ABSENT argument, and nothing about an absent argument is visible in
 * review.
 *
 * SCOPE, STATED HONESTLY. This scans `src/` for the ambient-locale call FORMS. It
 * cannot prove a locale-stable render — a component could still format through a
 * helper this does not know about. What it can prove is that the specific hole
 * that cost two hydration failures is closed and stays closed.
 */

const SRC = join(process.cwd(), "src");

/** Production source only. A guard that scans its own fixtures reports on itself. */
function walk(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== "node_modules" && entry !== ".next") out.push(...walk(full));
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * The three ways to ask for a locale and not name one. `Intl.*Format()` with no
 * arguments is the same defect wearing a different constructor, and was missed by
 * the first draft of this guard — which is exactly how a one-directional guard
 * goes blind to its own defect rotated.
 */
const AMBIENT_FORMS: { pattern: RegExp; what: string }[] = [
  { pattern: /\.toLocaleString\(\s*\)/g, what: ".toLocaleString() with no locale" },
  { pattern: /\.toLocaleDateString\(\s*\)/g, what: ".toLocaleDateString() with no locale" },
  { pattern: /\.toLocaleTimeString\(\s*\)/g, what: ".toLocaleTimeString() with no locale" },
  { pattern: /new Intl\.(NumberFormat|DateTimeFormat)\(\s*\)/g, what: "new Intl.*Format() with no locale" },
  // `Intl.NumberFormat(undefined, …)` is the ambient locale spelled out, and reads
  // as deliberate to a reviewer. It is not.
  { pattern: /new Intl\.(NumberFormat|DateTimeFormat)\(\s*undefined\b/g, what: "new Intl.*Format(undefined, …)" },
  { pattern: /\.toLocale(String|DateString|TimeString)\(\s*undefined\b/g, what: ".toLocale*(undefined, …)" },
];

interface Hit {
  file: string;
  line: number;
  what: string;
  text: string;
}

/**
 * A line that is only a comment is documentation, not a call.
 *
 * The first run of this guard failed on TWO hits, both inside the header of
 * `format-number.ts` — the file whose entire purpose is to explain the defect.
 * A guard that cannot tell a described call from a made one either flags every
 * document that names the bug, or gets "fixed" by weakening the pattern until it
 * stops catching the bug too. `check-tokens` hit this exact shape counting hex
 * colours inside comments.
 *
 * Deliberately line-based, not a full comment stripper: a trailing comment on a
 * line that also carries code still counts, because that line has code on it.
 */
function isCommentLine(text: string): boolean {
  const t = text.trim();
  return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
}

function scan(files: string[]): Hit[] {
  const hits: Hit[] = [];
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    const lines = src.split("\n");
    for (const { pattern, what } of AMBIENT_FORMS) {
      lines.forEach((text, i) => {
        if (isCommentLine(text)) return;
        pattern.lastIndex = 0;
        if (pattern.test(text)) {
          hits.push({ file: file.replace(process.cwd(), "").replace(/\\/g, "/"), line: i + 1, what, text: text.trim() });
        }
      });
    }
  }
  return hits;
}

describe("no formatter resolves its locale from the host", () => {
  const files = walk(SRC);

  it("scans a corpus that is actually there", () => {
    // The anti-vacuity floor. Every assertion below passes trivially against an
    // empty file list, and a walk() that silently returns nothing — a renamed
    // directory, a changed cwd — would look like a clean bill of health.
    expect(files.length).toBeGreaterThan(300);
  });

  it("finds no ambient-locale formatting in src/", () => {
    const hits = scan(files);
    const report = hits.map((h) => `  ${h.file}:${h.line}  ${h.what}\n      ${h.text.slice(0, 110)}`).join("\n");
    expect(
      hits,
      hits.length === 0
        ? ""
        : `Ambient-locale formatting resolves differently on the server and in the browser, which ` +
            `breaks hydration. Pass an explicit locale — NUMBER_LOCALE from @/lib/format-number, or ` +
            `the helpers in @/lib/format-date.\n${report}`,
    ).toEqual([]);
  });

  it("would catch the exact call that broke /library/buyers", () => {
    // The mutation half. Without this, the test above passes just as happily
    // against a regex that matches nothing — which is the failure mode of every
    // guard in this repo that was written after the fact and never fed the
    // original defect.
    const original = "                    {b.orderCount.toLocaleString()}";
    const matched = AMBIENT_FORMS.some(({ pattern }) => {
      pattern.lastIndex = 0;
      return pattern.test(original);
    });
    expect(matched, "the guard no longer recognises the call form it was built for").toBe(true);
  });

  it("does not flag a call that only appears inside a comment", () => {
    // Pinned because the alternative fix — loosening the pattern until the
    // documentation stopped matching — would have disarmed the guard entirely.
    expect(isCommentLine("// 40 call sites called `n.toLocaleString()` with no locale.")).toBe(true);
    expect(isCommentLine(" * Use this instead of `n.toLocaleString()` anywhere")).toBe(true);
    expect(isCommentLine("                    {b.orderCount.toLocaleString()}")).toBe(false);
  });

  it("does not flag a call that names its locale", () => {
    // The other direction: a guard that flags everything is as useless as one
    // that flags nothing, and this is the assertion that stops someone "fixing"
    // a false positive by loosening the pattern.
    for (const fixed of [
      'n.toLocaleString(NUMBER_LOCALE)',
      'n.toLocaleString("en-IE")',
      'd.toLocaleString(DATE_LOCALE, DATE_TIME_OPTIONS)',
      'new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR" })',
    ]) {
      const matched = AMBIENT_FORMS.some(({ pattern }) => {
        pattern.lastIndex = 0;
        return pattern.test(fixed);
      });
      expect(matched, `false positive on: ${fixed}`).toBe(false);
    }
  });
});
