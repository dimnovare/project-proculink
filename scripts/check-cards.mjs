/**
 * check-cards.mjs — the card-surface gate.
 *
 * WHAT IT ENFORCES
 * There is ONE card in this product: <Card> in src/components/bridge/layout/Card.tsx.
 * A card is an element that paints a raised surface itself — a background AND a
 * border AND a corner radius on the same element. Every such element that is not
 * <Card> is a hand-rolled card, and hand-rolled cards are what made the 3px
 * cross-section edge meaningless: the edge cannot be applied "by rule" if most
 * cards are not reachable from the rule.
 *
 * WHY A LEDGER AND NOT A BAN
 * ~150 of these existed when the gate was written. Turning main red on day one
 * gets a gate switched off, and then nobody reads CI at all — which has already
 * happened in this repo once (see the same reasoning in check-tokens.mjs). So the
 * remaining debt is ledgered per file, PINNED IN BOTH DIRECTIONS:
 *   - a new hand-rolled card in an unlisted file fails;
 *   - a row that records more than the file now carries also fails, because a
 *     ledger that over-states the debt is how a fixed thing stays "known broken".
 * Re-cut with `node scripts/check-cards.mjs --emit-baseline --write`.
 *
 * WHAT IS DELIBERATELY NOT A CARD, and why the exclusions are SHAPES not filenames
 * A notice, a banner, a popover, a dropdown, a dialog, a list row, a segmented
 * control and a step badge all paint a surface too. They are not cards and they
 * do not take a semantic side edge — <StatusNotice> owns tone, and it signals it
 * with a 3px LEFT BORDER of its own. That collision is real and it is why these
 * shapes are excluded here rather than migrated: converting a notice into a Card
 * would change its geometry AND overload the edge a second time.
 *
 * ANTI-VACUITY
 * Every count printed is elements EXTRACTED, never files listed. `all()` over an
 * empty set is true, and a scanner that lists 251 files and tokenises none is
 * indistinguishable from a clean tree unless it says what it actually parsed.
 * --stats exposes the extraction counts for the test to assert a floor against.
 *
 * Usage:
 *   node scripts/check-cards.mjs                    # report only (exits 0)
 *   node scripts/check-cards.mjs --strict           # exits 1 on new or stale rows
 *   node scripts/check-cards.mjs --emit-baseline --write
 *   node scripts/check-cards.mjs --stats            # JSON counts
 *   node scripts/check-cards.mjs --root <dir>       # scan a fixture tree
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "fs";
import { join, relative } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const argv = process.argv.slice(2);
const flagValue = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const rootFlag = argv.indexOf("--root");
const ROOT = rootFlag >= 0 ? argv[rootFlag + 1] : join(__dirname, "..");
const STRICT = argv.includes("--strict");
const EMIT_BASELINE = argv.includes("--emit-baseline");
const WRITE = argv.includes("--write");
const STATS = argv.includes("--stats");
const baselineFlag = flagValue("--baseline");
const BASELINE_PATH = baselineFlag ?? join(__dirname, "card-debt-baseline.json");
const USING_FIXTURE = rootFlag >= 0 && baselineFlag === undefined;

const SKIP_DIR = new Set(["node_modules", ".next", ".claude"]);
const TEST_FILE = /\.test\.tsx$/;

/**
 * The files that ARE the card surface, plus the one primitive that legitimately
 * paints its own bordered box because it owns tone rather than side.
 */
const ALLOWLIST = [
  {
    pattern: /^src\/components\/bridge\/layout\/Card\.tsx$/,
    reason: "This file IS the card. Banning a card surface here leaves nowhere to define one.",
  },
  {
    pattern: /^src\/components\/bridge\/layout\/StatusNotice\.tsx$/,
    reason:
      "Owns TONE, not side. Its 3px left border is the tone signal and predates the " +
      "side edge; it is a notice primitive, not a card.",
  },
  {
    pattern: /^src\/components\/bridge\/layout\/MobileListRow\.tsx$/,
    reason: "A list row primitive. Rows are not cards and take no side edge.",
  },
];

function collect(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIR.has(e)) out.push(...collect(full));
    } else if (/\.tsx$/.test(e) && !TEST_FILE.test(e)) out.push(full);
  }
  return out;
}

