// The connection check-run summary, as the backend really writes it.
//
// ── Why this file exists ─────────────────────────────────────────────────────
//
// The shape used to be declared TWICE — once in `useConnectionRevisions.ts` and once
// in `HistoryDrawer.tsx`, the second copy annotated "kept structurally compatible so
// the same object flows straight through". Neither copy had a `parseLeg`, which the
// backend had been sending since replay flip A. A pack that failed ONLY on the parse
// leg turned the evidence panel red and then explained nothing: the one sentence that
// says what went wrong is `parseLeg.note`, and it was dropped on the floor.
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
//
// ── Every leg now says what it DID, not whether it objected ──────────────────
//
// PAIRS WITH BACKEND PR 207 (`fix/publish-gate-empty-test-pack`). Each leg carried a
// `bool Passed`, and every "there was nothing to run this on" path set it to `true`.
// The pack's verdict is a conjunction of the legs, so an un-run leg was
// indistinguishable from a satisfied one, and four separate paths handed back a pass
// over a run that had executed nothing — most importantly a supplier with NO ORDERS,
// which is the default state at onboarding. The conformance leg even had a `skipped`
// flag that named the situation correctly and was then counted as a pass anyway.
//
// So `ReplayLeg.Passed`, `ConformanceLeg.Skipped`, `ConformanceLeg.Passed` and
// `ParseLegSummary.Passed` are GONE from the wire, replaced by one `outcome` string
// per leg, plus a new `outcome` on the summary itself carrying the whole run's
// verdict. The strings and what they mean live in
// `src/lib/testPackOutcomeManifest.ts` — this module carries the SHAPE, that one
// carries the vocabulary and the words a person reads.
//
// The `outcome` values are kept as raw strings through this module deliberately: the
// manifest is the only thing allowed to decide what an unrecognised value means, and
// narrowing to a union here would either reject one at the boundary (losing it) or
// launder it into a known member (which is the defect).

import { testLegOutcome } from "@/lib/testPackOutcomeManifest";

// ── PRE-PR-207 COMPATIBILITY — SCAFFOLDING, DELETE WHEN PR 207 IS EVERYWHERE ──
//
// This frontend can deploy BEFORE the backend that carries PR 207, so it has to read a
// payload that still speaks the old shape: `bool passed` on every leg, `bool skipped` on
// the standards leg, and no `outcome` anywhere.
//
// It is read and then DELIBERATELY REFUSED AS A VERDICT. `passed: true` is the exact
// value that was true for a run which exercised nothing — that is the whole defect —
// so the legacy boolean resolves to the same conservative answer as a value this page
// cannot read at all, and never to a pass. `passed: false` goes with it: one rule for
// the whole legacy shape is easier to reason about, and safer, than a rule that trusts
// the boolean in one direction only. The cost is a deploy window in which "Make live"
// stays shut until the checks are re-run against the new backend, which is the correct
// way round.
//
// TO DELETE, once PR 207 is deployed everywhere: remove `TestPackLegacyLegFields` and
// every `legacy*` field below, the `legacyBool` reader, `isLegacyTestPackPayload`,
// `RevisionTestEvidence.legacyPassed`, the `LEGACY_*_FIELDS` lists, and the one marked
// line in HistoryDrawer's evidence panel. Nothing else depends on them.
export interface TestPackLegacyLegFields {
  /** Pre-PR-207 `bool Passed`. Present ONLY on a payload from a backend without PR 207. */
  legacyPassed?: boolean | null;
}

/** Replay leg — the version re-run over recent orders. Never delivers. */
export interface TestPackReplayLeg extends TestPackLegacyLegFields {
  /** Raw `TestLegOutcomeNames` value. Read it through `@/lib/testPackOutcomeManifest`. */
  outcome: string | null;
  orderCount: number;
  outputErrors: number;
  outputChanged: number;
  validationChanged: number;
  note: string | null;
}

/** Standards leg — a rebuilt output validated against its named standards profile. */
export interface TestPackConformanceLeg extends TestPackLegacyLegFields {
  /**
   * Pre-PR-207 `bool Skipped`, this leg only. SCAFFOLDING — see the block above.
   *
   * It is the sharpest illustration of why the boolean had to go: the flag named the
   * situation correctly ("we did not check this") and the pack's conjunction then spent
   * it as a pass anyway.
   */
  legacySkipped?: boolean | null;
  /**
   * Raw `TestLegOutcomeNames` value.
   *
   * This is the leg that most often reports `not_applicable`: CSV, JSON and XML have no
   * named standards profile and no operator action can give them one, so the check does
   * not exist for them rather than having been missed.
   */
  outcome: string | null;
  profile: string | null;
  errors: number;
  warnings: number;
  note: string | null;
}

/**
 * Parse-from-source leg — orders with a stored source file re-read under this version's
 * input mapping.
 *
 * `failures > 0` is what fails this leg; `parseChanges` are informational (a mapping
 * change SHOULD change parsing) and must not be rendered as faults.
 */
