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
        header: { Region: { outputPath: "Region", canonicalField: null, fixedValue: "EU", fieldManipulators: [] } },
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

describe("canonical→target mutations (do NOT clobber sourceMap)", () => {
  const withSrc: OrderMappingOverride = withSourceConnect(emptyOverride(), "PoNumber", "cell:r1c1");

  it("withTargetConnect preserves the existing sourceMap (and lands a LINE canonical in lines scope)", () => {
    const next = withTargetConnect(withSrc, "SupplierItemCode", "ItemCode");
    expect(next.sourceMap).toEqual({ PoNumber: { sourceToken: "cell:r1c1", fixedValue: null, manipulators: [] } });
    // SupplierItemCode is a LINE canonical → the rule lands in the lines scope.
    expect(next.output?.lines.ItemCode).toEqual({ outputPath: "ItemCode", canonicalField: "SupplierItemCode", fixedValue: null, fieldManipulators: [] });
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
    expect(next.output?.header.Region).toEqual({ outputPath: "Region", canonicalField: null, fixedValue: "EU", fieldManipulators: [] });
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
    expect(next.output?.lines.UnitPrice).toEqual({ outputPath: "UnitPrice", canonicalField: null, fixedValue: "12.5", fieldManipulators: [] });
  });
});

describe("withAddOutputField (order can add an output field — outgoing_empty fix)", () => {
  it("materializes the current spine as pass-through rules then adds the new field when output was empty", () => {
    const current = [
      { outputPath: "PoNumber", scope: "header" as const },
      { outputPath: "SupplierItemCode", scope: "line" as const },
    ];
    const next = withAddOutputField(emptyOverride(), "Credentials", "header", current);
    // existing spine paths kept as pass-through rules so the lane doesn't collapse to one field
    expect(next.output?.header.PoNumber).toEqual({ outputPath: "PoNumber", canonicalField: "PoNumber", fixedValue: null, fieldManipulators: [] });
    expect(next.output?.lines.SupplierItemCode).toEqual({ outputPath: "SupplierItemCode", canonicalField: "SupplierItemCode", fixedValue: null, fieldManipulators: [] });
    // the new field is added as a declared pass-through target
    expect(next.output?.header.Credentials).toEqual({ outputPath: "Credentials", canonicalField: "Credentials", fixedValue: null, fieldManipulators: [] });
  });

  it("does NOT re-materialize the spine when the override already has declared rules", () => {
    const seeded = withTargetConnect(emptyOverride(), "SupplierItemCode", "ItemCode");
    const next = withAddOutputField(seeded, "Notes", "header", [{ outputPath: "ItemCode", scope: "line" }]);
    // only the existing declared rule + the new field — no spine flood
    expect(Object.keys(next.output?.header ?? {})).toEqual(["Notes"]);
    expect(Object.keys(next.output?.lines ?? {})).toEqual(["ItemCode"]);
    expect(next.output?.header.Notes?.outputPath).toBe("Notes");
  });

  it("routes a canonical line-named field into the line scope", () => {
    const next = withAddOutputField(emptyOverride(), "UnitPrice", "header", []);
    expect(next.output?.lines.UnitPrice?.outputPath).toBe("UnitPrice");
    expect(next.output?.header.UnitPrice).toBeUndefined();
  });

  it("is a no-op for a blank path and for a duplicate path", () => {
    expect(withAddOutputField(emptyOverride(), "   ", "header", []).output).toBeNull();
    const seeded = withAddOutputField(emptyOverride(), "Foo", "header", []);
    const again = withAddOutputField(seeded, "Foo", "header", []);
    expect(Object.keys(again.output?.header ?? {})).toEqual(["Foo"]);
  });
});
