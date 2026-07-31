/**
 * check-vocabulary.mjs  —  the ProcuLink vocabulary gate
 *
 * ProcuLink ships ONE plain-procurement vocabulary to users. Three things are
 * policed, in three modes:
 *
 *   1. METAPHOR tier (BLOCK).  The internal "Bridge Layer" design metaphor —
 *      bridge / crossing / dock / lane / spine / wire / traveller — is allowed
 *      in CODE (component names, file names, CSS classes, gradient vars, data-*
 *      attributes, comments) but must never appear in USER-FACING copy. This
 *      war is won; the tier stays as a regression guard.
 *
 *   2. JARGON tier (BLOCK).  Engineering nouns that leak out of the engine and
 *      into rendered copy — revision, canonical, replay, unrouted, passport,
 *      dead-letter, bindings, ingress, provenance, … (DESIGN-DB-1 §6.5, §7.2).
 *      These have no legitimate user-facing reading.
 *
 *   3. GLOSS tier (WARN, exit 0).  Words that ARE legitimate but must be
 *      glossed on first use — cXML, UBL, EDIFACT, X12, webhook, SFTP, schema,
 *      namespace, … Printed with `--warn`; never fails the build. Standards
 *      names are FACTS (a supplier's IT team asked for "cXML 1.2"), so renaming
 *      them would make the copy wrong. They stay WARN forever.
 *
 *   4. `--nouns` (BLOCK).  The positive check: DESIGN-DB-1 §7.4. Navigation
 *      labels (sidebar items + group headers, hub tabs, supplier tabs, settings
 *      tabs, inbox filter chips) may only use the nine approved nouns plus the
 *      closed place/support word lists in src/lib/vocabulary.ts. A blocklist
 *      can only catch a bad word; this catches a tenth CONCEPT ("Partners",
 *      "Rules & formats", "PO Mapping", "Normalized").
 *
 * WHAT IS SCANNED (DESIGN-DB-1 §7.1). The old gate looked only at
 * src/app/(app) + src/app/(marketing) — i.e. everywhere except where the
 * vocabulary actually lives. It now also reads:
 *   • src/components/**  (.tsx + .ts)  — "Active rule bindings", "Remove node"
 *   • src/lib/*.ts       (top level)   — the label registries (section-guides,
 *                                        breadcrumb-style maps, help copy)
 *
 * WHAT IS EXEMPT FROM THE BLOCK TIERS (and why — each is measured, §7.1):
 *   • src/app/(marketing)/help/**   reference docs for a technical reader; they
 *                                   MUST say cXML, UBL, `Idempotency-Key`
 *   • src/app/(app)/admin/**        our own staff runbook, not customer copy
 *   • (marketing)/{dpa,terms,privacy,aup,subprocessors}   legal text
 *   • **\/*.test.*, src/mocks/**, src/lib/standards/**    fixtures + fact tables
 *
 * FALSE-POSITIVE GUARDS (DESIGN-DB-1 §7.3 — a careless list turns CI red):
 *   • whole-word matching only (\b…\b). "AST" inside "P-ast- due" produced 51
 *     false hits in the audit scan, so 3-letter acronyms are OFF the lists.
 *   • "version" is NEVER policed. It is the *replacement* for "revision" and is
 *     correct in a changelog, in "Version history", in "v3". Only "revision" is.
 *   • "diff" / "node" / "sync" / "scope" are OFF the block list: "different",
 *     "Node.js", "asynchronous", "scoped" are all ordinary English.
 *   • .ts registries are matched on the VALUE side only (label-ish keys, plus
 *     every value inside a `*_LABELS` Record), so a status or route-segment
 *     IDENTIFIER (`delivery_dead_letter:`, `exceptions:`) never fails the gate.
 *   • MDX code fences are tracked with real fence state, so a line INSIDE a
 *     fence (`POST /api/ingress/{slug}/orders`) is not scanned as prose.
 *   • PROPER_NOUN_MASKS blanks third-party names that contain a policed word
 *     (Proton Bridge, Node.js, Zapier, Make.com, Amazon S3, Cloudflare R2).
 *
 * Usage:
 *   bun run lint:vocab                 # block tiers + --nouns (what CI runs)
 *   node scripts/check-vocabulary.mjs           # block tiers only
 *   node scripts/check-vocabulary.mjs --warn    # also print the gloss tier
 *   node scripts/check-vocabulary.mjs --nouns   # noun budget only
 *   node scripts/check-vocabulary.mjs --root <dir>   # scan a fixture tree
 */

import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { join, relative } from "path";
import { fileURLToPath } from "url";

