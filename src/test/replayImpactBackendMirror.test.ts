import { afterAll, describe, test, expect } from "vitest";
import { existsSync, readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { ROOT } from "./appRoutes";
import {
  backendWouldPassReplayLeg,
  legacyBackendWouldPassReplayLeg,
  replayImpact,
  type ReplaySummary,
} from "@/components/connections/replayImpactModel";

// ─────────────────────────────────────────────────────────────────────────────
// Pins the pre-publish impact verdict against the backend's OWN publish predicate.
//
// P0-C (audit 2026-08-13 v3) was `noImpact = changedCount === 0 && startFailing === 0`,
// which graded a revision that rendered NOTHING as "safe to go live". The audit's
// point was not that the frontend needed a better predicate — it was that the
// correct one already existed one repository away and the frontend had authored a
// second, weaker definition of the same idea instead of mirroring it.
//
// TWO BACKEND SHAPES, and this file reads both. Either side may deploy first.
//
//   pre-PR-207:  var replayPassed = replay.OrderCount == 0 || rendered > 0;
//
//   with PR 207: var replayOutcome =
//                    replay.OrderCount == 0 ? TestLegOutcome.NotExercised
//                    : outputErrors > 0     ? TestLegOutcome.Failed
//                    : rendered == 0        ? TestLegOutcome.Failed
//                                           : TestLegOutcome.Passed;
//
// The rename alone would have taken `parseReplayPassPredicate` to null and turned
// this suite red; the MEANING change is the part that mattered. An empty replay
// window stopped being a pass, and any render error started failing the leg where
// one rendered order out of five used to carry it — so the frontend model became
// more permissive than the backend in exactly the direction this file exists to
// prevent. The two accepted versions are enumerated and the expectation is picked
// from whichever the checkout declares; a THIRD shape fails rather than skips,
// because "the backend changed again" must never look like "nothing to do".
//
// WHAT DRIFT LOOKS LIKE HERE, and why a string compare would not catch it:
//   • the C# starts counting a different property (`DraftOutput` -> something else)
//     — then `replayRenderedCount` is reading a field the backend no longer gates on;
//   • the C# changes which states its leg passes;
//   • the frontend recommends go-live in a state the backend refuses to publish.
// The third is the one that shipped, so it is checked as a TRUTH TABLE rather than
// as text. The second is checked by INTERPRETING the parsed C# over that same table
// rather than by pinning the literal source line, so that reordering two arms that
// both yield `Failed` — a rewrite with no behavioural content — does not read as
// drift, while any real change to the accepted set does.
//
// ANTI-VACUITY, in the three shapes this repo has been bitten by:
//   1. The parsers run against inline fixtures of BOTH backend shapes on EVERY
//      invocation, backend or not. A parser that silently stopped matching would
//      otherwise "confirm" the mirror by finding nothing.
//   2. `recordComparison` refuses an empty backend side and counts itself; an
//      `afterAll` asserts the counter reached the declared number. A run that
//      resolved a backend and compared nothing is a FAILURE, not a pass.
//   3. `null`, never `[]`, when a symbol is absent — "renamed" must be
//      distinguishable from "matched nothing".
//
// Run it deliberately with:
//   PROCULINK_BACKEND_PATH=/path/to/ProcuLink bunx vitest run src/test/replayImpactBackendMirror.test.ts
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
 * from "matched nothing". Unchanged by PR 207 — both shapes count the same thing.
 */
export function parseRenderedCountProperty(cs: string): string | null {
  const m = /var\s+rendered\s*=\s*replay\.Orders\.Count\(\s*\w+\s*=>\s*\w+\.(\w+)\s+is\s+not\s+null\s*\)\s*;/.exec(cs);
  return m ? m[1] : null;
}

/**
 * PRE-PR-207. `var replayPassed = replay.OrderCount == 0 || rendered > 0;`
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

/** One `condition ? outcome` arm of the PR-207 ternary chain. */
export interface ReplayOutcomeArm {
  condition: string;
  outcome: string;
}

/** The whole chain: ordered arms, plus the value when no arm matched. */
export interface ReplayOutcomeChain {
  arms: ReplayOutcomeArm[];
  fallback: string;
}

/**
 * WITH PR 207. Splits `var replayOutcome = c1 ? o1 : c2 ? o2 : … : fallback;` into
 * its arms. Returns null when the declaration is absent or is not a ternary chain,
 * so a rename is distinguishable from a parser that went blind.
 *
 * Kept structural rather than regex-per-condition: the arms are then INTERPRETED
 * below, which is what makes the diff a comparison of meaning instead of a
 * comparison of formatting.
 */
export function parseReplayOutcomeChain(cs: string): ReplayOutcomeChain | null {
  const m = /var\s+replayOutcome\s*=\s*([^;]+);/.exec(cs);
  if (!m) return null;
  const body = m[1].replace(/\s+/g, " ").trim();

  // Split on top-level `?` and `:`. Neither the conditions nor the outcomes in this
  // chain contain either character, but parens are tracked so a future guard clause
  // like `(a || b) ? …` does not silently mis-split.
  const parts: string[] = [];
  let depth = 0;
  let last = 0;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    else if (depth === 0 && (ch === "?" || ch === ":")) {
      parts.push(body.slice(last, i).trim());
      last = i + 1;
    }
  }
  parts.push(body.slice(last).trim());

  // [c1, o1, c2, o2, …, fallback] — always odd, and at least one full arm.
  if (parts.length < 3 || parts.length % 2 === 0) return null;
  if (parts.some((p) => p.length === 0)) return null;

  const arms: ReplayOutcomeArm[] = [];
  for (let i = 0; i < parts.length - 1; i += 2) {
    arms.push({ condition: parts[i], outcome: parts[i + 1] });
  }
  return { arms, fallback: parts[parts.length - 1] };
}