/**
 * Every JSX opening tag with its 1-based line. Brace- AND quote-aware: `>` occurs
 * inside JSX expressions (`count > 0`) and inside quoted attributes
 * (`aria-label="a > b"`), and a naive `<div[^>]*>` ends at the wrong character and
 * never reaches the style prop. Same technique as check-tokens.mjs, for the same
 * reason and with the same failure behind it.
 */
function openingTags(src) {
  const out = [];
  const re = /<([a-zA-Z][a-zA-Z0-9.]*)\b/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    let depth = 0;
    let quote = null;
    let end = -1;
    for (let i = m.index; i < src.length; i += 1) {
      const ch = src[i];
      if (quote !== null) {
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
    out.push({
      name: m[1],
      tag: src.slice(m.index, end + 1),
      line: src.slice(0, m.index).split("\n").length,
    });
  }
  return out;
}

const CONTAINERS = new Set([
  "div", "section", "aside", "article", "li", "ul", "details", "form", "header", "footer", "main",
]);

const BORDER_UTIL = /(?:^|[\s"'`{])border(?:-2|-\[?\d)?(?![\w-])|(?:^|[\s"'`{])border-(?:t|b|l|r|x|y)(?![\w-])/;
const ROUNDED_UTIL = /(?:^|[\s"'`{])rounded(?:-(?:sm|md|lg|xl|2xl|3xl|card|card-sm|card-lg|\[[^\]]+\]))?(?![\w-])/;
const SURFACE_UTIL = /(?:^|[\s"'`{])bg-(?:surface|white|surface2|card|navy-surface)(?![\w-])/;
const INLINE_BORDER = /\bborder\s*:/;
const INLINE_RADIUS = /\bborderRadius\s*:/;
const INLINE_BG = /\b(?:background|backgroundColor)\s*:/;

/**
 * Shapes that paint a surface but are NOT cards. Each is a structural signal
 * present in the tag itself, so the exclusion is auditable from the source line
 * rather than asserted from a filename.
 */
const NOT_A_CARD = [
  ["overlay-role", /role\s*=\s*["'](?:dialog|listbox|menu|tooltip|combobox|radiogroup|tablist|alertdialog)["']/],
  ["pill-inline", /display\s*:\s*["']inline-(?:flex|block)["']/],
  ["pill-round", /(?:^|[\s"'`{])rounded-full(?![\w-])|borderRadius\s*:\s*(?:999|9999)/],
  ["decorative", /aria-hidden(?:\s*=\s*\{?\s*(?:true|"true")\s*\}?)?[\s/>]/],
  ["floating", /position\s*:\s*["'](?:fixed|absolute)["']|(?:^|[\s"'`{])(?:fixed|absolute)(?![\w-])/],
  ["list-row", /(?:^|[\s"'`{])mapper-row(?![\w-])|data-mapper-row/],
  // A tone edge is StatusNotice's signal, not a card's side edge.
  ["tone-notice", /borderLeft\s*:\s*[`"']?3px solid var\(--(?:danger|amber|brand-green|brand-blue)\)/],
];

const files = collect(join(ROOT, "src"));
let tagsExtracted = 0;
let containersExamined = 0;
const excluded = {};
const perFile = new Map();

for (const f of files) {
  const rel = relative(ROOT, f).replace(/\\/g, "/");
  if (ALLOWLIST.some((a) => a.pattern.test(rel))) continue;
  const src = readFileSync(f, "utf8");
  for (const t of openingTags(src)) {
    tagsExtracted += 1;
    if (!CONTAINERS.has(t.name)) continue;
    containersExamined += 1;

    const cls = /className\s*=\s*(?:"([^"]*)"|\{([\s\S]*?)\}(?=\s|$))/.exec(t.tag);
    const clsText = cls ? (cls[1] ?? cls[2] ?? "") : "";
    const styleM = /style\s*=\s*\{\{([\s\S]*?)\}\}/.exec(t.tag);
    const styleText = styleM ? styleM[1] : "";

    const tw = BORDER_UTIL.test(clsText) && ROUNDED_UTIL.test(clsText) && SURFACE_UTIL.test(clsText);
    const inline = INLINE_BORDER.test(styleText) && INLINE_RADIUS.test(styleText) && INLINE_BG.test(styleText);
    const cssClass = /(?:^|[\s"'`])(?:card|xcard)(?![\w-])/.test(clsText);
    if (!(tw || inline || cssClass)) continue;

    const ex = NOT_A_CARD.find(([, re]) => re.test(t.tag));
    if (ex) {
      excluded[ex[0]] = (excluded[ex[0]] ?? 0) + 1;
      continue;
    }
    const entry = perFile.get(rel) ?? { violations: [], count: 0 };
    entry.violations.push({ line: t.line, el: t.name, how: tw ? "tailwind" : inline ? "inline" : "css-class" });
    entry.count += 1;
    perFile.set(rel, entry);
  }
}

const BASELINE = existsSync(BASELINE_PATH) && !USING_FIXTURE ? JSON.parse(readFileSync(BASELINE_PATH, "utf8")) : {};
const violationTotal = [...perFile.values()].reduce((n, v) => n + v.count, 0);

if (STATS) {
  console.log(
    JSON.stringify(
      {
        listed: files.length,
        tagsExtracted,
        containersExamined,
        handRolledCards: violationTotal,
        filesWithCards: perFile.size,
        excludedByShape: excluded,
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
  const ledger = {};
  for (const [rel, v] of [...perFile.entries()].sort(([a], [b]) => a.localeCompare(b))) ledger[rel] = v.count;
  const json = `${JSON.stringify(ledger, null, 2)}\n`;
  if (WRITE) {
    writeFileSync(BASELINE_PATH, json, "utf8");
    console.log(`Wrote ${Object.keys(ledger).length} row(s), ${violationTotal} hand-rolled card(s).`);
  } else process.stdout.write(json);
  process.exit(0);
}

const overBudget = [...perFile.entries()].filter(([rel, v]) => v.count > (BASELINE[rel] ?? 0));
const stale = USING_FIXTURE
  ? []
  : Object.entries(BASELINE)
      .map(([rel, budget]) => [rel, budget, perFile.get(rel)?.count ?? 0])
      .filter(([, budget, actual]) => actual < budget);

console.log(
  `\nCard-surface gate — extracted ${tagsExtracted} JSX tag(s), examined ` +
    `${containersExamined} container element(s) across ${files.length} file(s) under src/**\n`,
);
console.log(`Excluded as not-a-card, by shape: ${JSON.stringify(excluded)}`);

if (overBudget.length > 0) {
  const total = overBudget.reduce((n, [rel, v]) => n + (v.count - (BASELINE[rel] ?? 0)), 0);
  console.error(`\nFAIL — ${total} new hand-rolled card(s) across ${overBudget.length} file(s):\n`);
  for (const [rel, v] of overBudget) {
    console.error(`  ${rel}  (${v.count} found, ${BASELINE[rel] ?? 0} allowed)`);
    for (const x of v.violations.slice(0, 15)) console.error(`    ${rel}:${x.line}  <${x.el}>  [${x.how}]`);
  }
  console.error(
    `\n  Use <Card> from @/components/bridge/layout/Card. Pick its edge by the rule in\n` +
      `  that file's header: blue = buyer/incoming, green = supplier/outgoing,\n` +
      `  bridge = spans both, none = neutral OR you cannot tell. "none" is a real answer.\n`,
  );
}

if (stale.length > 0) {
  const freed = stale.reduce((n, [, b, a]) => n + (b - a), 0);
  console.error(`\nFAIL — ${stale.length} STALE row(s): the ledger records ${freed} card(s) that no longer exist.\n`);
  for (const [rel, budget, actual] of stale) console.error(`  [STALE] ${rel}  ${actual} found, ${budget} recorded`);
  console.error(`\n  These files got BETTER. Re-cut:  node scripts/check-cards.mjs --emit-baseline --write\n`);
}

if (overBudget.length === 0 && stale.length === 0) {
  console.log(`\nOK — ${violationTotal} hand-rolled card(s), all ledgered.`);
}

console.log(
  `\nLimits: this gate reads source text. It sees a card by its SHAPE (background +\n` +
    `border + radius on one container element); it cannot tell whether the EDGE VALUE\n` +
    `is semantically right. The rule itself is pinned by src/test/cardEdgeRule.test.tsx.\n`,
);

if (STRICT && (overBudget.length > 0 || stale.length > 0)) process.exit(1);
process.exit(0);