// The comment stripper and the literal masker, shared with the two link guards through
// src/test/sourceScan.ts. ONE copy — see scripts/lib/sourceScan.mjs for why it lives under
// scripts/ (this gate runs under bare `node`, so it cannot import a .ts module) and why
// blockBody() below needs BOTH of them rather than just the stripper.
import { maskLiterals, stripComments } from "./lib/sourceScan.mjs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// ─── CLI ──────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const rootFlag = argv.indexOf("--root");
const ROOT = rootFlag >= 0 ? argv[rootFlag + 1] : join(__dirname, "..");
const WANT_NOUNS = argv.includes("--nouns") || argv.includes("--all");
// The gloss tier is a to-do list, not a build signal: printing 400+ lines in CI
// trains people to scroll past the gate. `--all` reports its COUNT; `--warn`
// lists it.
const WANT_WARN = argv.includes("--warn");
const WANT_TERMS = !argv.includes("--nouns") || argv.includes("--all");

// ─── Scan scope ───────────────────────────────────────────────────────────────
const SCAN_TARGETS = [
  { dir: ["src", "app", "(app)"], recursive: true, ext: /\.(tsx|mdx)$/ },
  { dir: ["src", "app", "(marketing)"], recursive: true, ext: /\.(tsx|mdx)$/ },
  { dir: ["src", "components"], recursive: true, ext: /\.(tsx|ts)$/ },
  // Top level ONLY: the label registries live here. Sub-directories are fact
  // tables (src/lib/standards) and infrastructure (src/lib/security).
  { dir: ["src", "lib"], recursive: false, ext: /\.ts$/ },
];

/** Paths exempt from the BLOCK tiers. Justified in the header comment. */
const BLOCK_EXEMPT = [
  /^src\/app\/\(marketing\)\/help\//,
  /^src\/app\/\(app\)\/admin\//,
  /^src\/app\/\(marketing\)\/(dpa|terms|privacy|aup|subprocessors)\//,
  /^src\/components\/help\//,
  // Vendored shadcn/ui primitives — dependency infrastructure with no product
  // copy of its own (CLAUDE.md §14). Their generics (`FieldPath<T>`) also read
  // as JSX text to any line-based extractor.
  /^src\/components\/ui\//,
  /^src\/lib\/(help-articles|help-search|guides|guide-shots\.generated)\.ts$/,
  /^src\/lib\/standards\//,
  /^src\/mocks\//,
  /\.test\.(ts|tsx)$/,
  /\.stories\.(ts|tsx)$/,
];

// ─── Tier 1: retired Bridge-Layer metaphor (BLOCK) ────────────────────────────
const METAPHOR = [
  "bridge", "crossing", "crossings", "dock", "docks", "lane", "lanes",
  "spine", "wire", "wires", "wired", "wiring", "traveller", "travellers",
];

// ─── Tier 2: engine jargon that leaked into copy (BLOCK) ──────────────────────
// DESIGN-DB-1 §6.5 + §7.2. Deliberately EXCLUDES: version(s) (the approved
// replacement for "revision"), node, diff, sync, scope, profile, standard,
// operator, record, bundle — all have ordinary-English readings (§7.3).
const JARGON = [
  "revision", "revisions",
  "canonical", "canonically",
  "passport", "passports",
  "artifact", "artifacts",
  "replay", "replays", "replayed", "replaying",
  "dead-letter", "dead letter", "dead-lettered", "dead lettered",
  "idempotency", "idempotent",
  "unrouted",
  "upsert", "upserted",
  "ingress", "egress",
  "tenant", "tenants",
  "test pack",
  "provenance",
  "binding", "bindings",
  "conformance",
  // "Exception" is a programming word for the same thing a user calls an issue
  // (§6.5 #99). Help reference articles keep it — they are BLOCK-exempt.
  "exception", "exceptions",
  // "field path" as PROSE only. The camelCase `fieldPath` is by definition a
  // code identifier (and react-hook-form's `FieldPath<T>` generic tripped it).
  "field path",
  "normalized", "normalised", "normalizing", "normalising",
  "org_id", "nonce", "payload", "payloads",
  "serialize", "serialise", "deserialize", "deserialise",
  "hydrate", "hydrated",
];

// ─── Tier 3: legitimate but must be glossed (WARN, never fails) ───────────────
const GLOSS = [
  "webhook", "webhooks", "endpoint", "endpoints",
  "cxml", "ubl", "edifact", "peppol", "sftp", "ftps", "imap",
  "namespace", "namespaces", "schema", "schemas",
  "transform", "transforms", "transformed", "transforming",
  "parse", "parses", "parsed", "parsing",
  "poll", "polling", "retry", "retries",
];

const reFor = (list) =>
  new RegExp(
    `(?<![A-Za-z0-9])(${list.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?![A-Za-z0-9])`,
    "i",
  );
const METAPHOR_RE = reFor(METAPHOR);
const JARGON_RE = reFor(JARGON);
const GLOSS_RE = reFor(GLOSS);

/** Files allowed to keep a policed term in render copy. Justify every entry. */
const FILE_ALLOWLIST = new Set([
  // Empty. Add an entry ONLY for a justified proper-noun case that
  // PROPER_NOUN_MASKS cannot express.
]);

/** Exact visible phrases that are legitimately fine. Keep SHORT, justify each. */
const PHRASE_ALLOWLIST = [
  // A physical product in the mock catalogue: 22AWG electrical wire. The noun is
  // the real-world object a buyer orders, not the Bridge-Layer metaphor.
  "Wire 22AWG Black 100m",
];

