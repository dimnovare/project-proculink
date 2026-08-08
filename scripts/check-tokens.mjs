/**
 * check-tokens.mjs  —  the ProcuLink design-token gate
 *
 * WHAT THE DESIGN DOC ASKS FOR
 * docs/design-system/11-unified-page-rules.md §Enforcement specifies one CI lint,
 * scoped to `src/app/**`, failing the build on the two patterns that caused the
 * drift the audit found:
 *
 *   1. Raw 6-digit hex literals — regex `#[0-9A-Fa-f]{6}`. Pages must use a token
 *      class or `var(--token)`.
 *   2. Inline-styled buttons — `<button` carrying an inline `background:` (or
 *      `style={{ background`). Use the Button primitive.
 *
 * The same doc's "Every new page MUST" rule 5 also bans per-page palette
 * constants (`const BLUE = "#1E66C9"` — "the #1 source of drift in the audit").
 * A palette constant IS a hex literal, so rule 1 already catches it; it is
 * reported under its own rule id purely so the message can name the fix.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SCAN ROOT IS `src/**`, NOT `src/app/**`, AND THAT IS THE WHOLE POINT.
 *
 * The doc's `src/app/**` scope was written for a tree where a page is a page.
 * This is not that tree. Measured 2026-08-08: every signature screen in the
 * product is a ~10-line `src/app` wrapper over a body in `src/components`.
 *
 *     src/app/(app)/library/suppliers/page.tsx       9 lines
 *     src/app/(app)/bridge/page.tsx                 10
 *     src/app/(app)/operations/log/page.tsx         11
 *     src/app/(app)/upload/page.tsx                 11
 *     src/app/(app)/inbox/[orderId]/page.tsx        15
 *     src/app/(app)/inbox/page.tsx                  18
 *
 *   …against the bodies those wrappers render:
 *
 *     src/components/bridge/InboxView.tsx         2318 lines
 *     src/components/bridge/UploadWorkbench.tsx   2307
 *     src/components/bridge/BridgeDashboard.tsx   2014
 *     src/components/bridge/SupplierDockProfile.tsx 1860
 *
 * So an `src/app`-rooted scan read 147 of the 665 colour-bearing files under
 * src/, and not one line of any screen a user actually looks at. A green run
 * said nothing about any screen in the product.
 *
 * NOTHING WAS WRONG WITH THE PREDICATE. Every rule below was already correct and
 * every one of them was already tested. The gate failed by WHAT IT WAS POINTED
 * AT. That is the same failure this file has already been through once: the
 * retired-colour rule was widened to all of src/** because the banned emerald
 * shipped as a 2.27:1 focus ring from src/components/help/, invisible to an
 * src/app scan "by construction". Widening one rule and leaving the other four
 * behind is why it had to be done twice. It is now done for all of them.
 *
 * The ledger (scripts/token-debt-baseline.json) is therefore large: 4,491
 * violations across 155 files, against the 707 across 39 the src/app root
 * reported. NOTHING REGRESSED AND NO RULE GOT STRICTER, and the arithmetic says
 * so: filter the new ledger to src/app rows and it is 39 rows totalling 707 —
 * identical, row for row, to the ledger this replaces. Every one of the 3,784
 * added violations comes from a file the gate had never opened.
 *
 * By region: src/components 3,712 across 105 files, src/app 707 across 39,
 * everything else (src/lib, src/mocks, src/types, mdx-components) 72 across 11.
 * 83% of this product's raw colour was outside the gate's field of view.
 *
 * That last figure is not historical. Between this branch being cut and being
 * rebased, four PRs landed on main; they removed 5 literals from
 * UploadWorkbench.tsx and ADDED 2 — one in SupplierDockProfile.tsx, one in a new
 * src/lib/exceptionStateManifest.ts. Both additions are outside src/app, so both
 * went in with no gate on them at all, in one day, while lint:tokens was green.
 * The src/app total did not move by a single literal across all four.
 *
 * It is LEDGERED, not enforced, and that is deliberate. A gate that turns main
 * red on the day it lands gets switched off, and then nobody reads CI at all —
 * which has already happened in this repo once.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * FOUR DELIBERATE DEVIATIONS FROM THE DOC, each measured:
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
 *   • RETIRED COLOURS have NO BASELINE AND NO ALLOWLIST. Every other rule
 *     ledgers its existing debt; this one refuses to, because a banned value is
 *     never debt, it is a bug. (Its scan root used to be the deviation too —
 *     all of src/** while the rest read src/app/** — after the banned emerald
 *     shipped as the focus-visible ring on all 46 help articles, 2.2731:1
 *     against a 3:1 non-text floor, from src/components/help/. Every rule reads
 *     src/** now, so only the no-baseline part is still a deviation.)
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
 *      "different debt". Growth (28 -> 29) fails and shrinkage (28 -> 27) fails,
 *      so the count is pinned in BOTH directions — but neutralising one
 *      violation and adding a different one in the same file (28 -> 28) still
 *      passes SILENTLY. A green `lint:tokens` does NOT mean a baselined file is
 *      unchanged, only that it carries the same NUMBER of literals. Keying the
 *      ledger by violation content would close this; it is a baseline-format
 *      change and is deliberately not bundled into a scope fix.
 *   3. STILL NOT CAUGHT, by design or by limitation: `color-mix()` (its
 *      arguments are usually tokens), CSS named colours (`red` is unresolvable
 *      from `red` the identifier or the prose), and any hex assembled at
 *      runtime — `"#" + "1E66C9"`, `` `#${x}` ``, `[..].join("")`. A source-text
 *      scanner cannot see the last group without evaluating the program.
 *   4. A LEDGER IS ONLY AN ALIBI FOR THE FILES IT LISTS. This used to be a
 *      scope warning — every BASELINE row was an src/app path, so "the debt is
 *      ledgered" said nothing about src/components/**. That specific hole is
 *      closed: the ledger now covers src/**. The general form still bites, and
 *      it bit this repo once already — an acceptance criteria deferred its
 *      un-audited remainder to "the 798 ledgered violations" while 27 measured
 *      sub-4.5:1 TEXT pairs sat in src/components/**, reachable from /bridge,
 *      /inbox/[orderId] and /operations/*, in a region the ledger had never had
 *      a row for. Before quoting the ledger as coverage, check that the thing
 *      you are covering is a thing this gate measures at all (see 1 and 5).
 *   5. IT IS NOT AN EMISSION CHECK. It reads the files; it does not read the
 *      stylesheet those files compile to, and the two scanners do not agree on
 *      scope. This gate skips `*.test.ts(x)` on purpose — a test that pins a ban
 *      has to be able to name the value it bans — and tailwind.config.ts did
 *      not, so Tailwind's content scanner read a FIXTURE STRING out of
 *      check-tokens.test.ts and emitted the banned emerald into production CSS
 *      while this gate was green. scripts/check-emitted-css.mjs closes that by
 *      asking the compiler.
 *
 * ROUTE ENUMERATION. next.config.ts sets pageExtensions ["ts","tsx","mdx"] and
 * the tree carries 45 `page.mdx` against 44 `page.tsx`. A .tsx-only scan would
 * see under half the routes, so .mdx is in scope and is pinned by a test.
 *
 * TWO LISTS, AND THEY ARE NOT THE SAME THING:
 *   ALLOWLIST — permanent, and lives in this file. A file that legitimately
 *               cannot use a token. Every entry states the evidence. Currently
 *               one: globals.css, which IS the token definitions.
 *   BASELINE  — a debt ledger with per-file counts, in
 *               scripts/token-debt-baseline.json. NOT an exemption: a listed
 *               file must carry EXACTLY its recorded count.
 *
 * THE LEDGER FAILS IN BOTH DIRECTIONS, and the second direction is the one that
 * is usually left out. A new violation in an unlisted file reddens — that is the
 * obvious half. A LISTED VIOLATION THAT NO LONGER EXISTS ALSO REDDENS, because a
 * ledger that over-states the debt is how a fixed thing stays "known broken"
 * forever: the row outlives the defect, the total printed in the PR body stops
 * being true, and the next reader budgets for work that is already done.
 *
 * The old behaviour was to report a shrunk row as INFO and never fail, on the
 * reasoning that "making a stale row red would punish the exact behaviour this
 * gate exists to encourage — someone cleans a file, CI goes red, they learn to
 * leave it alone". That concern is real and it is answered by ergonomics, not by
 * silence: the failure names the file, prints the true count, and the fix is one
 * command that rewrites the whole ledger —
 *
 *     node scripts/check-tokens.mjs --emit-baseline --write
 *
 * Nobody has to hand-count a row. Hand-counting is how a ratchet gets a wrong
 * number in it, which is why --emit-baseline existed before this change.
 *
 * Usage:
 *   bun run lint:tokens                             # strict — what CI runs
 *   node scripts/check-tokens.mjs                   # report only, always exits 0
 *   node scripts/check-tokens.mjs --strict          # exits 1 on NEW or STALE rows
 *   node scripts/check-tokens.mjs --root <dir>      # scan a fixture tree
 *   node scripts/check-tokens.mjs --baseline <file> # use a different ledger
 *   node scripts/check-tokens.mjs --emit-baseline   # print the ledger for the tree as it is
 *   node scripts/check-tokens.mjs --emit-baseline --write   # …and rewrite the file
 *   node scripts/check-tokens.mjs --stats           # corpus + violation counts as JSON
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "fs";
import { join, relative } from "path";
import { fileURLToPath } from "url";
import { RETIRED_COLORS, retiredRegex } from "./retired-colors.mjs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// ─── CLI ──────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flagValue = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const rootFlag = argv.indexOf("--root");
const ROOT = rootFlag >= 0 ? argv[rootFlag + 1] : join(__dirname, "..");
const STRICT = argv.includes("--strict");
// Prints the ledger for the tree exactly as it stands, and with --write rewrites
// it. Hand-counting rows is how a ratchet gets a wrong number in it, and the
// ledger is now several hundred rows long — there is no hand-editing it at all.
const EMIT_BASELINE = argv.includes("--emit-baseline");
const WRITE = argv.includes("--write");
// Corpus + violation counts as JSON, for the anti-vacuity assertions in
// src/test/check-tokens.test.ts. A file COUNT is not a detection floor, so this
// reports what was actually read and line-scanned, not what was merely listed.
const STATS = argv.includes("--stats");
const baselineFlag = flagValue("--baseline");
const BASELINE_PATH = baselineFlag ?? join(__dirname, "token-debt-baseline.json");
// A fixture tree has no shared debt history, so the repo's baseline must not
// silently absolve it. Without this, a test fixture placed at a baselined path
// would pass for the wrong reason. An EXPLICIT --baseline overrides that: the
// caller has said which ledger applies, so it applies.
const USING_FIXTURE = rootFlag >= 0 && baselineFlag === undefined;

// ─── Scan scope ───────────────────────────────────────────────────────────────
// `src`, not `src/app`. See the header: every screen in this product is a
// ~10-line src/app wrapper over a 1,000–2,300-line body in src/components, so an
// src/app root read 151 of 666 files and none of the product.
const SCAN_DIR = ["src"];
const SCAN_EXT = /\.(tsx|ts|mdx|css)$/;
const SKIP_DIR = new Set(["node_modules", ".next"]);
/**
 * Test files are skipped by EVERY rule, and the reason is the same one the
 * retired-colour rule already had: a test that PINS a ban has to be able to name
 * the value it bans. src/test/token-contrast.test.ts and this gate's own
 * check-tokens.test.ts both spell out hex on purpose.
 *
 * This is the single riskiest exclusion in the file, so: it is a FILENAME rule,
 * not a directory rule. `src/test/textColorScan.ts` is not a test file by this
 * regex and is not exempt — it carries 4 hex literals in its doc comments and is
 * ledgered like anything else. Excluding whole directories is what created the
 * blind spot this change exists to fix; it is not repeated here at smaller scale.
 */
