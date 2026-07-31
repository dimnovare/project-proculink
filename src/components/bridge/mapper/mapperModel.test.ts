import { describe, it, expect } from "vitest";
import {
  emptyOverride,
  sourceConnections,
  outputConnections,
  fixedValues,
  withSourceConnect,
  withSourceDisconnect,
  withTargetConnect,
  withTargetDisconnect,
  withFixedValue,
  withFieldManipulators,
  withCatalogPrice,
  withAddOutputField,
} from "./mapperModel";
import type { OrderMappingOverride } from "@/lib/api/types";

describe("projections", () => {
  it("sourceConnections projects canonicalField → token id", () => {
    const o: OrderMappingOverride = {
      customFields: [],
      sourceMap: { PoNumber: { sourceToken: "cell:r1c1", manipulators: [] }, Currency: { sourceToken: null, manipulators: [] } },
    };
    expect(sourceConnections(o)).toEqual({ PoNumber: "cell:r1c1" });
  });

  it("outputConnections projects outputPath → canonicalField across both scopes", () => {
    const o: OrderMappingOverride = {
      customFields: [],
      output: {
        header: { ItemCode: { outputPath: "ItemCode", canonicalField: "SupplierItemCode", fieldManipulators: [] } },
        lines: { Qty: { outputPath: "Qty", canonicalField: "Quantity", fieldManipulators: [] } },
      },
    };
    expect(outputConnections(o)).toEqual({ ItemCode: "SupplierItemCode", Qty: "Quantity" });
  });

  it("fixedValues projects only literal (non-canonical) rules", () => {
    const o: OrderMappingOverride = {
      customFields: [],
      output: {
        header: { Region: { outputPath: "Region", canonicalField: null, sourceToken: null, fixedValue: "EU", fieldManipulators: [] } },
        lines: {},
      },
    };
    expect(fixedValues(o)).toEqual({ Region: "EU" });
  });
});

describe("source→canonical mutations (sourceMap preserved)", () => {
  it("withSourceConnect adds a rule and keeps the rest of the document", () => {
    const o: OrderMappingOverride = { customFields: [{ key: "X", label: "X", scope: "header" }], output: null, sourceMap: { Currency: { sourceToken: "c", manipulators: [] } } };
    const next = withSourceConnect(o, "PoNumber", "cell:r1c1");
    expect(next.sourceMap).toEqual({
      Currency: { sourceToken: "c", manipulators: [] },
      PoNumber: { sourceToken: "cell:r1c1", fixedValue: null, manipulators: [] },
    });
    // other sub-docs carried through
    expect(next.customFields).toEqual([{ key: "X", label: "X", scope: "header" }]);
  });

  it("withSourceDisconnect drops only that rule", () => {
    const o = withSourceConnect(withSourceConnect(emptyOverride(), "PoNumber", "t1"), "Currency", "t2");
    const next = withSourceDisconnect(o, "PoNumber");
    expect(next.sourceMap).toEqual({ Currency: { sourceToken: "t2", fixedValue: null, manipulators: [] } });
  });

  it("withSourceDisconnect of the last rule nulls the map", () => {
    const o = withSourceConnect(emptyOverride(), "PoNumber", "t1");
    expect(withSourceDisconnect(o, "PoNumber").sourceMap).toBeNull();
  });
});

// WP-15: every rule writer now goes through outputRuleModel, which seeds a rule with all three
// binding keys present and null rather than absent. The old four-key literals disagreed about
// that — one produced `canonicalField: undefined` where callers compared against null — and the
// same literals were what deleted `expression` and `sourceToken` on every edit.
describe("canonical→target mutations (do NOT clobber sourceMap)", () => {
  const withSrc: OrderMappingOverride = withSourceConnect(emptyOverride(), "PoNumber", "cell:r1c1");

  it("withTargetConnect preserves the existing sourceMap (and lands a LINE canonical in lines scope)", () => {
    const next = withTargetConnect(withSrc, "SupplierItemCode", "ItemCode");
    expect(next.sourceMap).toEqual({ PoNumber: { sourceToken: "cell:r1c1", fixedValue: null, manipulators: [] } });
    // SupplierItemCode is a LINE canonical → the rule lands in the lines scope.
    expect(next.output?.lines.ItemCode).toEqual({ outputPath: "ItemCode", canonicalField: "SupplierItemCode", sourceToken: null, fixedValue: null, fieldManipulators: [] });
  });

  it("a LINE canonical lands a rule in the lines scope", () => {
    const next = withTargetConnect(emptyOverride(), "Quantity", "Qty");
    expect(next.output?.lines.Qty?.canonicalField).toBe("Quantity");
    expect(next.output?.header.Qty).toBeUndefined();
  });

  it("withTargetConnect preserves manipulators on an existing rule", () => {
    const seeded: OrderMappingOverride = {
      customFields: [],
      output: { header: { ItemCode: { outputPath: "ItemCode", canonicalField: "BuyerItemCode", fieldManipulators: [{ type: "Trim", params: [] }] } }, lines: {} },
    };
    const next = withTargetConnect(seeded, "SupplierItemCode", "ItemCode");
    expect(next.output?.header.ItemCode?.fieldManipulators).toEqual([{ type: "Trim", params: [] }]);
    expect(next.output?.header.ItemCode?.canonicalField).toBe("SupplierItemCode");
  });

  it("withTargetDisconnect drops the rule and keeps sourceMap intact", () => {
    const connected = withTargetConnect(withSrc, "SupplierItemCode", "ItemCode");
    const next = withTargetDisconnect(connected, "ItemCode");
    expect(next.output).toBeNull();
    expect(next.sourceMap).toEqual({ PoNumber: { sourceToken: "cell:r1c1", fixedValue: null, manipulators: [] } });
  });
});

