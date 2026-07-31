import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { extractLinks } from "./linkExtract";
import {
  extractRaw,
  NAV_CALL_ANCHOR,
  NAV_CALL_OR_NEW_URL_ANCHOR,
  stripComments,
} from "./sourceScan";

/**
 * The shared source-scanning module (./sourceScan) is exercised end to end by BOTH guards that
 * import it — route-reachability.test.ts and link-crawl.test.ts each pin its extraction decisions
 * against hand-written fixtures, from opposite directions. Re-asserting comment stripping or region
 * bounds a third time here would just be a third copy of the same test.
 *
 * What neither guard can pin is the one place they deliberately DISAGREE: the nav-call anchor is
 * exported in two forms, and the wider one carries `new URL(…)`.
 *
 * That asymmetry is invisible to both suites. Widening the crawl's anchor to include `new URL` does
 * not obviously break anything — it just quietly starts demanding that paths which were never links
 * resolve. Narrowing the reachability guard's anchor does not obviously break anything either — it
 * just quietly stops crediting a real referrer. Either edit reads as a tidy-up, so the difference is
 * pinned here: the convergence that produced ./sourceScan was contracted to change NEITHER guard's
 * behaviour, and collapsing these two sets would have changed one.
 *
 * If the two should agree, that is a decision on its own merits with its own test. There is no
 * evidence in this repo for which answer is right, so this test asserts only that they still differ
 * exactly as they did before the convergence.
 */
describe("sourceScan — the two nav-call anchors differ by exactly `new URL`", () => {
  /** `.test()` on a /g regex advances lastIndex, so reset before every probe. */
  const matches = (re: RegExp, text: string) => {
    re.lastIndex = 0;
    return re.test(text);
  };

  it("both forms match the calls the two guards agree on", () => {
    for (const re of [NAV_CALL_ANCHOR, NAV_CALL_OR_NEW_URL_ANCHOR]) {
      expect(matches(re, 'router.push("/inbox")')).toBe(true);
      expect(matches(re, 'router.replace("/inbox")')).toBe(true);
      expect(matches(re, 'redirect("/bridge")')).toBe(true);
    }
  });

  it("only the wider form matches `new URL(`", () => {
    expect(matches(NAV_CALL_OR_NEW_URL_ANCHOR, 'new URL("/x", base)')).toBe(true);
    expect(matches(NAV_CALL_ANCHOR, 'new URL("/x", base)')).toBe(false);
  });

  it("the difference survives into what each guard actually extracts", () => {
    // The reachability guard's redirect group uses the wider anchor, so a `new URL` path IS a
    // referrer for it.
    expect(
      extractRaw('new URL("/welcome", req.url)', [{ anchor: NAV_CALL_OR_NEW_URL_ANCHOR, mode: "call" }]),
    ).toContain("/welcome");

    // The crawl uses the narrower one, so the same source yields no outbound link to check. This is
    // the assertion that fails if someone shares a single anchor between the two guards.
    expect(extractLinks('new URL("/welcome", req.url)')).toEqual([]);

    // …and the crawl has NOT gone blind to the calls both guards do agree on.
    expect(extractLinks('router.push("/inbox")')).toContain("/inbox");
    expect(extractLinks('redirect("/operations/health")')).toContain("/operations/health");
  });
});

/**
 * The reading primitives live in scripts/lib/sourceScan.mjs — plain ESM, because a THIRD
 * consumer imports them and cannot read TypeScript: `lint:vocab` is
 * `node scripts/check-vocabulary.mjs`, and ci.yml has no `setup-node` step.
 *
 * That boundary costs something, and this block is the price being paid rather than assumed.
 */
describe("sourceScan — what the .mjs boundary must not cost", () => {
  /**
   * The syntax mode is a CLOSED UNION, and the move to untyped `.mjs` silently widened it to
   * `string` once already — `stripComments("x", "bogus")` typechecked where it had not.
   *
   * The union is declared once, as a JSDoc `@typedef` in the .mjs, and tsc reads it through
   * `allowJs`. The load-bearing assertion in this test is the `@ts-expect-error` DIRECTIVE,
   * not the `expect()` beneath it: `bun run typecheck` reports TS2578 "Unused
   * '@ts-expect-error' directive" the moment the parameter widens back, which is the exact
   * regression. Both directions were mutation-checked — removing the directive gives TS2345,
   * widening the typedef to `{string}` gives TS2578.
   */
  it("keeps `syntax` a closed union across the boundary — enforced by tsc, not at runtime", () => {
    expect(stripComments("// gone\nkept", "js").trim()).toBe("kept");
    expect(stripComments("// kept\nkept", "mdx")).toContain("// kept");

    // @ts-expect-error — `syntax` is SourceSyntax ("js" | "mdx"), never an arbitrary string.
    const widened = stripComments("kept", "bogus");
    expect(widened).toBe("kept");
  });

  /**
   * ONE COPY, THREE CONSUMERS — and the reason this is a test rather than a comment is that
   * the repo has now had to de-duplicate a stripper twice. `4c7350a` fixed the
   * comment-after-a-colon defect in one copy while another was still wrong, and the backend
   * deleted a duplicated stripper (`504d9cc`) for the same reason. Two copies drift, and the
   * one nobody fixed is the one still shipping the bug.
   *
   * This also catches the merge hazard directly: any branch that carries its own
   * `scripts/lib/stripComments.mjs` turns CI red on the merged tree instead of quietly
   * leaving two strippers in place — the class TRAP 23 is about.
   */
  it("defines each reading primitive exactly once in the repo", () => {
    const repoRoot = path.resolve(__dirname, "..", "..");
    const SKIP = new Set([
      "node_modules",
      ".next",
      ".git",
      ".claude",
      "playwright-report",
      "test-results",
    ]);
    const FNS = ["stripComments", "maskLiterals", "readLiteral"] as const;

    // Read each file ONCE and test all three names against it. Reading per-name instead
    // tripled the I/O and pushed this past vitest's 5s default under full-suite load.
    const definers: Record<string, string[]> = { stripComments: [], maskLiterals: [], readLiteral: [] };
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (SKIP.has(entry)) continue;
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx|mjs|js)$/.test(entry)) continue;
        const text = readFileSync(full, "utf8");
        if (!text.includes("function ")) continue;
        for (const fn of FNS) {
          if (new RegExp(String.raw`function\s+${fn}\s*\(`).test(text)) {
            definers[fn].push(path.relative(repoRoot, full).replace(/\\/g, "/"));
          }
        }
      }
    };
    walk(path.join(repoRoot, "src"));
    walk(path.join(repoRoot, "scripts"));

    for (const fn of FNS) {
      expect(definers[fn], fn).toEqual(["scripts/lib/sourceScan.mjs"]);
    }
  }, 20_000);
});
