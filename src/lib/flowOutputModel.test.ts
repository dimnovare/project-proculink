import { describe, expect, it } from "vitest";
import type { OutputNode, OutputNodeTemplate } from "@/lib/api/types";
import { describeSendWhen, excelSeparator, fromSimple, leafPaths, toSimple, uniqueNames } from "@/lib/flowOutputModel";

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

  it("round-trips widths and the separator", () => {
    const simple = { fields: [{ name: "po", source: { field: "po" }, width: 6 }], table: null, delimiter: ";" };
    expect(toSimple(fromSimple(simple, "fixed"))!.fields[0].width).toBe(6);
    expect(toSimple(fromSimple(simple, "fixed"))!.delimiter).toBe(";");
    expect(toSimple(fromSimple(simple, "csv"))).toEqual({ ...simple, fields: [{ name: "po", source: { field: "po" } }] });
    const quoted = fromSimple(simple, "csv");
    quoted.csvDialect = { delimiter: ";", quotePolicy: "always" };
    expect(toSimple(quoted)).toBeNull();
  });

  it("keeps the separator and byte-order mark through an edit and a change of type", () => {
    const simple = toSimple({ ...template, csvDialect: { delimiter: ";", byteOrderMark: true } });
    expect(simple).not.toBeNull();
    expect(simple!.byteOrderMark).toBe(true);
    expect(fromSimple(simple!, "csv").csvDialect).toEqual({ delimiter: ";", byteOrderMark: true });
    expect(fromSimple(simple!, "xlsx").csvDialect).toEqual({ delimiter: ";", byteOrderMark: true });
    expect(fromSimple(simple!, "json").csvDialect).toBeUndefined();
  });

  it("picks the separator Excel expects from the first browser language and the time zone", () => {
    expect(excelSeparator(["et-EE"], "Europe/Tallinn")).toBe(";");
    expect(excelSeparator(["en-US"], "Europe/Tallinn")).toBe(";");
    expect(excelSeparator(["en-GB"], "Europe/London")).toBe(",");
    expect(excelSeparator(["en-US"], "America/New_York")).toBe(",");
    expect(excelSeparator(["de-DE"], "UTC")).toBe(";");
  });

  it("reads a field with no rule as a blank fixed value", () => {
    const disconnected = structuredClone(template);
    delete disconnected.root.children![0].rule;
    expect(toSimple(disconnected)!.fields[0].source).toEqual({ fixed: "" });
  });

  it("refuses a leaf that carries a manipulator", () => {
    const withManipulator = structuredClone(template);
    withManipulator.root.children![0].rule!.fieldManipulators = [{ type: "Trim" } as never];
    expect(toSimple(withManipulator)).toBeNull();
  });

  it("round-trips a lookup row and still refuses a mixed chain", () => {
    const row = { name: "code", source: { field: "code" }, lookup: { id: "L1", ifMissing: "blank" as const } };
    const out = fromSimple({ fields: [row], table: null }, "csv");
    expect(toSimple(out)).toEqual({ fields: [row], table: null });

    out.root.children![0].rule!.fieldManipulators = [
      { type: "Lookup", params: ["L1", "blank"] },
      { type: "Trim" },
    ] as never;
    expect(toSimple(out)).toBeNull();

    const fields = { fields: [{ key: "supplier", label: "Supplier", type: "text", meaning: null, required: false }], tables: [] };
    expect(describeSendWhen({ field: "supplier", op: "is_not", value: "Acme" }, fields)).toBe("Only when Supplier is not “Acme”");
    expect(describeSendWhen(null, fields)).toBeNull();
  });
});

describe("leafPaths", () => {
  it("leaf paths follow the shared vector", () => {
    const f = (name: string): OutputNode => ({ name, nodeType: "field", rule: { outputPath: name, fieldManipulators: [] } });
    const obj = (name: string, children: OutputNode[]): OutputNode => ({ name, nodeType: "object", children });
    const t = {
      format: "json",
      root: obj("document", [f("a"), obj("b", [f("c")]), { name: "lines", nodeType: "array", children: [obj("row", [f("q")])] }]),
    } as OutputNodeTemplate;
    const leaves = leafPaths(t);
    expect(leaves.map((l) => l.path)).toEqual(["a", "b/c", "lines/row/q"]);
    expect(leaves.filter((l) => l.inTable).map((l) => l.path)).toEqual(["lines/row/q"]);
  });
});

it("uniqueNames numbers repeats like the backend: any case, from 2, blanks stay blank", () => {
  expect(uniqueNames(["Müüja", "müüja", "", "Summa", "Summa"])).toEqual(["Müüja", "müüja 2", "", "Summa", "Summa 2"]);
});
