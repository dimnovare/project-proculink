import { describe, test, expect } from "vitest";
import { join } from "path";
import { ROOT } from "./appRoutes";
import { dirEntries, readSource, strippedSource } from "./sourceCorpus";
import { readyBarLabel } from "@/components/bridge/workshop/acceptanceGateModel";

// ─────────────────────────────────────────────────────────────────────────────
// P0-B's sentence, guarded in the two places it can come back.
//
// `help-status-labels.test.ts` exists in this repo because a help article taught
// the opposite of what a badge meant, and its header states the general case: "No
// gate can know that a legitimate English word stopped being a status name."
// Nothing generalised it — so P0-B's sentence was quoted VERBATIM in two guides
// and would have gone on teaching "every required field is filled and checked"
// after the product stopped saying it.
//
// WHAT THIS GUARD DOES NOT DO. It does not ban the string. `IssuesPanel.tsx:243`
// still holds it as the `readyLabel ?? "…"` fallback, and that file belongs to
// another packet, so removing the literal is not this change's to make. Banning it
// would also be the weaker guard: the defect was never the literal, it was that
// NOTHING PRODUCED THE PROP. So the assertion below is the one that actually
// prevents the regression — every production call site must pass `readyLabel` —
// and it would fail the moment a new caller forgets, which is precisely how the
// fallback became the only sentence in the product.
//
// ANTI-VACUITY. Every walk counts what it EXTRACTED — files read, call sites
// matched, guides matched — and fails on zero. A sweep over an empty set is
// vacuously clean, and that is the most common way a guard here has reported green
// with the defect live.
// ─────────────────────────────────────────────────────────────────────────────

const RETIRED_CLAIM = "every required field is filled and checked";

/** The sentence the product renders when nothing is outstanding. */
const CURRENT_CLAIM = readyBarLabel({ advisoryCount: 0, counterpartyNoun: "Supplier" });

const SRC = join(ROOT, "src");
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "build"]);

function walk(dir: string, match: RegExp, out: string[] = []): string[] {
  for (const entry of dirEntries(dir)) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory) walk(full, match, out);
    else if (match.test(entry.name)) out.push(full);
  }
  return out;
}

const isTestFile = (f: string) => /\.(test|spec)\.[jt]sx?$/.test(f);

describe("the green ready bar's sub-line is produced, never defaulted", () => {
  /**
   * The walk and the extraction, run in the `describe` body rather than inside the assertion.
   *
   * Reading and comment-stripping every production .tsx is ~1s with the rest of the suite
   * competing for the machine, against vitest's 5000ms per-test budget, and src/ only grows. A
   * `describe` body is evaluated during collection, which is not measured against that budget.
   * Both floors below still assert on what the walk and the locator actually produced.
   */
  const files = walk(SRC, /\.tsx$/).filter((f) => !isTestFile(f));

  // Comments are stripped with the repo's own stripper rather than a second copy
  // of one: a regex over raw source cannot tell code from a commented-out example,
  // and four gates once missed a restored defect for exactly that reason.
  const callSites: Array<{ rel: string; hasProp: boolean }> = [];
  for (const file of files) {
    const code = strippedSource(file);
    for (const m of code.matchAll(/<IssuesPanel\b/g)) {
      // The element's own attribute span: from the tag to its first `>` that is
      // not inside a nested expression. Bounded so one call site's props can
      // never be read as another's.
      const tail = code.slice(m.index, m.index + 1200);
      const end = tail.indexOf("/>") >= 0 ? tail.indexOf("/>") : tail.indexOf(">");
      callSites.push({
        rel: file.slice(ROOT.length + 1),
        hasProp: /\breadyLabel\s*=/.test(tail.slice(0, end < 0 ? undefined : end)),
      });
    }
  }

  test("every production <IssuesPanel> call site passes readyLabel", () => {
    expect(files.length, "the walk found no production .tsx files — vacuous").toBeGreaterThan(100);

    // Floor on what was EXTRACTED. With zero call sites the filter below is empty
    // and `toEqual([])` is vacuously true — the exact shape this repo has been
    // bitten by eight times.
    expect(
      callSites.length,
      "no <IssuesPanel> call site found in production source — the locator is stale",
    ).toBeGreaterThanOrEqual(1);

    const missing = callSites.filter((c) => !c.hasProp).map((c) => c.rel);
    expect(
      missing,
      "these render <IssuesPanel> without readyLabel, so they fall back to the hardcoded " +
        `"No open issues — ${RETIRED_CLAIM}." — the claim P0-B retired`,
    ).toEqual([]);
  });

  test("the locator can see a call site that does NOT pass the prop", () => {
    // The control for the test above. Without it, a locator that matched nothing
    // useful would report a clean sweep forever.
    const withProp = `<IssuesPanel issues={x} readyLabel={y} onFix={z} />`;
    const withoutProp = `<IssuesPanel issues={x} onFix={z} />`;
    const span = (s: string) => s.slice(0, s.indexOf("/>"));
    expect(/\breadyLabel\s*=/.test(span(withProp))).toBe(true);
    expect(/\breadyLabel\s*=/.test(span(withoutProp))).toBe(false);
  });
});

describe("help guides quote the bar the product actually renders", () => {
  const GUIDES = join(SRC, "app", "(marketing)", "help", "guides");

  test("no user-facing doc still teaches the retired claim", () => {
    const docs = walk(SRC, /\.mdx?$/);
    expect(docs.length, "no .md/.mdx found under src — vacuous").toBeGreaterThan(0);

    const offenders = docs
      .filter((f) => readSource(f).includes(RETIRED_CLAIM))
      .map((f) => f.slice(ROOT.length + 1));
    expect(
      offenders,
      `these docs still teach "${RETIRED_CLAIM}", which the product no longer renders`,
    ).toEqual([]);
  });

  test("every guide that quotes the ready bar quotes the current sentence", () => {
    const files = walk(GUIDES, /\.mdx?$/);
    expect(files.length, "no help guides found — vacuous").toBeGreaterThan(0);

    const quoting = files.filter((f) => readSource(f).includes("Ready to send ·"));
    // Floor on what MATCHED: with no guide quoting the bar, the loop below proves
    // nothing at all.
    expect(
      quoting.length,
      "no help guide quotes the ready bar — either they stopped, or the locator is stale",
    ).toBeGreaterThanOrEqual(2);

    const wanted = CURRENT_CLAIM.replace(/\s+/g, " ");
    for (const f of quoting) {
      // Guides wrap prose across lines, so compare on collapsed whitespace.
      const collapsed = readSource(f).replace(/\s+/g, " ");
      expect(
        collapsed.includes(wanted),
        `${f.slice(ROOT.length + 1)} quotes the ready bar but not the sentence readyBarLabel produces`,
      ).toBe(true);
    }
  });
});
