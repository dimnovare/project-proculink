// The invariant that makes OrderWorkshop's advisory-count subtraction correct.
//
// OrderWorkshop derives "non-blocking work the operator may deliberately send
// past" as `failingAcceptanceCount(decision) - acceptanceBlockers.length`. That
// arithmetic is only meaningful because the two helpers read the SAME decision
// differently, and nothing pinned that before: the module shipped with no test
// file, and a mutation forcing the whole advisory count to zero passed all 1676
// tests in the suite.
//
// The asymmetry, stated once so a future edit cannot quietly remove it:
//   • failingAcceptanceCount → blockers.length, ALWAYS.
//   • acceptanceIssues       → [] unless `blocked` is true.
// So a BLOCKED order nets zero (everything it has is blocking and is already in
// `issues`), and an OVERRIDDEN order — blocked:false with blockers still listed —
// nets every blocker. That second case is the only one failingAcceptanceCount is
// ever read in, per its own docstring, and it is exactly what the send
// confirmation asks the operator to acknowledge.
//
// Collapse either half and the override state silently stops being announced:
// the button stops promising an acknowledgement, and the operator meets the
// dialog with no warning.

import { describe, it, expect } from "vitest";
import type { AcceptanceGateDecision } from "@/lib/api/types";
import { acceptanceIssues, failingAcceptanceCount, GATE_UNAVAILABLE_CODE } from "./acceptanceGateModel";

const NOUN = "Supplier";

function decision(over: Partial<AcceptanceGateDecision> = {}): AcceptanceGateDecision {
  return {
    blocked: false,
    reason: null,
    overridden: false,
    overriddenBy: null,
    overrideReason: null,
    blockers: [],
    ...over,
  };
}

const TWO_BLOCKERS = [
  { code: "currency.equals", message: "Currency must be EUR.", lineNumber: null },
  { code: "unitPrice.lte", message: "Unit price above the agreed ceiling.", lineNumber: 3 },
];

/** What OrderWorkshop computes. Mirrors the call site, so the arithmetic is under test. */
function advisoryCount(d: AcceptanceGateDecision | undefined | null): number {
  return Math.max(0, failingAcceptanceCount(d) - acceptanceIssues(d, NOUN).length);
}

describe("failingAcceptanceCount", () => {
  it("counts the blockers whether or not the gate is currently refusing", () => {
    expect(failingAcceptanceCount(decision({ blocked: true, blockers: TWO_BLOCKERS }))).toBe(2);
    expect(
      failingAcceptanceCount(decision({ blocked: false, overridden: true, blockers: TWO_BLOCKERS })),
    ).toBe(2);
  });

  it("is zero for a clear decision, and for no decision at all", () => {
    expect(failingAcceptanceCount(decision())).toBe(0);
    expect(failingAcceptanceCount(undefined)).toBe(0);
    expect(failingAcceptanceCount(null)).toBe(0);
  });
});

describe("acceptanceIssues", () => {
  it("projects blockers only while the gate is REFUSING", () => {
    expect(acceptanceIssues(decision({ blocked: true, blockers: TWO_BLOCKERS }), NOUN)).toHaveLength(2);
  });

  it("projects NOTHING once an override has been recorded, even with blockers listed", () => {
    // Gating an overridden order would claim a block the server does not honour.
    expect(
      acceptanceIssues(decision({ blocked: false, overridden: true, blockers: TWO_BLOCKERS }), NOUN),
    ).toHaveLength(0);
  });

  it("blocks on an unevaluable gate — unknown is not the same as clear", () => {
    const issues = acceptanceIssues(decision(), NOUN, { unavailable: true });
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe(GATE_UNAVAILABLE_CODE);
    expect(issues[0].severity).toBe("blocking");
  });

  it("routes the party noun through the caller's label set, never a hardcoded one", () => {
    const inbound = acceptanceIssues(decision(), "Customer", { unavailable: true });
    expect(inbound[0].title).toContain("customer");
    expect(inbound[0].title).not.toMatch(/supplier/i);
  });
});

describe("the advisory subtraction OrderWorkshop performs", () => {
  it("is ZERO for a blocked order — every failing rule is already an issue", () => {
    expect(advisoryCount(decision({ blocked: true, blockers: TWO_BLOCKERS }))).toBe(0);
  });

  it("is EVERY blocker for an overridden order — the acknowledgement the dialog will ask for", () => {
    expect(
      advisoryCount(decision({ blocked: false, overridden: true, blockers: TWO_BLOCKERS })),
    ).toBe(2);
  });

  it("is zero when nothing failed, and never negative", () => {
    expect(advisoryCount(decision())).toBe(0);
    expect(advisoryCount(undefined)).toBe(0);
  });
});
