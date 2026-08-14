// testPackOutcomeManifest — the ONE place the frontend writes down what a supplier
// connection's check run can have concluded, and the only list that may answer
// "may this version be made live?".
//
// WHY THIS FILE EXISTS
//
// The check run used to report a plain `bool passed`, and FOUR separate paths through
// `SupplierConnectionService.ExecuteTestPackAsync` set it to `true` over a run that had
// executed nothing:
//
//   1. no orders exist for this supplier at all — the DEFAULT state at onboarding, i.e.
//      exactly when an operator runs checks;
//   2. one of five replayed orders rendering while four errored;
//   3. the standards leg being permanently absent for CSV / JSON / XML output (
//      `ConformanceService.ProfileForFormat` returns null for all three, and CSV is the
//      sample default), which the leg itself named `skipped: true` and the pack's
//      conjunction then spent as a pass;
//   4. every order being a PDF/AI source, so the source re-parse leg had nothing
//      deterministic to re-read.
//
// A connection with a wrong endpoint, wrong credentials and a wrong output format
// therefore passed its checks and published, and real deliveries routed through it.
//
// The frontend repeated the shape. `useConnectionRevisions.ts` answered `evidence.passed`
// with "Checks passed — this version is ready to make live.", `HistoryDrawer.tsx` printed
// `Checks {passed ? "passed" : "failed"}`, and both were two-valued over a question that
// has four answers. Two call sites composing their own sentences from one boolean is also
// how they drifted: the drawer said a leg was "skipped" while the banner called the same
// run a pass.
//
// So this follows `src/lib/deliveryAttemptManifest.ts` and `src/lib/orderStatusManifest.ts`:
// one table, every row carrying the C# site it mirrors, derived sets rather than second
// copies, and a cross-repo diff (`src/test/testPackOutcomeMirror.test.ts`) that parses the
// real C# whenever a backend checkout is reachable. An outcome this file has never heard
// of — including an ABSENT one — resolves to `unrecognised`, WHICH IS NEVER FAVOURABLE.
//
// PROVENANCE — backend repo ProcuLink @ PR 207 (`fix/publish-gate-empty-test-pack`,
// 8a5287f7e115a3583f4f5b24079528b736a7296d), read 2026-08-14. This frontend change PAIRS
// with that PR and must not ship before it: the wire fields it reads do not exist on
// `main`.
//
//   ProcuLink.Core/Services/ISupplierConnectionService.cs:89-119   enum TestLegOutcome
//   ProcuLink.Core/Services/ISupplierConnectionService.cs:122-136  enum TestPackOutcome
//   ProcuLink.Core/Services/ISupplierConnectionService.cs:142-158  TestLegOutcomeNames
//   ProcuLink.Core/Services/ISupplierConnectionService.cs:160-174  TestPackOutcomeNames
//   ProcuLink.Api/Services/SupplierConnectionService.cs:649        RollUp (leg → pack)
//   ProcuLink.Api/Services/SupplierConnectionService.cs:306-307    the publish gate
//
// WHAT THIS FILE DELIBERATELY DOES NOT DO. It does not re-derive the pack verdict from the
// legs. `RollUp` is the authority and lives in the backend; the pack sends its own
// `outcome` and this module reads it. A second roll-up here would be a copy that can
// disagree — and the version that disagrees is always the one the operator is looking at.

/**
 * How a check run, or one leg of it, concluded.
 *
 *  passed          it ran against real material and found no fault. THE ONLY FAVOURABLE
 *                  value, and the only one that may unlock "make live"
 *  failed          it ran and found a fault
 *  not_exercised   it could not run because the material does not exist YET — no orders
 *                  for this supplier, no rebuilt output, no re-readable source file.
 *                  NOT a pass and NOT a failure: nothing is broken, the operator has
 *                  simply not given us anything to check, and it clears once they do
 *  not_applicable  no such check exists for this setup and no operator action would
 *                  create one — the standards leg over CSV / JSON / XML output. Reported
 *                  as a neutral FACT, never as a pass and never as a gap. LEG-ONLY: the
 *                  backend's `TestPackOutcome` has no such member, and it does not block
 *                  publish, because gating on it would strand the most common supplier
 *                  formats on a check nothing could ever satisfy
 *  unrecognised    THE BACKEND SENT AN OUTCOME THIS FILE DOES NOT KNOW, OR SENT NONE AT
 *                  ALL. Never stored in the table below; only ever produced by a lookup
 *                  missing. Renders as its own state and IS NEVER FAVOURABLE — an
 *                  unreadable answer reading as a pass is this whole defect one level down
 */