/** The replay-window counts the C# conditions are written over. */
export interface BackendReplayState {
  total: number;
  rendered: number;
  errors: number;
}

/**
 * Every condition this file knows how to evaluate, in both polarities — so an
 * equivalent rewrite (`rendered == 0 ? Failed` becoming `rendered > 0 ? Passed`)
 * still evaluates rather than reading as drift, while a condition over something
 * genuinely new does not quietly evaluate to `false` and vanish.
 */
const KNOWN_CONDITIONS: Record<string, (s: BackendReplayState) => boolean> = {
  "replay.OrderCount == 0": (s) => s.total === 0,
  "replay.OrderCount > 0": (s) => s.total > 0,
  "outputErrors > 0": (s) => s.errors > 0,
  "outputErrors == 0": (s) => s.errors === 0,
  "rendered == 0": (s) => s.rendered === 0,
  "rendered > 0": (s) => s.rendered > 0,
};

export type ChainEvaluation =
  | { kind: "outcome"; outcome: string }
  | { kind: "unknown-condition"; condition: string };

/**
 * Every arm condition this file cannot evaluate. Checked before the walk rather
 * than during it: an unreachable arm is still a gating term the model does not
 * know about, and reachability is not the property that makes it drift.
 */
export function unknownConditions(chain: ReplayOutcomeChain): string[] {
  return chain.arms.map((a) => a.condition).filter((c) => !(c in KNOWN_CONDITIONS));
}

/** Walks the parsed chain for one state, exactly as C# would. */
export function evaluateReplayOutcomeChain(
  chain: ReplayOutcomeChain,
  s: BackendReplayState,
): ChainEvaluation {
  for (const arm of chain.arms) {
    const predicate = KNOWN_CONDITIONS[arm.condition];
    if (predicate === undefined) return { kind: "unknown-condition", condition: arm.condition };
    if (predicate(s)) return { kind: "outcome", outcome: arm.outcome };
  }
  return { kind: "outcome", outcome: chain.fallback };
}

/**
 * `var outputChanged = current.Ok && draft.Ok && !string.Equals(...)` in
 * ReplayService — the reason a broken draft scores `outputChanged: false`, which
 * is the mechanism of the defect. If this ever stops requiring `draft.Ok`, the
 * `rendered` term stops being load-bearing and this mirror should be revisited.
 */
