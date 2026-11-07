import { describe, expect, it } from "vitest";
import type { OutputNode, OutputNodeTemplate } from "@/lib/api/types";
import type { FlowFieldList } from "@/lib/api/documents";
import { withTargetConnect, withTargetDisconnect } from "@/components/bridge/mapper/mapperModel";
import { flowSourceFields, leafPaths, toOverride, toTemplate } from "./flowMapperModel";

const leaf = (name: string, rule?: OutputNode["rule"]): OutputNode => ({ name, nodeType: "field", ...(rule ? { rule } : {}) });
const template = (): OutputNodeTemplate => ({
  format: "json",
  root: {
    name: "document", nodeType: "object",
    children: [
      leaf("invoiceNumber", { outputPath: "invoiceNumber", canonicalField: "invoiceNumber", fieldManipulators: [] }),
      leaf("date", { outputPath: "date", canonicalField: "date", fieldManipulators: [] }),
      leaf("total", { outputPath: "total", fixedValue: "EUR", fieldManipulators: [] }),
      {
        name: "lines", nodeType: "array", collection: "lines",
        children: [
          leaf("sku", { outputPath: "sku", canonicalField: "sku", fieldManipulators: [{ type: "Lookup", params: ["L1", "keep"] }, { type: "Trim", params: [] }] }),
          leaf("date", { outputPath: "date", canonicalField: "date", fieldManipulators: [] }),
        ],
      },
    ],
  },
});
const cols = ["sku", "date"];
const fields: FlowFieldList = {
  fields: ["invoiceNumber", "date"].map((key) => ({ key, label: key, type: "text", meaning: null, required: false })),
  tables: [{ key: "lines", label: "Lines", columns: cols.map((key) => ({ key, label: key, type: "text", meaning: null, required: false })) }],
};
const find = (t: OutputNodeTemplate, path: string) => leafPaths(t).find((l) => l.path === path)!.node;

describe("flowMapperModel", () => {
  it("round trip without edits returns the same template", () => {
    const t = template();
    expect(toTemplate(t, toOverride(t, cols))).toEqual(t);
  });

  it("the same key in header and table stays two sources", () => {
    const t = template();
    const ids = flowSourceFields(fields, null).map((f) => f.id); // null = the first table
    expect(ids).toContain("date");
    expect(ids).toContain("col:date");
    const loaded = toOverride(t, cols);
    expect(loaded.output?.lines["lines/date"].canonicalField).toBe("col:date");
    expect(loaded.output?.header["date"].canonicalField).toBe("date");
    // Cross-wire both, so neither saved value can be the one it started with.
    let o = withTargetConnect(loaded, "invoiceNumber", "date");
    o = withTargetConnect(o, "col:sku", "lines/date");
    const out = toTemplate(t, o);
    expect(find(out, "date").rule?.canonicalField).toBe("invoiceNumber");
    expect(find(out, "lines/date").rule?.canonicalField).toBe("sku");
    expect(find(out, "lines/sku")).toEqual(find(t, "lines/sku"));
  });

  it("two leaves with the same name stay two fields", () => {
    const t = template();
    t.root.children!.push(leaf("total", { outputPath: "total", canonicalField: "invoiceNumber", fieldManipulators: [] }));
    const totals = (x: OutputNodeTemplate) => x.root.children!.filter((c) => c.name === "total");
    const out = toTemplate(t, withTargetConnect(toOverride(t, cols), "date", "invoiceNumber"));
    expect(find(out, "invoiceNumber").rule?.canonicalField).toBe("date");
    expect(totals(out)).toEqual(totals(t));
  });

  it("a disconnect keeps the column, empty", () => {
    const t = template();
    const out = toTemplate(t, withTargetDisconnect(toOverride(t, cols), "invoiceNumber"));
    expect(leafPaths(out).map((l) => l.path)).toEqual(leafPaths(t).map((l) => l.path));
    expect(find(out, "invoiceNumber").rule?.canonicalField).toBeUndefined();
  });
});
