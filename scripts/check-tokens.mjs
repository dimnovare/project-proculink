/**
 * check-tokens.mjs  —  the ProcuLink design-token gate
 *
 * WHAT THE DESIGN DOC ASKS FOR
 * docs/design-system/11-unified-page-rules.md §Enforcement specifies one CI lint,
 * scoped to `src/app/**`, failing the build on the two patterns that caused the
 * drift the audit found:
 *
 *   1. Raw 6-digit hex literals — regex `#[0-9A-Fa-f]{6}` anywhere under
 *      src/app/**. Pages must use a token class or `var(--token)`; the primitives
 *      in src/components/bridge/** are the only place raw colour values belong.
 *   2. Inline-styled buttons — `<button` carrying an inline `background:` (or
 *      `style={{ background`). Use the Button primitive.
 *
 * The same doc's "Every new page MUST" rule 5 also bans per-page palette
 * constants (`const BLUE = "#1E66C9"` — "the #1 source of drift in the audit").
 * A palette constant IS a hex literal, so rule 1 already catches it; it is
 * reported under its own rule id purely so the message can name the fix.
 *
 * THREE DELIBERATE DEVIATIONS FROM THE DOC, each measured:
 *   • The regex also accepts an 8-digit #RRGGBBAA. The doc's 6-digit regex
 *     matches the first six characters of one anyway; being explicit means the
 *     reported span is the whole literal.
 *   • COMMENTS ARE SCANNED. The doc says "anywhere", and not scanning them would
 *     have hidden a real defect: how-it-works/page.tsx documented the palette as
 *     "#28C55E family" — a colour the same doc explicitly BANS. Stale palette
 *     documentation is exactly how drift survives a cleanup.
 *   • Default is report-only; `--strict` is what fails. That matches
 *     check-pageshell.mjs, and CI runs --strict.
 *
 * ROUTE ENUMERATION. next.config.ts sets pageExtensions ["ts","tsx","mdx"] and
 * the tree carries 45 `page.mdx` against 44 `page.tsx`. A .tsx-only scan would
 * see under half the routes, so .mdx is in scope and is pinned by a test.
 *
 * TWO LISTS, AND THEY ARE NOT THE SAME THING:
 *   ALLOWLIST — permanent. A file that legitimately cannot use a token. Every
 *               entry states the evidence. Currently one: globals.css, which IS
 *               the token definitions.
 *   BASELINE  — a temporary debt ledger with per-file counts. NOT an exemption:
 *               a listed file may keep its recorded count and may never exceed
 *               it; an unlisted file must be at zero. Cleaning a file means
 *               deleting its row. This is check-pageshell.mjs's baseline shape
 *               with counts added, so a listed file cannot silently grow.
 *
 * Usage:
 *   bun run lint:tokens                            # strict — what CI runs
 *   node scripts/check-tokens.mjs                  # report only, always exits 0
 *   node scripts/check-tokens.mjs --strict         # exits 1 on NEW violations
 *   node scripts/check-tokens.mjs --root <dir>     # scan a fixture tree
 *   node scripts/check-tokens.mjs --emit-baseline  # print the ledger for the tree as it is
 */

import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { join, relative } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// ─── CLI ──────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const rootFlag = argv.indexOf("--root");
const ROOT = rootFlag >= 0 ? argv[rootFlag + 1] : join(__dirname, "..");
const STRICT = argv.includes("--strict");
// Prints the ledger for the tree exactly as it stands. Used when a sweep lands
// and the baseline needs re-cutting — hand-counting 35 rows is how a ratchet
// gets a wrong number in it.
const EMIT_BASELINE = argv.includes("--emit-baseline");
// A fixture tree has no shared debt history, so the repo's baseline must not
// silently absolve it. Without this, a test fixture placed at a baselined path
// would pass for the wrong reason.
const USING_FIXTURE = rootFlag >= 0;