export function parseOutputChangedRequiresDraftOk(cs: string): boolean | null {
  const m = /var\s+outputChanged\s*=\s*([^;]+);/.exec(cs);
  if (!m) return null;
  return /\bdraft\.Ok\b/.test(m[1]);
}

// ── The state space, shared by every truth table below ───────────────────────

const TRUTH_TABLE: ReplaySummary[] = (() => {
  const out: ReplaySummary[] = [];
  for (const total of [0, 1, 3]) {
    for (const rendered of [0, 1]) {
      if (rendered > total) continue;
      for (const errors of [0, 1]) {
        for (const startFailing of [0, 1]) {
          out.push({ total, rendered, outputChanges: 0, validationChanges: 0, startFailing, errors });
        }
      }
    }
  }
  return out;
})();

/** The `TestLegOutcome` member the C# fallback arm must name for a pass. */
const PASSED_OUTCOME = "TestLegOutcome.Passed";

// ── Anti-vacuity 1: the parsers, against inline fixtures of BOTH shapes ──────

/** Verbatim from SupplierConnectionService.cs on backend `main` (pre-PR-207). */
const FIXTURE_LEGACY = `
        var outputErrors      = replay.Orders.Count(o => o.OutputError is not null);
        var rendered          = replay.Orders.Count(o => o.DraftOutput is not null);
        var outputChanged     = replay.Orders.Count(o => o.OutputChanged);
        var replayPassed      = replay.OrderCount == 0 || rendered > 0;
`;