describe("fixed values", () => {
  it("withFixedValue sets a literal and clears canonicalField", () => {
    const next = withFixedValue(emptyOverride(), "Region", "EU");
    expect(next.output?.header.Region).toEqual({ outputPath: "Region", canonicalField: null, sourceToken: null, fixedValue: "EU", fieldManipulators: [] });
  });

  it("clearing a plain fixed value drops the rule", () => {
    const set = withFixedValue(emptyOverride(), "Region", "EU");
    expect(withFixedValue(set, "Region", null).output).toBeNull();
  });
});

describe("manipulator chain (Task 9 fx pills, sourceMap preserved)", () => {
  const withSrc: OrderMappingOverride = withSourceConnect(emptyOverride(), "PoNumber", "cell:r1c1");

  it("withFieldManipulators adds an fx chain to a wired output rule and keeps its source", () => {
    const wired = withTargetConnect(withSrc, "SupplierItemCode", "ItemCode");
    const next = withFieldManipulators(wired, "ItemCode", [{ type: "Trim", params: [] }]);
    expect(next.output?.lines.ItemCode?.fieldManipulators).toEqual([{ type: "Trim", params: [] }]);
    expect(next.output?.lines.ItemCode?.canonicalField).toBe("SupplierItemCode");
    expect(next.sourceMap).toEqual({ PoNumber: { sourceToken: "cell:r1c1", fixedValue: null, manipulators: [] } });
  });

  it("withFieldManipulators on a fresh path creates a pass-through rule carrying the chain", () => {
    const next = withFieldManipulators(emptyOverride(), "Notes", [{ type: "Fallback", params: ["n/a"] }]);
    expect(next.output?.header.Notes?.fieldManipulators).toEqual([{ type: "Fallback", params: ["n/a"] }]);
    expect(next.output?.header.Notes?.canonicalField).toBeNull();
  });

  it("withFieldManipulators with an empty chain on an otherwise-default rule drops it", () => {
    const set = withFieldManipulators(emptyOverride(), "Notes", [{ type: "Trim", params: [] }]);
    expect(withFieldManipulators(set, "Notes", []).output).toBeNull();
  });
});

describe("catalog price action (Task 9)", () => {
  it("withCatalogPrice writes the price as a fixed value in the line scope", () => {
    const next = withCatalogPrice(emptyOverride(), "UnitPrice", 12.5);
    expect(next.output?.lines.UnitPrice).toEqual({ outputPath: "UnitPrice", canonicalField: null, sourceToken: null, fixedValue: "12.5", fieldManipulators: [] });
  });
});