export type TestOutcome =
  | "passed"
  | "failed"
  | "not_exercised"
  | "not_applicable"
  | "unrecognised";

/** Where an outcome may legitimately appear: on one leg, on the whole run, or both. */
export type TestOutcomeScope = "leg" | "pack";

export interface TestOutcomeFact {
  /** The exact string the API sends. Matched exactly, after trim + lowercase. */
  wire: string;
  /** Never "unrecognised" — that outcome exists only for values absent from this table. */
  outcome: Exclude<TestOutcome, "unrecognised">;
  /** Which of the backend's two vocabularies declares it. */
  scopes: readonly TestOutcomeScope[];
  /**
   * May this outcome unlock an action that assumes the version is proven?
   *
   * True for `passed` and nothing else. A column rather than a predicate over the union,
   * so adding a row forces the question to be answered rather than defaulted.
   */
  favourable: boolean;
  /** How one leg's line in the evidence list reads. Generic across all three legs. */
  legWord: string;
  /** file:line of the constant this row mirrors. */
  backendSite: string;
  /** Why this row reads the way it does. */
  note: string;
}

/**
 * Every outcome the backend can put on the wire, for a leg or for the whole run.
 *
 * An ALLOW-LIST of exact values. The thing being replaced was a boolean, and a boolean is
 * what let "we did not run this" and "we ran this and it was fine" be the same answer.
 */
export const TEST_OUTCOME_FACTS: readonly TestOutcomeFact[] = [
  {
    wire: "passed",
    outcome: "passed",
    scopes: ["leg", "pack"],
    favourable: true,
    legWord: "passed",
    backendSite:
      "ProcuLink.Core/Services/ISupplierConnectionService.cs:144 (TestLegOutcomeNames.Passed) / :162 (TestPackOutcomeNames.Passed)",
    note:
      "THE ONLY FAVOURABLE ROW. At pack level `RollUp` (SupplierConnectionService.cs:649) " +
      "reaches it only when no leg failed AND the replay leg genuinely ran — replay being " +
      "the load-bearing leg, the one that takes a real stored order, pushes it through this " +
      "version's mapping and builds the actual outgoing document.",
  },
  {
    wire: "failed",
    outcome: "failed",
    scopes: ["leg", "pack"],
    favourable: false,
    legWord: "failed",
    backendSite:
      "ProcuLink.Core/Services/ISupplierConnectionService.cs:145 (TestLegOutcomeNames.Failed) / :163 (TestPackOutcomeNames.Failed)",
    note:
      "A fault was found. Any failing leg fails the whole run (RollUp, :649), and an " +
      "exploding pack is stored as this too (SupplierConnectionService.cs:230-237) rather " +
      "than thrown.",
  },
  {
    wire: "not_exercised",
    outcome: "not_exercised",
    scopes: ["leg", "pack"],
    favourable: false,
    legWord: "not run",
    backendSite:
      "ProcuLink.Core/Services/ISupplierConnectionService.cs:146 (TestLegOutcomeNames.NotExercised) / :164 (TestPackOutcomeNames.NotExercised)",
    note:
      "THE STATE THAT USED TO PUBLISH. A supplier with zero orders — every newly configured " +
      "supplier, which is the whole population running checks at onboarding — ran the pack, " +
      "was told it passed, and could make live a connection whose endpoint, credentials and " +
      "output format had never been exercised. The publish gate now refuses it by name " +
      "(ConnectionPublishOutcome.EvidenceNotExercised, ISupplierConnectionService.cs:213), " +
      "and the operator can clear it by putting one order through.",
  },
  {
    wire: "not_applicable",
    outcome: "not_applicable",
    scopes: ["leg"],
    favourable: false,
    legWord: "no such check for this setup",
    backendSite:
      "ProcuLink.Core/Services/ISupplierConnectionService.cs:147 (TestLegOutcomeNames.NotApplicable)",
    note:
      "LEG-ONLY: TestPackOutcome has no such member, so a whole run may never conclude it. " +
      "It is the standards leg over CSV / JSON / XML output, where ProfileForFormat returns " +
      "null and no operator action could ever produce a profile. Reported and never counted " +
      "as a pass — but deliberately NOT a blocker either: those are buildable, publishable " +
      "formats and CSV is the sample default, so gating on it would strand them forever. " +
      "The fix for a vacuous check is to stop it claiming a pass, not to turn it into a " +
      "deadlock, so this must read as a neutral fact rather than as a missing check.",
  },
] as const;

