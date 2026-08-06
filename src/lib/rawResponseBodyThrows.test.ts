import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * No throw site in the api layer may paste a raw response body into its message.
 *
 * WHY A SOURCE SCAN, WHEN THE BEHAVIOUR IS ALREADY TESTED. Because per-site fixes are exactly how
 * this defect has kept coming back. FE #94 sanitised one operand; FE #98 sanitised the rest of that
 * component and found a third door; fixing that door led to `ApiHttpError`'s constructor, which
 * covers every throw site that uses the class — and an adversarial sweep then found EIGHT more that
 * throw a plain `Error` instead, each one rendered to an operator by a different screen.
 *
 * A behavioural test can only pin the sites someone thought to write a test for. This one fails on
 * a site nobody has thought about yet, including the one added next month, which is the only kind
 * of guard that has ever held here.
 *
 * WHAT IT LOOKS FOR: `new Error(` whose message interpolates one of the variables this layer reads
 * a response body into, without routing it through `serverReason`. `ApiHttpError` is deliberately
 * NOT flagged — its constructor cleans the message itself (`src/lib/api/core.ts`).
 */

const LIB = path.join(process.cwd(), "src", "lib");

/**
 * The identifiers this codebase reads `await res.text()` into, plus the inline call.
 *
 * Deliberately a fixed list rather than "any identifier": the point is to catch a body, not to
 * forbid interpolation. Every name here was taken from a real throw site in `src/lib`.
 */
const BODY_NAMES = "await\\s+res\\.text\\(\\)|t|text|bodyText|rawText|serverMsg|serverText";
const BODY_TOKEN = new RegExp(
  // interpolated: `…: ${t}` / `${await res.text()}`
  `\\$\\{\\s*(?:${BODY_NAMES})\\b` +
  // or passed straight in: `new Error(t || res.statusText)` — the form eight sites actually used,
  // and the form the first draft of this guard missed because it only looked for `${`.
  `|new Error\\(\\s*(?:${BODY_NAMES})\\s*(?:\\|\\||\\))`,
);

/** `new Error(` … up to the end of that logical statement. Good enough: these are all one-liners. */
const NEW_ERROR = /new Error\((?:[^;]*?)\)\s*;/g;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else if (/\.ts$/.test(entry.name) && !/\.(test|spec)\.ts$/.test(entry.name)) out.push(p);
  }
  return out;
}

function offenders(): string[] {
  const found: string[] = [];
  for (const file of walk(LIB)) {
    const src = fs.readFileSync(file, "utf8");
    const lines = src.split(/\r?\n/);
    for (const match of src.matchAll(NEW_ERROR)) {
      const stmt = match[0];
      if (!BODY_TOKEN.test(stmt)) continue;
      if (stmt.includes("serverReason(")) continue;
      const line = src.slice(0, match.index ?? 0).split(/\r?\n/).length;
      found.push(`${path.relative(process.cwd(), file).replace(/\\/g, "/")}:${line}  ${lines[line - 1]?.trim() ?? stmt}`);
    }
  }
  return found;
}

describe("the api layer never throws a raw response body", () => {
  it("has no `new Error` that pastes a body into the message", () => {
    const found = offenders();
    expect(found, `Route the body through serverReason() — see src/lib/serverText.ts\n${found.join("\n")}`).toEqual([]);
  });

  it("actually detects the shape it is meant to detect", () => {
    // Anti-vacuity. A scan that matches nothing passes forever, including after someone narrows
    // the pattern into uselessness. This pins that the ORIGINAL defect shape is still caught.
    const sample = 'if (!res.ok) { const t = await res.text(); throw new Error(`Delete failed: ${t || res.statusText}`); }';
    expect(NEW_ERROR.test(sample)).toBe(true);
    NEW_ERROR.lastIndex = 0;
    expect(BODY_TOKEN.test(sample)).toBe(true);
    // The second shape, verbatim from api-client.ts:1106. The first draft of this guard passed
    // green against eight live sites because it only looked for a template interpolation.
    expect(BODY_TOKEN.test("throw new Error(t || res.statusText);")).toBe(true);
    expect(BODY_TOKEN.test("throw new Error(text || `submitSupportRequest failed: ${res.status}`);")).toBe(true);
    // …and that the sanctioned form is NOT caught, so the fix is reachable.
    const fixed = 'throw new Error(`Delete failed: ${serverReason(t, res.statusText)}`);';
    expect(BODY_TOKEN.test(fixed) && !fixed.includes("serverReason(")).toBe(false);
  });

  it("scans a real, non-empty corpus", () => {
    // The other failure mode of a source scan: pointing at the wrong directory and passing because
    // it read nothing. `src/lib` is where every api module lives.
    const files = walk(LIB);
    expect(files.length).toBeGreaterThan(20);
    expect(files.some((f) => f.endsWith("api-client.ts"))).toBe(true);
    expect(files.some((f) => f.includes("api") && f.endsWith("core.ts"))).toBe(true);
  });
});