const TEST_FILE = /\.test\.(tsx?|mdx)$/;

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
// tailwind.config.ts is the other definition site and sits at the repo root,
// outside src/**, so it is out of scope. src/lib/ds-tokens.ts is named in its own
// header as a token module but was MEASURED at 0 colour literals — it exports
// typed helpers only (`confidenceTier`), so it needs no row. Do not add one
// pre-emptively: an allowlist row for a file with nothing to allow is how a real
// hex gets a free pass later.

/**
 * Debt ledger — every file that carries a raw colour literal, with the count it
 * carries. The count is pinned in BOTH directions: exceeding it fails, dropping
 * below it fails (the row is stale and the total has stopped being true), and a
 * file with no row must be at zero. Re-cut with `--emit-baseline --write`.
 *
 * It lives in scripts/token-debt-baseline.json, not here. At this size an inline
 * object would be most of the file, and a JSON file is something `--write` can
 * regenerate wholesale instead of asking a human to edit a number by hand.
 *
 * HISTORY, because the numbers moved for an honest reason.
 * Cut at 478b809 with a 6-digit-hex-only regex, rooted at src/app: 840 across 40
 * files. WP-30 swept `(home)/page.tsx` (64) and `(marketing)/how-it-works/page.tsx`
 * (47) and called them "cleaned to zero", leaving 729 across 38 files.
 *
 * Re-cut after the regex was extended to rgb()/rgba()/hsl()/hsla() and 3-digit
 * hex: 806 across 40 files. Both "cleaned" pages reappeared — 9 and 7 — because
 * "zero" had meant "zero BY THE OLD REGEX", and both still restate the brand blue
 * in decimal (`rgba(30,102,201,0.22)` IS `#1E66C9`).
 *
 * Re-cut again here when the scan root moved from src/app to src. The jump is
 * large and it is not new drift: it is the first count that includes the files
 * the screens are actually built out of. See the header for the measurement.
 */