/** Verbatim from SupplierConnectionService.cs with BE PR 207 applied. */
const FIXTURE_PR_207 = `
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

describe("the parsers themselves", () => {
  test("read the counted property out of both backend shapes", () => {
    expect(parseRenderedCountProperty(FIXTURE_LEGACY)).toBe("DraftOutput");
    expect(parseRenderedCountProperty(FIXTURE_PR_207)).toBe("DraftOutput");
    expect(parseOutputChangedRequiresDraftOk(FIXTURE_REPLAY)).toBe(true);
  });

  test("read the pre-PR-207 boolean predicate", () => {
    expect(parseReplayPassPredicate(FIXTURE_LEGACY)).toEqual({
      emptyIsPass: true,
      requiresRendered: true,
    });
    // …and do not find a chain in it, so the two shapes cannot both match one file.
    expect(parseReplayOutcomeChain(FIXTURE_LEGACY)).toBeNull();
  });

  test("read the PR-207 ternary chain, arm by arm", () => {
    const chain = parseReplayOutcomeChain(FIXTURE_PR_207);
    expect(chain).not.toBeNull();
    expect(chain!.arms).toEqual([
      { condition: "replay.OrderCount == 0", outcome: "TestLegOutcome.NotExercised" },
      { condition: "outputErrors > 0", outcome: "TestLegOutcome.Failed" },
      { condition: "rendered == 0", outcome: "TestLegOutcome.Failed" },
    ]);
    expect(chain!.fallback).toBe(PASSED_OUTCOME);
    // …and the legacy parser finds nothing here, for the same reason as above.
    expect(parseReplayPassPredicate(FIXTURE_PR_207)).toBeNull();
  });

  test("return null rather than a false positive when the symbol is gone", () => {
    expect(parseRenderedCountProperty("var somethingElse = 1;")).toBeNull();
    expect(parseReplayPassPredicate("var somethingElse = 1;")).toBeNull();
    expect(parseReplayOutcomeChain("var somethingElse = 1;")).toBeNull();
    expect(parseOutputChangedRequiresDraftOk("var somethingElse = 1;")).toBeNull();
    // A `replayOutcome` that is no longer a ternary chain is also null, not an
    // arm-less chain that would evaluate to its own body and compare as "passed".
    expect(parseReplayOutcomeChain("var replayOutcome = TestLegOutcome.Passed;")).toBeNull();
  });

  test("notice a counted property that is no longer the output", () => {
    const drifted = FIXTURE_PR_207.replace("o.DraftOutput is not null", "o.OutputError is not null");
    expect(parseRenderedCountProperty(drifted)).toBe("OutputError");
  });

  test("the chain interpreter reproduces the fixture's own truth table", () => {
    const chain = parseReplayOutcomeChain(FIXTURE_PR_207)!;
    const passes = (s: BackendReplayState) => {
      const e = evaluateReplayOutcomeChain(chain, s);
      return e.kind === "outcome" && e.outcome === PASSED_OUTCOME;
    };
    expect(passes({ total: 0, rendered: 0, errors: 0 })).toBe(false); // not_exercised
    expect(passes({ total: 3, rendered: 0, errors: 3 })).toBe(false); // failed
    expect(passes({ total: 3, rendered: 1, errors: 2 })).toBe(false); // failed — PR 207's change
    expect(passes({ total: 3, rendered: 3, errors: 0 })).toBe(true);
  });

  test("an equivalent rewrite is not drift, but a new condition is", () => {
    // Same accepted set, arms reordered and one polarity flipped. It must still
    // evaluate, or this file would fail the backend for reformatting.
    const rewritten = FIXTURE_PR_207.replace(
      /var replayOutcome =[\s\S]*?TestLegOutcome\.Passed;/,
      [
        "var replayOutcome =",
        "    outputErrors > 0       ? TestLegOutcome.Failed",
        "    : replay.OrderCount == 0 ? TestLegOutcome.NotExercised",
        "    : rendered > 0           ? TestLegOutcome.Passed",
        "                             : TestLegOutcome.Failed;",
      ].join("\n"),
    );
    const chain = parseReplayOutcomeChain(rewritten)!;
    expect(chain.arms).toHaveLength(3);
    for (const s of TRUTH_TABLE) {
      const e = evaluateReplayOutcomeChain(chain, s);
      expect(e.kind).toBe("outcome");
      expect(e.kind === "outcome" && e.outcome === PASSED_OUTCOME).toBe(
        backendWouldPassReplayLeg(s),
      );
    }

    // A condition over something this file has never seen is reported, never
    // silently treated as false — that is the shape that would let a new gating
    // term land on the backend and read here as "no change".
    const novel = FIXTURE_PR_207.replace("outputErrors > 0", "deliveryProbeFailures > 0");
    const novelChain = parseReplayOutcomeChain(novel)!;
    expect(unknownConditions(novelChain)).toEqual(["deliveryProbeFailures > 0"]);
    expect(evaluateReplayOutcomeChain(novelChain, { total: 3, rendered: 3, errors: 0 })).toEqual({
      kind: "unknown-condition",
      condition: "deliveryProbeFailures > 0",
    });
    // The real chain has none, so the check above is not passing by being empty.
    expect(unknownConditions(parseReplayOutcomeChain(FIXTURE_PR_207)!)).toEqual([]);
  });

  test("the truth table is not empty and contains every refusal shape", () => {
    expect(TRUTH_TABLE.length).toBeGreaterThanOrEqual(16);
    expect(TRUTH_TABLE.some((s) => s.total === 0)).toBe(true);
    expect(TRUTH_TABLE.some((s) => s.total > 0 && s.rendered === 0)).toBe(true);
    expect(TRUTH_TABLE.some((s) => s.rendered > 0 && s.errors > 0)).toBe(true);
    expect(TRUTH_TABLE.some((s) => s.rendered > 0 && s.errors === 0 && s.total > 0)).toBe(true);
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

// ── Which backend this checkout is ───────────────────────────────────────────

export type WireVersion = "with-pr-207" | "pre-pr-207";

/**
 * The version this checkout speaks, or null when it is NEITHER — which is drift
 * and has to fail, not skip. Determined from the declaration this file mirrors
 * rather than from an adjacent symbol, so "the predicate moved" cannot be missed
 * by a probe that is still finding its neighbour.
 */
export function wireVersionOf(cs: string): WireVersion | null {
  if (parseReplayOutcomeChain(cs) !== null) return "with-pr-207";
  if (parseReplayPassPredicate(cs) !== null) return "pre-pr-207";
  return null;
}

describe("the wire-version probe", () => {
  test("identifies each fixture as itself, and a third shape as neither", () => {
    expect(wireVersionOf(FIXTURE_PR_207)).toBe("with-pr-207");
    expect(wireVersionOf(FIXTURE_LEGACY)).toBe("pre-pr-207");
    expect(wireVersionOf("var replayVerdict = Something.Else;")).toBeNull();
  });
});

const CONNECTION_CS = BACKEND ? readFileSync(join(BACKEND, CONNECTION_SERVICE_REL), "utf8") : null;
const WIRE = CONNECTION_CS === null ? null : wireVersionOf(CONNECTION_CS);

// ── The diff ─────────────────────────────────────────────────────────────────

let comparisonsRun = 0;
const EXPECTED_COMPARISONS =
  2 + // the counted property: that it parses at all, and that it is DraftOutput
  3 + // the wire arm: the declaration parses, it matches the model, it bounds go-live
  1; // outputChanged still requires draft.Ok

describe("replayImpactModel mirrors SupplierConnectionService's publish predicate", () => {
  test("the gate allows this run to proceed", () => {
    const missing = BACKEND ? missingParsedFiles(BACKEND, existsSync) : [];
    expect(mirrorGateFailure({ backendRoot: BACKEND, missing, required: REQUIRE_MIRROR })).toBeNull();
  });

  test.skipIf(BACKEND === null)("the checkout is one of the two versions this file reads", () => {
    // Neither declaration present means the backend moved somewhere neither arm
    // below understands, and that has to be loud — a mirror whose subject vanished
    // is exactly the state that reads as "nothing to check".
    expect(
      WIRE,
      `${CONNECTION_SERVICE_REL} declares neither \`var replayOutcome = … ? … : …\` (BE PR 207) ` +
        "nor `var replayPassed = …` (its predecessor). src/components/connections/replayImpactModel.ts " +
        "mirrors a predicate that is gone, and this file cannot say which states the backend now " +
        "publishes.",
    ).not.toBeNull();
  });

  test.skipIf(BACKEND === null)("counts the same property the backend counts", () => {
    const property = parseRenderedCountProperty(CONNECTION_CS!);
    expect(
      property,
      `${CONNECTION_SERVICE_REL} no longer declares \`var rendered = replay.Orders.Count(o => o.X is not null)\`. ` +
        "replayImpactModel.replayRenderedCount cites that line as the definition it mirrors.",
    ).not.toBeNull();
    comparisonsRun += 1;

    // The DTO field replayRenderedCount reads, in the backend's own casing. The
    // frontend contract camel-cases the C# record property, so this is the diff.
    expect(property).toBe("DraftOutput");
    comparisonsRun += 1;
  });

  test.skipIf(WIRE !== "with-pr-207")("agrees with the PR-207 leg outcome, state for state", () => {
    const chain = parseReplayOutcomeChain(CONNECTION_CS!)!;
    expect(chain.arms.length, "a chain with no arms compares nothing").toBeGreaterThan(0);
    expect(
      unknownConditions(chain),
      `${CONNECTION_SERVICE_REL} gates the replay leg on a term replayImpactModel.ts does not ` +
        'model at all. A new gating term must not be read as "no change" — add it to the ' +
        "summary and to KNOWN_CONDITIONS.",
    ).toEqual([]);
    comparisonsRun += 1;

    // The diff, as MEANING rather than text: interpret the real C# over the whole
    // table and require it to accept exactly the states `backendWouldPassReplayLeg`
    // accepts. Both directions — a backend that started passing something the model
    // refuses is drift too, just the harmless-today direction of it.
    let backendPasses = 0;
    for (const s of TRUTH_TABLE) {
      const evaluation = evaluateReplayOutcomeChain(chain, s);
      const passes = evaluation.kind === "outcome" && evaluation.outcome === PASSED_OUTCOME;
      if (passes) backendPasses += 1;
      expect(
        passes,
        `backendWouldPassReplayLeg disagrees with the C# for ${JSON.stringify(s)}`,
      ).toBe(backendWouldPassReplayLeg(s));
    }
    // Floor on what the walk actually found: a chain that passed NOTHING would
    // satisfy the loop above against a model that also passes nothing.
    expect(backendPasses, "the C# passes no state in the table — this comparison is vacuous")
      .toBeGreaterThan(0);
    expect(backendPasses).toBeLessThan(TRUTH_TABLE.length);
    comparisonsRun += 1;

    // And the states it refuses are states the panel must not recommend. This is the
    // assertion the shipped defect would have failed: `{total: 3, rendered: 0}` read
    // "safe to go live" while the backend's own leg was false.
    const refused = TRUTH_TABLE.filter((s) => !backendWouldPassReplayLeg(s));
    expect(refused.length, "no refused state in the table — this comparison is vacuous")
      .toBeGreaterThan(0);
    for (const s of refused) {
      expect(
        replayImpact(s).safeToGoLive,
        `frontend recommends go-live for a state the backend refuses to publish: ${JSON.stringify(s)}`,
      ).toBe(false);
    }
    comparisonsRun += 1;
  });

  test.skipIf(WIRE !== "pre-pr-207")("agrees with the pre-PR-207 boolean predicate", () => {
    const predicate = parseReplayPassPredicate(CONNECTION_CS!);
    expect(
      predicate,
      `${CONNECTION_SERVICE_REL} no longer declares \`var replayPassed = …\`.`,
    ).not.toBeNull();
    comparisonsRun += 1;

    expect(predicate).toEqual({ emptyIsPass: true, requiresRendered: true });
    // The historical rule, and the model's copy of it, agree over the table.
    for (const s of TRUTH_TABLE) {
      expect(
        legacyBackendWouldPassReplayLeg(s),
        `legacyBackendWouldPassReplayLeg disagrees with the C# for ${JSON.stringify(s)}`,
      ).toBe(s.total === 0 || s.rendered > 0);
    }
    comparisonsRun += 1;

    // The model ships the STRICTER PR-207 rule while this backend is still live, so
    // what has to hold here is that its recommendation is inside the older backend's
    // accepted set too. Checked against the deployed rule, not only in a comment.
    const refused = TRUTH_TABLE.filter((s) => !legacyBackendWouldPassReplayLeg(s));
    expect(refused.length, "no refused state in the table — this comparison is vacuous")
      .toBeGreaterThan(0);
    for (const s of refused) {
      expect(
        replayImpact(s).safeToGoLive,
        `frontend recommends go-live for a state this backend refuses: ${JSON.stringify(s)}`,
      ).toBe(false);
    }
    for (const s of TRUTH_TABLE.filter(backendWouldPassReplayLeg)) {
      expect(
        legacyBackendWouldPassReplayLeg(s),
        `the model accepts ${JSON.stringify(s)}, which THIS deployed backend refuses`,
      ).toBe(true);
    }
    comparisonsRun += 1;
  });

  test.skipIf(BACKEND === null)("outputChanged still requires the draft to have rendered", () => {
    const cs = readFileSync(join(BACKEND!, REPLAY_SERVICE_REL), "utf8");
    const requiresDraftOk = parseOutputChangedRequiresDraftOk(cs);
    expect(
      requiresDraftOk,
      `${REPLAY_SERVICE_REL} no longer declares \`var outputChanged = …\`.`,
    ).not.toBeNull();
    // If this ever goes false, an unrenderable order would start reporting
    // `outputChanged: true` and the `rendered` term would stop being load-bearing —
    // the mechanism behind P0-C would have changed and this model needs re-reading.
    expect(requiresDraftOk).toBe(true);
    comparisonsRun += 1;
  });
});

afterAll(() => {
  if (BACKEND === null) return;
  // A third-shape backend already failed the wire-version gate above, by name. A
  // second failure here would only bury it, and the counter means nothing when
  // neither wire arm was allowed to run.
  if (WIRE === null) return;
  expect(
    comparisonsRun,
    "a backend checkout resolved but the mirror compared fewer things than it declares — " +
      "a run that resolves a backend and compares nothing is a failure, not a pass",
  ).toBe(EXPECTED_COMPARISONS);
});
