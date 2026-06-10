import { describe, it, expect } from "vitest";
import { orderWiresForRender } from "./SpineConnectors";

// orderWiresForRender decides the PAINT order of the decorative source→canonical
// wires given the hovered canonical node id. The hover highlight is keyed on the
// UNIQUE node id (w.id); the hovered wire is moved LAST so it always paints on top
// of any overlapping dimmed wire (PO + Order date share the "header-meta" source
// anchor, so their paths overlap — the previous behaviour let the dimmed one grey
// out the highlighted one).
describe("orderWiresForRender", () => {
  const wires = [
    { id: "po" },
    { id: "date" },
    { id: "buyer" },
    { id: "supplier" },
  ];

  it("keeps the natural order (with original indices) when nothing is hovered", () => {
    expect(orderWiresForRender(wires, null)).toEqual([
      { wire: { id: "po" }, oi: 0 },
      { wire: { id: "date" }, oi: 1 },
      { wire: { id: "buyer" }, oi: 2 },
      { wire: { id: "supplier" }, oi: 3 },
    ]);
  });

  it("moves the hovered wire LAST so it paints on top — by its UNIQUE node id", () => {
    // Hovering ORDER DATE must surface the DATE wire last, NOT PO's (the regression:
    // PO + date share srcRef "header-meta", and the highlight had been clobbered to PO).
    const ordered = orderWiresForRender(wires, "date");
    expect(ordered.map((w) => w.wire.id)).toEqual(["po", "buyer", "supplier", "date"]);
    // Original index is preserved for stable per-wire animation timing.
    expect(ordered[ordered.length - 1]).toEqual({ wire: { id: "date" }, oi: 1 });
  });

  it("paints the hovered PO wire last too (symmetry — same source anchor)", () => {
    const ordered = orderWiresForRender(wires, "po");
    expect(ordered.map((w) => w.wire.id)).toEqual(["date", "buyer", "supplier", "po"]);
  });

  it("preserves the relative order of the non-hovered wires (stable partition)", () => {
    const ordered = orderWiresForRender(wires, "buyer");
    expect(ordered.map((w) => w.wire.id)).toEqual(["po", "date", "supplier", "buyer"]);
  });

  it("is a no-op ordering when the hovered id matches nothing on screen", () => {
    const ordered = orderWiresForRender(wires, "totals");
    expect(ordered.map((w) => w.wire.id)).toEqual(["po", "date", "buyer", "supplier"]);
  });
});
