import { describe, expect, it } from "vitest";
import type { OutputNode, OutputNodeTemplate } from "@/lib/api/types";
import { fromSimple, toSimple } from "@/lib/flowOutputModel";

// Shaped like DefaultOutputTemplate.For(...) for csv: leaves named by label, one table "lines" of two columns.
const leaf = (name: string, canonicalField: string): OutputNode => ({
  name, nodeType: "field", children: [], rule: { outputPath: name, canonicalField, fieldManipulators: [] },
});
const template: OutputNodeTemplate = {
  format: "csv",
  root: {
    name: "document", nodeType: "object",
    children: [
      leaf("Invoice number", "invoice_number"),
      leaf("Total", "total"),
      {
        name: "lines", nodeType: "array", collection: "lines",
        children: [{ name: "row", nodeType: "object", children: [leaf("Item", "item"), leaf("Quantity", "qty")] }],
      },
    ],
  },
};

describe("flowOutputModel", () => {
  it("round-trips the default shape", () => {
    const simple = toSimple(template)!;
    expect(simple.table?.key).toBe("lines");
    expect(fromSimple(simple, "csv")).toEqual(template);
  });

  it("refuses a leaf that carries a manipulator", () => {
    const withManipulator = structuredClone(template);
    withManipulator.root.children![0].rule!.fieldManipulators = [{ type: "Trim" } as never];
    expect(toSimple(withManipulator)).toBeNull();
  });
});
