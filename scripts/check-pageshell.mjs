/**
 * check-pageshell.mjs
 *
 * Scans every page.tsx under src/app/(app) and reports pages that do not import
 * PageShell from src/components/bridge/layout/PageShell.
 *
 * Intent: keep new (app) pages on the unified layout primitives (PageShell).
 * The unified design system ships PageShell as the standard wrapper for all
 * app-area pages. This script is a REPORT-ONLY audit (exit 0) — it prints a
 * list but never breaks CI. Wire it to `bun run check:pageshell` (see
 * package.json) to run manually or in code review.
 *
 * Baseline (2026-06-10): a known set of legacy pages pre-date the unified
 * system; they are listed in BASELINE below. Any page NOT in the baseline and
 * also NOT using PageShell will be flagged as a new non-conforming page.
 * Baseline pages are noted so their migration can be tracked over time.
 *
 * Usage:
 *   bun run check:pageshell          # report only (always exits 0)
 *   bun run check:pageshell --strict # exits 1 if NEW non-conforming pages found
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = join(__dirname, "..");
const APP_DIR = join(ROOT, "src", "app", "(app)");

// Baseline of known non-conforming pages as of 2026-06-10.
// These pre-date the unified PageShell rollout; they are tracked here so we
// can migrate them over time. New pages should NOT be added to this list.
const BASELINE_NON_CONFORMING = new Set([
  "src/app/(app)/bridge/page.tsx",
  "src/app/(app)/connections/[connectionId]/page.tsx",
  "src/app/(app)/connections/page.tsx",
  "src/app/(app)/inbox/[orderId]/page.tsx",
  "src/app/(app)/inbox/page.tsx",
  "src/app/(app)/library/mappings/page.tsx",
  "src/app/(app)/library/rule-definitions/page.tsx",
  "src/app/(app)/library/rules/page.tsx",
  "src/app/(app)/library/suppliers/[id]/page.tsx",
  "src/app/(app)/library/suppliers/page.tsx",
  "src/app/(app)/operations/log/page.tsx",
  "src/app/(app)/operations/webhooks/page.tsx",
  "src/app/(app)/settings/page.tsx",
  "src/app/(app)/upload/page.tsx",
  "src/app/(app)/upload/preview/[orderId]/page.tsx",
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

function usesPageShell(filePath) {
  const content = readFileSync(filePath, "utf8");
  return content.includes("PageShell");
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
