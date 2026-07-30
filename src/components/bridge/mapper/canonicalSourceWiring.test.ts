// WP-14 — the modules that reason about "is this name a canonical field?" must use the WIDE
// bindable vocabulary (CANONICAL_*_SOURCE_FIELDS), not the narrow default output shape.
//
// Two of them are correctness, not cosmetics:
//
//   • mapperModel.scopeOf — decides whether a rule lands in output.header or output.lines. The
//     backend resolves a header rule against the HEADER row bag, which carries no line keys. A
//     rule bound to ManufacturerPartNumber that lands in the header scope therefore emits an
//     EMPTY column, silently, forever.
//   • outgoingStatusModel — an output path that IS a canonical key resolves 1:1 with no wire.
//     Reporting "unmapped" for a path the backend does resolve makes the pane lie.

import { describe, it, expect } from "vitest";
import { withTargetConnect, emptyOverride } from "./mapperModel";
import { computeOutgoingStatus, type OutgoingStatusInput } from "./outgoingStatusModel";
import type { TargetField } from "./types";

const tf = (outputPath: string, scope: "header" | "line" = "header"): TargetField => ({
  outputPath, label: outputPath, scope,
});

function baseInput(over: Partial<OutgoingStatusInput> = {}): OutgoingStatusInput {
  return {
    outputConnections: {},
    sourceConnections: {},
    fixedValues: {},
    tokenValueById: new Map(),
    canonicalValueByKey: new Map(),
    labelForCanonical: (k) => k,
    ...over,
  };
}

describe("mapperModel scope classification over the widened vocabulary", () => {
  it("puts a widened LINE field in the lines scope", () => {
    // Header scope would resolve against the header row bag, which has no line keys → empty column.
    for (const field of ["ManufacturerPartNumber", "CustomerPartNumber", "NetAmount", "TaxAmount",
      "DiscountPercent", "Unspsc", "Recipient", "ContractNumber", "ManufacturerName"]) {
      const o = withTargetConnect(emptyOverride(), field, `out_${field}`);
      expect(o.output?.lines).toHaveProperty(`out_${field}`);
      expect(o.output?.header).not.toHaveProperty(`out_${field}`);
    }
  });

  it("keeps a widened HEADER field in the header scope", () => {
    for (const field of ["ShipToCity", "BillToPostalCode", "Incoterms", "BuyerTaxId", "ContactEmail"]) {
      const o = withTargetConnect(emptyOverride(), field, `out_${field}`);
      expect(o.output?.header).toHaveProperty(`out_${field}`);
      expect(o.output?.lines).not.toHaveProperty(`out_${field}`);
    }
  });
});

describe("outgoing status over the widened vocabulary", () => {
  it("reports a widened canonical output path as an auto 1:1 default", () => {
    const s = computeOutgoingStatus(
      tf("ShipToCity"),
      baseInput({ canonicalValueByKey: new Map([["ShipToCity", "Trondheim"]]) }),
    );

    expect(s.mapped).toBe(true);
    expect(s.kind).toBe("auto");
    expect(s.valuePreview).toBe("Trondheim");
  });

  it("reports a widened LINE canonical output path as an auto 1:1 default", () => {
    const s = computeOutgoingStatus(
      tf("ManufacturerPartNumber", "line"),
      baseInput({ canonicalValueByKey: new Map([["ManufacturerPartNumber", "QBT2500-BK-BTK1"]]) }),
    );

    expect(s.mapped).toBe(true);
    expect(s.kind).toBe("auto");
  });

  it("still reports a genuinely unknown output path as unmapped", () => {
    const s = computeOutgoingStatus(tf("SupplierInventedColumn"), baseInput());
    expect(s.mapped).toBe(false);
    expect(s.kind).toBe("none");
  });
});