// ─── Scan scope ───────────────────────────────────────────────────────────────
const SCAN_DIR = ["src", "app"];
const SCAN_EXT = /\.(tsx|ts|mdx|css)$/;

/**
 * Permanent exclusions. Each entry states the evidence for why a token cannot be
 * used here — "appears intentional" is not a reason.
 */
const ALLOWLIST = [
  {
    pattern: /^src\/app\/globals\.css$/,
    rules: ["hex-literal", "palette-const"],
    reason:
      "This file IS the token definitions — `:root { --brand-blue: #1E66C9 }`. " +
      "A hex here is the declaration every `var(--token)` elsewhere resolves to. " +
      "Banning it would leave nowhere to define a token.",
  },
];
// tailwind.config.ts and src/lib/ds-tokens.ts are the other two definition sites.
// Both sit OUTSIDE src/app/**, so they are already out of scope; adding rows for
// them would be noise that implies the scope is wider than it is.

/**
 * Debt ledger — files that still carry pre-WP-30 hex, with the count they carry.
 * Exceeding the count fails; a new file with any hex fails. Delete a row when the
 * file reaches zero. Follow-up: sweep these onto tokens page by page (the doc's
 * own migration order is 11-unified-page-rules.md §Migration order).
 *
 * Cut with `--emit-baseline` at 478b809: 840 violations across 40 files. WP-30
 * cleans `(home)/page.tsx` (64) and `(marketing)/how-it-works/page.tsx` (47) to
 * zero — they are the packet's named page and the only two files under src/app
 * carrying a measured WCAG AA failure — leaving 729 across 38 files here.
 */
const BASELINE = {
  "src/app/(app)/admin/AdjustLimitsModal.tsx": 33,
  "src/app/(app)/admin/CreateInvoiceModal.tsx": 42,
  "src/app/(app)/admin/page.tsx": 1,
  "src/app/(app)/error.tsx": 10,
  "src/app/(app)/inbound/asns/page.tsx": 5,
  "src/app/(app)/inbound/invoices/page.tsx": 1,
  "src/app/(app)/layout.tsx": 2,
  "src/app/(app)/library/buyers/page.tsx": 13,
  "src/app/(app)/operations/connectors/page.tsx": 122,
  "src/app/(app)/operations/exceptions/page.tsx": 18,
  "src/app/(app)/operations/health/page.tsx": 6,
  "src/app/(app)/operations/webhooks/page.tsx": 82,
  "src/app/(app)/settings/page.tsx": 28,
  "src/app/(marketing)/aup/page.tsx": 11,
  "src/app/(marketing)/book-demo/page.tsx": 7,
  "src/app/(marketing)/changelog/page.tsx": 24,
  "src/app/(marketing)/customers/page.tsx": 15,
  "src/app/(marketing)/dpa/page.tsx": 23,
  "src/app/(marketing)/formats/page.tsx": 23,
  "src/app/(marketing)/help/page.tsx": 8,
  "src/app/(marketing)/how-it-works/AnimatedPipelinePanel.tsx": 29,
  "src/app/(marketing)/layout.tsx": 8,
  "src/app/(marketing)/one-pager/page.tsx": 17,
  "src/app/(marketing)/one-pager/print.css": 1,
  "src/app/(marketing)/pricing/page.tsx": 3,
  "src/app/(marketing)/privacy/page.tsx": 17,
  "src/app/(marketing)/security/page.tsx": 29,
  "src/app/(marketing)/subprocessors/page.tsx": 21,
  "src/app/(marketing)/support/page.tsx": 19,
  "src/app/(marketing)/terms/page.tsx": 12,
  "src/app/(marketing)/watch/page.tsx": 11,
  "src/app/(marketing)/welcome/page.tsx": 13,
  "src/app/global-error.tsx": 10,
  "src/app/layout.tsx": 2,
  "src/app/not-found.tsx": 6,
  "src/app/onboarding/select-organization/page.tsx": 1,
  "src/app/sign-in/[[...sign-in]]/page.tsx": 28,
  "src/app/sign-up/[[...sign-up]]/page.tsx": 28,
};

