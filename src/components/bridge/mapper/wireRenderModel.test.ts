import { describe, it, expect } from "vitest";
import {
  wireDrawDelayMs,
  estimatePathLength,
  isSourceWireEmphasised,
  isTargetWireEmphasised,
  wireOpacity,
} from "./wireRenderModel";

describe("wireDrawDelayMs", () => {
  it("is 0 for the first wire", () => {
    expect(wireDrawDelayMs(0)).toBe(0);
    expect(wireDrawDelayMs(-1)).toBe(0);
  });

  it("ramps by step per index", () => {
    expect(wireDrawDelayMs(1, 38)).toBe(38);
    expect(wireDrawDelayMs(3, 38)).toBe(114);
  });

  it("clamps to the cap so a busy mapping settles quickly", () => {
    expect(wireDrawDelayMs(100, 38, 320)).toBe(320);
  });
});

describe("estimatePathLength", () => {
  it("is at least the chord length (so the dash fully hides the wire)", () => {
    const chord = Math.hypot(300, 40);
    const len = estimatePathLength(0, 0, 300, 40);
    expect(len).toBeGreaterThanOrEqual(chord);
  });

  it("grows with span", () => {
    const short = estimatePathLength(0, 0, 100, 0);
    const long = estimatePathLength(0, 0, 600, 0);
    expect(long).toBeGreaterThan(short);
  });
});

describe("isSourceWireEmphasised", () => {
  const wire = { canonicalField: "PoNumber", tokenId: "cell:r1c2" };

  it("matches on the canonical field (hovering the spine node)", () => {
    expect(isSourceWireEmphasised(wire, "PoNumber")).toBe(true);
  });

  it("matches on the SOURCE TOKEN id (hovering the incoming row) — the founder bug", () => {
    expect(isSourceWireEmphasised(wire, "cell:r1c2")).toBe(true);
  });

  it("does not match an unrelated id", () => {
    expect(isSourceWireEmphasised(wire, "Currency")).toBe(false);
  });

  it("treats null hover as not emphasised", () => {
    expect(isSourceWireEmphasised(wire, null)).toBe(false);
  });
});

describe("isTargetWireEmphasised", () => {
  const wire = { canonicalField: "ItemCode", outputPath: "SupplierSKU" };

  it("matches on the canonical field (spine node hover)", () => {
    expect(isTargetWireEmphasised(wire, "ItemCode")).toBe(true);
  });

  it("matches on the output path (output row hover)", () => {
    expect(isTargetWireEmphasised(wire, "SupplierSKU")).toBe(true);
  });

  it("does not match unrelated or null", () => {
    expect(isTargetWireEmphasised(wire, "PoNumber")).toBe(false);
    expect(isTargetWireEmphasised(wire, null)).toBe(false);
  });
});

describe("wireOpacity", () => {
  it("is resting strength with no hover and no drag", () => {
    // Design-system Phase 2c pixel-spec: the idle wire bundle rests a hair below full so it
    // reads as a calm layer rather than hard black lines. Hover lifts the pointed-at wire to 1.
    expect(wireOpacity({ dragging: false, hovering: false, emphasised: false })).toBe(0.9);
  });

  it("dims everything uniformly during a drag", () => {
    expect(wireOpacity({ dragging: true, hovering: false, emphasised: true })).toBe(0.45);
    expect(wireOpacity({ dragging: true, hovering: true, emphasised: false })).toBe(0.45);
  });

  it("lights the emphasised wire and de-emphasises the rest on hover (but keeps them visible)", () => {
    expect(wireOpacity({ dragging: false, hovering: true, emphasised: true })).toBe(1);
    // De-emphasised, NOT vanished — reaching for a row control must never read as "wire lost".
    expect(wireOpacity({ dragging: false, hovering: true, emphasised: false })).toBe(0.32);
  });

  it("honours custom dim levels", () => {
    expect(
      wireOpacity({ dragging: false, hovering: true, emphasised: false, hoverDimOpacity: 0.2 }),
    ).toBe(0.2);
  });
});