const BASELINE = readBaseline(BASELINE_PATH);

function readBaseline(path) {
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf8"));
}

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

/**
 * All violations in one file's source, plus the number of lines actually put
 * through the rules. The line count is returned because a FILE COUNT IS NOT A
 * DETECTION FLOOR — "666 files scanned" is equally true of a scanner that read
 * every file and of one that listed them and tokenised nothing.
 */
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

  return { violations, lineCount: lines.length };
}

// ─── File discovery ───────────────────────────────────────────────────────────
function collect(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIR.has(entry)) out.push(...collect(full));
    } else if (SCAN_EXT.test(entry) && !TEST_FILE.test(entry)) {
      out.push(full);
    }
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
 * Retired colours. Same corpus as the main scan now that both read src/**, but
 * still a SEPARATE PASS, because the two differ in what forgives a hit: the main
 * scan has an allowlist and a ledger, and this has neither. A banned value is not
 * debt, so there is nothing for it to be baselined into.
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
        if (!SKIP_DIR.has(entry)) stack.push(full);
      } else if (SCAN_EXT.test(entry) && !TEST_FILE.test(entry)) {
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

/** rel → { violations: [], count: number, budget: number } */
const perFile = new Map();
// `files.length` is what was LISTED. These two are what was actually read and put
// through the rules — the numbers the anti-vacuity test asserts against.
let tokenisedCount = 0;
let linesScanned = 0;
let allowedTotal = 0;