// ─── Rules ────────────────────────────────────────────────────────────────────

/** #RRGGBB or #RRGGBBAA, not followed by a further hex digit. */
const HEX_RE = /#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?(?![0-9A-Fa-f])/g;

/** `const SCREAMING_SNAKE = "#hex"` — the per-page palette constant (doc rule 5). */
const PALETTE_CONST_RE = /\bconst\s+([A-Z][A-Z0-9_]*)\s*(?::[^=]*)?=\s*["'`](#[0-9A-Fa-f]{3,8})["'`]/;

const RULE_HINT = {
  "hex-literal":
    "replace with `var(--token)` or a Tailwind token class (bg-brand-green, text-ink-muted, border-border)",
  "palette-const":
    "per-page palette constants are banned (11-unified-page-rules.md rule 5) — point the constant at `var(--token)` or delete it",
  "inline-button-bg":
    "use the Button primitive from @/components/bridge/DSPrimitives instead of an inline background",
};

/**
 * Every `<button …>` OPENING TAG in a source string, with its 1-based start line.
 * A regex cannot do this alone: `>` occurs inside JSX expressions (`a > b`,
 * `Array<{x}>`), so the tag end is found by tracking brace depth and only
 * accepting a `>` at depth 0.
 */
function buttonOpeningTags(src) {
  const out = [];
  const re = /<button\b/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    let depth = 0;
    let end = -1;
    for (let i = m.index; i < src.length; i += 1) {
      const ch = src[i];
      if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
      else if (ch === ">" && depth === 0) {
        end = i;
        break;
      }
    }
    if (end === -1) continue;
    const tag = src.slice(m.index, end + 1);
    const line = src.slice(0, m.index).split("\n").length;
    out.push({ tag, line });
  }
  return out;
}

/** All violations in one file's source. */
function scanSource(src, ext) {
  const violations = [];
  const lines = src.split(/\r?\n/);

  lines.forEach((line, i) => {
    const paletteConst = PALETTE_CONST_RE.exec(line);
    if (paletteConst) {
      violations.push({
        rule: "palette-const",
        line: i + 1,
        text: `const ${paletteConst[1]} = "${paletteConst[2]}"`,
      });
      // Reported once, under the more specific rule. Do NOT also count it as a
      // bare hex literal — one defect, one line in the report.
      return;
    }
    HEX_RE.lastIndex = 0;
    let m;
    while ((m = HEX_RE.exec(line)) !== null) {
      violations.push({ rule: "hex-literal", line: i + 1, text: m[0] });
    }
  });

  // Inline-styled buttons only exist in JSX.
  if (ext === "tsx" || ext === "mdx") {
    for (const { tag, line } of buttonOpeningTags(src)) {
      if (/style\s*=\s*\{\{[\s\S]*?\bbackground\b/.test(tag)) {
        violations.push({
          rule: "inline-button-bg",
          line,
          text: tag.replace(/\s+/g, " ").slice(0, 90),
        });
      }
    }
  }

  return violations;
}

// ─── File discovery ───────────────────────────────────────────────────────────
function collect(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...collect(full));
    else if (SCAN_EXT.test(entry)) out.push(full);
  }
  return out;
}

const toRel = (p) => relative(ROOT, p).replace(/\\/g, "/");

function allowedRules(rel) {
  const hit = ALLOWLIST.find((a) => a.pattern.test(rel));
  if (!hit) return null;
  return hit.rules === "*" ? "*" : new Set(hit.rules);
}

// ─── Run ──────────────────────────────────────────────────────────────────────
const files = collect(join(ROOT, ...SCAN_DIR));

/** rel → { newOnes: [], allowed: number, baselineCount: number, count: number } */
const perFile = new Map();
let scannedCount = 0;
let allowedTotal = 0;

