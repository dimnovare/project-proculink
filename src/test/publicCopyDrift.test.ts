import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { stripComments } from "../../scripts/lib/sourceScan.mjs";
import { GUIDES } from "@/lib/guides";
import { HELP_ARTICLES } from "@/lib/help-articles";
import { NEVER_CLAIM } from "@/lib/neverClaim";
import { LEGACY_PAID_PLANS } from "@/lib/plans";

/**
 * Public pages never sell the old product (plan 12b, R10). Walks every `(home)` and `(marketing)` page and layout, plus the marketing and help components,
 * strips comments (a guard here once passed by matching its own comment), and fails on a legacy paid plan
 * name, the word "Pilot" as copy, or anything the document engine does not do (`NEVER_CLAIM`).
 *
 * The one place legacy names appear is the pricing FAQ "I'm on {names}. What changes?" (C26). It
 * interpolates `LEGACY_PAID_PLANS`, so its source holds no literal name and needs no allowlist; instead the
 * guard asserts that template still exists exactly once. Delete the FAQ, or type a name elsewhere, and it fails.
 */
const SRC = join(process.cwd(), "src");

/** Legal pages: they describe the contract and data handling, and are renamed Pilot -> Trial by hand (R7). */
const LEGAL_PAGES = new Set(["aup", "dpa", "privacy", "subprocessors", "terms"].map((s) => `app/(marketing)/${s}/page.tsx`));
/** The changelog is a dated, frozen record of what shipped (changelog-append-only.test.ts). */
const EXCLUDED = new Set([...LEGAL_PAGES, "app/(marketing)/changelog/page.tsx"]);

// Public copy is not only in pages: the footer (layouts) and the components the pages render carry it too.
const walk = (dir: string, wanted: RegExp): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name), wanted) : wanted.test(e.name) && !/\.test\./.test(e.name) ? [join(dir, e.name)] : [],
  );
const PAGE = /^(page|layout)\.(tsx|mdx)$/;
const SOURCE = /\.(ts|tsx)$/;

const files = [
  ...walk(join(SRC, "app/(home)"), PAGE),
  ...walk(join(SRC, "app/(marketing)"), PAGE),
  ...walk(join(SRC, "components/marketing"), SOURCE),
  ...walk(join(SRC, "components/help"), SOURCE),
]
  .map((f) => relative(SRC, f).replace(/\\/g, "/"))
  .filter((f) => !EXCLUDED.has(f));

// stripComments reads an apostrophe in JSX text ("don't") as a string opener, so a later whole-line `//` comment can
// survive it (security/page.tsx did). Dropping whole-line `//` comments afterwards removes that false positive; the
// stripper itself is shared and left alone. Nothing real hides: a surviving literal is still scanned.
const readCopy = (f: string) => {
  const mdx = f.endsWith(".mdx");
  const src = stripComments(readFileSync(join(SRC, f), "utf8"), mdx ? "mdx" : "js");
  return mdx ? src : src.replace(/^\s*\/\/.*$/gm, "");
};
const stripped = new Map(files.map((f) => [f, readCopy(f)]));

const legacyNames = LEGACY_PAID_PLANS.map((p) => new RegExp(`\\b${p.name}\\b`));
const C26_TEMPLATE = "I'm on ${LEGACY_PLAN_NAMES}. What changes?";

describe("public copy drift", () => {
  it("walks the pages it should", () => {
    // Measured 65 on 2026-11-12 (pages, layouts, marketing and help components). Floor is about 90% of that: files only get added, so a drop means the walk lost a directory.
    expect(files.length).toBeGreaterThanOrEqual(58);
    // Pages that gatedCapabilityClaims exempts from its tier scan are exactly the ones this guard must cover;
    // its list is not exported, so it is derived from the same registries.
    const help = (...s: string[]) => `app/(marketing)/help/${s.join("/")}/page.mdx`;
    const exempted = [
      "app/(home)/page.tsx",
      "app/(marketing)/how-it-works/page.tsx",
      "app/(marketing)/security/page.tsx",
      ...HELP_ARTICLES.map((a) => help(a.slug)),
      ...GUIDES.filter((g) => g.audience === "client" && g.status === "live").map((g) => help("guides", g.slug)),
    ];
    expect(exempted.filter((f) => !stripped.has(f))).toEqual([]);
    expect(LEGACY_PAID_PLANS.length).toBeGreaterThan(0);
    // C26 is found exactly once, on the pricing page.
    const c26 = [...stripped].filter(([, src]) => src.includes(C26_TEMPLATE)).map(([f]) => f);
    expect(c26).toEqual(["app/(marketing)/pricing/page.tsx"]);
  });

  it("never sells the old product", () => {
    const hits: string[] = [];
    for (const [file, src] of stripped) {
      for (const re of legacyNames) if (re.test(src)) hits.push(`${file}: legacy plan ${re.source}`);
      if (/\bPilot\b/.test(src)) hits.push(`${file}: "Pilot"`);
      for (const { label, pattern } of NEVER_CLAIM) if (pattern.test(src)) hits.push(`${file}: ${label}`);
    }
    expect(hits).toEqual([]);
  });
});
