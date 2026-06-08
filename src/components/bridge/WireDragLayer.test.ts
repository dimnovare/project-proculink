import { describe, it, expect } from "vitest";
import { resolveWireSource } from "./WireDragLayer";

// resolveWireSource decides which canonical node feeds an output line — the logic
// that makes a dragged wire actually RE-ROUTE (the bug was the wire never moving).
describe("resolveWireSource", () => {
  it("defaults to identity when there is no override", () => {
    expect(resolveWireSource("totals", undefined)).toEqual({ sourceNode: "totals", isOverride: false });
    expect(resolveWireSource("po", null)).toEqual({ sourceNode: "po", isOverride: false });
  });

  it("re-points an output line to a different canonical node when overridden", () => {
    // grand_total (totals) re-sourced from Currency → node "currency", flagged as override
    expect(resolveWireSource("totals", "Currency")).toEqual({ sourceNode: "currency", isOverride: true });
    expect(resolveWireSource("buyer", "SupplierName")).toEqual({ sourceNode: "supplier", isOverride: true });
  });

  it("is NOT an override when the canonical equals the line's default source", () => {
    // po ← PoNumber is the identity default, so an explicit same-value rule isn't a re-route
    expect(resolveWireSource("po", "PoNumber")).toEqual({ sourceNode: "po", isOverride: false });
  });

  it("falls back to identity (no re-route) for an unknown canonical field", () => {
    expect(resolveWireSource("date", "NotARealField")).toEqual({ sourceNode: "date", isOverride: false });
  });
});
