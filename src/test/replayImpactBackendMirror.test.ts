import { afterAll, describe, test, expect } from "vitest";
import { existsSync, readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { ROOT } from "./appRoutes";
import { TEST_LEG_OUTCOMES } from "@/lib/testPackOutcomeManifest";
import {
  backendReplayLegOutcome,
  replayImpact,
  type ReplayLegOutcome,
  type ReplaySummary,
} from "@/components/connections/replayImpactModel";

// ─────────────────────────────────────────────────────────────────────────────
// Pins the pre-publish impact verdict against the backend's OWN replay-leg predicate.
//
// P0-C (audit 2026-08-13 v3) was `noImpact = changedCount === 0 && startFailing === 0`,
// which graded a revision that rendered NOTHING as "safe to go live". The audit's
// point was not that the frontend needed a better predicate — it was that the
// correct one already existed one repository away and the frontend had authored a
// second, weaker definition of the same idea instead of mirroring it.
//
// THE BACKEND PREDICATE MOVED, so this file now reads TWO shapes and refuses a third.
//
//   pre-PR-207  ProcuLink.Api/Services/SupplierConnectionService.cs
//                 var replayPassed = replay.OrderCount == 0 || rendered > 0;
//
//   PR 207      ProcuLink.Api/Services/SupplierConnectionService.cs
//                 var replayOutcome =
//                     replay.OrderCount == 0 ? TestLegOutcome.NotExercised
//                     : outputErrors > 0     ? TestLegOutcome.Failed
//                     : rendered == 0        ? TestLegOutcome.Failed
//                                            : TestLegOutcome.Passed;
//
// WHY BOTH, AND WHY NEVER A SKIP. The two halves deploy independently and either may
// land first — CI checks out the backend's DEFAULT BRANCH, so this suite runs against
// a pre-PR-207 backend until that PR merges and a PR-207 one afterwards, with no
// coordination available between the two merges. A `skipIf` over the difference would
// turn "the backend moved somewhere neither branch understands" into "nothing to do",
// which is the same vacuous-pass shape as the defect under repair. So the two accepted
// versions are POSITIVELY IDENTIFIED and anything else FAILS. (Same construction as
// `src/test/testPackOutcomeMirror.test.ts`, which reads the outcome vocabulary.)
//
// WHAT IS COMPARED, per shape:
//   • PR 207 — an ARM-FOR-ARM diff. The C# ternary is parsed into ordered
//     condition -> outcome arms, each condition is resolved to a predicate over the
//     frontend's summary shape, and both sides are evaluated over the same state table
//     and required to agree EXACTLY. A reordered arm, a retermed condition or a fourth
//     outcome all fail. Enum members are mapped to wire strings through
//     `TEST_LEG_OUTCOMES` rather than a second hand-typed list.
//   • pre-PR-207 — a ONE-DIRECTIONAL check, because the frontend is deliberately
//     stricter than that backend: for every state the old predicate refuses, the
//     frontend must not recommend go-live. It may refuse more, and does.
//
// ANTI-VACUITY, in the three shapes this repo has been bitten by:
//   1. The parsers run against inline fixtures of BOTH shapes on EVERY invocation,
//      backend or not. A parser that silently stopped matching would otherwise
//      "confirm" the mirror by finding nothing.
//   2. `comparisonsRun` refuses to be incremented by a comparison that did not happen,
//      and an `afterAll` asserts the counter reached the number declared for the shape
//      that was resolved. A run that resolved a backend and compared nothing is a
//      FAILURE, not a pass.
//   3. `null`, never `[]`, when a symbol is absent — "renamed" must be distinguishable
//      from "matched nothing".
// ─────────────────────────────────────────────────────────────────────────────

const CONNECTION_SERVICE_REL = "ProcuLink.Api/Services/SupplierConnectionService.cs";
const REPLAY_SERVICE_REL = "ProcuLink.Api/Services/ReplayService.cs";
const PARSED_FILES = [CONNECTION_SERVICE_REL, REPLAY_SERVICE_REL] as const;

/**
 * The backend checkout, or null. Same walk as `backendMirror.test.ts`: the
 * frontend is often a git worktree several levels below its own repo root, so a
 * fixed `../ProcuLink` does not resolve.
 */
function findBackendRoot(): string | null {
  const fromEnv = process.env.PROCULINK_BACKEND_PATH;
  if (fromEnv && existsSync(join(fromEnv, CONNECTION_SERVICE_REL))) return fromEnv;

  let dir = resolve(ROOT);
  for (let i = 0; i < 8; i += 1) {
    const candidate = join(dirname(dir), "ProcuLink");
    if (PARSED_FILES.every((rel) => existsSync(join(candidate, rel)))) return candidate;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

const BACKEND = findBackendRoot();
const REQUIRE_MIRROR = process.env.PROCULINK_REQUIRE_BACKEND_MIRROR === "1";

/** Files a resolved backend must contain. A missing one is DRIFT, not a skip. */
export function missingParsedFiles(backendRoot: string, exists: (p: string) => boolean): string[] {
  return PARSED_FILES.filter((rel) => !exists(join(backendRoot, rel)));
}

/**
 * Why this run may not proceed, or null. Pure, and unit-tested on BOTH branches
 * below — the branch that matters is unreachable on any machine that has the
 * backend cloned, which is every machine this file was written on.
 */
export function mirrorGateFailure(input: {
  backendRoot: string | null;
  missing: readonly string[];
  required: boolean;
}): string | null {
  if (input.backendRoot === null) {
    if (!input.required) return null;
    return (
      "PROCULINK_REQUIRE_BACKEND_MIRROR=1 but no backend checkout was reachable, so the " +
      "replay-impact mirror did not run. This run proves nothing about " +
      "src/components/connections/replayImpactModel.ts. Set PROCULINK_BACKEND_PATH to a " +
      "ProcuLink checkout (the `backend-mirror` job in .github/workflows/ci.yml does this)."
    );
  }
  if (input.missing.length > 0) {
    return (
      `The backend checkout at ${input.backendRoot} is missing ${input.missing.join(", ")}. ` +
      "replayImpactModel.ts cites those paths as the source of its predicate, so a path that " +
      "no longer exists is drift the model has to answer for — not a reason to skip the diff."
    );
  }
  return null;
}

// ── The parsers ──────────────────────────────────────────────────────────────

/**
 * `var rendered = replay.Orders.Count(o => o.DraftOutput is not null);`
 *   → "DraftOutput"
 * Returns null when the statement is absent, so "renamed" is distinguishable
 * from "matched nothing".
 */
export function parseRenderedCountProperty(cs: string): string | null {
  const m = /var\s+rendered\s*=\s*replay\.Orders\.Count\(\s*\w+\s*=>\s*\w+\.(\w+)\s+is\s+not\s+null\s*\)\s*;/.exec(cs);
  return m ? m[1] : null;
}

/**
 * `var outputErrors = replay.Orders.Count(o => o.OutputError is not null);`
 *   → "OutputError"
 *
 * Load-bearing from PR 207 onward: `outputErrors > 0` is an arm of the replay-leg
 * ternary, and `summariseReplay.errors` is the frontend count it must correspond to.
 * Parsed on both shapes because the statement predates PR 207 — it was already there,
 * counted, and printed under a headline that ignored it.
 */
export function parseOutputErrorsCountProperty(cs: string): string | null {
  const m = /var\s+outputErrors\s*=\s*replay\.Orders\.Count\(\s*\w+\s*=>\s*\w+\.(\w+)\s+is\s+not\s+null\s*\)\s*;/.exec(cs);
  return m ? m[1] : null;
}

/**
 * pre-PR-207: `var replayPassed = replay.OrderCount == 0 || rendered > 0;`
 *   → { emptyIsPass: true, requiresRendered: true }
 */
export function parseReplayPassPredicate(
  cs: string,
): { emptyIsPass: boolean; requiresRendered: boolean } | null {
  const m = /var\s+replayPassed\s*=\s*([^;]+);/.exec(cs);
  if (!m) return null;
  const body = m[1].replace(/\s+/g, " ").trim();
  return {
    emptyIsPass: /replay\.OrderCount == 0/.test(body) && body.includes("||"),
    requiresRendered: /\brendered > 0\b/.test(body),
  };
}

/** One arm of the PR 207 ternary: a condition, and the outcome it selects. */
export interface ReplayOutcomeArm {
  /** The C# condition verbatim, whitespace-collapsed. `null` for the final fallback. */
  condition: string | null;
  /** The wire string, derived from the enum member and checked against the manifest. */
  outcome: string;
}

/**
 * `TestLegOutcome.NotExercised` → `"not_exercised"`, but only if the manifest declares
 * it. Derived rather than hand-mapped: a second table of enum-member-to-wire pairs is
 * exactly the duplicated vocabulary this family of defect propagates through, and
 * validating against `TEST_LEG_OUTCOMES` means a fifth member added upstream resolves to
 * null here instead of quietly becoming a string nothing reads.
 */
export function csharpMemberToWireOutcome(member: string): string | null {
  const wire = member.replace(/(?<!^)([A-Z])/g, "_$1").toLowerCase();
  return TEST_LEG_OUTCOMES.includes(wire) ? wire : null;
}

/**
 * PR 207: the `var replayOutcome = … ? … : …;` chain, as ordered arms.
 *
 * Returns null when the statement is absent OR when any enum member in it is one the
 * manifest does not declare — an unreadable arm must not be silently dropped, because a
 * chain missing an arm still evaluates and would compare green against a shorter model.
 */
export function parseReplayOutcomeArms(cs: string): ReplayOutcomeArm[] | null {
  const m = /var\s+replayOutcome\s*=\s*([^;]+);/.exec(cs);
  if (m === null) return null;
  const body = m[1].replace(/\s+/g, " ").trim();

  const arms: ReplayOutcomeArm[] = [];
  const armRe = /([^?:]+?)\s*\?\s*TestLegOutcome\.(\w+)/g;
  let armMatch: RegExpExecArray | null;
  while ((armMatch = armRe.exec(body)) !== null) {
    const outcome = csharpMemberToWireOutcome(armMatch[2]);
    if (outcome === null) return null;
    arms.push({ condition: armMatch[1].trim(), outcome });
  }

  const fallback = /:\s*TestLegOutcome\.(\w+)\s*$/.exec(body);
  if (fallback === null) return null;
  const fallbackOutcome = csharpMemberToWireOutcome(fallback[1]);
  if (fallbackOutcome === null) return null;
  arms.push({ condition: null, outcome: fallbackOutcome });

  // A "chain" of nothing but a fallback is not a chain, and would evaluate to a constant
  // that happens to agree with the model on part of the table.
  return arms.length >= 2 ? arms : null;
}

/**
 * Every C# condition this file knows how to evaluate against a `ReplaySummary`.
 *
 * An ALLOW-LIST. A condition that is not here cannot be reasoned about, and the
 * evaluator returns null rather than guessing — a mirror that silently ignores a term it
 * does not understand is asserting agreement it never established.
 */
const CONDITION_PREDICATES: Readonly<Record<string, (s: ReplaySummary) => boolean>> = {
  "replay.OrderCount == 0": (s) => s.total === 0,
  "outputErrors > 0": (s) => s.errors > 0,
  "rendered == 0": (s) => s.rendered === 0,
};

/**
 * Evaluate the parsed C# arms in order. Null when any condition is one
 * `CONDITION_PREDICATES` does not name.
 */
export function evaluateReplayOutcomeArms(
  arms: readonly ReplayOutcomeArm[],
  s: ReplaySummary,
): string | null {
  for (const arm of arms) {
    if (arm.condition === null) return arm.outcome;
    const predicate = CONDITION_PREDICATES[arm.condition];
    if (predicate === undefined) return null;
    if (predicate(s)) return arm.outcome;
  }
  return null;
}

/**
 * `var outputChanged = current.Ok && draft.Ok && !string.Equals(...)` in
 * ReplayService — the reason a broken draft scores `outputChanged: false`, which
 * is the mechanism of the original defect. If this ever stops requiring `draft.Ok`, an
 * unrenderable order would start reporting `outputChanged: true` and the `rendered`
 * term would stop being load-bearing.
 */
export function parseOutputChangedRequiresDraftOk(cs: string): boolean | null {
  const m = /var\s+outputChanged\s*=\s*([^;]+);/.exec(cs);
  if (!m) return null;
  return /\bdraft\.Ok\b/.test(m[1]);
}

// ── The state table, shared by every comparison ──────────────────────────────

/**
 * The states both sides are evaluated over.
 *
 * `total`/`rendered`/`errors` are enumerated rather than sampled, because the two
 * predicates disagree only in narrow corners and a table that misses them compares
 * green while the disagreement ships. `rendered + errors <= total` keeps the states
 * physically producible by a real replay.
 */
export function replayStateTable(): ReplaySummary[] {
  const states: ReplaySummary[] = [];
  for (const total of [0, 1, 5]) {
    for (const rendered of [0, 1, 4]) {
      for (const errors of [0, 1, 4]) {
        if (rendered > total || errors > total || rendered + errors > total) continue;
        for (const startFailing of [0, 1]) {
          states.push({
            total,
            rendered,
            outputChanges: 0,
            validationChanges: 0,
            startFailing,
            errors,
          });
        }
      }
    }
  }
  return states;
}

// ── Anti-vacuity 1: the parsers, against inline fixtures, always ─────────────

/** SupplierConnectionService.cs as it reads on a backend WITHOUT PR 207. */
const FIXTURE_PRE_207 = `
        var outputErrors      = replay.Orders.Count(o => o.OutputError is not null);
        var rendered          = replay.Orders.Count(o => o.DraftOutput is not null);
        var outputChanged     = replay.Orders.Count(o => o.OutputChanged);
        var replayPassed      = replay.OrderCount == 0 || rendered > 0;
`;

/** SupplierConnectionService.cs as it reads WITH PR 207, copied verbatim. */
const FIXTURE_WITH_207 = `
        var outputErrors      = replay.Orders.Count(o => o.OutputError is not null);
        var rendered          = replay.Orders.Count(o => o.DraftOutput is not null);
        var outputChanged     = replay.Orders.Count(o => o.OutputChanged);
        var validationChanged = replay.Orders.Count(o => o.ValidationChanged);

        var replayOutcome =
            replay.OrderCount == 0 ? TestLegOutcome.NotExercised
            : outputErrors > 0     ? TestLegOutcome.Failed
            : rendered == 0        ? TestLegOutcome.Failed
                                   : TestLegOutcome.Passed;
`;

const FIXTURE_REPLAY = `
        var outputChanged = current.Ok && draft.Ok && !string.Equals(current.Text, draft.Text, StringComparison.Ordinal);
`;

const PR_207_ARMS: ReplayOutcomeArm[] = [
  { condition: "replay.OrderCount == 0", outcome: "not_exercised" },
  { condition: "outputErrors > 0", outcome: "failed" },
  { condition: "rendered == 0", outcome: "failed" },
  { condition: null, outcome: "passed" },
];

describe("the parsers themselves", () => {
  test("read both fixtures the C# is expected to look like", () => {
    expect(parseRenderedCountProperty(FIXTURE_PRE_207)).toBe("DraftOutput");
    expect(parseRenderedCountProperty(FIXTURE_WITH_207)).toBe("DraftOutput");
    expect(parseOutputErrorsCountProperty(FIXTURE_PRE_207)).toBe("OutputError");
    expect(parseOutputErrorsCountProperty(FIXTURE_WITH_207)).toBe("OutputError");
    expect(parseOutputChangedRequiresDraftOk(FIXTURE_REPLAY)).toBe(true);

    expect(parseReplayPassPredicate(FIXTURE_PRE_207)).toEqual({
      emptyIsPass: true,
      requiresRendered: true,
    });
    expect(parseReplayOutcomeArms(FIXTURE_WITH_207)).toEqual(PR_207_ARMS);
  });

  test("each shape's parser reads ONLY its own shape", () => {
    // The version resolver below decides which comparison runs off exactly this
    // difference, so the two parsers overlapping would make the resolver meaningless.
    expect(parseReplayOutcomeArms(FIXTURE_PRE_207)).toBeNull();
    expect(parseReplayPassPredicate(FIXTURE_WITH_207)).toBeNull();
  });

  test("return null rather than a false positive when the symbol is gone", () => {
    expect(parseRenderedCountProperty("var somethingElse = 1;")).toBeNull();
    expect(parseOutputErrorsCountProperty("var somethingElse = 1;")).toBeNull();
    expect(parseReplayPassPredicate("var somethingElse = 1;")).toBeNull();
    expect(parseReplayOutcomeArms("var somethingElse = 1;")).toBeNull();
    expect(parseOutputChangedRequiresDraftOk("var somethingElse = 1;")).toBeNull();
  });

  test("notice a counted property that is no longer the output", () => {
    const drifted = FIXTURE_WITH_207.replace("o.DraftOutput is not null", "o.OutputError is not null");
    expect(parseRenderedCountProperty(drifted)).toBe("OutputError");
  });

  test("notice a pass predicate that no longer requires anything to render", () => {
    const drifted = FIXTURE_PRE_207.replace("replay.OrderCount == 0 || rendered > 0", "true");
    expect(parseReplayPassPredicate(drifted)).toEqual({ emptyIsPass: false, requiresRendered: false });
  });

  test("notice a reordered arm, a retermed condition, and a fifth outcome", () => {
    const reordered = FIXTURE_WITH_207.replace(
      "replay.OrderCount == 0 ? TestLegOutcome.NotExercised\n            : outputErrors > 0     ? TestLegOutcome.Failed",
      "outputErrors > 0 ? TestLegOutcome.Failed\n            : replay.OrderCount == 0     ? TestLegOutcome.NotExercised",
    );
    expect(parseReplayOutcomeArms(reordered)).not.toEqual(PR_207_ARMS);

    const retermed = FIXTURE_WITH_207.replace("outputErrors > 0", "outputErrors > 2");
    const retermedArms = parseReplayOutcomeArms(retermed);
    expect(retermedArms).not.toBeNull();
    // Parsed fine — and then refused at EVALUATION, because the term is not one this
    // file knows how to reason about. Unknown must never mean ignored.
    expect(
      evaluateReplayOutcomeArms(retermedArms!, {
        total: 5, rendered: 1, outputChanges: 0, validationChanges: 0, startFailing: 0, errors: 4,
      }),
    ).toBeNull();

    // An enum member the manifest never declared voids the whole chain.
    const fifth = FIXTURE_WITH_207.replace("TestLegOutcome.Passed", "TestLegOutcome.ProbablyFine");
    expect(parseReplayOutcomeArms(fifth)).toBeNull();
  });

  test("map C# enum members onto the manifest's wire strings, and nothing else", () => {
    expect(csharpMemberToWireOutcome("Passed")).toBe("passed");
    expect(csharpMemberToWireOutcome("NotExercised")).toBe("not_exercised");
    expect(csharpMemberToWireOutcome("NotApplicable")).toBe("not_applicable");
    // Not a member of TEST_LEG_OUTCOMES — so it resolves to null rather than to a
    // plausible-looking string this frontend has no reading for.
    expect(csharpMemberToWireOutcome("ProbablyFine")).toBeNull();
    expect(TEST_LEG_OUTCOMES.length).toBeGreaterThan(0);
  });

  test("the state table covers the states the two backends disagree about", () => {
    const states = replayStateTable();
    expect(states.length).toBeGreaterThanOrEqual(24);
    // The zero-order revision — every supplier at onboarding. Old backend: pass.
    // PR 207: not_exercised, and publish refused by name.
    expect(states.some((s) => s.total === 0)).toBe(true);
    // Some rendered, some errored. Old backend: pass, because `rendered > 0`.
    // PR 207: failed. A control built only from a clean full render touches neither.
    expect(states.some((s) => s.total > 0 && s.rendered > 0 && s.errors > 0)).toBe(true);
    // Nothing rendered at all — the state the shipped frontend called "safe to go live".
    expect(states.some((s) => s.total > 0 && s.rendered === 0)).toBe(true);
    // And the clean control, so the table is not all-negative either.
    expect(states.some((s) => s.total > 0 && s.rendered === s.total && s.errors === 0)).toBe(true);
  });
});

// ── Anti-vacuity 2: the gate, both branches ──────────────────────────────────

describe("the mirror gate", () => {
  test("an unreachable backend is a skip locally and a FAILURE in CI", () => {
    expect(mirrorGateFailure({ backendRoot: null, missing: [], required: false })).toBeNull();
    const failure = mirrorGateFailure({ backendRoot: null, missing: [], required: true });
    expect(failure).toContain("PROCULINK_REQUIRE_BACKEND_MIRROR=1");
    expect(failure).toContain("proves nothing");
  });

  test("a resolved backend missing a parsed file is drift, not a skip", () => {
    const failure = mirrorGateFailure({
      backendRoot: "/x",
      missing: [CONNECTION_SERVICE_REL],
      required: false,
    });
    expect(failure).toContain(CONNECTION_SERVICE_REL);
  });

  test("missingParsedFiles reports every declared file, and the list is not empty", () => {
    expect(PARSED_FILES.length).toBeGreaterThan(0);
    expect(missingParsedFiles("/x", () => false)).toEqual([...PARSED_FILES]);
    expect(missingParsedFiles("/x", () => true)).toEqual([]);
  });
});

// ── Which backend is this? ───────────────────────────────────────────────────

export type BackendWireVersion = "with-pr-207" | "pre-pr-207";

/**
 * Which of the two accepted backend versions this C# is — or null when it is neither,
 * which is drift and must fail rather than skip.
 */
export function backendWireVersion(connectionServiceCs: string): BackendWireVersion | null {
  if (parseReplayOutcomeArms(connectionServiceCs) !== null) return "with-pr-207";
  if (parseReplayPassPredicate(connectionServiceCs) !== null) return "pre-pr-207";
  return null;
}

describe("the version resolver", () => {
  test("identifies both accepted shapes and refuses a third", () => {
    expect(backendWireVersion(FIXTURE_WITH_207)).toBe("with-pr-207");
    expect(backendWireVersion(FIXTURE_PRE_207)).toBe("pre-pr-207");
    // A third shape is not "no work to do". It is the mirror's subject vanishing.
    expect(backendWireVersion("var replaySomethingNew = Whatever.Value;")).toBeNull();
  });
});

const CONNECTION_CS = BACKEND ? readFileSync(join(BACKEND, CONNECTION_SERVICE_REL), "utf8") : null;
const WIRE = CONNECTION_CS === null ? null : backendWireVersion(CONNECTION_CS);

// ── The diff ─────────────────────────────────────────────────────────────────

let comparisonsRun = 0;

/** Comparisons that run whatever shape the backend is. */
const SHARED_COMPARISONS = 4;
/** Comparisons that run only on the shape named. */
const COMPARISONS_BY_SHAPE: Record<BackendWireVersion, number> = {
  "with-pr-207": 4,
  "pre-pr-207": 3,
};

describe("replayImpactModel mirrors SupplierConnectionService's replay-leg predicate", () => {
  test("the gate allows this run to proceed", () => {
    const missing = BACKEND ? missingParsedFiles(BACKEND, existsSync) : [];
    expect(mirrorGateFailure({ backendRoot: BACKEND, missing, required: REQUIRE_MIRROR })).toBeNull();
  });

  test.skipIf(BACKEND === null)("the checkout is one of the two versions this frontend reads", () => {
    expect(
      WIRE,
      `${BACKEND}/${CONNECTION_SERVICE_REL} declares neither \`var replayOutcome = …\` (PR 207) ` +
        "nor `var replayPassed = …` (pre-PR-207). replayImpactModel.ts cites one of those two as " +
        "the definition it mirrors, so a third shape means the model is mirroring something that " +
        "is gone — which has to be loud, not skipped.",
    ).not.toBeNull();
  });

  test.skipIf(BACKEND === null)("counts the same two properties the backend counts", () => {
    const rendered = parseRenderedCountProperty(CONNECTION_CS!);
    expect(
      rendered,
      `${CONNECTION_SERVICE_REL} no longer declares \`var rendered = replay.Orders.Count(o => o.X is not null)\`. ` +
        "replayImpactModel.replayRenderedCount cites that line as the definition it mirrors.",
    ).not.toBeNull();
    // The DTO field replayRenderedCount reads, in the backend's own casing. The
    // frontend contract camel-cases the C# record property, so this is the diff.
    expect(rendered).toBe("DraftOutput");
    comparisonsRun += 1;

    const errors = parseOutputErrorsCountProperty(CONNECTION_CS!);
    expect(
      errors,
      `${CONNECTION_SERVICE_REL} no longer declares \`var outputErrors = replay.Orders.Count(o => o.X is not null)\`. ` +
        "summariseReplay.errors mirrors that count, and from PR 207 it is an arm of the leg predicate.",
    ).not.toBeNull();
    expect(errors).toBe("OutputError");
    comparisonsRun += 1;
  });

  test.skipIf(BACKEND === null)("outputChanged still requires the draft to have rendered", () => {
    const cs = readFileSync(join(BACKEND!, REPLAY_SERVICE_REL), "utf8");
    const requiresDraftOk = parseOutputChangedRequiresDraftOk(cs);
    expect(
      requiresDraftOk,
      `${REPLAY_SERVICE_REL} no longer declares \`var outputChanged = …\`.`,
    ).not.toBeNull();
    comparisonsRun += 1;
    // If this ever goes false, an unrenderable order would start reporting
    // `outputChanged: true` and the `rendered` term would stop being load-bearing —
    // the mechanism behind P0-C would have changed and this model needs re-reading.
    expect(requiresDraftOk).toBe(true);
    comparisonsRun += 1;
  });

  // ── PR 207: exact, arm for arm ─────────────────────────────────────────────

  test.skipIf(WIRE !== "with-pr-207")("agrees ARM FOR ARM with the replay-leg ternary", () => {
    const arms = parseReplayOutcomeArms(CONNECTION_CS!);
    expect(arms, `${CONNECTION_SERVICE_REL} no longer declares \`var replayOutcome = …\`.`).not.toBeNull();
    comparisonsRun += 1;

    expect(
      arms,
      "the replay-leg ternary drifted from backendReplayLegOutcome in " +
        "src/components/connections/replayImpactModel.ts — that function is a transcription of " +
        "this chain, arm for arm and in order.",
    ).toEqual(PR_207_ARMS);
    comparisonsRun += 1;

    // Every outcome the chain can produce must be one the frontend's own type admits,
    // or the equality below is comparing a value this frontend has no reading for.
    const produced = new Set(arms!.map((a) => a.outcome));
    expect(produced.size, "the chain produces a single outcome — that is not a predicate").toBeGreaterThan(1);
    for (const outcome of produced) {
      expect(TEST_LEG_OUTCOMES, `${outcome} is not in the manifest's leg vocabulary`).toContain(outcome);
    }
    comparisonsRun += 1;

    // The truth table, as an EQUALITY rather than an implication: on this backend the
    // frontend is not permitted to be merely stricter, it must agree exactly.
    const states = replayStateTable();
    const evaluated = states.map((s) => ({ s, backend: evaluateReplayOutcomeArms(arms!, s) }));

    // Floors on what was EXTRACTED, not on what was iterated. Each names one of the two
    // states PR 207 changed the answer for; a run in which either is absent has not
    // touched the defect and must not report agreement.
    const notExercised = evaluated.filter((e) => e.backend === "not_exercised");
    const failed = evaluated.filter((e) => e.backend === "failed");
    const passed = evaluated.filter((e) => e.backend === "passed");
    expect(notExercised.length, "no zero-order state reached — the onboarding case is untested").toBeGreaterThan(0);
    expect(
      failed.some((e) => e.s.rendered > 0 && e.s.errors > 0),
      "no partially-rendered state reached — the 'four of five errored' case is untested",
    ).toBe(true);
    expect(passed.length, "no passing state reached — the comparison could be vacuously negative").toBeGreaterThan(0);

    for (const { s, backend } of evaluated) {
      expect(
        backend,
        `the C# arms could not be evaluated for ${JSON.stringify(s)} — an unknown condition term`,
      ).not.toBeNull();
      const frontend: ReplayLegOutcome = backendReplayLegOutcome(s);
      expect(
        frontend as string,
        `frontend and backend disagree on the replay leg for ${JSON.stringify(s)}`,
      ).toBe(backend);
      // And the verdict the operator sees may never recommend go-live off a leg the
      // backend did not pass. This is the assertion the shipped defect failed.
      if (backend !== "passed") {
        expect(
          replayImpact(s).safeToGoLive,
          `frontend recommends go-live for a state the backend refuses to publish: ${JSON.stringify(s)}`,
        ).toBe(false);
      }
    }
    comparisonsRun += 1;
  });

  // ── pre-PR-207: one-directional, because the frontend is stricter on purpose ──

  test.skipIf(WIRE !== "pre-pr-207")("never recommends go-live where the OLD predicate refuses", () => {
    const predicate = parseReplayPassPredicate(CONNECTION_CS!);
    expect(predicate, `${CONNECTION_SERVICE_REL} no longer declares \`var replayPassed = …\`.`).not.toBeNull();
    comparisonsRun += 1;

    expect(predicate).toEqual({ emptyIsPass: true, requiresRendered: true });
    comparisonsRun += 1;

    // `replayPassed == OrderCount == 0 || rendered > 0`, restated under the flags just
    // parsed rather than hardcoded, so a predicate that lost a term evaluates differently.
    const oldBackendPasses = (s: ReplaySummary) =>
      (predicate!.emptyIsPass && s.total === 0) || (predicate!.requiresRendered && s.rendered > 0);

    const states = replayStateTable();
    const refused = states.filter((s) => !oldBackendPasses(s));
    expect(refused.length, "no refused state in the table — this comparison is vacuous").toBeGreaterThan(0);
    for (const s of refused) {
      expect(
        replayImpact(s).safeToGoLive,
        `frontend recommends go-live for a state the backend refuses to publish: ${JSON.stringify(s)}`,
      ).toBe(false);
    }

    // The frontend is deliberately STRICTER than this backend, and that has to be
    // demonstrated rather than assumed — otherwise "compatible with both" would be
    // satisfied by a model that simply reproduced the old rule and would break the
    // moment PR 207 lands. Both states below pass the old predicate; neither may be
    // recommended.
    const stricter = states.filter((s) => oldBackendPasses(s) && !replayImpact(s).safeToGoLive);
    expect(
      stricter.some((s) => s.total === 0),
      "the zero-order state is graded go-live — the onboarding case regressed",
    ).toBe(true);
    expect(
      stricter.some((s) => s.rendered > 0 && s.errors > 0),
      "a partially-rendered state is graded go-live — the 'four of five errored' case regressed",
    ).toBe(true);
    comparisonsRun += 1;
  });
});

afterAll(() => {
  if (BACKEND === null) return;
  expect(
    WIRE,
    "a backend checkout resolved but its replay-leg predicate matched neither accepted shape",
  ).not.toBeNull();
  expect(
    comparisonsRun,
    "a backend checkout resolved but the mirror compared fewer things than it declares for " +
      `the \`${WIRE}\` shape — a run that resolves a backend and compares nothing is a failure, ` +
      "not a pass",
  ).toBe(SHARED_COMPARISONS + COMPARISONS_BY_SHAPE[WIRE!]);
});