for (const file of files) {
  const rel = toRel(file);
  const ext = (/\.([a-z]+)$/.exec(file) ?? [, ""])[1];
  const allow = allowedRules(rel);

  const { violations: found, lineCount } = scanSource(readFileSync(file, "utf8"), ext);
  tokenisedCount += 1;
  linesScanned += lineCount;
  if (found.length === 0) continue;

  const live = allow === "*" ? [] : found.filter((v) => !(allow && allow.has(v.rule)));
  allowedTotal += found.length - live.length;
  if (live.length === 0) continue;

  const budget = USING_FIXTURE || EMIT_BASELINE ? 0 : (BASELINE[rel] ?? 0);
  perFile.set(rel, { violations: live, count: live.length, budget });
}

const violationTotal = [...perFile.values()].reduce((n, v) => n + v.count, 0);

if (STATS) {
  console.log(
    JSON.stringify(
      {
        root: toRel(join(ROOT, ...SCAN_DIR)) || SCAN_DIR.join("/"),
        listed: files.length,
        tokenised: tokenisedCount,
        linesScanned,
        filesWithViolations: perFile.size,
        violations: violationTotal,
        retired: retired.length,
        baselineRows: Object.keys(BASELINE).length,
        baselineTotal: Object.values(BASELINE).reduce((n, v) => n + v, 0),
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

if (EMIT_BASELINE) {
  const rows = [...perFile.entries()].sort(([a], [b]) => a.localeCompare(b));
  const ledger = {};
  for (const [rel, v] of rows) ledger[rel] = v.count;
  const json = `${JSON.stringify(ledger, null, 2)}\n`;
  if (WRITE) {
    writeFileSync(BASELINE_PATH, json, "utf8");
    console.log(
      `Wrote ${rows.length} row(s), ${violationTotal} violation(s) to ${toRel(BASELINE_PATH)}`,
    );
  } else {
    process.stdout.write(json);
  }
  process.exit(0);
}

const overBudget = [...perFile.entries()].filter(([, v]) => v.count > v.budget);
const withinBudget = [...perFile.entries()].filter(([, v]) => v.count > 0 && v.count <= v.budget);

/**
 * Baseline rows that record MORE violations than the file now carries — cleaned,
 * partially cleaned, or deleted outright (a missing file reads as 0).
 *
 * THIS FAILS. It did not used to, and the comment that said so argued that
 * reddening CI when someone cleans a file teaches them to stop cleaning files.
 * The counter-argument won: a row that outlives its defect is how a fixed thing
 * stays "known broken" forever, and the ledger total is a number the founder
 * reads as "how much design debt exists". An over-stated total is not a
 * conservative estimate, it is a wrong one, and nothing else in the repo can
 * catch it. The ergonomics answer is below in the failure message: one command,
 * no hand-counting.
 */
const stale = USING_FIXTURE
  ? []
  : Object.entries(BASELINE)
      .map(([rel, budget]) => [rel, budget, perFile.get(rel)?.count ?? 0])
      .filter(([, budget, actual]) => actual < budget);

console.log(
  `\nDesign-token gate — tokenised ${tokenisedCount}/${files.length} file(s), ` +
    `${linesScanned} line(s) under ${SCAN_DIR.join("/")}/** (.tsx/.ts/.mdx/.css, excluding *.test.*)\n`,
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
} else if (retired.length === 0 && stale.length === 0) {
  console.log("OK — no new raw hex, palette constants, or inline-styled buttons under src/**.");
}

if (withinBudget.length > 0) {
  console.log(
    `\nBaseline debt (ledgered in ${toRel(BASELINE_PATH)} — pinned in BOTH directions:\n` +
      `clean one and re-cut with \`--emit-baseline --write\`, do not leave the row behind):`,
  );
  for (const [rel, v] of withinBudget) console.log(`  [TODO] ${rel}  ${v.count}/${v.budget}`);
}

if (allowedTotal > 0) {
  console.log(`\nAllowlisted: ${allowedTotal} literal(s) in token-definition files.`);
  for (const a of ALLOWLIST) console.log(`  ${a.pattern.source} — ${a.reason}`);
}

if (stale.length > 0) {
  const freed = stale.reduce((n, [, budget, actual]) => n + (budget - actual), 0);
  console.error(
    `FAIL — ${stale.length} STALE baseline row(s): the ledger records ${freed} violation(s) ` +
      `that no longer exist.\n`,
  );
  for (const [rel, budget, actual] of stale) {
    console.error(`  [STALE] ${rel}  ${actual} found, ${budget} recorded`);
  }
  console.error(
    `\n  These files got BETTER. Nothing is broken — the ledger is just out of date, and a\n` +
      `  ledger that over-states the debt is how a fixed thing stays "known broken" forever.\n` +
      `  Re-cut it (no hand-counting, it rewrites every row):\n\n` +
      `      node scripts/check-tokens.mjs --emit-baseline --write\n`,
  );
}

// Stated on every run so a green result is never over-read. See the header.
console.log(
  `\nLimits: this gate reads source text under src/**. It does NOT check contrast\n` +
    `— two tokens can fail WCAG against each other with no hex on the line (see\n` +
    `src/test/token-contrast.test.ts). The baseline is a per-file COUNT pinned in\n` +
    `both directions, so growth and shrinkage both fail, but swapping one\n` +
    `violation for another in a baselined file passes silently.\n`,
);

if (STRICT && (overBudget.length > 0 || retired.length > 0 || stale.length > 0)) {
  if (overBudget.length > 0) {
    console.error(
      `Strict mode: ${overBudget.length} file(s) exceed their token budget. Use var(--token) / a Tailwind token class.`,
    );
  }
  if (retired.length > 0) {
    console.error(`Strict mode: ${retired.length} retired-colour use(s) under src/**.`);
  }
  if (stale.length > 0) {
    console.error(
      `Strict mode: ${stale.length} stale baseline row(s). Re-cut with \`--emit-baseline --write\`.`,
    );
  }
  process.exit(1);
}

process.exit(0);
