import { describe, it, expect } from "vitest";
import { pickConnectTarget, type WireBank } from "./mapperWireDispatch";
import type { Pt } from "./wireMath";

const canonicalZones: Pt[] = [
  { id: "PoNumber", x: 100, y: 10 },
  { id: "Currency", x: 100, y: 50 },
];
const targetZones: Pt[] = [
  { id: "out_code", x: 200, y: 10 },
  { id: "out_qty", x: 200, y: 50 },
];

describe("pickConnectTarget — bank-aware drag routing", () => {
  it("a SOURCE-bank drag snaps to the nearest CANONICAL zone (source→canonical)", () => {
    const r = pickConnectTarget("source", { x: 102, y: 12 }, canonicalZones, targetZones, 36);
    expect(r).toEqual({ kind: "source", from: undefined, to: "PoNumber" });
  });

  it("a CANONICAL-bank drag snaps to the nearest TARGET zone (canonical→target)", () => {
    const r = pickConnectTarget("canonical", { x: 198, y: 48 }, canonicalZones, targetZones, 36);
    expect(r).toEqual({ kind: "target", from: undefined, to: "out_qty" });
  });

  it("returns null when nothing is within snap range", () => {
    expect(pickConnectTarget("source", { x: 500, y: 500 }, canonicalZones, targetZones, 36)).toBeNull();
    expect(pickConnectTarget("canonical", { x: 500, y: 500 }, canonicalZones, targetZones, 36)).toBeNull();
  });

  it("carries the drag's source id through as `from`", () => {
    const bank: WireBank = "source";
    const r = pickConnectTarget(bank, { x: 100, y: 10, sourceId: "cell:r1c1" }, canonicalZones, targetZones, 36);
    expect(r).toEqual({ kind: "source", from: "cell:r1c1", to: "PoNumber" });
  });

  it("a canonical-bank drag never targets a canonical zone (only the target bank)", () => {
    // A point that is closest to a canonical zone but originated in the canonical bank
    // must still only resolve against TARGET zones — it cannot wire canonical→canonical.
    const r = pickConnectTarget("canonical", { x: 100, y: 10, sourceId: "PoNumber" }, canonicalZones, targetZones, 36);
    expect(r).toBeNull();
  });
});
