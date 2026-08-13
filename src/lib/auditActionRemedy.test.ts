import { describe, it, expect } from "vitest";
import {
  ACTIONS_OWED_A_REMEDY,
  REACH_SENTENCE,
  auditActionRemedy,
  type FailureReach,
} from "./auditActionRemedy";
import { AUDIT_ACTION_FACTS, auditActionFact } from "./auditActionManifest";

// The remedy table's completeness is DERIVED from the manifest, never re-listed
// here. A `failed` or `held` action added to AUDIT_ACTION_FACTS with no remedy
// fails this file — which is the point: the decision "what should an operator do
// about this?" is forced at the moment the event becomes renderable, rather than
// defaulting to silence on the one screen that exists to answer it.
//
// Every sweep below carries a floor. `all()` over an empty set is true, and a
// coverage test that stopped finding any actions would otherwise report success
// for a table that had become empty.

describe("remedy coverage is derived from the manifest", () => {
  it("floor: the manifest really yields failing and held actions to cover", () => {
    expect(ACTIONS_OWED_A_REMEDY.length).toBeGreaterThanOrEqual(15);
    // Both kinds must be represented, or a regression that dropped one whole kind
    // would still satisfy a plain non-empty check.
    const kinds = new Set(ACTIONS_OWED_A_REMEDY.map((a) => auditActionFact(a)?.kind));
    expect(kinds.has("failed")).toBe(true);
    expect(kinds.has("held")).toBe(true);
  });

  it("every failed or held action has a remedy", () => {
    const missing = ACTIONS_OWED_A_REMEDY.filter((a) => auditActionRemedy(a) === null);
    expect(missing).toEqual([]);
  });

  it("no success, recovery or creation event gains a remedy", () => {
    // The mirror of the manifest's own scope rule for `reasonKeys`. "What do I do
    // now?" is a question a stopped order raises; a completed one does not.
    const notOwed = AUDIT_ACTION_FACTS.filter((f) => f.kind !== "failed" && f.kind !== "held");
    // Floor: there really are non-failure actions to check.
    expect(notOwed.length).toBeGreaterThan(10);
    const wrongly = notOwed.filter((f) => auditActionRemedy(f.action) !== null);
    expect(wrongly.map((f) => f.action)).toEqual([]);
  });

  it("an action this build has never heard of gets no invented next step", () => {
    for (const stranger of ["Escalated", "DeliveryVaporised", "", "   ", null, undefined]) {
      expect(auditActionRemedy(stranger)).toBeNull();
    }
  });

  it("resolves an action whatever its casing, like the manifest does", () => {
    const withRemedy = ACTIONS_OWED_A_REMEDY[0];
    expect(auditActionRemedy(withRemedy)).not.toBeNull();
    expect(auditActionRemedy(withRemedy.toLowerCase())).not.toBeNull();
    expect(auditActionRemedy(withRemedy.toUpperCase())).not.toBeNull();
  });
});

describe("remedy copy tells the truth about how far the order got", () => {
  it("every reach has a sentence, and every remedy names a known reach", () => {
    const reaches = Object.keys(REACH_SENTENCE) as FailureReach[];
    expect(reaches.length).toBe(4);
    for (const r of reaches) expect(REACH_SENTENCE[r].length).toBeGreaterThan(20);

    let checked = 0;
    for (const action of ACTIONS_OWED_A_REMEDY) {
      const remedy = auditActionRemedy(action);
      expect(remedy).not.toBeNull();
      expect(reaches).toContain(remedy!.reach);
      checked += 1;
    }
    expect(checked).toBe(ACTIONS_OWED_A_REMEDY.length);
  });

  it("uses all four reaches — the shapes are genuinely distinguished", () => {
    // If every failure resolved to one reach, the panel would be back to making
    // all four shapes look the same, which is the defect this module exists for.
    const used = new Set(ACTIONS_OWED_A_REMEDY.map((a) => auditActionRemedy(a)!.reach));
    expect(used.size).toBe(4);
  });

  it("a refusal that never left the building is never blamed on the supplier", () => {
    let checked = 0;
    for (const action of ACTIONS_OWED_A_REMEDY) {
      const remedy = auditActionRemedy(action)!;
      if (remedy.reach !== "before_send") continue;
      // The supplier never saw this order, so no remedy may send the operator to
      // chase them about it.
      expect(remedy.next).not.toMatch(/ask the supplier|contact the supplier|supplier's reply/i);
      checked += 1;
    }
    // Floor: there really are before_send actions, or the loop asserted nothing.
    expect(checked).toBeGreaterThan(3);
  });

  it("never tells the operator to resend something that would be refused identically", () => {
    // The rule src/test/statusVocabulary.test.ts already enforces on the exception
    // detail sentences. A supplier's business rejection is deterministic: the same
    // file gets the same answer, so "try again" is advice that wastes a person's
    // afternoon.
    const rejection = auditActionRemedy("MarkedRejected");
    expect(rejection).not.toBeNull();
    expect(rejection!.next).toMatch(/corrected order/i);
    expect(rejection!.next).not.toMatch(/^try again|send it again\b(?!.*corrected)/i);
  });

  it("an unconfirmed delivery warns about duplicates instead of offering a resend", () => {
    // A second copy at the supplier is a worse outcome than an unanswered
    // question, so this one shape must not read like the others.
    const unknown = auditActionRemedy("DeliveryUnconfirmed");
    expect(unknown).not.toBeNull();
    expect(unknown!.reach).toBe("unknown_send");
    expect(unknown!.next).toMatch(/duplicate/i);
    expect(unknown!.next).toMatch(/ask the supplier/i);
  });

  it("a billing hold points at billing, not at the order or the supplier", () => {
    const held = auditActionRemedy("DeliveryHeldForBilling");
    expect(held).not.toBeNull();
    expect(held!.reach).toBe("paused");
    expect(held!.next).toMatch(/plan|payment/i);
  });

  it("uses no raw engine tokens, GUIDs or bare status codes in operator copy", () => {
    let checked = 0;
    for (const action of ACTIONS_OWED_A_REMEDY) {
      const { next } = auditActionRemedy(action)!;
      expect(next).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i); // GUID
      expect(next).not.toMatch(/\b(dead[- ]?letter|hangfire|jsonb|enqueue|payload)\b/i);
      expect(next).not.toMatch(/\bHTTP \d{3}\b/);
      expect(next).not.toMatch(/_[a-z]+_/); // snake_case engine slug
      // A remedy is an instruction: it must be a sentence, not a fragment.
      expect(next.length).toBeGreaterThan(25);
      expect(next.trimEnd().endsWith(".")).toBe(true);
      checked += 1;
    }
    expect(checked).toBe(ACTIONS_OWED_A_REMEDY.length);
  });
});
