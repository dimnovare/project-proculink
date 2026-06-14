import { describe, it, expect } from "vitest";
import { bezier, nearestZone, resolveWireSource, resolveSourceWires } from "./wireMath";

const NODE_TO_CANONICAL = { po: "PoNumber", currency: "Currency" } as const;

describe("resolveWireSource (parameterized node↔canonical map)", () => {
  it("identity when no override", () => {
    expect(resolveWireSource("po", null, NODE_TO_CANONICAL)).toEqual({ sourceNode: "po", isOverride: false });
  });
  it("re-points to the override's canonical node", () => {
    expect(resolveWireSource("po", "Currency", NODE_TO_CANONICAL)).toEqual({ sourceNode: "currency", isOverride: true });
  });
  it("falls back to lineId for an unknown canonical (custom field with no node)", () => {
    expect(resolveWireSource("po", "MadeUp", NODE_TO_CANONICAL)).toEqual({ sourceNode: "po", isOverride: false });
  });
  it("is NOT an override when the canonical equals the line's default source", () => {
    expect(resolveWireSource("po", "PoNumber", NODE_TO_CANONICAL)).toEqual({ sourceNode: "po", isOverride: false });
  });
  it("treats undefined override as identity (parity with null)", () => {
    expect(resolveWireSource("currency", undefined, NODE_TO_CANONICAL)).toEqual({ sourceNode: "currency", isOverride: false });
  });
});

describe("resolveSourceWires (stale-token-safe)", () => {
  it("draws only for tokens that still exist", () => {
    const sourceMap = { PoNumber: { sourceToken: "cell:r1c1", manipulators: [] }, Currency: { sourceToken: "gone", manipulators: [] } };
    const wires = resolveSourceWires(["PoNumber", "Currency"], sourceMap, new Set(["cell:r1c1"]));
    expect(wires).toEqual([{ nodeId: "PoNumber", canonicalField: "PoNumber", tokenId: "cell:r1c1" }]);
  });
  it("returns nothing for a null/absent source map", () => {
    expect(resolveSourceWires(["PoNumber"], null, new Set(["cell:r1c1"]))).toEqual([]);
    expect(resolveSourceWires(["PoNumber"], undefined, new Set(["cell:r1c1"]))).toEqual([]);
  });
  it("ignores a rule with no source token (fixed-value/pass-through)", () => {
    const sourceMap = { PoNumber: { sourceToken: null, manipulators: [] }, Currency: { manipulators: [] } };
    expect(resolveSourceWires(["PoNumber", "Currency"], sourceMap, new Set(["cell:r1c1"]))).toEqual([]);
  });
});

describe("nearestZone (snap)", () => {
  it("returns the zone within SNAP_PX, else null", () => {
    const zones = [{ id: "a", x: 0, y: 0 }, { id: "b", x: 100, y: 0 }];
    expect(nearestZone(zones, 5, 5, 36)).toBe("a");
    expect(nearestZone(zones, 60, 60, 36)).toBeNull();
  });
  it("picks the closer of two in-range zones", () => {
    const zones = [{ id: "a", x: 0, y: 0 }, { id: "b", x: 20, y: 0 }];
    expect(nearestZone(zones, 18, 0, 36)).toBe("b");
    expect(nearestZone(zones, 2, 0, 36)).toBe("a");
  });
  it("returns null for an empty zone list", () => {
    expect(nearestZone([], 0, 0, 36)).toBeNull();
  });
});

describe("bezier", () => {
  it("emits a cubic path with clamped horizontal offset", () => {
    expect(bezier(0, 0, 200, 50)).toMatch(/^M 0 0 C 80 0 120 50 200 50$/);
  });
  it("clamps the offset to a minimum of 24 for short spans", () => {
    // |dx| = 10 → 0.5*10 = 5, clamped up to 24.
    expect(bezier(0, 0, 10, 0)).toBe("M 0 0 C 24 0 -14 0 10 0");
  });
  it("clamps the offset to a maximum of 80 for long spans", () => {
    // |dx| = 400 → 0.5*400 = 200, clamped down to 80.
    expect(bezier(0, 0, 400, 0)).toBe("M 0 0 C 80 0 320 0 400 0");
  });
  it("respects sign for a right-to-left span", () => {
    // dx = -200 → sign -1, offset -80.
    expect(bezier(200, 0, 0, 0)).toBe("M 200 0 C 120 0 80 0 0 0");
  });
});
