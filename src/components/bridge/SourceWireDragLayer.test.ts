import { describe, it, expect } from "vitest";
import { resolveSourceWires, NODE_TO_CANONICAL_FIELD } from "./SourceWireDragLayer";

// resolveSourceWires decides which source token feeds each canonical node — the logic
// that makes a dragged source→canonical wire actually RE-ROUTE (the bug to avoid was
// the wire never moving even though the connection "saved").
describe("resolveSourceWires", () => {
  const NODE_IDS = ["po", "date", "buyer", "supplier", "currency", "lines", "totals"];
  const KNOWN = new Set(["cell:r1c1", "cell:r1c2", "cell:r1c3"]);

  it("returns no wires when there is no source map", () => {
    expect(resolveSourceWires(NODE_IDS, undefined, KNOWN)).toEqual([]);
    expect(resolveSourceWires(NODE_IDS, null, KNOWN)).toEqual([]);
    expect(resolveSourceWires(NODE_IDS, {}, KNOWN)).toEqual([]);
  });

  it("draws a wire from a token to the canonical node it now feeds", () => {
    const map = { PoNumber: { sourceToken: "cell:r1c1" } };
    expect(resolveSourceWires(NODE_IDS, map, KNOWN)).toEqual([
      { nodeId: "po", canonicalField: "PoNumber", tokenId: "cell:r1c1" },
    ]);
  });

  it("re-routes when the same field is re-pointed to a different token", () => {
    // Simulates a second drop: PoNumber now sourced from a different cell.
    const before = resolveSourceWires(NODE_IDS, { PoNumber: { sourceToken: "cell:r1c1" } }, KNOWN);
    const after  = resolveSourceWires(NODE_IDS, { PoNumber: { sourceToken: "cell:r1c2" } }, KNOWN);
    expect(before[0].tokenId).toBe("cell:r1c1");
    expect(after[0].tokenId).toBe("cell:r1c2");
    expect(after[0].nodeId).toBe("po");
  });

  it("maps each header field to the right node id", () => {
    const map = {
      PoNumber: { sourceToken: "cell:r1c1" },
      OrderDate: { sourceToken: "cell:r1c2" },
      BuyerName: { sourceToken: "cell:r1c3" },
    };
    const wires = resolveSourceWires(NODE_IDS, map, KNOWN);
    expect(wires.map((w) => `${w.canonicalField}->${w.nodeId}`).sort()).toEqual(
      ["BuyerName->buyer", "OrderDate->date", "PoNumber->po"],
    );
  });

  it("ignores a rule whose token is not in the current file (stale → no dangling wire)", () => {
    const map = { PoNumber: { sourceToken: "cell:r9c9" } }; // not in KNOWN
    expect(resolveSourceWires(NODE_IDS, map, KNOWN)).toEqual([]);
  });

  it("ignores a rule with no source token (fixed-value-only / pass-through)", () => {
    const map = { Currency: { sourceToken: null }, OrderDate: {} as { sourceToken?: string | null } };
    expect(resolveSourceWires(NODE_IDS, map, KNOWN)).toEqual([]);
  });

  it("ignores a source-map key that is not a recognised canonical field", () => {
    const map = { NotAField: { sourceToken: "cell:r1c1" } };
    expect(resolveSourceWires(NODE_IDS, map, KNOWN)).toEqual([]);
  });

  it("only emits wires for nodes actually on screen", () => {
    const map = {
      PoNumber: { sourceToken: "cell:r1c1" },
      Currency: { sourceToken: "cell:r1c3" },
    };
    // "currency" node not rendered → its wire is dropped.
    const wires = resolveSourceWires(["po", "date"], map, KNOWN);
    expect(wires).toEqual([{ nodeId: "po", canonicalField: "PoNumber", tokenId: "cell:r1c1" }]);
  });

  it("exposes a node→canonical map covering all triptych nodes", () => {
    expect(NODE_TO_CANONICAL_FIELD).toMatchObject({
      po: "PoNumber", date: "OrderDate", buyer: "BuyerName",
      supplier: "SupplierName", currency: "Currency",
      lines: "LineNumber", totals: "LineTotal",
    });
  });
});
