// The rollout rule, pinned. `GET /api/orders/{id}/mapping-suggestions` sent a hard-coded
// `confidence: 0.95` for every saved-mapping entry; it now sends `null` + `basis`. During the
// rollout both shapes are on the wire, and the ONE thing that must never happen in either is a
// missing confidence turning into a number.

import { describe, it, expect } from "vitest";
import { resolveSuggestionBasis, suggestionConfidenceDisplay } from "./suggestionBasisModel";

describe("resolveSuggestionBasis", () => {
  it("believes an explicit basis in both directions", () => {
    expect(resolveSuggestionBasis("saved_mapping", null)).toBe("saved_mapping");
    expect(resolveSuggestionBasis("model", 0.86)).toBe("model");
  });

  it("believes an explicit saved_mapping even when a stale number came with it", () => {
    // The 0.95 IS the defect. A backend still sending it alongside the new basis must not
    // win the argument.
    expect(resolveSuggestionBasis("saved_mapping", 0.95)).toBe("saved_mapping");
  });

  it("treats an absent basis as model ONLY when a real number came with it", () => {
    expect(resolveSuggestionBasis(undefined, 0.86)).toBe("model");
    expect(resolveSuggestionBasis(null, 0.86)).toBe("model");
  });

  it("treats an absent basis with no number as a saved mapping", () => {
    expect(resolveSuggestionBasis(undefined, null)).toBe("saved_mapping");
    expect(resolveSuggestionBasis(undefined, undefined)).toBe("saved_mapping");
  });

  it("does not accept NaN as a score", () => {
    expect(resolveSuggestionBasis(undefined, Number.NaN)).toBe("saved_mapping");
  });

  it("accepts 0 as a score — a zero is a measurement, not an absence", () => {
    expect(resolveSuggestionBasis(undefined, 0)).toBe("model");
  });
});

describe("suggestionConfidenceDisplay", () => {
  it("shows a score only for a scored model suggestion", () => {
    expect(suggestionConfidenceDisplay("model", 0.86)).toBe("score");
    expect(suggestionConfidenceDisplay(undefined, 0.86)).toBe("score");
  });

  it("shows the saved-mapping marker for a null confidence", () => {
    expect(suggestionConfidenceDisplay("saved_mapping", null)).toBe("saved_mapping");
    expect(suggestionConfidenceDisplay(undefined, null)).toBe("saved_mapping");
  });

  it("never shows a score for a saved mapping, even with a stale number attached", () => {
    expect(suggestionConfidenceDisplay("saved_mapping", 0.95)).toBe("saved_mapping");
  });

  it("shows nothing when a suggestion claims a model but carries no number", () => {
    // Contradictory data. Neither "95%" nor "Saved mapping" would be true, so neither renders.
    expect(suggestionConfidenceDisplay("model", null)).toBe("none");
  });
});