export interface TestPackParseLeg extends TestPackLegacyLegFields {
  /** Raw `TestLegOutcomeNames` value. */
  outcome: string | null;
  ordersReParsed: number;
  parseChanges: number;
  failures: number;
  skipped: number;
  note: string | null;
}

export interface TestPackSummary {
  /**
   * Raw `TestPackOutcomeNames` value — the whole run's verdict, rolled up server-side by
   * `SupplierConnectionService.RollUp`.
   *
   * Carried on the summary as well as on the test endpoint's response so a stored
   * `test_result_json` can be read back later without the endpoint's envelope.
   */
  outcome: string | null;
  replay: TestPackReplayLeg | null;
  conformance: TestPackConformanceLeg | null;
  error: string | null;
  parseLeg: TestPackParseLeg | null;
}

export interface RevisionTestEvidence {
  revisionId: string;
  /**
   * Raw pack outcome. NOT a boolean — the question has four answers, and the boolean it
   * replaces could not tell "we found nothing wrong" from "we tested nothing".
   */
  outcome: string | null;
  /**
   * The pre-PR-207 envelope boolean, when that is ALL the backend sent. SCAFFOLDING.
   *
   * Recorded so the screen can tell "an older backend answered" from "a backend this
   * page cannot read at all" and say so. It is never a verdict: see the compatibility
   * block at the top of this file.
   */
  legacyPassed?: boolean | null;
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
  "outcome",
  "replay",
  "conformance",
  "error",
  "parseLeg",
] as const satisfies readonly (keyof TestPackSummary)[];

export const TEST_PACK_REPLAY_LEG_FIELDS = [
  "outcome",
  "orderCount",
  "outputErrors",
  "outputChanged",
  "validationChanged",
  "note",
] as const satisfies readonly (keyof TestPackReplayLeg)[];

export const TEST_PACK_CONFORMANCE_LEG_FIELDS = [
  "outcome",
  "profile",
  "errors",
  "warnings",
  "note",
] as const satisfies readonly (keyof TestPackConformanceLeg)[];

export const TEST_PACK_PARSE_LEG_FIELDS = [
  "outcome",
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

// ── The PRE-PR-207 wire contract, as data — SCAFFOLDING ──────────────────────
//
// The frontend must be diffable against BOTH deployed backends while the pair is landing,
// so the older record shapes are written down too. The mirror picks whichever one the
// checked-out C# actually declares and diffs against that, in both directions; a THIRD
// shape still fails, which is the property worth keeping.
//
// DELETE these four lists and `LEGACY_TEST_PACK_BACKEND_RECORDS` with the rest of the
// compatibility block once PR 207 is deployed everywhere.

export const LEGACY_TEST_PACK_SUMMARY_FIELDS = [
  "replay",
  "conformance",
  "error",
  "parseLeg",
] as const;

export const LEGACY_TEST_PACK_REPLAY_LEG_FIELDS = [
  "passed",
  "orderCount",
  "outputErrors",
  "outputChanged",
  "validationChanged",
  "note",
] as const;

export const LEGACY_TEST_PACK_CONFORMANCE_LEG_FIELDS = [
  "skipped",
  "passed",
  "profile",
  "errors",
  "warnings",
  "note",
] as const;

export const LEGACY_TEST_PACK_PARSE_LEG_FIELDS = [
  "passed",
  "ordersReParsed",
  "parseChanges",
  "failures",
  "skipped",
  "note",
] as const;

export const LEGACY_TEST_PACK_BACKEND_RECORDS = {
  TestPackSummary: LEGACY_TEST_PACK_SUMMARY_FIELDS,
  ReplayLeg: LEGACY_TEST_PACK_REPLAY_LEG_FIELDS,
  ConformanceLeg: LEGACY_TEST_PACK_CONFORMANCE_LEG_FIELDS,
  ParseLegSummary: LEGACY_TEST_PACK_PARSE_LEG_FIELDS,
} as const;

/** The C# file the records above are mirrored from — cited once, used by the diff. */
export const TEST_PACK_BACKEND_FILE = "ProcuLink.Api/Services/SupplierConnectionService.cs";

// ── Narrowing readers ────────────────────────────────────────────────────────

const asRecord = (v: unknown): Record<string, unknown> | null =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

const count = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
/** Empty strings collapse to null: an empty note is not a note, and would render as a blank bullet. */
const text = (v: unknown): string | null =>
  typeof v === "string" && v.trim().length > 0 ? v : null;

/**
 * An outcome field, kept verbatim.
 *
 * Anything that is not a non-empty string becomes null, which the manifest reads as
 * `unrecognised`. It is NOT coerced to a known member and NOT defaulted — a value this
 * reader cannot vouch for must arrive downstream still looking like one.
 */
const outcomeText = (v: unknown): string | null => text(v);

/**
 * A pre-PR-207 boolean field: the value when the wire really carried a boolean, else null.
 *
 * SCAFFOLDING — see the compatibility block at the top of this file. Reading it is what
 * lets the screen recognise an older backend and say so; it is never read as a verdict.
 */
const legacyBool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);

