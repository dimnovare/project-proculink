// WP-14 — the mapping picker must offer EVERY canonical field the backend row bag exposes.
//
// Backend source of truth:
//   ProcuLink.Transform/Output/MappedTransformService.cs
//     BuildHeaderRow  → the header-scope key set
//     BuildLineRow    → the line-scope key set (a line bag also carries every header key)
// Kept honest on that side by CanonicalRowCompletenessTests, which reflects over the entities.
//
// Two DIFFERENT vocabularies live in types.ts and must not be conflated:
//
//   • CANONICAL_HEADER_FIELDS / CANONICAL_LINE_FIELDS — the DEFAULT OUTPUT SHAPE (the "spine").
//     These are the columns a fresh order's outgoing document claims it will contain. Widening
//     them would make every order suddenly claim to emit a bill-to phone number.
//   • CANONICAL_HEADER_SOURCE_FIELDS / CANONICAL_LINE_SOURCE_FIELDS — the BINDABLE vocabulary.
//     Everything a rule may name as its source. This is what the picker offers.
//
// The spine is a subset of the vocabulary. This suite pins both, and pins the subset relation.

import { describe, it, expect } from "vitest";
import {
  CANONICAL_HEADER_FIELDS,
  CANONICAL_LINE_FIELDS,
  CANONICAL_HEADER_SOURCE_FIELDS,
  CANONICAL_LINE_SOURCE_FIELDS,
  CANONICAL_SOURCE_GROUPS,
} from "./types";

/** Exactly the keys MappedTransformService.BuildHeaderRow writes. */
const BACKEND_HEADER_ROW_KEYS = [
  "PoNumber", "OrderDate", "BuyerName", "Currency", "SupplierName",
  "SubTotal", "TaxTotal", "GrandTotal", "PaymentTerms", "RequestedDeliveryDate",
  "DocumentType",
  "ContactName", "ContactEmail", "ContactPhone",
  "Incoterms", "ShippingMethod", "BuyerOrderRef", "BuyerTaxId",
  "ShipToName", "ShipToDeliverTo", "ShipToStreet", "ShipToCity",
  "ShipToPostalCode", "ShipToCountry", "ShipToEmail", "ShipToPhone",
  "BillToName", "BillToDeliverTo", "BillToStreet", "BillToCity",
  "BillToPostalCode", "BillToCountry", "BillToEmail", "BillToPhone",
];

/** Exactly the LINE-scope keys MappedTransformService.BuildLineRow adds on top of the header bag. */
const BACKEND_LINE_ROW_KEYS = [
  "LineNumber", "BuyerItemCode", "SupplierItemCode", "Description",
  "Quantity", "Unit", "UnitPrice", "LineTotal", "LineAmount", "TaxRate", "DeliveryDate",
  "TaxAmount", "ManufacturerPartNumber", "ManufacturerName", "CustomerPartNumber",
  "DiscountPercent", "Unspsc", "Recipient", "ContractNumber", "NetAmount",
];

describe("canonical SOURCE vocabulary (what the picker offers)", () => {
  it("offers every header key the backend row bag exposes", () => {
    for (const key of BACKEND_HEADER_ROW_KEYS) {
      expect(CANONICAL_HEADER_SOURCE_FIELDS).toContain(key);
    }
  });

  it("offers every line key the backend row bag exposes", () => {
    for (const key of BACKEND_LINE_ROW_KEYS) {
      expect(CANONICAL_LINE_SOURCE_FIELDS).toContain(key);
    }
  });

  it("offers nothing the backend cannot resolve", () => {
    // A name in the picker that the row bag does not carry resolves to "" at transform time —
    // the user binds a field and silently gets an empty column.
    expect([...CANONICAL_HEADER_SOURCE_FIELDS].sort()).toEqual([...BACKEND_HEADER_ROW_KEYS].sort());
    expect([...CANONICAL_LINE_SOURCE_FIELDS].sort()).toEqual([...BACKEND_LINE_ROW_KEYS].sort());
  });

  it("carries the delivery address — the field class the packet exists for", () => {
    for (const key of ["ShipToName", "ShipToStreet", "ShipToCity", "ShipToPostalCode", "ShipToCountry"]) {
      expect(CANONICAL_HEADER_SOURCE_FIELDS).toContain(key);
    }
    expect(CANONICAL_LINE_SOURCE_FIELDS).toContain("ManufacturerPartNumber");
  });

  it("has no duplicate names within a scope", () => {
    expect(new Set(CANONICAL_HEADER_SOURCE_FIELDS).size).toBe(CANONICAL_HEADER_SOURCE_FIELDS.length);
    expect(new Set(CANONICAL_LINE_SOURCE_FIELDS).size).toBe(CANONICAL_LINE_SOURCE_FIELDS.length);
  });
});

describe("the default OUTPUT SHAPE (spine) stays narrow", () => {
  // Guard against the easy mistake: widening the picker by widening the spine, which would make
  // a fresh order's outgoing document claim ~45 columns it was never asked to emit.
  it("is unchanged", () => {
    expect([...CANONICAL_HEADER_FIELDS]).toEqual(
      ["PoNumber", "OrderDate", "BuyerName", "Currency", "SupplierName"],
    );
    expect([...CANONICAL_LINE_FIELDS]).toEqual(
      ["LineNumber", "BuyerItemCode", "SupplierItemCode", "Description",
        "Quantity", "Unit", "UnitPrice", "LineTotal"],
    );
  });

  it("is a subset of the bindable vocabulary, in the same leading order", () => {
    // The spine must stay offerable — and stay at the TOP of the picker, where it was.
    expect(CANONICAL_HEADER_SOURCE_FIELDS.slice(0, CANONICAL_HEADER_FIELDS.length))
      .toEqual([...CANONICAL_HEADER_FIELDS]);
    expect(CANONICAL_LINE_SOURCE_FIELDS.slice(0, CANONICAL_LINE_FIELDS.length))
      .toEqual([...CANONICAL_LINE_FIELDS]);
  });
});

describe("CANONICAL_SOURCE_GROUPS (the picker's scope grouping)", () => {
  it("covers every source field exactly once, per scope", () => {
    const header = CANONICAL_SOURCE_GROUPS.filter((g) => g.scope === "header").flatMap((g) => g.fields);
    const line = CANONICAL_SOURCE_GROUPS.filter((g) => g.scope === "line").flatMap((g) => g.fields);

    expect([...header].sort()).toEqual([...CANONICAL_HEADER_SOURCE_FIELDS].sort());
    expect([...line].sort()).toEqual([...CANONICAL_LINE_SOURCE_FIELDS].sort());
    expect(new Set(header).size).toBe(header.length);
    expect(new Set(line).size).toBe(line.length);
  });

  it("preserves the vocabulary order, so the picker's keyboard nav matches what is drawn", () => {
    const header = CANONICAL_SOURCE_GROUPS.filter((g) => g.scope === "header").flatMap((g) => g.fields);
    const line = CANONICAL_SOURCE_GROUPS.filter((g) => g.scope === "line").flatMap((g) => g.fields);
    expect(header).toEqual([...CANONICAL_HEADER_SOURCE_FIELDS]);
    expect(line).toEqual([...CANONICAL_LINE_SOURCE_FIELDS]);
  });

  it("labels every group", () => {
    for (const g of CANONICAL_SOURCE_GROUPS) {
      expect(g.label.length).toBeGreaterThan(0);
      expect(g.fields.length).toBeGreaterThan(0);
    }
  });
});
