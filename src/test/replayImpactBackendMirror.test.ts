import { afterAll, describe, test, expect } from "vitest";
import { existsSync, readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { ROOT } from "./appRoutes";
import {
  backendWouldPassReplayLeg,
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
// second, weaker definition of the same idea instead of mirroring it:
//
//     ProcuLink.Api/Services/SupplierConnectionService.cs
//       var rendered     = replay.Orders.Count(o => o.DraftOutput is not null);
//       var replayPassed = replay.OrderCount == 0 || rendered > 0;
//
// So this file does what `backendMirror.test.ts` does for the status manifest:
// reads the real C#, and fails when the two drift.
//
// WHAT DRIFT LOOKS LIKE HERE, and why a string compare would not catch it:
//   • the C# starts counting a different property (`DraftOutput` -> something else)
//     — then `replayRenderedCount` is reading a field the backend no longer gates on;
//   • the C# stops treating `OrderCount == 0` as pass-with-note;
//   • the frontend recommends go-live in a state where `replayPassed` is false.
// The third is the one that shipped, so it is checked as a TRUTH TABLE rather than
// as text: for every state where the backend would refuse to publish, the frontend
// must not recommend going live.
//
// ANTI-VACUITY, in the three shapes this repo has been bitten by:
//   1. The parsers run against an inline fixture on EVERY invocation, backend or
//      not. A parser that silently stopped matching would otherwise "confirm" the
//      mirror by finding nothing.
//   2. `recordComparison` refuses an empty backend side and counts itself; an
//      `afterAll` asserts the counter reached the declared number. A run that
//      resolved a backend and compared nothing is a FAILURE, not a pass.
//   3. `null`, never `[]`, when a symbol is absent — "renamed" must be
//      distinguishable from "matched nothing".
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
 * `var replayPassed = replay.OrderCount == 0 || rendered > 0;`
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

// ── Anti-vacuity 1: the parsers, against inline fixtures, always ─────────────

const FIXTURE_CONNECTION = `
        var outputErrors      = replay.Orders.Count(o => o.OutputError is not null);
        var rendered          = replay.Orders.Count(o => o.DraftOutput is not null);
        var outputChanged     = replay.Orders.Count(o => o.OutputChanged);
        var replayPassed      = replay.OrderCount == 0 || rendered > 0;
`;

const FIXTURE_REPLAY = `
        var outputChanged = current.Ok && draft.Ok && !string.Equals(current.Text, draft.Text, StringComparison.Ordinal);
`;

describe("the parsers themselves", () => {
  test("read the fixture the C# is expected to look like", () => {
    expect(parseRenderedCountProperty(FIXTURE_CONNECTION)).toBe("DraftOutput");
    expect(parseReplayPassPredicate(FIXTURE_CONNECTION)).toEqual({
      emptyIsPass: true,
      requiresRendered: true,
    });
    expect(parseOutputChangedRequiresDraftOk(FIXTURE_REPLAY)).toBe(true);
  });

  test("return null rather than a false positive when the symbol is gone", () => {
    expect(parseRenderedCountProperty("var somethingElse = 1;")).toBeNull();
    expect(parseReplayPassPredicate("var somethingElse = 1;")).toBeNull();
    expect(parseOutputChangedRequiresDraftOk("var somethingElse = 1;")).toBeNull();
  });

  test("notice a counted property that is no longer the output", () => {
    const drifted = FIXTURE_CONNECTION.replace("o.DraftOutput is not null", "o.OutputError is not null");
    expect(parseRenderedCountProperty(drifted)).toBe("OutputError");
  });

  test("notice a pass predicate that no longer requires anything to render", () => {
    const drifted = FIXTURE_CONNECTION.replace("replay.OrderCount == 0 || rendered > 0", "true");
    expect(parseReplayPassPredicate(drifted)).toEqual({ emptyIsPass: false, requiresRendered: false });
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

// ── The diff ─────────────────────────────────────────────────────────────────

let comparisonsRun = 0;
const EXPECTED_COMPARISONS = 4;

describe("replayImpactModel mirrors SupplierConnectionService's publish predicate", () => {
  test("the gate allows this run to proceed", () => {
    const missing = BACKEND ? missingParsedFiles(BACKEND, existsSync) : [];
    expect(mirrorGateFailure({ backendRoot: BACKEND, missing, required: REQUIRE_MIRROR })).toBeNull();
  });

  test.skipIf(BACKEND === null)("counts the same property the backend counts", () => {
    const cs = readFileSync(join(BACKEND!, CONNECTION_SERVICE_REL), "utf8");
    const property = parseRenderedCountProperty(cs);
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

  test.skipIf(BACKEND === null)("agrees on when a revision may publish at all", () => {
    const cs = readFileSync(join(BACKEND!, CONNECTION_SERVICE_REL), "utf8");
    const predicate = parseReplayPassPredicate(cs);
    expect(
      predicate,
      `${CONNECTION_SERVICE_REL} no longer declares \`var replayPassed = …\`.`,
    ).not.toBeNull();
    expect(predicate).toEqual({ emptyIsPass: true, requiresRendered: true });
    comparisonsRun += 1;

    // The truth table. For every state in which the backend's own predicate is
    // false, the frontend must not recommend going live. This is the assertion the
    // shipped defect would have failed: `{total: 3, rendered: 0}` read
    // "safe to go live" while `replayPassed` was false.
    const states: ReplaySummary[] = [];
    for (const total of [0, 1, 3]) {
      for (const rendered of [0, 1]) {
        if (rendered > total) continue;
        for (const errors of [0, 1]) {
          for (const startFailing of [0, 1]) {
            states.push({ total, rendered, outputChanges: 0, validationChanges: 0, startFailing, errors });
          }
        }
      }
    }
    expect(states.length).toBeGreaterThanOrEqual(16);
    const refused = states.filter((s) => !backendWouldPassReplayLeg(s));
    // Floor on what was EXTRACTED, not on what was iterated: if no state in the
    // table is one the backend refuses, the loop below proves nothing.
    expect(refused.length, "no refused state in the table — this comparison is vacuous").toBeGreaterThan(0);
    for (const s of refused) {
      expect(
        replayImpact(s).safeToGoLive,
        `frontend recommends go-live for a state the backend refuses to publish: ${JSON.stringify(s)}`,
      ).toBe(false);
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
  });
});

afterAll(() => {
  if (BACKEND === null) return;
  expect(
    comparisonsRun,
    "a backend checkout resolved but the mirror compared fewer things than it declares — " +
      "a run that resolves a backend and compares nothing is a failure, not a pass",
  ).toBe(EXPECTED_COMPARISONS);
});
