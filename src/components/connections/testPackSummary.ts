// The connection test-pack summary, as the backend really writes it.
//
// ── Why this file exists ─────────────────────────────────────────────────────
//
// The shape used to be declared TWICE — once in `useConnectionRevisions.ts` and once
// in `HistoryDrawer.tsx`, the second copy annotated "kept structurally compatible so
// the same object flows straight through". Neither copy had a `parseLeg`, which the
// backend has been sending since replay flip A:
//
//   ProcuLink.Api/Services/SupplierConnectionService.cs:587
//     record TestPackSummary(ReplayLeg? Replay, ConformanceLeg? Conformance,
//                            string? Error, ParseLegSummary? ParseLeg = null)
//
// and `passed` is `replayPassed && (conformance skipped || passed) && parsePassed`
// (:703). So a pack that failed ONLY on the parse leg turned the evidence panel red
// and then explained nothing: the replay and conformance lines both read normally,
// and the one sentence that says what went wrong is `parseLeg.note`, which was
// dropped on the floor. On a PASS, the informational "N order(s) would parse
// differently under this revision" was dropped too.
//
// ── Why a parser and not a cast ──────────────────────────────────────────────
//
// `parseTestSummary` was `JSON.parse(json) as TestPackSummary`. Be precise about what
// that cost: at RUNTIME the parsed object still carried `parseLeg` — `JSON.parse`
// keeps every key it is given. What the cast threw away was the TYPE. From the moment
// the value was asserted into a three-field interface, `summary.parseLeg` was a
// compile error, so every consumer downstream was type-checked into ignoring a field
// that was sitting right there in the object. `evidenceNotes` read three notes
// because three was all the interface offered. Nothing errored, nothing warned, and
// review had nothing to notice.
//
// So a cast is not a parse in the way that matters here: it does not check the value,
// and it silently narrows what the rest of the program is allowed to see. The reader
// below narrows field by field instead, and cannot produce a value whose type is a lie.
//
// A reader still cannot notice a field the backend ADDS tomorrow — nothing running in
// the browser can, because an unknown key and an absent key look identical. That half
// is covered where it can be: the exported field lists are diffed against the real C#
// record parameters by `src/test/backendMirror.test.ts`, so the next leg the backend
// adds fails the build here instead of disappearing into a red panel with no reason
// on it.

/** Replay leg — the revision re-run over recent orders. Never delivers. */
export interface TestPackReplayLeg {
  passed: boolean;
  orderCount: number;
  outputErrors: number;
  outputChanged: number;
  validationChanged: number;
  note: string | null;
}

/** Conformance leg — a replayed output validated against its named standards profile. */
export interface TestPackConformanceLeg {
  skipped: boolean;
  /** `bool?` on the wire: null when the leg was skipped. */
  passed: boolean | null;
  profile: string | null;
  errors: number;
  warnings: number;
  note: string | null;
}

/**
 * Parse-from-source leg — orders with a stored source file re-parsed under this
 * revision's input mapping.
 *
 * Fails only when every eligible order failed to re-parse
 * (`parsePassed = eligible == 0 || reParsed > 0`, SupplierConnectionService.cs:694),
 * so `failures > 0` alone is not a failure and must not be rendered as one.
 */
export interface TestPackParseLeg {
  passed: boolean;
  ordersReParsed: number;
  parseChanges: number;
  failures: number;
  skipped: number;
  note: string | null;
}

export interface TestPackSummary {
  replay: TestPackReplayLeg | null;
  conformance: TestPackConformanceLeg | null;
  error: string | null;
  parseLeg: TestPackParseLeg | null;
}

export interface RevisionTestEvidence {
  revisionId: string;
  passed: boolean;
  testedAt: string;
  summary: TestPackSummary | null;
}

// ── The wire contract, as data ───────────────────────────────────────────────
//
// Runtime values rather than types alone, because the cross-repo diff in
// backendMirror.test.ts has to compare them against C# record parameters and cannot
// read a TypeScript interface. `satisfies` pins each list to its own interface, so a
// renamed or deleted field is a compile error here; the diff covers the direction
// TypeScript cannot see, which is the backend growing a field we never added.

export const TEST_PACK_SUMMARY_FIELDS = [
  "replay",
  "conformance",
  "error",
  "parseLeg",
] as const satisfies readonly (keyof TestPackSummary)[];

export const TEST_PACK_REPLAY_LEG_FIELDS = [
  "passed",
  "orderCount",
  "outputErrors",
  "outputChanged",
  "validationChanged",
  "note",
] as const satisfies readonly (keyof TestPackReplayLeg)[];

export const TEST_PACK_CONFORMANCE_LEG_FIELDS = [
  "skipped",
  "passed",
  "profile",
  "errors",
  "warnings",
  "note",
] as const satisfies readonly (keyof TestPackConformanceLeg)[];

