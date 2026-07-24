/**
 * check-vocabulary.mjs  (WS-9 vocabulary gate)
 *
 * ProcuLink ships ONE plain-procurement vocabulary to users. The internal
 * "Bridge Layer" design metaphor — bridge / crossing / dock / lane / spine /
 * wire / traveller — is allowed in CODE (component names, file names, CSS
 * classes, gradient vars, data-* attributes, comments) but must NOT appear in
 * USER-FACING rendered copy.
 *
 * This script scans the render code under src/app/(app) and src/app/(marketing)
 * and FAILS (exit 1) if a retired metaphor word appears in visible copy:
 *   - JSX text nodes   ( >…retired word…<  that is not part of a tag )
 *   - visible string attributes ( aria-label / title / placeholder / alt /
 *     a bare `label="…"` / a `label:`-keyed object value )
 *   - user-facing status/toast strings ( setFlow(…) / announce(…) )
 *
 * It deliberately IGNORES (these keep the metaphor by design):
 *   - import lines and `from "…"` module specifiers
 *   - className= / class= and `className:` keys, data-* attributes
 *   - CSS variable references  var(--gradient-link-spine) etc.
 *   - href="/bridge" route paths
 *   - // and /* … *\/ and {/* … *\/} comments
 *   - the allowlisted component/identifier tokens (Bridge*, *Spine*, *Dock*,
 *     CrossingsLog, LaneDrawer, WireTopology, …) and a few known-safe phrases.
 *   - third-party proper nouns that contain a retired word (PROPER_NOUN_MASKS,
 *     e.g. Proton Bridge) — these are real product names, not our metaphor.
 *
 * Pragmatic by design: it favours FEW false positives over exhaustive coverage,
 * so it stays green in normal development and only trips on obvious regressions
 * (a retired word landing in plainly-visible copy).
 *
 * Usage:
 *   bun run lint:vocab        # exits 1 if any retired term is found in visible copy
 *   node scripts/check-vocabulary.mjs
 */

import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { join, relative } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = join(__dirname, "..");
const SCAN_DIRS = [
  join(ROOT, "src", "app", "(app)"),
  join(ROOT, "src", "app", "(marketing)"),
];

// Retired user-facing metaphor words. Matched whole-word, case-insensitive.
// (We intentionally do NOT list "rail"/"deck" — they survive only in CSS/comments.)
const RETIRED = [
  "bridge",
  "crossing",
  "crossings",
  "dock",
  "docks",
  "lane",
  "lanes",
  "spine",
  "wire",
  "wires",
  "wired",
  "wiring",
  "traveller",
  "travellers",
];
const RETIRED_RE = new RegExp(`\\b(${RETIRED.join("|")})\\b`, "i");

// Files allowed to keep retired terms in render code because their visible copy
// is owned by OTHER agents this session (cross-cutting sweep skips them) OR
// because the term is a proper noun that has no plain replacement.
const FILE_ALLOWLIST = new Set([
  // Empty: the wave-3 sweep + the main-thread ConnectionDetail fix cleared every
  // user-facing retired term. Add an entry ONLY for a justified proper-noun case.
]);

// Exact visible phrases that are legitimately fine and would otherwise trip the
// gate (proper-noun product names, deliberate copy). Keep this list SHORT and
// justify every entry.
const PHRASE_ALLOWLIST = [
  // none — Task-1 cleared the (app)+(marketing) render copy.
];

// Third-party proper nouns that legitimately CONTAIN a retired word. These are
// blanked out of a visible span BEFORE the retired-word check, so a real product
// name survives the gate without weakening it for ordinary copy around it.
// Keep this list SHORT and justify every entry.
const PROPER_NOUN_MASKS = [
  // "Proton Bridge" is Proton AG's local IMAP client application — the actual
  // product a user must install to poll a Proton mailbox. It has no plain-word
  // substitute, and renaming it would make the help article factually wrong.
  /\bProton\s*\(via\s+Bridge\)/gi,
  /\bProton\s+Bridge\b/gi,
];

/** Blank out allowlisted proper nouns so only genuine metaphor use is matched. */
function maskProperNouns(text) {
  return PROPER_NOUN_MASKS.reduce((acc, re) => acc.replace(re, " "), text);
}

