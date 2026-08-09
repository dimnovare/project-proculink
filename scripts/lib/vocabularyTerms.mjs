// The ProcuLink copy vocabulary — ONE definition, two consumers, two languages.
//
// WHY IT LIVES HERE AND NOT INSIDE THE GATE. These three tiers were declared as inline
// arrays inside scripts/check-vocabulary.mjs, which was correct while the gate was the
// only thing that could enforce them: it walks frontend source, and frontend source was
// assumed to be where all user-facing copy is written.
//
// It is not. `src/components/bridge/problem/OrderProblemPanel.tsx` renders
// `order.errorMessage` — a sentence composed in the BACKEND repo, in C# — into the
// operator's explanation block, verbatim apart from markup stripping. So a second
// consumer now needs the identical lists: `src/test/backendCopyVocabulary.test.ts`,
// which reads the C# and applies the same rule to the sentences that reach the screen
// from the other side.
//
// Two hand-maintained copies of one rule is the drift this repo keeps paying for
// (`9cea6e5` converged two source-link extractors for exactly this reason; the header of
// scripts/lib/sourceScan.mjs carries the full account). A word added to JARGON here must
// become banned in BOTH languages on the same commit, or the gate means one thing on one
// side of the wire and another thing on the other.
//
// FORM. Plain ESM, same as sourceScan.mjs and for the same reason: `lint:vocab` is
// `node scripts/check-vocabulary.mjs` and ci.yml has no `setup-node` step, so the gate
// runs on whatever node ubuntu-latest ships and cannot import TypeScript. The vitest
// consumer reads this module through `allowJs`.
//
// `src/test/sourceScan.test.ts` asserts this file is the only place the three tiers are
// declared, so a re-inlined copy turns CI red.

// ─── Tier 1: retired Bridge-Layer metaphor (BLOCK) ────────────────────────────
//
// The internal "Bridge Layer" design metaphor is allowed in CODE (component names, file
// names, CSS classes, gradient vars, data-* attributes, comments) but must never appear
// in USER-FACING copy. CLAUDE.md §9. This war is won on the frontend; the tier stays as
// a regression guard, and now covers the backend's sentences too.
// "topology" is the INTERNAL name of the wire diagram — CLAUDE.md §2 ("Wire Topology
// dashboard"), §9 (the dashboard heading is "Orders", never "Order topology"), and
// BridgeDashboard.tsx's own header. It was missing from this tier only because the war was
// won on the words the founder listed by hand; the noun that names the picture was never
// typed out. Three shipped strings were still using it when it was added: the landing
// hero's `live order topology` chrome label and its `Topology` view toggle, and the
// dashboard's `Couldn't load your topology` error card — whose sibling card, on the query
// right next to it, already said "Couldn't load your connections".
export const METAPHOR = [
  "bridge", "crossing", "crossings", "dock", "docks", "lane", "lanes",
  "spine", "wire", "wires", "wired", "wiring", "traveller", "travellers",
  "topology", "topologies",
];

// ─── Tier 2: engine jargon that leaked into copy (BLOCK) ──────────────────────
// DESIGN-DB-1 §6.5 + §7.2. Deliberately EXCLUDES: version(s) (the approved
// replacement for "revision"), node, diff, sync, scope, profile, standard,
// operator, record, bundle — all have ordinary-English readings (§7.3).
export const JARGON = [
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
//
// Words that ARE legitimate but must be glossed on first use. Standards names are FACTS
// (a supplier's IT team asked for "cXML 1.2"), so renaming them would make the copy
// wrong. They stay WARN forever — on both sides of the wire.
export const GLOSS = [
  "webhook", "webhooks", "endpoint", "endpoints",
  "cxml", "ubl", "edifact", "peppol", "sftp", "ftps", "imap",
  "namespace", "namespaces", "schema", "schemas",
  "transform", "transforms", "transformed", "transforming",
  "parse", "parses", "parsed", "parsing",
  "poll", "polling", "retry", "retries",
];

/**
 * A case-insensitive whole-word matcher for one tier.
 *
 * Whole-word only (`(?<![A-Za-z0-9])…(?![A-Za-z0-9])`) — "AST" inside "P-ast- due"
 * produced 51 false hits in the original audit scan, which is why 3-letter acronyms are
 * off the lists entirely and why substring matching is not an option here.
 *
 * Shared so the two consumers cannot disagree about what "the word appears" means: a
 * backend scanner that matched substrings would report `transformer` as `transform` and
 * a frontend gate that did not would call the same sentence clean.
 *
 * @param {readonly string[]} list
 * @param {string} [flags] extra regex flags — pass "g" to enumerate every hit in a span
 * @returns {RegExp}
 */
export function termPattern(list, flags = "") {
  const alternation = list.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return new RegExp(`(?<![A-Za-z0-9])(${alternation})(?![A-Za-z0-9])`, `i${flags}`);
}

/**
 * The tiers, in the order a report should print them, with their severity.
 *
 * `blocks: true` means a hit fails the build. Declared here rather than at each call
 * site so "GLOSS is warn-only" is one fact rather than two conventions.
 */
export const TIERS = [
  { name: "metaphor", terms: METAPHOR, blocks: true },
  { name: "jargon", terms: JARGON, blocks: true },
  { name: "gloss", terms: GLOSS, blocks: false },
];