describe("withAddOutputField (order can add an output field — outgoing_empty fix)", () => {
  it("adds ONLY the new field — does NOT materialize the spine (merge handles the canonical fields)", () => {
    const current = [
      { outputPath: "PoNumber", scope: "header" as const },
      { outputPath: "SupplierItemCode", scope: "line" as const },
    ];
    const next = withAddOutputField(emptyOverride(), "Credentials", "header", current);
    // The new field is added as a declared, UNMAPPED target.
    //
    // This used to assert `canonicalField: "Credentials"` — a self-referencing pass-through that
    // was inert only because "Credentials" resolves to nothing in the backend row bag. WP-14 made
    // 32 more names resolve, so the same construction turned "add a blank column called ShipToCity"
    // into a column silently pre-filled with the buyer's ship-to city. Declaring a column and
    // binding a source are separate acts by the author; only the second is consent.
    expect(next.output?.header.Credentials).toEqual({ outputPath: "Credentials", canonicalField: null, fixedValue: null, fieldManipulators: [] });
    // …and the canonical spine is NOT materialized into the override (deriveTargetFields(merge)
    // keeps it visible). Only the one added field lands; the rest stay AUTO/byte-identical.
    expect(next.output?.header.PoNumber).toBeUndefined();
    expect(next.output?.lines.SupplierItemCode).toBeUndefined();
    expect(Object.keys(next.output?.header ?? {})).toEqual(["Credentials"]);
  });

  it("does NOT re-materialize the spine when the override already has declared rules", () => {
    const seeded = withTargetConnect(emptyOverride(), "SupplierItemCode", "ItemCode");
    const next = withAddOutputField(seeded, "Notes", "header", [{ outputPath: "ItemCode", scope: "line" }]);
    // only the existing declared rule + the new field — no spine flood
    expect(Object.keys(next.output?.header ?? {})).toEqual(["Notes"]);
    expect(Object.keys(next.output?.lines ?? {})).toEqual(["ItemCode"]);
    expect(next.output?.header.Notes?.outputPath).toBe("Notes");
  });

  it("routes a canonical line-named field into the line scope — from the HINT, not the name", () => {
    // This test used to pass "header" and expect LINE scope, i.e. it asserted that the column's
    // NAME overrides the caller's explicit hint. That is the WP-14 scope defect: a supplier column
    // called DeliveryDate / TaxAmount / Recipient would jump to line scope and repeat per line.
    //
    // Both real callers already pass the right scope — `addCanonical` takes it from
    // systemCanonicalNodes() (UnitPrice is tagged "line" there) and `addCustom` takes it from the
    // author's own choice — so the name heuristic was redundant where it was right and silent where
    // it was wrong.
    const next = withAddOutputField(emptyOverride(), "UnitPrice", "line", []);
    expect(next.output?.lines.UnitPrice?.outputPath).toBe("UnitPrice");
    expect(next.output?.header.UnitPrice).toBeUndefined();

    // The counter-case: an author who deliberately adds a HEADER column named UnitPrice gets one.
    const asHeader = withAddOutputField(emptyOverride(), "UnitPrice", "header", []);
    expect(asHeader.output?.header.UnitPrice?.outputPath).toBe("UnitPrice");
    expect(asHeader.output?.lines.UnitPrice).toBeUndefined();
  });

  it("is a no-op for a blank path and for a duplicate path", () => {
    expect(withAddOutputField(emptyOverride(), "   ", "header", []).output).toBeNull();
    const seeded = withAddOutputField(emptyOverride(), "Foo", "header", []);
    const again = withAddOutputField(seeded, "Foo", "header", []);
    expect(Object.keys(again.output?.header ?? {})).toEqual(["Foo"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// WP-15 · the second half of S1 — this module had the SAME data-loss bug, and it
// is the worse of the two.
//
// `expression` is only authorable from the template editor. `sourceToken` is
// authorable TODAY from the output mapping editor (`OutputMappingEditor.tsx:192`),
// and both screens edit the same mapping-override document for one order. So:
// bind a column to a source token in one screen, add a Trim from the workbench
// transform popover in the other, and the four-key literal dropped the token. The
// rule then survived the `inert` check — it carries a manipulator — and the column
// was bound to nothing, delivering empty. Silent column blanking, for real.
// ─────────────────────────────────────────────────────────────────────────────
describe("rule writers preserve bindings they do not own", () => {
  function seeded() {
    return {
      customFields: [],
      output: {
        header: {},
        lines: {
          ItemCode: {
            outputPath: "ItemCode",
            canonicalField: null,
            sourceToken: "cell:r2c5",
            fixedValue: null,
            expression: "line.Quantity * line.UnitPrice",
            fieldManipulators: [],
          },
        },
      },
    } as unknown as Parameters<typeof withFieldManipulators>[0];
  }

  it("adding a manipulator keeps the sourceToken binding", () => {
    const next = withFieldManipulators(seeded(), "ItemCode", [{ type: "Trim", params: [] }], "line");
    expect(next.output?.lines.ItemCode?.sourceToken).toBe("cell:r2c5");
    expect(next.output?.lines.ItemCode?.expression).toBe("line.Quantity * line.UnitPrice");
  });

  it("a rule bound ONLY by source token is not treated as inert and dropped", () => {
    // Removing the last manipulator leaves a rule with no canonicalField and no
    // fixedValue. It is still bound — by its token — so it must survive.
    const next = withFieldManipulators(seeded(), "ItemCode", [], "line");
    expect(next.output?.lines.ItemCode?.sourceToken).toBe("cell:r2c5");
  });

  it("connecting a canonical field keeps the expression", () => {
    const next = withTargetConnect(seeded(), "SupplierItemCode", "ItemCode");
    const rule = next.output?.lines.ItemCode ?? next.output?.header.ItemCode;
    expect(rule?.expression).toBe("line.Quantity * line.UnitPrice");
    expect(rule?.canonicalField).toBe("SupplierItemCode");
    expect(rule?.sourceToken).toBeNull();
  });

  it("setting a fixed value keeps the expression", () => {
    const next = withFixedValue(seeded(), "ItemCode", "LITERAL", "line");
    const rule = next.output?.lines.ItemCode ?? next.output?.header.ItemCode;
    expect(rule?.expression).toBe("line.Quantity * line.UnitPrice");
    expect(rule?.fixedValue).toBe("LITERAL");
  });
});
