import { describe, it, expect } from "vitest";

import {
  FAVOURABLE_TEST_OUTCOMES,
  MAKE_LIVE_NEEDS_CHECKS_TITLE,
  TEST_LEG_OUTCOMES,
  TEST_OUTCOMES,
  TEST_OUTCOME_FACTS,
  TEST_PACK_OUTCOMES,
  testLegOutcome,
  testLegWord,
  testOutcomeFact,
  testOutcomeIsFavourable,
  testPackOutcome,
  testPackReading,
} from "@/lib/testPackOutcomeManifest";

// ─────────────────────────────────────────────────────────────────────────────
// A check that did not run is not a check that passed.
//
// THE DEFECT, verbatim. `SupplierConnectionService.ExecuteTestPackAsync` reported a
// plain `bool passed`, and FOUR paths set it true over a run that had executed nothing.
// The one that matters most: a supplier with NO ORDERS — the default state at
// onboarding, i.e. exactly when an operator runs checks — got
//
//     new ReplayLeg(true, 0, 0, 0, 0, "No orders exist for this supplier yet — replay pass-with-note.")
//
// and `return (true, …)`. The frontend then rendered
//
//     "Checks passed — this version is ready to make live."   useConnectionRevisions.ts:135
//     Checks {passed ? "passed" : "failed"}                   HistoryDrawer.tsx:470
//
// over a connection whose endpoint, credentials and output format had never been
// exercised, and real deliveries routed through it.
//
// This file pins the vocabulary. `passed` is the ONLY favourable value; `not_exercised`
// is neither a pass nor a failure; `not_applicable` is a neutral fact about the format
// and never a pass; and anything else — INCLUDING NOTHING AT ALL — is `unrecognised`,
// which is never favourable. The rendered surfaces are pinned next door, in
// src/components/connections/testPackOutcome.test.tsx.
// ─────────────────────────────────────────────────────────────────────────────

/** Wordings that assert the checks came back clean. */
const PASS_CLAIM: readonly RegExp[] = [
  /\bpass(ed|es|ing)?\b/i,
  /ready to (make|go) live/i,
  /\bsucceed(ed|s)?\b/i,
  /\bsuccessful\b/i,
  /all (checks )?(clear|good|green)/i,
  /no (problems|issues|errors)\b/i,
  /looks good/i,
  /\bverified\b/i,
];

/** The sentence that shipped over a run that tested nothing. Kept verbatim. */
const ORIGINAL_DEFECT = "Checks passed — this version is ready to make live.";

function passClaimsIn(text: string): string[] {
  return PASS_CLAIM.filter((re) => re.test(text)).map(String);
}

describe("the pass-claim matcher is not vacuous", () => {
  it("flags the sentence that shipped, verbatim", () => {
    // Without this, a broken regex clears every case below and the suite is decoration.
    expect(passClaimsIn(ORIGINAL_DEFECT)).not.toHaveLength(0);
  });

  it("also flags the panel headline that shipped beside it", () => {
    expect(passClaimsIn("Checks passed")).not.toHaveLength(0);
  });

  it("does not flag a sentence that claims nothing", () => {
    // Guards the opposite failure: a matcher so broad nothing can ever satisfy it.
    expect(passClaimsIn("Put one order through for this supplier, then run the checks again."))
      .toHaveLength(0);
  });
});

describe("the manifest table is not vacuous", () => {
  it("carries every value the two C# vocabularies declare", () => {
    // Anti-vacuity floor: an empty table makes every sweep below trivially true, and
    // makes `testOutcomeFact` answer null — i.e. `unrecognised` — for real values.
    expect(TEST_OUTCOMES).toEqual(["passed", "failed", "not_exercised", "not_applicable"]);
    expect(TEST_PACK_OUTCOMES).toEqual(["passed", "failed", "not_exercised"]);
    expect(TEST_LEG_OUTCOMES).toEqual(["passed", "failed", "not_exercised", "not_applicable"]);
  });

  it("names no value twice, and gives every row a backend citation and a note", () => {
    expect(new Set(TEST_OUTCOMES).size).toBe(TEST_OUTCOMES.length);
    for (const fact of TEST_OUTCOME_FACTS) {
      expect(fact.backendSite, `${fact.wire} cites no C# site`).toMatch(/\.cs:\d+/);
      expect(fact.note.length, `${fact.wire} carries no note`).toBeGreaterThan(0);
      expect(fact.scopes.length, `${fact.wire} belongs to no vocabulary`).toBeGreaterThan(0);
    }
  });

  it("marks exactly one outcome favourable", () => {
    // The sharpest statement of the rule. A second favourable row is the defect
    // returning: three of the four vacuous-pass paths were "this did not object".
    expect(FAVOURABLE_TEST_OUTCOMES).toEqual(["passed"]);
  });
});

