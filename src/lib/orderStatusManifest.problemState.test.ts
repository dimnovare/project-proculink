import { describe, it, expect } from "vitest";
import {
  ORDER_STATUS_FACTS,
  PROBLEM_BUCKET_STATUSES,
  REACHABLE_STATUSES,
  isProblemBucketStatus,
  orderProblemState,
  statusFact,
} from "./orderStatusManifest";

// `isProblemBucketStatus` is safe to READ and unsafe to NEGATE, and nothing in the type
// system says so. It answers false both for "this order is healthy" and for "I have never
// heard of this status", which is fine while the caller is asking "may I offer a recovery
// action here?" — the answer is no either way. Negate it and the two collapse the wrong
// way round: `!isProblemBucketStatus(unknown)` is `true`, an all-clear asserted about a
// status the build cannot read. The order review screen did exactly that and drew a green
// tick with "Nothing to fix".
//
// `orderProblemState` is the same question with the third answer kept. It returns a string
// union rather than a boolean specifically so the collapse cannot be written: there is no
// `!` that turns "unknown" into "clear", and a caller that forgets the arm fails to compile
// against a three-armed prop.
//
// The walks below iterate the manifest instead of a list typed into this file — WP-36
// exists because nine hand-copied status lists drifted from the backend and from each
// other, and a tenth here would go stale the first time a status is added.

/** Statuses no ORDER_STATUS_FACTS row names. Shaped like real backend additions. */
const NOT_IN_MANIFEST = [
  "awaiting_supplier_ack",
  "delivery_deferred",
  "queued_for_retry",
  "",
];

describe("orderProblemState — the third answer", () => {
  it("has statuses of both kinds to walk", () => {
    // Anti-vacuity floor. An empty manifest, or one with no healthy statuses, would let
    // every assertion below pass while testing nothing.
    expect(ORDER_STATUS_FACTS.length).toBeGreaterThan(0);
    expect(PROBLEM_BUCKET_STATUSES.length).toBeGreaterThan(0);
    expect(REACHABLE_STATUSES.filter((s) => !isProblemBucketStatus(s)).length).toBeGreaterThan(0);
  });

  it.each([...PROBLEM_BUCKET_STATUSES])("answers 'problem' for %s", (status) => {
    expect(orderProblemState(status)).toBe("problem");
  });

  it.each(REACHABLE_STATUSES.filter((s) => !isProblemBucketStatus(s)))(
    "answers 'clear' for the healthy status %s",
    (status) => {
      expect(orderProblemState(status)).toBe("clear");
    },
  );

  it.each(NOT_IN_MANIFEST)("answers 'unknown' for %j, which the manifest does not name", (status) => {
    // The precondition matters as much as the assertion: if one of these is ever added to
    // the manifest, this test must fail rather than quietly stop testing unknowns.
    expect(statusFact(status)).toBeNull();
    expect(orderProblemState(status)).toBe("unknown");
  });

  it.each([null, undefined])("answers 'unknown' for %j", (status) => {
    expect(orderProblemState(status)).toBe("unknown");
  });

  it("never answers 'clear' for a status it cannot find", () => {
    // The defect, stated as the property that was violated. `isProblemBucketStatus` says
    // false for all four of these; only one of the two functions can be safely negated.
    for (const status of NOT_IN_MANIFEST) {
      expect(isProblemBucketStatus(status)).toBe(false);
      expect(orderProblemState(status)).not.toBe("clear");
    }
  });

  it("agrees with isProblemBucketStatus wherever that predicate is meaningful", () => {
    // Not a redefinition of the fixed function in terms of the broken one: this only
    // asserts the two agree on statuses the manifest KNOWS, which is the whole range over
    // which the boolean carries information.
    for (const fact of ORDER_STATUS_FACTS) {
      const expected = isProblemBucketStatus(fact.status) ? "problem" : "clear";
      expect(orderProblemState(fact.status)).toBe(expected);
    }
  });
});