function readReplayLeg(v: unknown): TestPackReplayLeg | null {
  const o = asRecord(v);
  if (!o) return null;
  return {
    outcome: outcomeText(o.outcome),
    orderCount: count(o.orderCount),
    outputErrors: count(o.outputErrors),
    outputChanged: count(o.outputChanged),
    validationChanged: count(o.validationChanged),
    note: text(o.note),
    legacyPassed: legacyBool(o.passed),
  };
}

function readConformanceLeg(v: unknown): TestPackConformanceLeg | null {
  const o = asRecord(v);
  if (!o) return null;
  return {
    outcome: outcomeText(o.outcome),
    profile: text(o.profile),
    errors: count(o.errors),
    warnings: count(o.warnings),
    note: text(o.note),
    legacyPassed: legacyBool(o.passed),
    legacySkipped: legacyBool(o.skipped),
  };
}

function readParseLeg(v: unknown): TestPackParseLeg | null {
  const o = asRecord(v);
  if (!o) return null;
  return {
    outcome: outcomeText(o.outcome),
    ordersReParsed: count(o.ordersReParsed),
    parseChanges: count(o.parseChanges),
    failures: count(o.failures),
    // `skipped` is a COUNT of orders on this leg and always was — not the standards
    // leg's boolean of the same name. `count()` reads a stray boolean down to 0.
    skipped: count(o.skipped),
    note: text(o.note),
    legacyPassed: legacyBool(o.passed),
  };
}

/**
 * Did this payload come from a backend that predates PR 207? SCAFFOLDING.
 *
 * True when no `outcome` is present anywhere and at least one legacy boolean IS — which
 * distinguishes "an older backend answered" from "the payload is malformed". Both are
 * refused as verdicts; only this one has a sentence that helps the operator.
 */
export function isLegacyTestPackPayload(summary: TestPackSummary | null): boolean {
  if (!summary) return false;
  const legs = [summary.replay, summary.conformance, summary.parseLeg];
  if (summary.outcome !== null) return false;
  if (legs.some((leg) => leg && leg.outcome !== null)) return false;
  return legs.some(
    (leg) =>
      leg != null &&
      (typeof leg.legacyPassed === "boolean" ||
        (leg as TestPackConformanceLeg).legacySkipped != null),
  );
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
    outcome: outcomeText(o.outcome),
    replay: readReplayLeg(o.replay),
    conformance: readConformanceLeg(o.conformance),
    error: text(o.error),
    parseLeg: readParseLeg(o.parseLeg),
  };
}

// ── What the panel says about each leg ───────────────────────────────────────

/** The legs, in the order the backend runs them, with the name a person reads. */
const LEG_LABELS = [
  { label: "rebuilding recent orders", pick: (s: TestPackSummary) => s.replay },
  { label: "the standards check", pick: (s: TestPackSummary) => s.conformance },
  { label: "re-reading the source files", pick: (s: TestPackSummary) => s.parseLeg },
] as const;

function legsWhere(
  summary: TestPackSummary | null,
  keep: (outcome: ReturnType<typeof testLegOutcome>) => boolean,
): string[] {
  if (!summary) return [];
  const out: string[] = [];
  for (const { label, pick } of LEG_LABELS) {
    const leg = pick(summary);
    if (leg && keep(testLegOutcome(leg.outcome))) out.push(label);
  }
  return out;
}

/**
 * The legs that FOUND A FAULT, in the order the backend runs them.
 *
 * The run's verdict names no leg, so "which one" has to be read back off them — a pack
 * that fails only on the parse leg used to turn the evidence panel red and then say
 * nothing at all about why.
 */
export function failedLegLabels(summary: TestPackSummary | null): string[] {
  return legsWhere(summary, (outcome) => outcome === "failed");
}

/**
 * The legs that PROVED NOTHING — they did not run, or came back unreadable.
 *
 * Deliberately separate from `failedLegLabels`: telling an operator their checks failed
 * when nothing failed is its own lie, and it points them at fixing a version that may be
 * perfectly fine. `not_applicable` is excluded — a standards check that does not exist
 * for CSV is a fact about the format, not a gap in the evidence, and no action clears it.
 */
export function unprovenLegLabels(summary: TestPackSummary | null): string[] {
  return legsWhere(
    summary,
    (outcome) => outcome === "not_exercised" || outcome === "unrecognised",
  );
}

/**
 * Every note the pack wrote, in leg order, with the top-level error last.
 *
 * `parseLeg.note` is the whole point: on a parse-only failure it is the ONLY sentence
 * that says what happened, and on a run that tested nothing the three legs' notes are
 * what tell the operator to put an order through.
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
