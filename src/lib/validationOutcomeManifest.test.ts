import { describe, it, expect } from "vitest";
import {
  VALIDATION_OUTCOME_FACTS,
  VALIDATION_STATUSES,
  outcomeIsFailure,
  outcomeIsOpenIssue,
  outcomeIsPass,
  outcomeWasNotEvaluated,
  validationOutcome,
  validationStatusFact,
} from "./validationOutcomeManifest";

// The vocabulary guard for acceptance-rule outcomes.
//
// The defect this pins: an acceptance rule has THREE answers, and the frontend encoded
// two. Backend PR 206 added `not_evaluated` for rules that could not run — a
// `line_amount_reconcile` on a document that printed no line amount, the
// absence-tolerant operators on a blank value, an unresolved field path. Those rules
// had been reporting a PASS while being structurally incapable of failing.
//
// Every assertion below is about a value that is NOT "pass" and NOT "fail", because
// that is the whole of the change. A test that only fed pass and fail rows would go
// green against the defective code.

describe("validationOutcomeManifest — the vocabulary", () => {
  it("knows exactly the three statuses the backend can send", () => {
    // An anti-vacuity floor: the walk below cannot shrink to a subset — or to
    // nothing — and keep reporting green.
    expect([...VALIDATION_STATUSES].sort()).toEqual(["fail", "not_evaluated", "pass"]);
    expect(VALIDATION_OUTCOME_FACTS).toHaveLength(3);
  });

  it("gives every row a backend site and a reason, so the copy is checkable", () => {
    for (const fact of VALIDATION_OUTCOME_FACTS) {
      expect(fact.backendSite, `${fact.status} has no backend site`).toMatch(/ProcuLink\./);
      expect(fact.note.length, `${fact.status} has no note`).toBeGreaterThan(20);
    }
  });

  it("resolves each known status to its own outcome", () => {
    expect(validationOutcome("pass")).toBe("pass");
    expect(validationOutcome("fail")).toBe("fail");
    expect(validationOutcome("not_evaluated")).toBe("not_evaluated");
  });

  it("tolerates the casing and padding an open string field can carry", () => {
    expect(validationOutcome("  NOT_EVALUATED  ")).toBe("not_evaluated");
    expect(validationStatusFact(" Pass ")?.outcome).toBe("pass");
  });
});

describe("validationOutcomeManifest — nothing unknown may read as a pass", () => {
  // The standing rule, written down in orderStatusManifest.ts: an unknown answer is
  // "I cannot say", never "carry on". Here that means it must not be countable into a
  // "checks passed" claim.
  const NOT_IN_THE_UNION = [
    "not_evaluated_yet",   // a plausible near-miss for the real value
    "skipped",             // a fourth outcome a later backend PR might add
    "waived",
    "PASSED",              // the English word, not the wire value
    "passing",
    "",
    "   ",
    null,
    undefined,
  ];

  it.each(NOT_IN_THE_UNION)("resolves %j to `unrecognised`", (status) => {
    expect(validationOutcome(status)).toBe("unrecognised");
  });

  it.each(NOT_IN_THE_UNION)("never lets %j claim a pass", (status) => {
    expect(outcomeIsPass(validationOutcome(status))).toBe(false);
  });

  it("surfaces an unrecognised outcome rather than hiding it", () => {
    // Not a pass AND not silently dropped: a row nobody can read is shown to a person.
    expect(outcomeIsOpenIssue("unrecognised")).toBe(true);
    // But it is not asserted to be a real rule failure either — nothing knows that.
    expect(outcomeIsFailure("unrecognised")).toBe(false);
  });
});

describe("validationOutcomeManifest — `not_evaluated` is neither verdict", () => {
  it("is not a pass", () => {
    expect(outcomeIsPass("not_evaluated")).toBe(false);
  });

  it("is not a failure", () => {
    expect(outcomeIsFailure("not_evaluated")).toBe(false);
  });

  it("is not an open issue — a document that stated no line amount is nothing to fix", () => {
    // Matches the backend: GetBlockingFailuresAsync collects only failures, so a rule
    // that could not run must not start refusing orders or filling the fix queue.
    expect(outcomeIsOpenIssue("not_evaluated")).toBe(false);
  });

  it("has its own predicate, so a screen can say what happened in words", () => {
    expect(outcomeWasNotEvaluated("not_evaluated")).toBe(true);
    expect(outcomeWasNotEvaluated("pass")).toBe(false);
    expect(outcomeWasNotEvaluated("fail")).toBe(false);
    expect(outcomeWasNotEvaluated("unrecognised")).toBe(false);
  });
});

describe("validationOutcomeManifest — exactly one outcome may claim a pass", () => {
  it("`outcomeIsPass` is true for `pass` and for nothing else", () => {
    const all = ["pass", "fail", "not_evaluated", "unrecognised"] as const;
    expect(all.filter(outcomeIsPass)).toEqual(["pass"]);
  });

  it("`outcomeIsFailure` is true for `fail` and for nothing else", () => {
    const all = ["pass", "fail", "not_evaluated", "unrecognised"] as const;
    expect(all.filter(outcomeIsFailure)).toEqual(["fail"]);
  });
});
