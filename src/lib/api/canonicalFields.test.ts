import { describe, it, expect } from "vitest";
import {
  BINDABLE_HEADER_FIELDS,
  BINDABLE_LINE_FIELDS,
  CANONICAL_FIELD_GROUPS,
  CANONICAL_HEADER_FIELDS,
  CANONICAL_LINE_FIELDS,
} from "@/lib/api/types";

/**
 * WP-14 — the picker must offer every name the backend row bag exposes, grouped by scope.
 *
 * The gap: the backend exposed 10 header + 11 line names while the picker offered 5 + 8, and the
 * backend itself was 23 + 9 short of the real entity. So a supplier needing a delivery city could
 * not be served, and nothing anywhere said why — a rule naming an absent key just resolves to
 * nothing.
 *
 * The lists below are the mirror of `ProcuLink.Transform/Output/CanonicalRowFields.cs`
 * (`Header` / `Line`) in the backend repo. They are pinned as literals ON PURPOSE: two repos
 * cannot share a compile-time constant, so the honest guard is a checked-in expectation that
 * fails the moment someone edits the picker list without editing this one. The backend half of
 * the pair is `CanonicalRowFieldsCompletenessTests`, which fails if an entity field is neither
 * exposed nor explicitly excluded. Together they mean neither side can silently narrow.
 */
const BACKEND_HEADER_ROW_KEYS = [
  "PoNumber",
  "OrderDate",
  "BuyerName",
  "Currency",
  "SupplierName",
  "SubTotal",
  "TaxTotal",
  "GrandTotal",
  "PaymentTerms",
  "RequestedDeliveryDate",
  "BuyerOrderRef",
  "BuyerTaxId",
  "ContactName",
  "ContactEmail",
  "ContactPhone",
  "Incoterms",
  "ShippingMethod",
  "ShipToName",
  "ShipToDeliverTo",
  "ShipToStreet",
  "ShipToCity",
  "ShipToPostalCode",
  "ShipToCountry",
  "ShipToEmail",
  "ShipToPhone",
  "BillToName",
  "BillToDeliverTo",
  "BillToStreet",
  "BillToCity",
  "BillToPostalCode",
  "BillToCountry",
  "BillToEmail",
  "BillToPhone",
] as const;

const BACKEND_LINE_ROW_KEYS = [
  "LineNumber",
  "BuyerItemCode",
  "SupplierItemCode",
  "Description",
  "Quantity",
  "Unit",
  "UnitPrice",
  "LineTotal",
  "LineAmount",
  "TaxRate",
  "DeliveryDate",
  "TaxAmount",
  "DiscountPercent",
  "NetAmount",
  "ManufacturerPartNumber",
  "ManufacturerName",
  "CustomerPartNumber",
  "Unspsc",
  "Recipient",
  "ContractNumber",
] as const;

describe("bindable canonical fields", () => {
  it("offers every header name the backend row bag exposes", () => {
    expect([...BINDABLE_HEADER_FIELDS].sort()).toEqual([...BACKEND_HEADER_ROW_KEYS].sort());
  });

  it("offers every line name the backend row bag exposes", () => {
    expect([...BINDABLE_LINE_FIELDS].sort()).toEqual([...BACKEND_LINE_ROW_KEYS].sort());
  });

  it("offers the fields a physical purchase order cannot ship without", () => {
    // Named explicitly so the reason this work happened survives a future refactor of the lists.
    for (const f of ["ShipToCity", "ShipToStreet", "ShipToPostalCode", "ShipToCountry", "Incoterms", "BuyerTaxId"]) {
      expect(BINDABLE_HEADER_FIELDS).toContain(f);
    }
    for (const f of ["ManufacturerPartNumber", "Unspsc", "DiscountPercent", "TaxAmount"]) {
      expect(BINDABLE_LINE_FIELDS).toContain(f);
    }
  });

  it("keeps every name in exactly one scope", () => {
    const overlap = BINDABLE_HEADER_FIELDS.filter((f) => (BINDABLE_LINE_FIELDS as readonly string[]).includes(f));
    expect(overlap).toEqual([]);
  });

  it("has no duplicates within a scope", () => {
    expect(new Set(BINDABLE_HEADER_FIELDS).size).toBe(BINDABLE_HEADER_FIELDS.length);
    expect(new Set(BINDABLE_LINE_FIELDS).size).toBe(BINDABLE_LINE_FIELDS.length);
  });
});

describe("CANONICAL_FIELD_GROUPS", () => {
  it("groups by scope and covers every bindable name exactly once", () => {
    const header = CANONICAL_FIELD_GROUPS.find((g) => g.scope === "header");
    const line = CANONICAL_FIELD_GROUPS.find((g) => g.scope === "line");

    expect(header).toBeDefined();
    expect(line).toBeDefined();
    expect(header!.fields).toEqual([...BINDABLE_HEADER_FIELDS]);
    expect(line!.fields).toEqual([...BINDABLE_LINE_FIELDS]);

    const all = CANONICAL_FIELD_GROUPS.flatMap((g) => g.fields);
    expect(new Set(all).size).toBe(all.length);
    expect(all.length).toBe(BINDABLE_HEADER_FIELDS.length + BINDABLE_LINE_FIELDS.length);
  });

  it("gives every group a human label", () => {
    for (const g of CANONICAL_FIELD_GROUPS) {
      expect(g.label.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("the default document spine stays narrow", () => {
  it("is a strict subset of the bindable set", () => {
    // The two lists mean different things and WP-14 deliberately kept them apart:
    // CANONICAL_*_FIELDS is the DEFAULT outgoing-document spine (what columns a supplier with no
    // configured output gets shown), BINDABLE_* is everything an author MAY bind. Widening the
    // spine to 53 columns would have redesigned the outgoing-document lane as a side effect of a
    // picker change — an unrequested UX regression.
    for (const f of CANONICAL_HEADER_FIELDS) expect(BINDABLE_HEADER_FIELDS).toContain(f);
    for (const f of CANONICAL_LINE_FIELDS) expect(BINDABLE_LINE_FIELDS).toContain(f);

    expect(CANONICAL_HEADER_FIELDS.length).toBeLessThan(BINDABLE_HEADER_FIELDS.length);
    expect(CANONICAL_LINE_FIELDS.length).toBeLessThan(BINDABLE_LINE_FIELDS.length);
  });
});
