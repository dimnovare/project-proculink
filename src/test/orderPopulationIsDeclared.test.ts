import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, sep } from "node:path";
import { stripComments } from "./sourceScan";

// ─────────────────────────────────────────────────────────────────────────────
// THE DIRECTION THE NEXT INSTANCE COMES FROM.
//
// `practiceOrderCountParity.test.tsx` renders the two screens that were wrong and
// reconciles what they print against the rows they print beside it. It cannot reach the
// next instance, because the next instance is not this defect again — it is a THIRD screen
// printing a FOURTH count, in a file nobody has written yet, which no rendering test
// enumerates.
//
// Nothing else would catch it. There is no type-level difference between the two
// populations: `OrdersPage.totalCount` and `OrdersSummary.total` are both `number`, and
// picking the wrong one compiles, renders, and reads plausibly. The exclusion is a
// CONVENTION, repeated by hand at every call site — which is exactly what the backend
// found when it wrote the same guard for its own side (`SampleExclusionIsDeclared…Tests`:
// there is no EF query filter on `IsSample` either).
//
// So: no production module may read an orders envelope's count fields for itself. The
// split lives in ONE place — `pagePopulation` / `summaryPopulation` in
// orderCountContract.ts — and a new surface either goes through it or fails here.
//
// BIDIRECTIONAL. The registry pins an EXACT count per file, so it fails both when a read
// is added to a file that has none and when the owner's own reads are deleted or moved.
// It cannot rot into a stale exemption that quietly permits anything.
// ─────────────────────────────────────────────────────────────────────────────

const COUNT_FIELD_RE = /\.(totalCount|sampleCount|sampleTotal)\b/g;

// COMMENTS ARE STRIPPED BEFORE SCANNING, with the repo's own primitive rather than a
// fourth regex. Not cosmetic: several of the files below DISCUSS `ordersPage.totalCount`
// in prose explaining why they no longer read it, and a guard that fires on its own
// explanation gets the explanation deleted instead of the guard fixed. `sourceScan.ts`
// already handles the cases a hand-rolled version gets wrong (`https://` is not a line
// comment), and `sourceScan.test.ts` asserts this primitive is defined exactly once in the
// repo — a local copy fails that test, which is how this import came to be here.

const SKIP_DIRS = new Set(["__tests__", "test", "mocks", "node_modules"]);

function productionSources(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) productionSources(full, acc);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry.name) || /\.(test|spec)\./.test(entry.name)) continue;
    acc.push(full);
  }
  return acc;
}

const SRC = join(process.cwd(), "src");
const rel = (p: string) => p.slice(process.cwd().length + 1).split(sep).join("/");

/**
 * Every production file allowed to read the raw count fields, and how many times.
 *
 * ONE ENTRY, deliberately. `orderCountContract.ts` owns the split; everything else asks it.
 * Adding a file here is a decision to derive the population a second time, and whoever
 * does it has to write down why — which is the whole point, because the v2 audit's P0-5
 * was two correct derivations of two different populations printed side by side with
 * nothing on the screen saying which was which.
 */
const DECLARED: Record<string, { reads: number; why: string }> = {
  "src/components/bridge/orderCountContract.ts": {
    reads: 3,
    why:
      "The owner. pagePopulation() reads totalCount + sampleCount and summaryPopulation() " +
      "reads sampleTotal; every screen consumes the result instead of the fields.",
  },
};

describe("which population a count describes is declared, not assumed", () => {
  const files = productionSources(SRC);

  it("scans a real corpus", () => {
    // ANTI-VACUITY. Every assertion below is satisfied for free by an empty file list —
    // a bad glob, a renamed directory, a `readdirSync` that threw and was swallowed — and
    // a sweep over nothing passing everything is the precise shape of the bug this packet
    // fixes. 386 production sources today; the floor sits well under it so this fails on a
    // broken scan rather than on a deleted component.
    expect(files.length).toBeGreaterThanOrEqual(300);
  });

  it("no production module reads an orders envelope's count fields for itself", () => {
    const found: Record<string, number> = {};
    for (const file of files) {
      const matches = stripComments(readFileSync(file, "utf8")).match(COUNT_FIELD_RE);
      if (matches) found[rel(file)] = matches.length;
    }

    const undeclared = Object.entries(found).filter(([path]) => !(path in DECLARED));
    expect(
      undeclared,
      "These read `.totalCount` / `.sampleCount` / `.sampleTotal` directly, so they decide " +
        "for themselves whether practice orders are counted. Use `pagePopulation` or " +
        "`summaryPopulation` from src/components/bridge/orderCountContract.ts:\n" +
        undeclared.map(([p, n]) => `  ${p} (${n})`).join("\n"),
    ).toEqual([]);

    // The reverse direction: a declared file whose count moved is a registry that no
    // longer describes the code, and a stale exemption is how a guard stops guarding.
    for (const [path, { reads, why }] of Object.entries(DECLARED)) {
      expect(found[path], `${path} is declared as ${reads} read(s) — ${why}`).toBe(reads);
    }
  });

  it("the two screens the audit named consume the shared derivation", () => {
    // The registry alone would stay green if a screen hand-rolled the split from
    // `items.filter(o => o.isSample)` instead — same defect, different spelling. Both
    // screens must reach the one derivation by name.
    for (const screen of ["BridgeDashboard.tsx", "InboxView.tsx"]) {
      const source = readFileSync(join(SRC, "components", "bridge", screen), "utf8");
      expect(source, `${screen} must derive its populations from orderCountContract`).toMatch(
        /from "\.\/orderCountContract"/,
      );
      expect(source, `${screen} must call pagePopulation rather than splitting the counts itself`).toContain(
        "pagePopulation(",
      );
    }
  });

  it("reads the code, not the prose about the code", () => {
    // Pinned because it is what makes the scan honest rather than merely quiet: the files
    // this sweeps explain the defect in comments that name the very fields being banned,
    // and BridgeDashboard/InboxView both carry such a comment today.
    const hits = (s: string) => (stripComments(s).match(COUNT_FIELD_RE) ?? []).length;
    expect(hits("// reading ordersPage.totalCount was the bug\nconst a = 1;")).toBe(0);
    expect(hits("/* page.sampleCount */\nconst b = 2;")).toBe(0);
    // A URL is not a line comment — the shared stripper is here partly for this.
    expect(hits('const url = "https://x.example/a";\nconst c = p.totalCount;')).toBe(1);
    // …and it must still see a real read. A stripper that returned "" would make every
    // assertion above pass, and the whole sweep with them.
    expect(hits("const d = page.sampleCount;")).toBe(1);
  });
});
