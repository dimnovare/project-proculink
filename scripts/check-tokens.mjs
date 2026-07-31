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
 * FIVE DELIBERATE DEVIATIONS FROM THE DOC, each measured:
 *   • The regex also accepts a 3-digit #RGB and an 8-digit #RRGGBBAA. The doc's
 *     6-digit regex matches the first six characters of an 8-digit literal
 *     anyway; being explicit means the reported span is the whole literal.
 *     3-digit was added after a refutation showed `#fff` walking straight past.
 *   • rgb() / rgba() / hsl() / hsla() with NUMERIC arguments are caught too, as
 *     rule `color-fn`. `rgba(30,102,201,0.22)` is `#1E66C9` restated in decimal:
 *     a 6-digit-hex-only gate reported two marketing pages as "cleaned to zero"
 *     while they still hardcoded the brand blue 14 times between them. A call
 *     with `var(--token)` inside it is NOT flagged — that is a token being given
 *     an alpha, which is the correct spelling, not drift.
 *   • RETIRED COLOURS are swept across ALL of src/**, not just src/app/**. The
 *     banned emerald shipped as the focus-visible ring on all 46 help articles
 *     (2.2731:1 against a 3:1 non-text floor) from src/components/help/, which
 *     an src/app-scoped gate is blind to by construction. This rule has no
 *     baseline and no allowlist: a banned value is never debt, it is a bug.
 *   • COMMENTS ARE SCANNED. The doc says "anywhere", and not scanning them would
 *     have hidden a real defect: how-it-works/page.tsx documented the palette as
 *     the retired-emerald "family" — a colour the same doc explicitly BANS.
 *     Stale palette documentation is exactly how drift survives a cleanup.
 *   • Default is report-only; `--strict` is what fails. That matches
 *     check-pageshell.mjs, and CI runs --strict.
 *
 * WHAT THIS GATE DOES NOT DO — read this before quoting a green run.
 *   1. IT IS NOT A CONTRAST CHECK. It reads source TEXT. Two tokens can fail
 *      WCAG against each other with no raw hex on the line at all:
 *      `{ background: "var(--amber-soft)", color: "var(--amber)" }` is 3.6547:1
 *      and this gate is green on it, permanently. A hex lint and AA conformance
 *      are ORTHOGONAL; neither implies the other. Contrast is checked from
 *      RESOLVED values in src/test/token-contrast.test.ts.
 *   2. THE BASELINE IS A PER-FILE COUNT, so it cannot tell "same debt" from
 *      "different debt". Neutralising one violation and adding a different one
 *      in the same file (28 -> 28) passes SILENTLY. Growth (28 -> 29) is caught
 *      and that is the load-bearing property, but a green `lint:tokens` does NOT
 *      mean a baselined file is unchanged. Keying the ledger by violation
 *      content would close this; it is a baseline-format change and is
 *      deliberately not bundled into an accessibility fix round.
 *   3. STILL NOT CAUGHT, by design or by limitation: `color-mix()` (its
 *      arguments are usually tokens), CSS named colours (`red` is unresolvable
 *      from `red` the identifier or the prose), and any hex assembled at
 *      runtime — `"#" + "1E66C9"`, `` `#${x}` ``, `[..].join("")`. A source-text
 *      scanner cannot see the last group without evaluating the program.
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
import { RETIRED_COLORS, retiredRegex } from "./retired-colors.mjs";

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
    rules: ["hex-literal", "palette-const", "color-fn"],
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
 * HISTORY, because the numbers moved for an honest reason.
 * Cut at 478b809 with a 6-digit-hex-only regex: 840 across 40 files. WP-30 swept
 * `(home)/page.tsx` (64) and `(marketing)/how-it-works/page.tsx` (47) and called
 * them "cleaned to zero", leaving 729 across 38 files.
 *
 * Re-cut here after the regex was extended to rgb()/rgba()/hsl()/hsla() and
 * 3-digit hex: 806 across 40 files. Both "cleaned" pages reappear — 9 and 7 —
 * because "zero" had meant "zero BY THE OLD REGEX", and both still restate the
 * brand blue in decimal (`rgba(30,102,201,0.22)` IS `#1E66C9`). They are back in
 * the ledger, which is the point: the drift is now counted instead of invisible.
 *
 * These 16 are all TRANSLUCENT overlay/shadow values, and CLAUDE.md §3 itself
 * writes card shadows as `rgba(11,26,47,0.04)`, so they are not obviously wrong
 * — they simply have no alpha-bearing token yet. Giving them one is a follow-up;
 * counting them is this change.
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
  "src/app/(app)/operations/connectors/page.tsx": 125,
  "src/app/(app)/operations/exceptions/page.tsx": 18,
  "src/app/(app)/operations/health/page.tsx": 6,
  "src/app/(app)/operations/webhooks/page.tsx": 83,
  "src/app/(app)/settings/page.tsx": 33,
  "src/app/(home)/page.tsx": 9,
  "src/app/(marketing)/aup/page.tsx": 11,
  "src/app/(marketing)/book-demo/page.tsx": 7,
  "src/app/(marketing)/changelog/page.tsx": 25,
  "src/app/(marketing)/customers/page.tsx": 17,
  "src/app/(marketing)/dpa/page.tsx": 23,
  "src/app/(marketing)/formats/page.tsx": 23,
  "src/app/(marketing)/help/page.tsx": 8,
  "src/app/(marketing)/how-it-works/AnimatedPipelinePanel.tsx": 35,
  "src/app/(marketing)/how-it-works/page.tsx": 7,
  "src/app/(marketing)/layout.tsx": 8,
  "src/app/(marketing)/one-pager/page.tsx": 17,
  "src/app/(marketing)/one-pager/print.css": 1,
  "src/app/(marketing)/pricing/page.tsx": 15,
  "src/app/(marketing)/privacy/page.tsx": 17,
  "src/app/(marketing)/security/page.tsx": 35,
  "src/app/(marketing)/subprocessors/page.tsx": 21,
  "src/app/(marketing)/support/page.tsx": 19,
  "src/app/(marketing)/terms/page.tsx": 12,
  "src/app/(marketing)/watch/page.tsx": 13,
  "src/app/(marketing)/welcome/page.tsx": 16,
  "src/app/global-error.tsx": 10,
  "src/app/layout.tsx": 2,
  "src/app/not-found.tsx": 6,
  "src/app/onboarding/select-organization/page.tsx": 1,
  "src/app/sign-in/[[...sign-in]]/page.tsx": 34,
  "src/app/sign-up/[[...sign-up]]/page.tsx": 34,
};

// ─── Rules ────────────────────────────────────────────────────────────────────

/**
 * #RGB, #RRGGBB or #RRGGBBAA, not followed by a further hex digit. The 6/8-digit
 * branch is tried first so `#1E66C9` is reported whole rather than as `#1E6`.
 * Measured under src/app: the only 3-digit literals present are `#fff`/`#000`,
 * so this branch adds no false positives (`#add`-shaped identifiers would be,
 * and there are none).
 */