export const TEST_PACK_PARSE_LEG_FIELDS = [
  "passed",
  "ordersReParsed",
  "parseChanges",
  "failures",
  "skipped",
  "note",
] as const satisfies readonly (keyof TestPackParseLeg)[];

/** Each summary field's C# record, for the mirror diff to name what it is comparing. */
export const TEST_PACK_BACKEND_RECORDS = {
  TestPackSummary: TEST_PACK_SUMMARY_FIELDS,
  ReplayLeg: TEST_PACK_REPLAY_LEG_FIELDS,
  ConformanceLeg: TEST_PACK_CONFORMANCE_LEG_FIELDS,
  ParseLegSummary: TEST_PACK_PARSE_LEG_FIELDS,
} as const;

/** The C# file the records above are mirrored from — cited once, used by the diff. */
export const TEST_PACK_BACKEND_FILE = "ProcuLink.Api/Services/SupplierConnectionService.cs";

// ── Narrowing readers ────────────────────────────────────────────────────────

const asRecord = (v: unknown): Record<string, unknown> | null =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

const bool = (v: unknown): boolean => v === true;
/** `bool?` — null unless the wire really carried a boolean. */
const nullableBool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);
const count = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
/** Empty strings collapse to null: an empty note is not a note, and would render as a blank bullet. */
const text = (v: unknown): string | null =>
  typeof v === "string" && v.trim().length > 0 ? v : null;

function readReplayLeg(v: unknown): TestPackReplayLeg | null {
  const o = asRecord(v);
  if (!o) return null;
  return {
    passed: bool(o.passed),
    orderCount: count(o.orderCount),
    outputErrors: count(o.outputErrors),
    outputChanged: count(o.outputChanged),
    validationChanged: count(o.validationChanged),
    note: text(o.note),
  };
}

function readConformanceLeg(v: unknown): TestPackConformanceLeg | null {
  const o = asRecord(v);
  if (!o) return null;
  return {
    skipped: bool(o.skipped),
    passed: nullableBool(o.passed),
    profile: text(o.profile),
    errors: count(o.errors),
    warnings: count(o.warnings),
    note: text(o.note),
  };
}

function readParseLeg(v: unknown): TestPackParseLeg | null {
  const o = asRecord(v);
  if (!o) return null;
  return {
    passed: bool(o.passed),
    ordersReParsed: count(o.ordersReParsed),
    parseChanges: count(o.parseChanges),
    failures: count(o.failures),
    skipped: count(o.skipped),
    note: text(o.note),
  };
}

/**
 * Read `test_result_json` into the summary, or null when the payload is not an
 * object at all.
 *
 * A missing leg stays null — that is a real state the backend writes — but a leg
 * that IS present is read field by field, so nothing downstream can dereference a
 * property this module never checked.
 */
export function parseTestSummary(summaryJson: string): TestPackSummary | null {
  let raw: unknown;
  try {
    raw = JSON.parse(summaryJson);
  } catch {
    return null;
  }
  const o = asRecord(raw);
  if (!o) return null;
  return {
    replay: readReplayLeg(o.replay),
    conformance: readConformanceLeg(o.conformance),
    error: text(o.error),
    parseLeg: readParseLeg(o.parseLeg),
  };
}

// ── What the panel says about a failure ──────────────────────────────────────

/**
 * The legs that reported a failure, in the order the backend runs them.
 *
 * `passed` on the pack is an AND across all three (SupplierConnectionService.cs:703),
 * so "which one" is not recoverable from the top-level flag — it has to be read back
 * off the legs. A conformance leg that was SKIPPED is not a failure: the backend's
 * own conjunction treats `Skipped` as satisfying the term.
 */
export function failedLegLabels(summary: TestPackSummary | null): string[] {
  if (!summary) return [];
  const failed: string[] = [];
  if (summary.replay && !summary.replay.passed) failed.push("replay");
  if (summary.conformance && !summary.conformance.skipped && summary.conformance.passed === false) {
    failed.push("standards conformance");
  }
  if (summary.parseLeg && !summary.parseLeg.passed) failed.push("re-parsing the source files");
  return failed;
}

/**
 * Every note the pack wrote, in leg order, with the top-level error last.
 *
 * `parseLeg.note` is the whole point: on a parse-only failure it is the ONLY sentence
 * that says what happened ("N of M order(s) with source files failed to re-parse
 * under this revision's input mapping"), and on a pass it carries the informational
 * "N order(s) would parse differently under this revision".
 */
export function evidenceNotes(summary: TestPackSummary | null): string[] {
  if (!summary) return [];
  return [
    summary.replay?.note,
    summary.conformance?.note,
    summary.parseLeg?.note,
    summary.error,
  ].filter((n): n is string => typeof n === "string" && n.length > 0);
}
