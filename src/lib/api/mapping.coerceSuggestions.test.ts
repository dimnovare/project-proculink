import { describe, it, expect } from "vitest";
import { coerceSuggestions } from "./mapping";

// Two defaults in this function decided whether the product made an AI claim, and both invented
// one out of a missing field:
//
//   source:     String(o.source ?? "ai")                       → silence became a model
//   confidence: ... : Number(o.confidence) || 0                → silence became 0%
//
// `isModelSuggestion` tests `source === "ai"`, so the first switched on the violet AiSuggestion
// card and the "AI confidence" chip for a response that said nothing about provenance at all.
// The second turned an absent score into a hard 0%, which the confidence ramp paints RED — a
// claim of near-certain wrongness, made from no evidence.
//
// This function is the single normalisation point for the suggest-fields payload, so it is the
// cheapest place to hold both lines still.

const one = (over: Record<string, unknown> = {}) =>
  coerceSuggestions([{ canonicalField: "PoNumber", suggestedColumn: "po_number", ...over }])![0];

describe("coerceSuggestions — an absent field is not evidence", () => {
  it("does NOT attribute an unattributed suggestion to a model", () => {
    const s = one();
    expect(s.source).not.toBe("ai");
    expect(s.source).toBe("unknown");
  });

  it("keeps a stated attribution exactly as sent", () => {
    // Anti-vacuity for the test above: the field is really being read, not hard-coded away.
    expect(one({ source: "ai" }).source).toBe("ai");
    expect(one({ source: "heuristic" }).source).toBe("heuristic");
  });

  it("turns an absent confidence into null, not 0", () => {
    expect(one().confidence).toBeNull();
  });

  it("turns an unparseable confidence into null, not 0", () => {
    expect(one({ confidence: "not a number" }).confidence).toBeNull();
    expect(one({ confidence: null }).confidence).toBeNull();
    expect(one({ confidence: Number.NaN }).confidence).toBeNull();
  });

  it("rejects an out-of-range confidence rather than passing it through", () => {
    // The field is documented 0..1. A 42 here would render as 4200% or tier as green nonsense.
    expect(one({ confidence: 42 }).confidence).toBeNull();
    expect(one({ confidence: -1 }).confidence).toBeNull();
  });

  it("keeps a real confidence, including the boundary values", () => {
    expect(one({ confidence: 0.89 }).confidence).toBe(0.89);
    expect(one({ confidence: 0 }).confidence).toBe(0);
    expect(one({ confidence: 1 }).confidence).toBe(1);
    // A numeric string is still a number the backend meant.
    expect(one({ confidence: "0.75" }).confidence).toBe(0.75);
  });

  it("drops entries with no canonical field, and returns null for a non-array", () => {
    expect(coerceSuggestions([{ suggestedColumn: "x" }])).toEqual([]);
    expect(coerceSuggestions({})).toBeNull();
    expect(coerceSuggestions(null)).toBeNull();
  });
});
