import { describe, it, expect } from "vitest";
import { withTargetConnect, withAddOutputField, withFieldManipulators } from "./mapperModel";

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

/**
 * The same defect at the OTHER TWO sites. Fixing `withTargetConnect` alone left
 * `withAddOutputField` reading the output column NAME with no scope guard at all, and
 * `withFieldManipulators` doing the same behind an `existing?.scope ??` fallback that only helps
 * once a rule already exists.
 *
 * "Add a column" is the FIRST thing an author does with a new column, so this path has no existing
 * rule to fall back on — the explicit hint is the only signal there is, and it was being
 * overridden.
 */
describe("withAddOutputField honours the explicit scope hint", () => {
  const noCurrentPaths: { outputPath: string; scope: "header" | "line" }[] = [];

  it.each(["DeliveryDate", "TaxAmount", "Recipient", "Unspsc", "ContractNumber", "ManufacturerPartNumber"])(
    "adds a HEADER column named %s in header scope, not line scope",
    (columnName) => {
      const result = withAddOutputField(null, columnName, "header", noCurrentPaths);

      expect(Object.keys(result.output!.header)).toContain(columnName);
      expect(Object.keys(result.output!.lines)).not.toContain(columnName);
    },
  );

  it("still puts a column added with the line hint into line scope", () => {
    // Non-vacuity: the hint must be obeyed in BOTH directions.
    const result = withAddOutputField(null, "TaxAmount", "line", noCurrentPaths);

    expect(Object.keys(result.output!.lines)).toContain("TaxAmount");
    expect(Object.keys(result.output!.header)).not.toContain("TaxAmount");
  });

  it("adds a blank column UNMAPPED, even when its name matches a canonical field", () => {
    // The compounding half of the defect. The rule is written as `canonicalField: path`, which
    // post-WP-14 RESOLVES for 32 more names — so "add a blank column called ShipToCity" declared a
    // column silently pre-filled with the buyer's ship-to city. Adding a column and binding a
    // source are two different acts by the author, and only the second one is consent.
    const result = withAddOutputField(null, "ShipToCity", "header", noCurrentPaths);

    expect(result.output!.header.ShipToCity.canonicalField).toBeNull();
    expect(result.output!.header.ShipToCity.fixedValue).toBeNull();
  });

  it("leaves an already-declared column exactly where it is", () => {
    const first = withAddOutputField(null, "TaxAmount", "line", noCurrentPaths);
    const again = withAddOutputField(first, "TaxAmount", "header", noCurrentPaths);

    expect(Object.keys(again.output!.lines)).toContain("TaxAmount");
    expect(Object.keys(again.output!.header)).not.toContain("TaxAmount");
  });
});

describe("withFieldManipulators honours the explicit scope hint", () => {
  it.each(["DeliveryDate", "TaxAmount", "Recipient", "Unspsc"])(
    "keeps a fresh HEADER column named %s in header scope",
    (columnName) => {
      const result = withFieldManipulators(null, columnName, [{ type: "Trim", params: [] }], "header");

      expect(Object.keys(result.output!.header)).toContain(columnName);
      expect(Object.keys(result.output!.lines)).not.toContain(columnName);
    },
  );

  it("still routes a fresh LINE column to line scope", () => {
    const result = withFieldManipulators(null, "TaxAmount", [{ type: "Trim", params: [] }], "line");

    expect(Object.keys(result.output!.lines)).toContain("TaxAmount");
    expect(Object.keys(result.output!.header)).not.toContain("TaxAmount");
  });
});
