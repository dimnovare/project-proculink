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
 */
function blockBody(src, name) {
  const decl = new RegExp(`\\bconst\\s+${name}\\b`).exec(src);
  if (!decl) return null;
  let eq = decl.index;
  while (eq < src.length) {
    if (src[eq] === "=" && src[eq + 1] !== "=" && src[eq + 1] !== ">") break;
    eq += 1;
  }
  if (eq >= src.length) return null;
  let i = eq + 1;
  while (i < src.length && src[i] !== "{" && src[i] !== "[") i += 1;
  if (i >= src.length) return null;
  const open = src[i];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  for (let j = i; j < src.length; j += 1) {
    if (src[j] === open) depth += 1;
    else if (src[j] === close) {
      depth -= 1;
      if (depth === 0) return src.slice(i + 1, j);
    }
  }
  return null;
}

/** Parse the approved word lists + pending labels straight out of vocabulary.ts. */
function loadVocabulary() {
  const src = readFileSync(join(ROOT, "src", "lib", "vocabulary.ts"), "utf8");
  const listOf = (name) => {
    const body = blockBody(src, name);
    if (body == null) throw new Error(`vocabulary.ts: ${name} not found`);
    return [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  };
  const words = new Set();
  for (const name of ["APPROVED_NOUNS", "APPROVED_PLACES", "APPROVED_SUPPORT"]) {
    for (const phrase of listOf(name)) {
      for (const w of phrase.toLowerCase().split(/\s+/)) if (w) words.add(w);
    }
  }
  const fillerBody = /const FILLER = new Set\(\[([^]*?)\]\)/.exec(src);
  const filler = new Set(
    fillerBody ? [...fillerBody[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]) : [],
  );
  const pendingBody = blockBody(src, "PENDING_IA_LABELS") ?? "";
  const pending = new Set(
    [...pendingBody.matchAll(/label:\s*"([^"]+)"/g)].map((m) => m[1].toLowerCase()),
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

function scanNouns() {
  const vocab = loadVocabulary();
  const offences = [];
  let labelCount = 0;

  for (const reg of NOUN_REGISTRIES) {
    const full = join(ROOT, ...reg.file.split("/"));
    if (!existsSync(full)) {
      offences.push({ file: reg.file, label: "(missing registry)", bad: ["file-not-found"] });
      continue;
    }
    const src = readFileSync(full, "utf8");
    for (const name of reg.blocks) {
      const body = blockBody(src, name);
      if (body == null) {
        offences.push({ file: reg.file, label: `(block ${name} not found)`, bad: ["registry-moved"] });
        continue;
      }
      const clean = body.replace(/\/\/.*$/gm, " ").replace(/\/\*[^]*?\*\//g, " ");
      const labels = reg.valueLabels
        ? // Record<Key, string>: take the VALUE side only, so a quoted KEY
          // ("rules-formats") is treated as code, not as taught copy.
          [...clean.matchAll(/:\s*"([^"]+)"/g)].map((m) => m[1])
        : [
            ...[...clean.matchAll(/\blabel:\s*"([^"]+)"/g)].map((m) => m[1]),
            ...[...clean.matchAll(/\bgroup:\s*"([^"]+)"/g)].map((m) => m[1]),
          ];
      for (const label of labels) {
        labelCount += 1;
        const bad = unapprovedWords(label, vocab);
        if (bad.length) offences.push({ file: reg.file, block: name, label, bad });
      }
    }
  }

  return { labelCount, offences };
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
  const { labelCount, offences } = scanNouns();
  console.log(`\nNoun budget — checked ${labelCount} navigation label(s) against the nine nouns`);
  if (offences.length === 0) {
    console.log("OK — every navigation label stays inside the approved vocabulary.\n");
  } else {
    failed = true;
    console.error(`FAIL — ${offences.length} label(s) teach a word outside the vocabulary:\n`);
    for (const o of offences) {
      console.error(`  ${o.file}${o.block ? ` (${o.block})` : ""}  "${o.label}"  → ${o.bad.join(", ")}`);
    }
    console.error(
      `\nEither rename the label to the approved word (src/lib/vocabulary.ts), or —\n` +
        `if the destination is being deleted/merged rather than renamed — add it to\n` +
        `PENDING_IA_LABELS with the DESIGN-DB-1 row that retires it.\n`,
    );
  }
}

process.exit(failed ? 1 : 0);
