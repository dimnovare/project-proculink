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
import {
  acceptanceIssues,
  confirmAckLabel,
  failingAcceptanceCount,
  readyBarLabel,
  statusChipTitle,
  CHECK_SCOPE_SENTENCE,
  GATE_UNAVAILABLE_CODE,
} from "./acceptanceGateModel";

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

// ── readyBarLabel (P0-B) ─────────────────────────────────────────────────────
// The green bar used to render IssuesPanel's hardcoded default, "No open issues —
// every required field is filled and checked.", because `readyLabel` had no
// producer in src/. "and checked" named a check nothing ran: the only rule-level
// check is POST /api/orders/{id}/validate, which has no caller.

describe("readyBarLabel — the sub-line under the green Ready to send bar", () => {
  it("never claims a field was CHECKED", () => {
    for (const advisoryCountValue of [0, 1, 2, 7]) {
      for (const noun of ["Supplier", "Customer"]) {
        const label = readyBarLabel({ advisoryCount: advisoryCountValue, counterpartyNoun: noun });
        expect(label, `advisoryCount=${advisoryCountValue} noun=${noun}`).not.toMatch(
          /filled and checked/,
        );
        expect(label).not.toBe("No open issues — every required field is filled and checked.");
        // Every branch keeps the true half, which two help guides and
        // issuesRailFailureState.test.tsx both key off.
        expect(label).toMatch(/^No open issues/);
      }
    }
  });

  it("bounds the claim when nothing is outstanding", () => {
    const label = readyBarLabel({ advisoryCount: 0, counterpartyNoun: "Supplier" });
    expect(label).toContain("everything ProcuLink can check before sending");
    expect(label).toContain("not a guarantee that the supplier will accept the order");
  });

  it("names the overridden rules the send control is already counting", () => {
    expect(readyBarLabel({ advisoryCount: 1, counterpartyNoun: "Supplier" })).toContain(
      "1 supplier rule did not pass and was overridden",
    );
    expect(readyBarLabel({ advisoryCount: 3, counterpartyNoun: "Supplier" })).toContain(
      "3 supplier rules did not pass and were overridden",
    );
  });

  it("routes the party noun, so an inbound org never reads 'supplier'", () => {
    for (const advisoryCountValue of [0, 2]) {
      const label = readyBarLabel({ advisoryCount: advisoryCountValue, counterpartyNoun: "Customer" });
      expect(label).toContain("customer");
      expect(label).not.toMatch(/supplier/i);
    }
  });

  it("says something different in each state — a constant would defeat the fix", () => {
    const clean = readyBarLabel({ advisoryCount: 0, counterpartyNoun: "Supplier" });
    const advisory = readyBarLabel({ advisoryCount: 2, counterpartyNoun: "Supplier" });
    expect(clean).not.toBe(advisory);
  });

  it("draws its scope sentence from the shared constant, so a fourth copy cannot drift", () => {
    expect(readyBarLabel({ advisoryCount: 0, counterpartyNoun: "Supplier" })).toContain(
      CHECK_SCOPE_SENTENCE,
    );
    expect(statusChipTitle({ noteCount: 0 })).toContain(CHECK_SCOPE_SENTENCE);
  });
});

// ── statusChipTitle ──────────────────────────────────────────────────────────
// The WorkshopStatusBar summary chip carried a STRONGER version of the sentence
// readyBarLabel had already retired, on the same screen and off the same two
// numbers: "Every required field is filled and every rule passed." Both halves
// are unsupported — no rule-level check runs (validate has no caller in src/),
// and the decision carries no signal for whether an acceptance profile exists at
// all, so "no rules" is indistinguishable from "every rule passed".

describe("statusChipTitle — the zero-blocker chip tooltip", () => {
  it("never claims a rule passed, and never claims a field was CHECKED", () => {
    for (const noteCount of [0, 1, 2, 7]) {
      const title = statusChipTitle({ noteCount });
      expect(title, `noteCount=${noteCount}`).not.toMatch(/every rule passed/i);
      expect(title, `noteCount=${noteCount}`).not.toMatch(/filled and check/i);
      expect(title).not.toBe("Every required field is filled and every rule passed.");
    }
  });

  it("bounds the claim to what ProcuLink actually looked at when nothing is outstanding", () => {
    const title = statusChipTitle({ noteCount: 0 });
    expect(title).toBe(
      "Nothing is blocking this order. This is everything ProcuLink can check before sending.",
    );
  });

  it("keeps the warnings-only wording untouched — that sentence was already true", () => {
    expect(statusChipTitle({ noteCount: 2 })).toBe(
      "Nothing is blocking this order. These are worth a look before you send.",
    );
  });

  it("says something different in each state — a constant would defeat the fix", () => {
    expect(statusChipTitle({ noteCount: 0 })).not.toBe(statusChipTitle({ noteCount: 1 }));
  });
});

// ── confirmAckLabel ──────────────────────────────────────────────────────────
// The consent step for an irreversible action. Its zero-exception arm read
// "Everything checks out." off exceptionCount ALONE, so an order with zero
// exceptions and N failed acceptance rules rendered that sentence directly above
// the dialog panel reading "N acceptance rules failed validation".

describe("confirmAckLabel — the send-confirmation checkbox", () => {
  const SEND = "Send to BoltWorks BV";

  it("never says everything checks out, in any combination of the two counts", () => {
    for (const exceptionCount of [0, 1, 3]) {
      for (const failingRuleCount of [0, 1, 4]) {
        const label = confirmAckLabel({ exceptionCount, failingRuleCount, actionPhrase: SEND });
        expect(label, `${exceptionCount}/${failingRuleCount}`).not.toMatch(/everything checks out/i);
        // Anti-vacuity: the checkbox must still have a readable label in every
        // one of those nine states, and must still name the action.
        expect(label).toContain(SEND);
      }
    }
  });

  it("bounds the clean case to the issue list it actually read", () => {
    expect(confirmAckLabel({ exceptionCount: 0, failingRuleCount: 0, actionPhrase: SEND })).toBe(
      `No open issues to review. ${SEND}.`,
    );
  });

  it("THE CONTRADICTION CASE: zero exceptions with failing rules claims nothing at all", () => {
    // The panel eighteen lines below says "2 acceptance rules failed validation"
    // and takes its own acknowledgement. This label may not answer it.
    const label = confirmAckLabel({ exceptionCount: 0, failingRuleCount: 2, actionPhrase: SEND });
    expect(label).toBe(`${SEND}.`);
    expect(label).not.toMatch(/no open issues/i);
    expect(label).not.toMatch(/everything checks out/i);
  });

  it("keeps the reviewed-N-issues arm, with its grammar, when exceptions exist", () => {
    expect(confirmAckLabel({ exceptionCount: 1, failingRuleCount: 0, actionPhrase: SEND })).toBe(
      `I've reviewed the 1 issue. ${SEND}.`,
    );
    expect(confirmAckLabel({ exceptionCount: 3, failingRuleCount: 0, actionPhrase: SEND })).toBe(
      `I've reviewed the 3 issues. ${SEND}.`,
    );
  });

  it("routes the action phrase, so an inbound org never reads 'Send'", () => {
    const inbound = confirmAckLabel({
      exceptionCount: 0,
      failingRuleCount: 0,
      actionPhrase: "Confirm for BoltWorks BV",
    });
    expect(inbound).toContain("Confirm for BoltWorks BV");
    expect(inbound).not.toMatch(/send/i);
  });
});
