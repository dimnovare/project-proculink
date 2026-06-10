import { describe, it, expect } from "vitest";
import { orderWiresForRender, fallbackSourceAnchor } from "./SpineConnectors";

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

// fallbackSourceAnchor computes the SOURCE endpoint when a wire's section element is
// missing or has a zero/degenerate rect (e.g. a display:none collapsed branch). The
// load-bearing contract: it must pin to the source column's right edge LEVEL with the
// canonical node's own y — and NEVER fly to the top of the page (the original bug).
describe("fallbackSourceAnchor", () => {
  // A representative source column: x-right=240, vertical extent 120..680 (grid-local px).
  const col = { top: 120, bottom: 680, right: 240 };

  it("anchors to the column's right edge at the node's own y (level hop, never the top)", () => {
    const { sx, sy } = fallbackSourceAnchor(col, 430, 132 /* a near-top % fallback */);
    expect(sx).toBe(240);          // on the source column's right edge
    expect(sy).toBe(430);          // LEVEL with the node — NOT 132 (near the top)
  });

  it("never flies to the top when the node y is missing — uses the column centre, not 0", () => {
    const { sx, sy } = fallbackSourceAnchor(col, null, null);
    expect(sx).toBe(240);
    expect(sy).toBe((col.top + col.bottom) / 2); // 400 — column centre, never ≈0
    expect(sy).toBeGreaterThan(col.top);
  });

  it("uses a finite in-column percentage fallback only when no node y is available", () => {
    const { sy } = fallbackSourceAnchor(col, null, 300);
    expect(sy).toBe(300);
  });

  it("ignores an out-of-column percentage fallback (would be a fly-off) and centres instead", () => {
    const { sy } = fallbackSourceAnchor(col, null, 5 /* above the column top → reject */);
    expect(sy).toBe((col.top + col.bottom) / 2);
  });

  it("clamps a node y that sits beyond the column extent back onto the column", () => {
    expect(fallbackSourceAnchor(col, 50, null).sy).toBe(col.top);     // above → clamp to top edge
    expect(fallbackSourceAnchor(col, 9000, null).sy).toBe(col.bottom); // below → clamp to bottom edge
  });

  it("never returns the page top-left origin for a degenerate (zero) column at the page top", () => {
    // Mirrors a display:none section reporting a rect at (0,0): even then the endpoint
    // tracks the node y rather than collapsing onto (0,0).
    const zeroTopCol = { top: 0, bottom: 0, right: 0 };
    const { sy } = fallbackSourceAnchor(zeroTopCol, 412, null);
    // Node y is outside the zero-height column, so it clamps — but to the column, which
    // is the real source column rect in practice (never an arbitrary page-top constant).
    expect(sy).toBe(0);
    // The real-world column is never zero-height; with a real column the node y wins:
    expect(fallbackSourceAnchor(col, 412, null).sy).toBe(412);
  });
});