/** Every wire value this file knows, in either vocabulary. */
export const TEST_OUTCOMES: readonly string[] = TEST_OUTCOME_FACTS.map((f) => f.wire);

function wireValuesInScope(scope: TestOutcomeScope): readonly string[] {
  return TEST_OUTCOME_FACTS.filter((f) => f.scopes.includes(scope)).map((f) => f.wire);
}

/**
 * The values `TestPackOutcomeNames` declares — what the whole run may conclude, and what
 * `test_outcome` may hold.
 *
 * Derived from the `scopes` column rather than retyped, so the two vocabularies cannot
 * drift apart inside this file.
 */
export const TEST_PACK_OUTCOMES: readonly string[] = wireValuesInScope("pack");

/** The values `TestLegOutcomeNames` declares — what ONE leg may conclude. */
export const TEST_LEG_OUTCOMES: readonly string[] = wireValuesInScope("leg");

/** The outcomes that may unlock an action. One row long, and meant to stay that way. */
export const FAVOURABLE_TEST_OUTCOMES: readonly string[] = TEST_OUTCOME_FACTS.filter(
  (f) => f.favourable,
).map((f) => f.wire);

const FACT_BY_WIRE = new Map(TEST_OUTCOME_FACTS.map((f) => [f.wire, f] as const));

/**
 * The manifest row for a raw outcome, or null when the backend sent something this file
 * has never heard of — including nothing at all, which is what a backend older than
 * BE PR 207 sends.
 *
 * Trimmed and lower-cased before lookup; the constants are already lowercase, so this only
 * absorbs whitespace and casing accidents. It is NOT a prefix or substring match and must
 * never become one.
 */
export function testOutcomeFact(raw: string | null | undefined): TestOutcomeFact | null {
  if (!raw) return null;
  return FACT_BY_WIRE.get(raw.trim().toLowerCase()) ?? null;
}

/**
 * How to read a raw outcome from ONE leg.
 *
 * UNKNOWN AND ABSENT VALUES ANSWER `unrecognised`, NOT A PASS.
 */
export function testLegOutcome(raw: string | null | undefined): TestOutcome {
  const fact = testOutcomeFact(raw);
  if (fact === null || !fact.scopes.includes("leg")) return "unrecognised";
  return fact.outcome;
}

/**
 * How to read a raw outcome for the WHOLE run.
 *
 * `not_applicable` answers `unrecognised` here on purpose: the backend's `TestPackOutcome`
 * cannot express it, so a run claiming it is a run this frontend cannot interpret — and an
 * uninterpretable answer must land on the cautious side, not be quietly normalised into
 * something adjacent.
 */
export function testPackOutcome(raw: string | null | undefined): TestOutcome {
  const fact = testOutcomeFact(raw);
  if (fact === null || !fact.scopes.includes("pack")) return "unrecognised";
  return fact.outcome;
}

/**
 * May a version with this run behind it be made live?
 *
 * A one-value allow-list rather than `outcome !== "failed"`. A deny-list is how a run that
 * exercised nothing came to unlock the button in the first place.
 */
export function testOutcomeIsFavourable(raw: string | null | undefined): boolean {
  return testPackOutcome(raw) === "passed";
}

/** The word for one leg's line in the evidence list. Unknown legs say so. */
export function testLegWord(raw: string | null | undefined): string {
  const outcome = testLegOutcome(raw);
  return testOutcomeFact(raw)?.legWord ?? (outcome === "unrecognised" ? "unknown result" : outcome);
}