describe("only `passed` unlocks anything", () => {
  it("answers true for a run that really passed", () => {
    // Floor: a predicate that answers false for everything would satisfy every
    // must-not-unlock case below while breaking the product.
    expect(testOutcomeIsFavourable("passed")).toBe(true);
  });

  // THE CONTROLS. A suite using only passed/failed passes without touching the defect —
  // the whole point is the third and fourth answers.
  const MUST_NOT_UNLOCK: ReadonlyArray<{ raw: string | null | undefined; why: string }> = [
    { raw: "failed", why: "a check found a fault" },
    {
      raw: "not_exercised",
      why: "THE DEFECT — the checks ran against a supplier with no orders and proved nothing",
    },
    { raw: "not_applicable", why: "leg-only; a whole run may never conclude it" },
    { raw: "some_outcome_we_do_not_know", why: "a value this file has never heard of" },
    { raw: "", why: "an empty string" },
    { raw: null, why: "no outcome at all — a backend older than BE PR 207" },
    { raw: undefined, why: "the field absent from the response" },
  ];

  it("covers every value that must not unlock", () => {
    // `[].every()` is true, so an empty case list would clear the sweep below against a
    // predicate that answers true for everything.
    expect(MUST_NOT_UNLOCK).toHaveLength(7);
  });

  MUST_NOT_UNLOCK.forEach(({ raw, why }) => {
    it(`refuses ${JSON.stringify(raw)} — ${why}`, () => {
      expect(testOutcomeIsFavourable(raw)).toBe(false);
      expect(testPackReading(raw).favourable).toBe(false);
    });
  });
});

describe("an unrecognised outcome resolves to `unrecognised`, never to something adjacent", () => {
  it("reads a value the table has never heard of", () => {
    expect(testPackOutcome("definitely_not_a_real_outcome")).toBe("unrecognised");
    expect(testLegOutcome("definitely_not_a_real_outcome")).toBe("unrecognised");
  });

  it("reads an absent value the same way", () => {
    // A backend older than BE PR 207 sends no `outcome` at all. That is not evidence of a
    // pass, and it is not evidence of a failure either.
    expect(testPackOutcome(null)).toBe("unrecognised");
    expect(testPackOutcome(undefined)).toBe("unrecognised");
    expect(testLegOutcome(null)).toBe("unrecognised");
  });

  it("refuses `not_applicable` at pack level, because the backend cannot send it there", () => {
    // TestPackOutcome has three members; TestLegOutcome has four. A run claiming the
    // fourth is a run this frontend cannot interpret, and an uninterpretable answer must
    // land on the cautious side rather than be normalised into a neighbour.
    expect(testLegOutcome("not_applicable")).toBe("not_applicable");
    expect(testPackOutcome("not_applicable")).toBe("unrecognised");
  });

  it("matches exactly, after trim and lowercase — never by prefix or substring", () => {
    expect(testPackOutcome("  PASSED  ")).toBe("passed");
    // The delivery manifest exists because `includes("deliver")` matched
    // `undeliverable`. The same mistake here would make "not_passed" a pass.
    expect(testPackOutcome("not_passed")).toBe("unrecognised");
    expect(testPackOutcome("passed_with_notes")).toBe("unrecognised");
    expect(testOutcomeFact("passed_with_notes")).toBeNull();
  });
});