const HEX_RE =
  /#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?(?![0-9A-Fa-f])|#[0-9A-Fa-f]{3}(?![0-9A-Fa-f])/g;

/**
 * rgb()/rgba()/hsl()/hsla() whose arguments contain no `var(`. With a token
 * inside — `rgba(var(--x), .2)` — it is a token being given an alpha and is
 * correct; with raw numbers it is a hardcoded colour wearing a different hat.
 *
 * CASE-INSENSITIVE. It was not, and `RGBA(30,102,201,.22)` walked straight past
 * a rule whose entire purpose is that a colour restated in a different notation
 * is still the same colour. CSS function names are case-insensitive, so the
 * gate has to be too. Measured before adding the flag: zero uppercase colour
 * functions exist under src/app today, so this changes no baseline count — it
 * closes the spelling, it does not re-cut the ledger.
 */
const COLOR_FN_RE = /\b(?:rgba?|hsla?)\(([^)]*)\)/gi;

/** `const SCREAMING_SNAKE = "#hex"` — the per-page palette constant (doc rule 5). */
const PALETTE_CONST_RE = /\bconst\s+([A-Z][A-Z0-9_]*)\s*(?::[^=]*)?=\s*["'`](#[0-9A-Fa-f]{3,8})["'`]/;

/**
 * Values the design system RETIRED and explicitly bans. Swept across all of
 * src/** — see the header. Never baselined, never allowlisted.
 *
 * HEX AND DECIMAL. This was `new RegExp(RETIRED_COLORS.join("|"), "gi")` — hex
 * only — which is the exact defect the `color-fn` rule above exists to close,
 * repeated one rule down: `rgb(40,197,94)` IS `#28C55E`, and it passed. The list
 * and both spellings now live in scripts/retired-colors.mjs, shared with
 * check-emitted-css.mjs so the two gates cannot drift apart.
 */
const RETIRED_RE = retiredRegex();

const RULE_HINT = {
  "hex-literal":
    "replace with `var(--token)` or a Tailwind token class (bg-brand-green, text-ink-muted, border-border)",
  "color-fn":
    "rgb()/rgba()/hsl()/hsla() with raw numbers is a hardcoded colour — use `var(--token)`, or put the token inside the call to give it an alpha",
  "palette-const":
    "per-page palette constants are banned (11-unified-page-rules.md rule 5) — point the constant at `var(--token)` or delete it",
  "inline-button-bg":
    "use the Button primitive from @/components/bridge/DSPrimitives instead of an inline background",
  "retired-color":
    "this colour was retired by the design system and is banned — see 11-unified-page-rules.md; the emerald was shipping as a 2.27:1 focus ring",
};

/**
 * Every `<button …>` OPENING TAG in a source string, with its 1-based start line.
 *
 * A regex cannot do this alone. `>` occurs inside JSX expressions (`count > 0`,
 * `Array<{x}>`), so a naive `<button[^>]*>` ends at the wrong character and
 * never reaches the `background`. Tracking BRACE DEPTH fixes that — and is not
 * enough on its own: a `>` inside a QUOTED ATTRIBUTE sits at depth 0 and
 * terminated the tag just as early. `aria-label="a > b"`, `title="Orders >
 * Inbox"` are ordinary JSX, and the first version of this scanner let a real
 * violation behind one straight through (exit 0). So quote state is tracked
 * alongside brace depth, and both are pinned by tests.
 */
function buttonOpeningTags(src) {
  const out = [];
  const re = /<button\b/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    let depth = 0;
    let quote = null; // the ' " or ` currently open, else null
    let end = -1;
    for (let i = m.index; i < src.length; i += 1) {
      const ch = src[i];
      if (quote !== null) {
        // A backslash escapes the next character inside a quoted run.
        if (ch === "\\") i += 1;
        else if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") quote = ch;
      else if (ch === "{") depth += 1;
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
    // rgb()/rgba()/hsl()/hsla() is checked on EVERY line, including a
    // palette-const line: `const SHADOW = "rgba(0,0,0,.4)"` is both.
    COLOR_FN_RE.lastIndex = 0;
    let fn;
    while ((fn = COLOR_FN_RE.exec(line)) !== null) {
      if (/var\(/.test(fn[1])) continue;
      violations.push({ rule: "color-fn", line: i + 1, text: fn[0].slice(0, 60) });
    }

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

/**
 * Retired colours, swept across ALL of src/**. Separate pass on purpose: the
 * main scan's scope, allowlist and ledger are about src/app debt, and a banned
 * value is not debt. Test files are skipped — the tests that PIN the ban have to
 * be able to name the value they ban.
 */
function retiredColorViolations(srcRoot) {
  const out = [];
  if (!existsSync(srcRoot)) return out;
  const stack = [srcRoot];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry !== "node_modules" && entry !== ".next") stack.push(full);
      } else if (SCAN_EXT.test(entry) && !/\.test\.tsx?$/.test(entry)) {
        const rel = relative(ROOT, full).replace(/\\/g, "/");
        readFileSync(full, "utf8")
          .split(/\r?\n/)
          .forEach((line, i) => {
            RETIRED_RE.lastIndex = 0;
            let m;
            while ((m = RETIRED_RE.exec(line)) !== null) {
              out.push({ rel, line: i + 1, text: m[0] });
            }
          });
      }
    }
  }
  return out;
}

// ─── Run ──────────────────────────────────────────────────────────────────────
const files = collect(join(ROOT, ...SCAN_DIR));
const retired = retiredColorViolations(join(ROOT, "src"));

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

if (retired.length > 0) {
  console.error(
    `FAIL — ${retired.length} use(s) of a RETIRED colour (${RETIRED_COLORS.join(", ")}) under src/**:\n`,
  );
  for (const r of retired) console.error(`  ${r.rel}:${r.line}  [retired-color]  "${r.text}"`);
  console.error(`\n  retired-color: ${RULE_HINT["retired-color"]}\n`);
}

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
} else if (retired.length === 0) {
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
  // INFO, never a failure — deliberate: making a stale row red would punish the
  // exact behaviour this gate exists to encourage (someone cleans a file, CI
  // goes red, they learn to leave it alone). Re-cut with `--emit-baseline`.
  console.log(`\nBaseline rows now cheaper than recorded — tighten with \`--emit-baseline\`:`);
  for (const [rel, budget, actual] of stale) console.log(`  [STALE] ${rel}  ${actual} < ${budget}`);
}

// Stated on every run so a green result is never over-read. See the header.
console.log(
  `\nLimits: this gate reads source text. It does NOT check contrast — two tokens\n` +
    `can fail WCAG against each other with no hex on the line (see\n` +
    `src/test/token-contrast.test.ts). The baseline is a per-file COUNT, so\n` +
    `swapping one violation for another in a baselined file passes silently;\n` +
    `only GROWTH is caught.\n`,
);

if (STRICT && (overBudget.length > 0 || retired.length > 0)) {
  if (overBudget.length > 0) {
    console.error(
      `Strict mode: ${overBudget.length} file(s) exceed their token budget. Use var(--token) / a Tailwind token class.`,
    );
  }
  if (retired.length > 0) {
    console.error(`Strict mode: ${retired.length} retired-colour use(s) under src/**.`);
  }
  process.exit(1);
}

process.exit(0);