// ── The sentences, derived from the outcome in ONE place ─────────────────────
//
// Every surface that speaks about a check run reads them from here. They used to be
// composed at each call site from the same boolean, which is how the banner and the
// evidence panel came to describe one run in two ways.

/** How a banner carrying one of these sentences should be painted. */
export type TestPackTone = "ok" | "warn" | "err";

export interface TestPackReading {
  outcome: TestOutcome;
  /** True only for `passed`. Gate on THIS, never on the sentence. */
  favourable: boolean;
  tone: TestPackTone;
  /** The evidence panel's headline. Never a bare "passed"/"failed". */
  headline: string;
  /** The inline banner sentence shown after a run finishes. */
  notice: string;
  /** The "Make live" tooltip while this run is the freshest evidence. */
  makeLiveTitle: string;
}

const READINGS: Record<TestOutcome, Omit<TestPackReading, "outcome">> = {
  passed: {
    favourable: true,
    tone: "ok",
    headline: "Checks passed",
    notice: "Checks passed — this version is ready to make live.",
    makeLiveTitle:
      "Applies this version to new orders. Orders already sent keep their original format. You can revert anytime.",
  },
  failed: {
    favourable: false,
    tone: "err",
    headline: "Checks failed",
    notice: "Checks ran but FAILED — see the details below. Fix these before making it live.",
    makeLiveTitle:
      "The checks found problems with this version. Fix them and run the checks again before making it live.",
  },
  not_exercised: {
    favourable: false,
    tone: "warn",
    // Neither "passed" nor "failed": nothing objected, and nothing was tried.
    headline: "Checks did not test this version",
    notice:
      "The checks ran and nothing objected, but they never tested this version — there were no orders " +
      "to run it against, so nothing was ever built from this setup. Put one order through for this " +
      "supplier, then run the checks again.",
    makeLiveTitle:
      "The checks have not tested this version yet — there were no orders to run it against. Put one " +
      "order through for this supplier, then run the checks again.",
  },
  // A leg may legitimately conclude this; a whole run may not. `testPackOutcome` already
  // maps it to `unrecognised`, so this entry exists only to keep the record total — if a
  // future backend does start sending it at pack level, it reads cautiously rather than
  // crashing or falling through to a pass.
  not_applicable: {
    favourable: false,
    tone: "warn",
    headline: "Checks reported nothing to test",
    notice:
      "The checks reported that none of them apply to this version, so nothing about it was verified. " +
      "It cannot be confirmed as ready to make live on this evidence.",
    makeLiveTitle:
      "The checks reported that none of them apply to this version, so nothing about it was verified.",
  },
  unrecognised: {
    favourable: false,
    tone: "warn",
    headline: "Checks returned a result this page can't read",
    notice:
      "The checks came back with a result this page doesn't recognise, so it can't tell you whether " +
      "this version is safe to make live. Run them again, and contact support if it keeps happening.",
    makeLiveTitle:
      "The checks came back with a result this page doesn't recognise, so it can't confirm this version " +
      "is safe to make live.",
  },
};

/**
 * Everything a surface needs to say about one run, from its raw outcome.
 *
 * The `favourable` flag and the words come from the SAME row, so a screen cannot enable a
 * control while its own sentence says the version is unproven — which is the contradiction
 * this replaces: the "Make live" button was correctly gated on evidence while the banner
 * beside it announced a pass.
 */
export function testPackReading(raw: string | null | undefined): TestPackReading {
  const outcome = testPackOutcome(raw);
  return { outcome, ...READINGS[outcome] };
}

/**
 * The "Make live" tooltip when there is NO run to read at all — never tested, or tested
 * before an edit voided the evidence (`UpdateDraftAsync` nulls it,
 * SupplierConnectionService.cs:194).
 *
 * Separate from the readings above because "no evidence" is not an outcome; conflating the
 * two would have this page invent a verdict for a run that never happened.
 */
export const MAKE_LIVE_NEEDS_CHECKS_TITLE =
  "Run the checks — a version can only go live once they have tested it.";