/**
 * Third-party proper nouns that legitimately CONTAIN a policed word. Blanked
 * out of a span BEFORE matching, so a real product name survives without
 * weakening the gate for the copy around it (§7.3 guard 5).
 */
const PROPER_NOUN_MASKS = [
  // "Proton Bridge" is Proton AG's local IMAP client — the actual application a
  // user installs to poll a Proton mailbox. Renaming it makes the copy wrong.
  /\bProton\s*\(via\s+Bridge\)/gi,
  /\bProton\s+Bridge\b/gi,
  /\bNode\.js\b/gi,
  /\bZapier\b/gi,
  /\bMake\.com\b/gi,
  /\bAmazon\s+S3\b/gi,
  /\bCloudflare\s+R2\b/gi,
  /\bErply\b/gi,
  /\bDirecto\b/gi,
];

function maskProperNouns(text) {
  return PROPER_NOUN_MASKS.reduce((acc, re) => acc.replace(re, " "), text);
}

// ─── File discovery ───────────────────────────────────────────────────────────
function collect(dir, ext, recursive) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (recursive) out.push(...collect(full, ext, recursive));
    } else if (ext.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const toRel = (p) => relative(ROOT, p).replace(/\\/g, "/");
const isBlockExempt = (rel) => BLOCK_EXEMPT.some((re) => re.test(rel));

// ─── Visible-span extraction ──────────────────────────────────────────────────

/**
 * From one .tsx line, the spans a user actually sees: JSX text + visible
 * attribute values + `label:` values + toast/live-region strings. Everything
 * else (identifiers, classNames, imports, comments) is discarded, so the term
 * check can never fire on code.
 */
function visibleSpansTsx(line) {
  const spans = [];
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

  let s = line
    .replace(/\/\*[^]*?\*\//g, " ")
    .replace(/\{\/\*[^]*?\*\/\}/g, " ")
    .replace(/\/\/.*$/, " ");

  // Visible attribute values. Includes the Bridge components' own copy props
  // (Card `sub`, PageHeader `subtitle`, EmptyState `hint`) — NOT className /
  // aria-labelledby / htmlFor, which are wiring.
  const ATTR_RE =
    /\b(aria-label|title|placeholder|alt|label|sub|subtitle|heading|description|hint|helper|caption|tooltip)\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = ATTR_RE.exec(s)) !== null) spans.push(m[2]);

  // `label: "…"` / `title: "…"` / `body: "…"` object values — page copy that
  // lives in a data array rather than in JSX (marketing cards, section guides).
  for (const v of tsLabelValues(s)) spans.push(v);

  const TOAST_RE = /\b(setFlow|announce|toast|setStatus|setNotice)\s*\(\s*[`"']([^`"']*)[`"']/g;
  while ((m = TOAST_RE.exec(s)) !== null) spans.push(m[2]);

  // JSX text nodes: text between a closing `>` and the next opening `<`.
  // GUARD: `>` is also a comparison / generic-close / arrow character, so a
  // slice such as `status >= 400 && replay.error.status < 500` or
  // `TName extends FieldPath<T> = FieldPath<T>` is CODE, not copy. Reject the
  // slice when the `>` was part of an operator, or when the slice contains
  // JS-only syntax. (Both classes were real false positives.)
  const TEXT_RE = />([^<>{}]+)</g;
  while ((m = TEXT_RE.exec(s)) !== null) {
    const before = m.index > 0 ? s[m.index - 1] : "";
    if (before === "=" || before === "!" || before === "<" || before === "-" || before === ">") continue;
    const text = m[1].trim();
    if (/^[=?:]/.test(text)) continue;
    if (/(&&|\|\||=>|\?\?|===|!==)/.test(text)) continue;
    if (text && /[A-Za-z]/.test(text)) spans.push(text);
  }

  // MULTI-LINE JSX text. A line-based extractor misses
  //     <label …>
  //       Revision to test
  //     </label>
  // because the prose line carries no `>` or `<` of its own — and that is where
  // most sentence-length copy lives. A line made only of words and prose
  // punctuation is scanned as copy, with three code-shaped exclusions that were
  // each a measured false positive:
  //   • a trailing `,` — an object / destructuring continuation (`revisions,`)
  //   • `.word` — property access (`replay.error instanceof …`)
  //   • fewer than two words — a bare identifier on its own line
  // Note: tested against `s` (comments stripped), not the raw line — a trailing
  // `// exception count` on a type member is a comment, not copy.
  const bare = s.trim();
  if (spans.length === 0 && looksLikeProse(bare)) spans.push(bare);

  return spans;
}

function looksLikeProse(trimmed) {
  if (!/^[A-Za-z][A-Za-z0-9 ,.'’!?%&/:;—–-]*$/.test(trimmed)) return false;
  if (/[,;:]$/.test(trimmed)) return false;
  if (/\.\w/.test(trimmed)) return false;
  return trimmed.split(/\s+/).length >= 2;
}

/**
 * Stateful .tsx line scanner. `/* … *\/` blocks whose continuation lines do NOT
 * start with `*` (the repo's boxed file headers) are the reason this needs state:
 * without it, every design-system header comment reads as prose.
 */
function tsxScanner() {
  let inBlockComment = false;
  return (line) => {
    let work = line;
    if (inBlockComment) {
      const end = work.indexOf("*/");
      if (end === -1) return [];
      work = work.slice(end + 2);
      inBlockComment = false;
    }
    work = work.replace(/\/\*[^]*?\*\//g, " ");
    const open = work.lastIndexOf("/*");
    if (open !== -1) {
      inBlockComment = true;
      work = work.slice(0, open);
    }
    return work.trim() ? visibleSpansTsx(work) : [];
  };
}

/**
 * .ts label registries. Guard §7.3-7: match ONLY the value side of a label-ish
 * key, so a status KEY (`delivery_dead_letter:`) is code and stays exempt while
 * its LABEL is policed.
 */
const TS_LABEL_KEYS =
  "label|title|sub|subtitle|purpose|text|cta|body|description|blurb|placeholder|headline|summary|heading|hint|helper|answer|question";
const TS_VALUE_RE = new RegExp(
  `\\b(?:${TS_LABEL_KEYS})\\s*:\\s*(?:"([^"]*)"|'([^']*)'|\`([^\`]*)\`)`,
  "g",
);

/**
 * A `*_LABELS` map is a Record<key, displayString>: CRUMB_LABELS keys on route
 * SEGMENTS (`exceptions:`), HUB_LABELS on hub keys, PLAN_LABELS on plan ids. The
 * key is code and the value is copy, but the key is not spelled `label:`, so the
 * label-key matcher cannot see it. Track the block and scan its values.
 *
 * Found by a mutation check: reverting `exceptions: "Issues"` in CRUMB_LABELS
 * left the gate GREEN — the crumb registry §7.1 explicitly names was blind.
 */
const LABEL_MAP_OPEN = /\bconst\s+[A-Z][A-Z0-9_]*LABELS\b/;
const MAP_VALUE_RE = /:\s*"([^"]+)"/g;

function labelMapTracker() {
  let depth = 0;
  return (line) => {
    const opening = depth === 0 && LABEL_MAP_OPEN.test(line);
    if (depth === 0 && !opening) return [];
    for (const ch of line) {
      if (ch === "{") depth += 1;
      else if (ch === "}") depth = Math.max(0, depth - 1);
    }
    MAP_VALUE_RE.lastIndex = 0;
    const out = [];
    let m;
    while ((m = MAP_VALUE_RE.exec(line)) !== null) out.push(m[1]);
    return out;
  };
}

/** All label-ish object VALUES on one line. Shared by the .ts and .tsx passes. */
function tsLabelValues(s) {
  const out = [];
  let m;
  TS_VALUE_RE.lastIndex = 0;
  while ((m = TS_VALUE_RE.exec(s)) !== null) {
    // `${…}` inside a template literal is an EXPRESSION, not copy — blank it so
    // an identifier (`${binding.fixedValue}`) can't fail the gate.
    const v = (m[1] ?? m[2] ?? m[3])?.replace(/\$\{[^}]*\}/g, " ");
    if (v && /[A-Za-z]/.test(v)) out.push(v);
  }
  return out;
}

function visibleSpansTs(line) {
  const trimmed = line.trim();
  if (
    trimmed.startsWith("//") ||
    trimmed.startsWith("*") ||
    trimmed.startsWith("/*") ||
    trimmed.startsWith("import ")
  ) {
    return [];
  }
  const s = line.replace(/\/\*[^]*?\*\//g, " ").replace(/\/\/.*$/, " ");
  return tsLabelValues(s);
}

/**
 * MDX prose. Guard §7.3-6: fence state is tracked ACROSS lines, so a line
 * inside a ``` block is code and is not scanned. Inline `code` spans are also
 * blanked — a path like `/api/ingress/{slug}` is an API fact, not copy.
 */
function mdxScanner() {
  let inFence = false;
  return (line) => {
    const t = line.trim();
    if (/^(```|~~~)/.test(t)) {
      inFence = !inFence;
      return [];
    }
    if (inFence) return [];
    if (t.startsWith("import ") || t.startsWith("export ")) return [];
    return [line.replace(/`[^`]*`/g, " ")];
  };
}

// ─── Term scan ────────────────────────────────────────────────────────────────
function scanTerms() {
  const files = SCAN_TARGETS.flatMap((t) =>
    collect(join(ROOT, ...t.dir), t.ext, t.recursive),
  );
  const blocked = [];
  const warned = [];

  for (const file of files) {
    const rel = toRel(file);
    if (FILE_ALLOWLIST.has(rel)) continue;
    const exempt = isBlockExempt(rel);
    const kind = /\.mdx$/.test(file) ? "mdx" : /\.tsx$/.test(file) ? "tsx" : "ts";
    const scan =
      kind === "mdx" ? mdxScanner() : kind === "tsx" ? tsxScanner() : visibleSpansTs;
    const labelMap = kind === "mdx" ? null : labelMapTracker();
    const lines = readFileSync(file, "utf8").split(/\r?\n/);

    lines.forEach((line, i) => {
      const spans = labelMap ? [...scan(line), ...labelMap(line)] : scan(line);
      for (const span of spans) {
        if (PHRASE_ALLOWLIST.includes(span.trim())) continue;
        const masked = maskProperNouns(span);
        const rec = { file: rel, line: i + 1, text: span.trim().slice(0, 120) };
        if (!exempt) {
          const metaphor = masked.match(METAPHOR_RE);
          if (metaphor) blocked.push({ ...rec, tier: "metaphor", term: metaphor[1].toLowerCase() });
          const jargon = masked.match(JARGON_RE);
          if (jargon) blocked.push({ ...rec, tier: "jargon", term: jargon[1].toLowerCase() });
        }
        const gloss = masked.match(GLOSS_RE);
        if (gloss) warned.push({ ...rec, term: gloss[1].toLowerCase() });
      }
    });
  }

  return { fileCount: files.length, blocked, warned };
}

// ─── --nouns: the noun budget ─────────────────────────────────────────────────
/**
 * Registries whose labels ARE the product's taught vocabulary. Path-pinned on
 * purpose: a new navigation registry has to be added here deliberately.
 * `valueLabels: true` means every string literal in the block is a label
 * (Record<Key, string> maps such as HUB_LABELS).
 */
const NOUN_REGISTRIES = [
  { file: "src/components/bridge/BridgeSidebar.tsx", blocks: ["NAV_MAIN", "NAV_TAIL"] },
  { file: "src/components/bridge/layout/HubTabs.tsx", blocks: ["HUB_TABS"] },
  { file: "src/components/bridge/layout/HubTabs.tsx", blocks: ["HUB_LABELS"], valueLabels: true },
  { file: "src/components/bridge/SupplierDockProfile.tsx", blocks: ["TABS"] },
  { file: "src/app/(app)/settings/page.tsx", blocks: ["TABS"] },
  { file: "src/components/bridge/InboxView.tsx", blocks: ["FILTER_CHIPS"] },
];

/**
 * The balanced `{…}` / `[…]` body of `const NAME … = {` in a source string.
 * The scan starts AFTER the `=`, because a TYPE ANNOTATION legitimately contains
 * brackets (`const TABS: Array<{ id: Tab }> = [`) and starting from the
 * declaration would return the empty body of `SidebarNavSection[]`.
 *
 * COMMENTS AND STRING LITERALS ARE DATA, NEVER DECLARATIONS — and this function was
 * fooled by both. A comment reading `const FILTER_CHIPS` above the real declaration
 * captured the anchor and `registry-moved` stopped firing; the same class was fixed in the
 * LINK GUARDS by `4c7350a` ("a comment after a colon is still a comment"), which touched
 * src/test/sourceScan.ts and route-reachability.test.ts but never this file — so this is
 * the first stripping fix `blockBody` has had, not the second.
 *
 * Stripping alone does not close the class: `stripComments` PRESERVES string and template
 * literals by design, because the two link guards read their contents, so the identical
 * token inside `"…const FILTER_CHIPS…"` or a template literal disarms the guard exactly as
 * the comment did — on all SEVEN policed blocks, not just the one where it was observed.
 *
 * So the search runs over `maskLiterals(stripComments(src))`, the same composition
 * `extractRaw` uses two lines apart in src/test/sourceScan.ts. (The two functions
 * themselves live in scripts/lib/sourceScan.mjs, which is what this file imports.) Masking
 * preserves length, so an offset means the same thing in both copies.
 *
 * THE SLICE COMES FROM THE UNMASKED COPY. Both callers read string-literal CONTENTS out
 * of the body — the `label:` literals here, and the approved word lists themselves in
 * loadVocabulary — and masked literals are blank. Search masked, slice unmasked; return a
 * body whose comments are gone but whose literals are intact.
 *
 * Balancing over the masked copy is a second fix in passing: a `}` or `]` inside a label
 * used to decrement the depth counter and truncate the body early, silently dropping
 * every label after it.
 *
 * Returns `{ body }` or `{ reason }`. The reason is reported as the offence, so "the
 * registry moved" stays distinguishable from "the name is now ambiguous".
 */
function blockBody(rawSrc, name) {
  const src = stripComments(rawSrc);
  const masked = maskLiterals(src);

  // The declaration must be at the START OF A LINE, optionally after `export`. All twelve
  // policed declarations are written that way, so this costs nothing — and it is what keeps
  // a JSX TEXT NODE from anchoring, which masking cannot see: a text node's `const NAME`
  // sits mid-line inside markup.
  const declRe = new RegExp(
    String.raw`^[ \t]*(?:export[ \t]+)?const\s+` + name + String.raw`\b`,
    "gm",
  );
  const decls = [...masked.matchAll(declRe)];

  // Requiring the declaration to be UNIQUE closes what is left: two declarations of the name
  // in one file make "take the first match" a coin flip about which one is policed.
  if (decls.length === 0) return { reason: "registry-moved" };
  if (decls.length > 1) return { reason: "ambiguous-declaration" };

  let eq = decls[0].index;
  while (eq < masked.length) {
    if (masked[eq] === "=" && masked[eq + 1] !== "=" && masked[eq + 1] !== ">") break;
    eq += 1;
  }
  if (eq >= masked.length) return { reason: "registry-moved" };

  // THE BODY MUST START HERE. Scanning forward for "the next `{` or `[` anywhere" is how an
  // ALIAS or a FACTORY silently re-pointed this guard at an unrelated block further down the
  // file: `const FILTER_CHIPS = CHIPS;` or `= buildChips(STATUSES)` let the scan run past the
  // assignment and police whatever bracket it met next — at a plausible label count, with no
  // parse failure, exit 0. Measured on the real InboxView.tsx: an aliased registry whose real
  // array holds "Partners"/"Normalized" reported OK at 38 labels instead of 42.
  //
  // `new Set([…])` is the one indirection a policed block actually uses (FILLER in
  // vocabulary.ts), so exactly that shape is stepped over. A bare identifier or any other
  // call is `not-a-literal`: this gate reads source text, and a registry it cannot read must
  // say so rather than quietly read something else.
  let i = eq + 1;
  while (i < masked.length && /\s/.test(masked[i])) i += 1;
  const lead = /^new\s+[\w.]+\s*\(\s*/.exec(masked.slice(i, i + 64));
  if (lead) i += lead[0].length;
  if (masked[i] !== "{" && masked[i] !== "[") return { reason: "not-a-literal" };
  const open = masked[i];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  for (let j = i; j < masked.length; j += 1) {
    if (masked[j] === open) depth += 1;
    else if (masked[j] === close) {
      depth -= 1;
      if (depth === 0) return { body: src.slice(i + 1, j) };
    }
  }
  return { reason: "registry-moved" };
}

/** Parse the approved word lists + pending labels straight out of vocabulary.ts. */
function loadVocabulary() {
  const src = readFileSync(join(ROOT, "src", "lib", "vocabulary.ts"), "utf8");
  /** The block's body, or a hard failure — this gate cannot run on a partial vocabulary. */
  const bodyOf = (name) => {
    const found = blockBody(src, name);
    if (found.reason) throw new Error(`vocabulary.ts: ${name} — ${found.reason}`);
    return found.body;
  };
  const listOf = (name) => {
    // BLANK entries are dropped before the emptiness check, not after. A list of whitespace
    // strings is not a list of approved words, and it is precisely what this function reads
    // if blockBody is ever changed to slice from the MASKED copy — masking preserves the
    // quotes and the length, so `"order"` becomes `"     "` and every `/"([^"]+)"/` still
    // matches. That mistake would otherwise leave the gate GREEN and completely vacuous:
    // every approved word blank, every label blank, nothing to compare, no offence.
    const values = [...bodyOf(name).matchAll(/"([^"]+)"/g)].map((m) => m[1]).filter((v) => v.trim());
    if (values.length === 0) throw new Error(`vocabulary.ts: ${name} parsed to an empty list`);
    return values;
  };
  const words = new Set();
  for (const name of ["APPROVED_NOUNS", "APPROVED_PLACES", "APPROVED_SUPPORT"]) {
    for (const phrase of listOf(name)) {
      for (const w of phrase.toLowerCase().split(/\s+/)) if (w) words.add(w);
    }
  }
  // FILLER used to be read by its own regex (`const FILLER = new Set\(\[([^]*?)\]\)`), which
  // was the one path in this file that never went through blockBody — so it kept the exact
  // literal-blindness the rest of the function just had fixed: a `])` inside a filler word
  // would have truncated the list. `= new Set([` reaches its `[` under the same bracket scan
  // every other block uses, so there is no reason for a second parser.
  const filler = new Set(listOf("FILLER"));
  // PENDING_IA_LABELS is a temporary allowlist and is ALLOWED to be empty — emptying it is how
  // it retires. The block still has to exist, though; a silent `?? ""` here would have turned a
  // renamed block into "nothing is pending" without a word.
  const pending = new Set(
    [...bodyOf("PENDING_IA_LABELS").matchAll(/label:\s*"([^"]+)"/g)].map((m) => m[1].toLowerCase()),
  );
  return { words, filler, pending };
}

/** Mirrors unapprovedWords() in src/lib/vocabulary.ts (kept honest by a test). */
function unapprovedWords(label, vocab) {
  if (vocab.pending.has(label.trim().toLowerCase())) return [];
  const singulars = (w) => {
    const out = [w];
    if (/ies$/.test(w)) out.push(w.slice(0, -3) + "y");
    if (/(ses|xes|zes|ches|shes)$/.test(w)) out.push(w.slice(0, -2));
    if (/es$/.test(w)) out.push(w.slice(0, -1), w.slice(0, -2));
    else if (/s$/.test(w) && !/ss$/.test(w)) out.push(w.slice(0, -1));
    return out;
  };
  const bad = [];
  for (const w of label
    .toLowerCase()
    .replace(/[()"'’,.:;/]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)) {
    if (vocab.filler.has(w)) continue;
    if (/^\d+$/.test(w)) continue;
    if (singulars(w).some((f) => vocab.words.has(f))) continue;
    bad.push(w);
  }
  return bad;
}

/**
 * A quoted value in any of the three JS quote styles. The old form was `"([^"]+)"` only, so
 * `{ label: 'Partners' }` and `` { label: `Partners` } `` were skipped WITHOUT A WORD — the
 * per-block floor cannot catch that, because the double-quoted siblings still parse and the
 * block is not empty. There is no Prettier in this repo to normalise quote style back.
 *
 * Written as three alternatives rather than one backreferenced class, because a class of
 * `[^"'\`]` would stop matching `"Don't"` — an apostrophe inside a double-quoted label is
 * ordinary English and must keep working.
 */
const LABEL_KEY_RE = /\b(?:label|group)\s*:\s*(?:"([^"]+)"|'([^']+)'|`([^`]+)`)/g;
const ANY_VALUE_RE = /:\s*(?:"([^"]+)"|'([^']+)'|`([^`]+)`)/g;
/** Whichever of the three alternation groups actually matched. */
const quoted = (m) => m[1] ?? m[2] ?? m[3];

function scanNouns() {
  const vocab = loadVocabulary();
  const offences = [];
  let labelCount = 0;
  // Every block NOUN_REGISTRIES claims to police, whether or not it parsed. Reported so that
  // deleting a registry entry changes a printed number instead of nothing at all.
  const blocksPoliced = NOUN_REGISTRIES.reduce((n, reg) => n + reg.blocks.length, 0);

  for (const reg of NOUN_REGISTRIES) {
    const full = join(ROOT, ...reg.file.split("/"));
    if (!existsSync(full)) {
      offences.push({
        kind: "structural",
        file: reg.file,
        label: "(missing registry)",
        bad: ["file-not-found"],
      });
      continue;
    }
    const src = readFileSync(full, "utf8");
    for (const name of reg.blocks) {
      const found = blockBody(src, name);
      if (found.reason) {
        offences.push({
          // Tagged at the PUSH SITE. Classifying by sniffing `bad` for a known code instead
          // misfiled a real wording offence: `unapprovedWords` does not split on `-`, so a nav
          // label named "Registry-moved" yields bad: ["registry-moved"] and was reported as a
          // parse failure, with the parse-failure remediation.
          kind: "structural",
          file: reg.file,
          label: `(block ${name}: ${found.reason})`,
          bad: [found.reason],
        });
        continue;
      }
      // `found.body` already has its comments stripped by blockBody, so the cruder strip that
      // used to run here (`/\/\/.*$/gm`) is gone — it would have eaten the tail of any label
      // containing `//`, which the real stripper does not.
      const labels = [
        ...(reg.valueLabels
          ? // Record<Key, string>: take the VALUE side only, so a quoted KEY
            // ("rules-formats") is treated as code, not as taught copy.
            found.body.matchAll(ANY_VALUE_RE)
          : found.body.matchAll(LABEL_KEY_RE)),
      ].map(quoted);
      // PER-BLOCK FLOOR. A block that is FOUND but yields nothing is the silent failure this
      // gate exists to prevent, and until now it raised no offence at all: zero labels means
      // zero comparisons, so the run prints OK and the count quietly shrinks. Every policed
      // registry is a rendered navigation surface — a real one always has at least one label,
      // so an empty body means the parse broke, not that the nav is empty.
      if (labels.length === 0) {
        offences.push({
          kind: "structural",
          file: reg.file,
          label: `(block ${name}: no labels parsed)`,
          bad: ["empty-registry"],
        });
        continue;
      }
      for (const label of labels) {
        labelCount += 1;
        const bad = unapprovedWords(label, vocab);
        if (bad.length) offences.push({ file: reg.file, block: name, label, bad });
      }
    }
  }

  return { labelCount, blocksPoliced, offences };
}

// ─── Run ──────────────────────────────────────────────────────────────────────
let failed = false;

if (WANT_TERMS) {
  const { fileCount, blocked, warned } = scanTerms();
  console.log(
    `\nVocabulary gate — scanned ${fileCount} file(s) under (app) + (marketing) + components + lib\n`,
  );
  if (blocked.length === 0) {
    console.log("OK — no retired metaphor or engine-jargon words in user-facing copy.");
  } else {
    failed = true;
    console.error(`FAIL — ${blocked.length} blocked term(s) in visible copy:\n`);
    for (const v of blocked) {
      console.error(`  ${v.file}:${v.line}  [${v.tier}: ${v.term}]  "${v.text}"`);
    }
    console.error(
      `\nRelabel to the plain word (revision→version, canonical→ProcuLink fields,\n` +
        `replay→test with recent orders, bindings→in use, ingress→order intake,\n` +
        // Both entries used to name a label the product does not ship:
        // "retry needed" (the badge reads "Out of retries") and a bare
        // "ready to send" for `normalized`, which is the label of `ready` -
        // the OTHER pre-delivery state. Status words come from STATUS_META.
        `dead-letter→out of retries, artifact→output file,\n` +
        `normalized→the STATUS_META label for the status you mean:\n` +
        `"Ready to send" (ready) or "Queued to send" (ready_to_deliver)).\n` +
        `Code identifiers, classNames, CSS vars and comments are exempt — only\n` +
        `visible copy must change. See DESIGN-DB-1 §6.5 for the full table.\n`,
    );
  }
  console.log(
    `GLOSS tier — ${warned.length} span(s) use a word that must be glossed on first use` +
      `${WANT_WARN ? ":" : " (run `bun run lint:vocab:warn` to list them)."}`,
  );
  if (WANT_WARN) {
    for (const v of warned) {
      console.log(`  ${v.file}:${v.line}  [${v.term}]  "${v.text}"`);
    }
    console.log("  (report-only — standards names are facts and stay WARN forever)");
  }
}

if (WANT_NOUNS) {
  // loadVocabulary THROWS when vocabulary.ts itself cannot be read — a renamed FILLER, an
  // approved list that parsed to nothing. That is the right severity, but an uncaught throw
  // prints a node stack trace where every other failure in this gate prints an explanation.
  let budget;
  try {
    budget = scanNouns();
  } catch (e) {
    failed = true;
    console.error(`\nNoun budget — could not read src/lib/vocabulary.ts, so nothing was checked.\n`);
    console.error(`  ${e.message}\n`);
    console.error(
      `The approved word lists ARE the budget; the gate cannot run on a partial one.\n` +
        `Restore the declaration, or update the names this file reads.\n`,
    );
    process.exit(1);
  }
  const { labelCount, blocksPoliced, offences } = budget;
  // The BLOCK COUNT is printed alongside the label count so that shrinking NOUN_REGISTRIES
  // changes a visible number. Deleting an entry polices less while the label count stays
  // plausible — losing NAV_MAIN drops 42 to 36, which no loose floor can distinguish from an
  // ordinary IA change. src/lib/vocabulary.test.ts pins this number.
  console.log(
    `\nNoun budget — checked ${labelCount} navigation label(s) across ${blocksPoliced} registry block(s) against the nine nouns`,
  );
  if (offences.length === 0) {
    console.log("OK — every navigation label stays inside the approved vocabulary.\n");
  } else {
    failed = true;
    // Two KINDS of offence, and they need different instructions. A parse failure means the
    // gate could not READ a registry — renaming a label would not fix it, and telling the
    // reader to do that sends them to the wrong file. Report them apart.
    //
    // Split on the TAG the push site set, never on the contents of `bad`. Sniffing `bad` for a
    // known code read a real wording offence as a parse failure: `unapprovedWords` does not
    // split on `-`, so a nav label named "Registry-moved" produces bad: ["registry-moved"].
    const structural = offences.filter((o) => o.kind === "structural");
    const vocabulary = offences.filter((o) => o.kind !== "structural");

    const line = (o) =>
      `  ${o.file}${o.block ? ` (${o.block})` : ""}  "${o.label}"  → ${o.bad.join(", ")}`;

    if (structural.length) {
      console.error(
        `FAIL — ${structural.length} policed ${structural.length === 1 ? "registry" : "registries"} could not be read:\n`,
      );
      for (const o of structural) console.error(line(o));
      console.error(
        `\nThis is a PARSE failure, not a wording problem — the noun budget could not find\n` +
          `the labels it is meant to police, so those labels went unchecked.\n` +
          `  registry-moved        the declaration is gone or renamed. Update NOUN_REGISTRIES\n` +
          `                        in this file, or restore the name.\n` +
          `  ambiguous-declaration the name is declared more than once, so which one is policed\n` +
          `                        is a coin flip. Rename one, or move the other out of the file.\n` +
          `  not-a-literal         the declaration is an alias or a factory call, so there is no\n` +
          `                        array/object literal here to read. Keep the registry a literal\n` +
          `                        in this file — this gate reads source text, not values.\n` +
          `  empty-registry        the block parsed but yielded no labels. A rendered navigation\n` +
          `                        surface always has at least one, so the parse is wrong.\n` +
          `  file-not-found        the pinned path no longer exists.\n`,
      );
    }
    if (vocabulary.length) {
      console.error(`FAIL — ${vocabulary.length} label(s) teach a word outside the vocabulary:\n`);
      for (const o of vocabulary) console.error(line(o));
      console.error(
        `\nEither rename the label to the approved word (src/lib/vocabulary.ts), or —\n` +
          `if the destination is being deleted/merged rather than renamed — add it to\n` +
          `PENDING_IA_LABELS with the DESIGN-DB-1 row that retires it.\n`,
      );
    }
  }
}

process.exit(failed ? 1 : 0);