describe("the words are derived from the outcome, in one place", () => {
  it("says the pass sentence only for a real pass", () => {
    const passed = testPackReading("passed");
    expect(passed.notice).toBe(ORIGINAL_DEFECT);
    expect(passed.headline).toBe("Checks passed");
    expect(passed.tone).toBe("ok");
  });

  const MUST_NOT_CLAIM_A_PASS = ["failed", "not_exercised", "not_applicable", "junk", "", null];

  it("covers every non-passing value", () => {
    expect(MUST_NOT_CLAIM_A_PASS).toHaveLength(6);
  });

  MUST_NOT_CLAIM_A_PASS.forEach((raw) => {
    it(`makes no pass claim for ${JSON.stringify(raw)}`, () => {
      const reading = testPackReading(raw);
      const surface = `${reading.headline} ${reading.notice} ${reading.makeLiveTitle}`;
      // Floor first: an empty reading would clear the sweep while saying nothing.
      expect(surface.trim().length).toBeGreaterThan(0);
      expect(passClaimsIn(surface)).toEqual([]);
    });
  });

  it("does not call a run that tested nothing a failure either", () => {
    // Both directions. Telling an operator their checks failed when nothing failed sends
    // them to debug a version that may be perfectly fine.
    const reading = testPackReading("not_exercised");
    expect(reading.tone).toBe("warn");
    expect(reading.headline).not.toMatch(/\bfail(ed|s|ure)?\b/i);
    expect(reading.notice).not.toMatch(/\bfail(ed|s|ure)?\b/i);
  });

  it("tells the operator the one action that clears a run that tested nothing", () => {
    // "Unproven" is only useful if it names what to do. The backend's publish 409 says
    // the same thing, so the two surfaces agree.
    const reading = testPackReading("not_exercised");
    expect(reading.notice).toContain("no orders");
    expect(reading.notice).toContain("Put one order through for this supplier");
    expect(reading.makeLiveTitle).toContain("Put one order through for this supplier");
  });

  it("admits when it cannot read the answer, rather than guessing", () => {
    const reading = testPackReading("something_new");
    expect(reading.outcome).toBe("unrecognised");
    expect(reading.notice).toMatch(/doesn't recognise/);
    expect(reading.tone).toBe("warn");
  });

  it("has a distinct sentence for every outcome, so no two states read alike", () => {
    // Anti-vacuity for the sweeps above: four readings that were all the same string
    // would make no pass claim and tell the operator nothing.
    const notices = ["passed", "failed", "not_exercised", "junk"].map(
      (raw) => testPackReading(raw).notice,
    );
    expect(new Set(notices).size).toBe(4);
  });

  it("keeps 'no evidence at all' separate from every outcome", () => {
    // Never tested is not an outcome. Folding it into one would have this page invent a
    // verdict for a run that never happened.
    const readings = ["passed", "failed", "not_exercised", "junk"].map(
      (raw) => testPackReading(raw).makeLiveTitle,
    );
    expect(readings).not.toContain(MAKE_LIVE_NEEDS_CHECKS_TITLE);
    expect(passClaimsIn(MAKE_LIVE_NEEDS_CHECKS_TITLE)).toEqual([]);
  });
});

describe("each leg's word", () => {
  it("says what the leg did, and never borrows a pass for one that did not run", () => {
    expect(testLegWord("passed")).toBe("passed");
    expect(testLegWord("failed")).toBe("failed");
    expect(testLegWord("not_exercised")).toBe("not run");
    // Not "skipped" — the flag the old payload used, which the pack then spent as a
    // pass. CSV/JSON/XML have no published standard, and no action creates one.
    expect(testLegWord("not_applicable")).toBe("no such check for this setup");
  });

  it("says so when it cannot read the leg", () => {
    expect(testLegWord("who_knows")).toBe("unknown result");
    expect(testLegWord(null)).toBe("unknown result");
  });

  it("never renders a leg word that reads as a pass except for `passed`", () => {
    for (const raw of ["failed", "not_exercised", "not_applicable", "who_knows", null]) {
      expect(passClaimsIn(testLegWord(raw)), `leg word for ${JSON.stringify(raw)}`).toEqual([]);
    }
  });
});
