import { describe, it, expect } from "vitest";
import { withTargetConnect } from "./mapperModel";

/**
 * WP-14 — widening the line-key set must not silently reclassify an existing output column.
 *
 * `scopeOf` used to decide a new rule's scope from `LINE_KEYS.has(canonicalField) ||
 * LINE_KEYS.has(outputPath)`. That second term reads the OUTPUT COLUMN NAME — the supplier's
 * name for their own column — as if it were one of our canonical field names. Adding
 * DeliveryDate / TaxRate / TaxAmount / ContractNumber / Recipient to LINE_KEYS therefore moves
 * any supplier output column literally NAMED one of those from header scope to line scope, which
 * changes the rendered document (a header column is emitted once; a line column repeats per line)
 * for a customer who changed nothing.
 *
 * A supplier column called "DeliveryDate" is not exotic — it is one of the most natural column
 * names in procurement.
 */
describe("output-rule scope is decided by the canonical source, never the column name", () => {
  it("keeps a header-scoped column named after a canonical LINE field in header scope", () => {
    // The author binds the ORDER's requested delivery date (a header field) into a column they
    // happen to have called "DeliveryDate".
    const result = withTargetConnect(null, "RequestedDeliveryDate", "DeliveryDate");

    expect(Object.keys(result.output!.header)).toContain("DeliveryDate");
    expect(Object.keys(result.output!.lines)).not.toContain("DeliveryDate");
  });

  it.each([
    ["TaxTotal", "TaxRate"],
    ["GrandTotal", "LineAmount"],
    ["BuyerOrderRef", "ContractNumber"],
    ["ShipToName", "Recipient"],
    ["TaxTotal", "TaxAmount"],
  ])(
    "binding header field %s into a column named %s stays header-scoped",
    (canonicalField, outputPath) => {
      const result = withTargetConnect(null, canonicalField, outputPath);

      expect(Object.keys(result.output!.header)).toContain(outputPath);
      expect(Object.keys(result.output!.lines)).not.toContain(outputPath);
    },
  );

  it("still routes a genuine LINE canonical field to line scope", () => {
    // Non-vacuity: the scope rule must still work, including for the newly bindable line names.
    for (const field of ["Quantity", "UnitPrice", "ManufacturerPartNumber", "Unspsc", "DiscountPercent"]) {
      const result = withTargetConnect(null, field, `col_${field}`);
      expect(Object.keys(result.output!.lines)).toContain(`col_${field}`);
      expect(Object.keys(result.output!.header)).not.toContain(`col_${field}`);
    }
  });

  it("still routes a genuine HEADER canonical field to header scope", () => {
    for (const field of ["PoNumber", "Currency", "ShipToCity", "Incoterms", "BuyerTaxId"]) {
      const result = withTargetConnect(null, field, `col_${field}`);
      expect(Object.keys(result.output!.header)).toContain(`col_${field}`);
      expect(Object.keys(result.output!.lines)).not.toContain(`col_${field}`);
    }
  });

  it("preserves an existing rule's authored scope when re-pointing its source", () => {
    // An already-authored rule keeps its scope regardless — re-pointing a source must never move
    // a column between scopes under the author's feet.
    const first = withTargetConnect(null, "Quantity", "Amount");
    expect(Object.keys(first.output!.lines)).toContain("Amount");

    const second = withTargetConnect(first, "GrandTotal", "Amount");
    expect(Object.keys(second.output!.lines)).toContain("Amount");
    expect(Object.keys(second.output!.header)).not.toContain("Amount");
  });
});
