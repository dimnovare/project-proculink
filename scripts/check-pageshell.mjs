/**
 * check-pageshell.mjs
 *
 * Scans every page.tsx under src/app/(app) and reports pages that do not use
 * PageShell from src/components/bridge/layout/PageShell — either directly, or
 * (for thin wrapper pages that just render one component) via a directly
 * imported component that owns the page layout and wraps itself in PageShell.
 *
 * Intent: keep new (app) pages on the unified layout primitives (PageShell).
 * The unified design system ships PageShell as the standard wrapper for all
 * app-area pages. This script is a REPORT-ONLY audit (exit 0) — it prints a
 * list but never breaks CI. Wire it to `bun run check:pageshell` (see
 * package.json) to run manually or in code review.
 *
 * Baseline (2026-06-11, shrunk from the 2026-06-10 set of 15 by the full
 * PageShell migration): the only page left is the order-review route, whose
 * SpineReview component intentionally owns its own full-bleed layout. Any page
 * NOT in the baseline and also NOT using PageShell will be flagged as a new
 * non-conforming page.
 *
 * Usage:
 *   bun run check:pageshell          # report only (always exits 0)
 *   bun run check:pageshell --strict # exits 1 if NEW non-conforming pages found
 */

import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { join, relative } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = join(__dirname, "..");
const APP_DIR = join(ROOT, "src", "app", "(app)");

// Baseline of known non-conforming pages.
// 2026-06-11: the full-migration pass moved every legacy page (or the layout
// component it delegates to) onto PageShell. The single remaining entry is
// deliberate: /inbox/[orderId] renders SpineReview, which owns a bespoke
// full-bleed review layout (the "heart piece") and is excluded by design.
// New pages should NOT be added to this list.
const BASELINE_NON_CONFORMING = new Set([
  "src/app/(app)/inbox/[orderId]/page.tsx",
]);

/** Recursively collect all page.tsx paths under a directory. */
function findPages(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...findPages(full));
    } else if (entry === "page.tsx") {
      results.push(full);
    }
  }
  return results;
}

/** Resolve an `@/…` or relative import specifier to a source file, if it exists. */
function resolveImport(spec, fromDir) {
  let base = null;
  if (spec.startsWith("@/")) base = join(ROOT, "src", spec.slice(2));
  else if (spec.startsWith(".")) base = join(fromDir, spec);
  if (!base) return null;
  for (const candidate of [base, `${base}.tsx`, `${base}.ts`, join(base, "index.tsx"), join(base, "index.ts")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/**
 * A page conforms when it references PageShell itself, or — thin-wrapper
 * pattern — when one of the component files it imports directly references
 * PageShell (one level deep only; no transitive walk).
 */
function usesPageShell(filePath) {
  const content = readFileSync(filePath, "utf8");
  if (content.includes("PageShell")) return true;
  const fromDir = join(filePath, "..");
  const importSpecs = [...content.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
  for (const spec of importSpecs) {
    if (!spec.startsWith("@/components/") && !spec.startsWith(".")) continue;
    const resolved = resolveImport(spec, fromDir);
    if (resolved && readFileSync(resolved, "utf8").includes("PageShell")) return true;
  }
  return false;
}

const allPages = findPages(APP_DIR);
const nonConforming = allPages.filter((p) => !usesPageShell(p));

// Normalize to relative paths (forward slashes for cross-platform consistency).
const toRelative = (p) => relative(ROOT, p).replace(/\\/g, "/");

const baselinePages = nonConforming.filter((p) =>
  BASELINE_NON_CONFORMING.has(toRelative(p))
);
const newPages = nonConforming.filter(
  (p) => !BASELINE_NON_CONFORMING.has(toRelative(p))
);

const conformingCount = allPages.length - nonConforming.length;
console.log(
  `\nPageShell conformance check — ${conformingCount}/${allPages.length} pages use PageShell\n`
);

if (newPages.length > 0) {
  console.log("NEW non-conforming pages (not in baseline — please add PageShell):");
  for (const p of newPages) {
    console.log(`  [NEW]  ${toRelative(p)}`);
  }
  console.log();
}

if (baselinePages.length > 0) {
  console.log("Baseline pages (legacy, pre-date unified system — migration tracked):");
  for (const p of baselinePages) {
    console.log(`  [TODO] ${toRelative(p)}`);
  }
  console.log();
}

if (nonConforming.length === 0) {
  console.log("All (app) pages use PageShell.");
}

const strict = process.argv.includes("--strict");
if (strict && newPages.length > 0) {
  console.error(
    `Strict mode: ${newPages.length} new page(s) do not use PageShell. Add PageShell or add to the baseline.`
  );
  process.exit(1);
}

process.exit(0);
