import { describe, test, expect } from "vitest";
import { existsSync, readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import {
  TEST_LEG_OUTCOMES,
  TEST_PACK_OUTCOMES,
  testOutcomeIsFavourable,
  testPackReading,
} from "@/lib/testPackOutcomeManifest";
import { ROOT } from "./appRoutes";

// ─────────────────────────────────────────────────────────────────────────────
// The cross-repo mirror check for the check-run outcome vocabulary.
//
// `src/lib/testPackOutcomeManifest.ts` is a hand-kept copy of two C# constant
// classes that live in another repo and another language. The thing it replaces was
// not a copy either — it was a BOOLEAN, and four separate backend paths set that
// boolean to `true` over a run that had executed nothing. The most consequential:
// a supplier with no orders, i.e. every newly configured supplier, could publish a
// connection whose endpoint, credentials and output format had never been exercised.
//
// A comment naming the C# site is not a check. This file parses the real C# and
// diffs it, in both directions, so a fifth outcome added over there cannot land here
// as `unrecognised` without anyone noticing — and an outcome this manifest invented
// cannot survive either.
//
// Written the same way as `src/test/deliveryAttemptMirror.test.ts`:
//
//   • The PARSER is tested against an inline fixture on EVERY run, everywhere. A
//     parser that quietly stopped matching would otherwise "confirm" the mirror by
//     finding nothing, which is the same vacuous-pass shape as the defect itself.
//   • The DIFF runs whenever a backend checkout is reachable — PROCULINK_BACKEND_PATH,
//     or a sibling `ProcuLink` found by walking up from this repo.
//   • When no checkout is reachable the diff is SKIPPED BY A DECLARED CONDITION with
//     the reason printed, never silently passed.
//
// PAIRS WITH BACKEND PR 207 (`fix/publish-gate-empty-test-pack`), and either half may
// deploy first. So a backend WITHOUT PR 207 is not a failure here and is not a skip
// either: it is POSITIVELY IDENTIFIED — the pre-PR-207 marker `record ReplayLeg(bool
// Passed` must be there — and the frontend's conservative fallback is asserted instead.
// The two accepted backend versions are enumerated; a third state, where neither marker
// is present, fails. "The backend changed again" must never look like "nothing to do".
//
// Run it deliberately with:
//   PROCULINK_BACKEND_PATH=/path/to/ProcuLink bunx vitest run src/test/testPackOutcomeMirror.test.ts
// ─────────────────────────────────────────────────────────────────────────────

/** Declares `TestLegOutcomeNames` and `TestPackOutcomeNames`. */
const NAMES_REL = "ProcuLink.Core/Services/ISupplierConnectionService.cs";

/** The backend checkout, or null. Same walk-up as the other mirror suites. */
function findBackendRoot(): string | null {
  const fromEnv = process.env.PROCULINK_BACKEND_PATH;
  if (fromEnv && existsSync(join(fromEnv, NAMES_REL))) return fromEnv;

  let dir = resolve(ROOT);
  for (let i = 0; i < 8; i += 1) {
    const candidate = join(dirname(dir), "ProcuLink");
    if (existsSync(join(candidate, NAMES_REL))) return candidate;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

const BACKEND = findBackendRoot();

/**
 * The string values of the `public const string` members of one static class.
 *
 * Returns null when the class is not declared — never an empty list, so "the parser
 * went blind" and "the class has no members" cannot be confused by a comparison that
 * would then find two empty lists equal.
 */
export function parseConstStringsInClass(cs: string, className: string): string[] | null {
  const opening = new RegExp(String.raw`class\s+${className}\b[^{]*\{`).exec(cs);
  if (opening === null) return null;

  // Walk braces from the class's opening `{` so a later class's constants cannot be
  // swept in. Both classes here are flat, but `ToName` adds a nested block each.
  let depth = 0;
  let end = cs.length;
  for (let i = opening.index + opening[0].length - 1; i < cs.length; i += 1) {
    if (cs[i] === "{") depth += 1;
    else if (cs[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const body = cs.slice(opening.index + opening[0].length, end);
  return Array.from(body.matchAll(/public\s+const\s+string\s+\w+\s*=\s*"([^"]*)"\s*;/g)).map(
    (m) => m[1],
  );
}

describe("the constant parser actually parses (so a green diff means something)", () => {
  test("reads both classes out of their real declarations, verbatim", () => {
    // ISupplierConnectionService.cs:142-174 (BE PR 207), copied as-is — including the
    // `ToName` switch bodies, which add nested braces and mention every member again.
    const fixture = `
public static class TestLegOutcomeNames
{
    public const string Passed        = "passed";
    public const string Failed        = "failed";
    public const string NotExercised  = "not_exercised";
    public const string NotApplicable = "not_applicable";

    public static string ToName(TestLegOutcome outcome) => outcome switch
    {
        TestLegOutcome.Passed        => Passed,
        TestLegOutcome.NotApplicable => NotApplicable,
        _ => throw new ArgumentOutOfRangeException(nameof(outcome), outcome, "Unmapped TestLegOutcome."),
    };
}

/// <summary>Stored string forms of <see cref="TestPackOutcome"/> (the <c>test_outcome</c> column).</summary>
public static class TestPackOutcomeNames
{
    public const string Passed       = "passed";
    public const string Failed       = "failed";
    public const string NotExercised = "not_exercised";
}`;

    expect(parseConstStringsInClass(fixture, "TestLegOutcomeNames")).toEqual([
      "passed",
      "failed",
      "not_exercised",
      "not_applicable",
    ]);
    // The brace walk is the point of this one: without it the leg class's members would
    // run on into the pack class and the two would be indistinguishable.
    expect(parseConstStringsInClass(fixture, "TestPackOutcomeNames")).toEqual([
      "passed",
      "failed",
      "not_exercised",
    ]);
    expect(parseConstStringsInClass(fixture, "NoSuchClass")).toBeNull();
  });

  test("the manifest's own lists are non-vacuous", () => {
    // A diff between two empty lists is green and means nothing.
    expect(TEST_PACK_OUTCOMES.length).toBeGreaterThan(0);
    expect(TEST_LEG_OUTCOMES.length).toBeGreaterThan(0);
    // The distinction that makes the two vocabularies worth mirroring separately.
    expect(TEST_LEG_OUTCOMES.length).toBeGreaterThan(TEST_PACK_OUTCOMES.length);
  });
});

/** The C# that declares the check-run legs, used to identify the wire version. */
const SERVICE_REL = "ProcuLink.Api/Services/SupplierConnectionService.cs";

/**
 * Which of the two accepted backend versions this checkout is — or null when it is
 * neither, which is drift and must fail rather than skip.
 */
function backendWireVersion(root: string): "with-pr-207" | "pre-pr-207" | null {
  const names = readFileSync(join(root, NAMES_REL), "utf8");
  if (parseConstStringsInClass(names, "TestPackOutcomeNames") !== null) return "with-pr-207";
  const service = existsSync(join(root, SERVICE_REL))
    ? readFileSync(join(root, SERVICE_REL), "utf8")
    : "";
  // The pre-PR-207 marker: the boolean this whole change exists to remove.
  if (/record\s+ReplayLeg\s*\(\s*bool\s+Passed\b/.test(service)) return "pre-pr-207";
  return null;
}

const WIRE = BACKEND ? backendWireVersion(BACKEND) : null;

describe("the outcome vocabulary mirrors the backend", () => {
  test.skipIf(!BACKEND)("the checkout is one of the two versions this frontend reads", () => {
    // The gate. Neither marker present means the backend moved somewhere neither branch
    // below understands, and that has to be loud — a mirror whose subject vanished is
    // exactly the state that reads as "nothing to check".
    expect(
      WIRE,
      `${BACKEND} is neither a PR-207 backend (\`class TestPackOutcomeNames\` in ${NAMES_REL}) ` +
        `nor a pre-PR-207 one (\`record ReplayLeg(bool Passed\` in ${SERVICE_REL}). ` +
        "src/lib/testPackOutcomeManifest.ts and the compatibility block in " +
        "src/components/connections/testPackSummary.ts both mirror a shape that is gone.",
    ).not.toBeNull();
  });

  test.skipIf(WIRE !== "with-pr-207")("TestPackOutcomeNames matches, in both directions", () => {
    const cs = readFileSync(join(BACKEND!, NAMES_REL), "utf8");
    const backend = parseConstStringsInClass(cs, "TestPackOutcomeNames")!;

    expect(backend.length, "the C# side parsed to an empty list, so this proves nothing")
      .toBeGreaterThan(0);
    expect(
      [...backend].sort(),
      "the pack-level outcome vocabulary drifted from src/lib/testPackOutcomeManifest.ts. An " +
        "outcome the backend can send and this manifest does not name resolves to " +
        "`unrecognised` — safe, but the operator is told the page cannot read the answer " +
        "when in fact nobody added the row.",
    ).toEqual([...TEST_PACK_OUTCOMES].sort());
  });

  test.skipIf(WIRE !== "with-pr-207")("TestLegOutcomeNames matches, in both directions", () => {
    const cs = readFileSync(join(BACKEND!, NAMES_REL), "utf8");
    const backend = parseConstStringsInClass(cs, "TestLegOutcomeNames")!;

    expect(backend.length, "the C# side parsed to an empty list, so this proves nothing")
      .toBeGreaterThan(0);
    expect(
      [...backend].sort(),
      "the per-leg outcome vocabulary drifted from src/lib/testPackOutcomeManifest.ts.",
    ).toEqual([...TEST_LEG_OUTCOMES].sort());
  });

  test.skipIf(WIRE !== "with-pr-207")("the leg vocabulary really is the wider of the two", () => {
    // Anti-vacuity for the two diffs above: if the C# ever declared the same members in
    // both classes, the manifest's `scopes` column would be describing a distinction
    // that no longer exists — and `testPackOutcome`'s refusal of `not_applicable` would
    // be rejecting something legal.
    const cs = readFileSync(join(BACKEND!, NAMES_REL), "utf8");
    const pack = parseConstStringsInClass(cs, "TestPackOutcomeNames")!;
    const leg = parseConstStringsInClass(cs, "TestLegOutcomeNames")!;
    expect(new Set(leg).size).toBeGreaterThan(new Set(pack).size);
    for (const value of pack) {
      expect(leg, `${value} is a pack outcome the leg vocabulary does not declare`).toContain(value);
    }
  });

  test.skipIf(WIRE !== "pre-pr-207")(
    "a pre-PR-207 backend sends NO outcome vocabulary, and the manifest refuses it",
    () => {
      // The other accepted version. This backend sends booleans and no `outcome` at all,
      // and the rule is that the boolean never becomes a verdict — asserted here against
      // the real checkout rather than only against a fixture.
      const cs = readFileSync(join(BACKEND!, NAMES_REL), "utf8");
      expect(parseConstStringsInClass(cs, "TestPackOutcomeNames")).toBeNull();
      expect(parseConstStringsInClass(cs, "TestLegOutcomeNames")).toBeNull();
      // What the page does with that: nothing favourable, in either direction of the
      // boolean, and never the pass sentence.
      expect(testOutcomeIsFavourable(null)).toBe(false);
      expect(testPackReading(null).favourable).toBe(false);
      expect(testPackReading(null).tone).not.toBe("ok");
    },
  );

  test.skipIf(!!BACKEND)("SKIPPED — no backend checkout reachable", () => {
    // Declared, so a run with no backend says why instead of reporting a silent pass.
    expect(BACKEND).toBeNull();
  });
});