for (const file of files) {
  const rel = toRel(file);
  const ext = (/\.([a-z]+)$/.exec(file) ?? [, ""])[1];
  const allow = allowedRules(rel);
  scannedCount += 1;

  const found = scanSource(readFileSync(file, "utf8"), ext);
  if (found.length === 0) continue;

  const live = allow === "*" ? [] : found.filter((v) => !(allow && allow.has(v.rule)));
  allowedTotal += found.length - live.length;
  if (live.length === 0) continue;

  const budget = USING_FIXTURE || EMIT_BASELINE ? 0 : (BASELINE[rel] ?? 0);
  perFile.set(rel, { violations: live, count: live.length, budget });
}

if (EMIT_BASELINE) {
  const rows = [...perFile.entries()].sort(([a], [b]) => a.localeCompare(b));
  console.log("const BASELINE = {");
  for (const [rel, v] of rows) console.log(`  ${JSON.stringify(rel)}: ${v.count},`);
  console.log("};");
  process.exit(0);
}

const overBudget = [...perFile.entries()].filter(([, v]) => v.count > v.budget);
const withinBudget = [...perFile.entries()].filter(([, v]) => v.count > 0 && v.count <= v.budget);

// Baseline rows that are now cheaper than recorded, or gone entirely. Reported so
// the ledger can be tightened — NEVER a failure: fixing a file must not turn CI red.
const stale = USING_FIXTURE
  ? []
  : Object.entries(BASELINE)
      .map(([rel, budget]) => [rel, budget, perFile.get(rel)?.count ?? 0])
      .filter(([, budget, actual]) => actual < budget);

console.log(
  `\nDesign-token gate — scanned ${scannedCount} file(s) under src/app (.tsx/.ts/.mdx/.css)\n`,
);

if (overBudget.length > 0) {
  const total = overBudget.reduce((n, [, v]) => n + (v.count - v.budget), 0);
  console.error(`FAIL — ${total} new token violation(s) across ${overBudget.length} file(s):\n`);
  for (const [rel, v] of overBudget) {
    const over = v.budget > 0 ? `  (${v.count} found, ${v.budget} allowed by baseline)` : "";
    console.error(`  ${rel}${over}`);
    for (const x of v.violations.slice(0, 25)) {
      console.error(`    ${rel}:${x.line}  [${x.rule}]  "${x.text}"`);
    }
    if (v.violations.length > 25) {
      console.error(`    … and ${v.violations.length - 25} more in this file`);
    }
  }
  console.error("");
  for (const rule of [...new Set(overBudget.flatMap(([, v]) => v.violations.map((x) => x.rule)))]) {
    console.error(`  ${rule}: ${RULE_HINT[rule]}`);
  }
  console.error(
    `\nTokens live in src/app/globals.css (:root custom properties) and tailwind.config.ts.\n` +
      `See docs/design-system/11-unified-page-rules.md §Enforcement.\n`,
  );
} else {
  console.log("OK — no new raw hex, palette constants, or inline-styled buttons under src/app.");
}

if (withinBudget.length > 0) {
  console.log(
    `\nBaseline debt (pre-WP-30, ratcheted — these may shrink, never grow):`,
  );
  for (const [rel, v] of withinBudget) console.log(`  [TODO] ${rel}  ${v.count}/${v.budget}`);
}

if (allowedTotal > 0) {
  console.log(`\nAllowlisted: ${allowedTotal} literal(s) in token-definition files.`);
  for (const a of ALLOWLIST) console.log(`  ${a.pattern.source} — ${a.reason}`);
}

if (stale.length > 0) {
  console.log(`\nBaseline rows now cheaper than recorded — please tighten:`);
  for (const [rel, budget, actual] of stale) console.log(`  [STALE] ${rel}  ${actual} < ${budget}`);
}

console.log("");

if (STRICT && overBudget.length > 0) {
  console.error(
    `Strict mode: ${overBudget.length} file(s) exceed their token budget. Use var(--token) / a Tailwind token class.`,
  );
  process.exit(1);
}

process.exit(0);