/** Recursively collect candidate render files (.tsx / .mdx) under a dir. */
function findFiles(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...findFiles(full));
    } else if (/\.(tsx|mdx)$/.test(entry) && !/\.test\.tsx$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const toRel = (p) => relative(ROOT, p).replace(/\\/g, "/");

/**
 * From one source line, return ONLY the spans of text that a user actually sees:
 * JSX text content + visible attribute values + toast/announce string args.
 * Everything else (code, classNames, imports, comments) is discarded so the
 * retired-word check never fires on identifiers.
 */
function visibleSpans(line) {
  const spans = [];

  // Skip whole-line comments and import/module lines outright.
  const trimmed = line.trim();
  if (
    trimmed.startsWith("//") ||
    trimmed.startsWith("*") ||
    trimmed.startsWith("/*") ||
    trimmed.startsWith("{/*") ||
    trimmed.startsWith("import ") ||
    /^export\s+\{/.test(trimmed)
  ) {
    return spans;
  }

  // Strip inline block comments and JSX comments so their text isn't scanned.
  let s = line
    .replace(/\/\*[^]*?\*\//g, " ")
    .replace(/\{\/\*[^]*?\*\/\}/g, " ");
  // Strip an inline trailing line comment (best-effort; not inside a string).
  s = s.replace(/\/\/.*$/, " ");

  // 1) Visible attribute values: aria-label, title, placeholder, alt, and a
  //    bare label="…" (NOT className / aria-labelledby / htmlFor).
  const ATTR_RE =
    /\b(aria-label|title|placeholder|alt|label)\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = ATTR_RE.exec(s)) !== null) spans.push(m[2]);

  // 2) `label: "…"` object values (command-palette entries, nav items, etc.).
  const LABEL_KEY_RE = /\blabel\s*:\s*"([^"]*)"/g;
  while ((m = LABEL_KEY_RE.exec(s)) !== null) spans.push(m[1]);

  // 3) User-facing toast / live-region strings.
  const TOAST_RE = /\b(setFlow|announce|toast|setStatus)\s*\(\s*[`"']([^`"']*)[`"']/g;
  while ((m = TOAST_RE.exec(s)) !== null) spans.push(m[2]);

  // 4) JSX text nodes: text between a closing `>` and the next opening `<`.
  //    We avoid attribute interiors by only taking the slice AFTER a `>`.
  //    `href="/bridge"` lives inside a tag (before `>`), so it's excluded.
  const TEXT_RE = />([^<>{}]+)</g;
  while ((m = TEXT_RE.exec(s)) !== null) {
    const text = m[1].trim();
    // Ignore pure punctuation / arrows / single glyphs.
    if (text && /[A-Za-z]/.test(text)) spans.push(text);
  }

  return spans;
}

/** MDX files are prose — scan the raw line as visible text (minus code fences). */
function visibleSpansMdx(line) {
  const t = line.trim();
  if (t.startsWith("import ") || t.startsWith("export ")) return [];
  if (t.startsWith("```") || t.startsWith("//")) return [];
  // JSX/HTML attribute hrefs etc. inside MDX still live before a `>`; the prose
  // is what matters, so just hand back the whole line.
  return [line];
}

const files = SCAN_DIRS.flatMap(findFiles);
const violations = [];

for (const file of files) {
  const rel = toRel(file);
  if (FILE_ALLOWLIST.has(rel)) continue;
  const isMdx = /\.mdx$/.test(file);
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, i) => {
    const spans = isMdx ? visibleSpansMdx(line) : visibleSpans(line);
    for (const span of spans) {
      if (PHRASE_ALLOWLIST.includes(span.trim())) continue;
      const hit = maskProperNouns(span).match(RETIRED_RE);
      if (hit) {
        violations.push({
          file: rel,
          line: i + 1,
          term: hit[1].toLowerCase(),
          text: span.trim().slice(0, 120),
        });
      }
    }
  });
}

console.log(
  `\nVocabulary gate — scanned ${files.length} render file(s) under (app)+(marketing)\n`
);

if (violations.length === 0) {
  console.log("OK — no retired metaphor words found in user-facing copy.\n");
  process.exit(0);
}

console.error(
  `FAIL — ${violations.length} retired metaphor word(s) found in visible copy:\n`
);
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}  [${v.term}]  "${v.text}"`);
}
console.error(
  `\nRelabel to plain procurement words (bridge/crossing→connection/delivery,\n` +
    `dock→supplier/connection, lane→row/field, spine→·, "wire fields"→"map fields").\n` +
    `Code identifiers, classNames, CSS vars, and comments are exempt — only\n` +
    `visible copy must change. If a match is a false positive, narrow the\n` +
    `visibleSpans() heuristic or add the exact phrase to PHRASE_ALLOWLIST.\n` +
    `If the match is a third-party product name (e.g. Proton Bridge), add it\n` +
    `to PROPER_NOUN_MASKS instead of rewriting accurate copy.\n`
);
process.exit(1);
