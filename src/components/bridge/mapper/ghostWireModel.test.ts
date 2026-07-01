import { describe, it, expect } from "vitest";
import {
  ghostConfidenceTier,
  ghostTierColor,
  ghostConfidencePercent,
  suggestionKey,
} from "./ghostWireModel";

describe("ghostConfidenceTier (0..1, plan thresholds .85/.60)", () => {
  it("ok at and above 0.85", () => {
    expect(ghostConfidenceTier(0.85)).toBe("ok");
    expect(ghostConfidenceTier(0.99)).toBe("ok");
  });
  it("warn in [0.60, 0.85)", () => {
    expect(ghostConfidenceTier(0.6)).toBe("warn");
    expect(ghostConfidenceTier(0.84)).toBe("warn");
  });
  it("danger below 0.60", () => {
    expect(ghostConfidenceTier(0.59)).toBe("danger");
    expect(ghostConfidenceTier(0)).toBe("danger");
  });
});

describe("ghostTierColor", () => {
  it("maps each tier to a locked token color", () => {
    expect(ghostTierColor("ok")).toBe("#2E8E3A");
    expect(ghostTierColor("warn")).toBe("#B36D14");
    expect(ghostTierColor("danger")).toBe("#C0392B");
  });
});

describe("ghostConfidencePercent", () => {
  it("rounds a 0..1 score to a whole percent", () => {
    expect(ghostConfidencePercent(0.872)).toBe(87);
    expect(ghostConfidencePercent(0.5)).toBe(50);
  });
  it("clamps out-of-range input", () => {
    expect(ghostConfidencePercent(1.4)).toBe(100);
    expect(ghostConfidencePercent(-0.2)).toBe(0);
  });
});

describe("suggestionKey", () => {
  it("matches the model dismissal key shape targetKey<-sourceId", () => {
    expect(suggestionKey({ targetKey: "SupplierItemCode", sourceId: "cell:r1c2" }))
      .toBe("SupplierItemCode<-cell:r1c2");
  });
});
