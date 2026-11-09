import { describe, expect, it } from "vitest";
import type { ReadResult } from "@/lib/api/documents";
import { addReadExtra, fieldListFromRead, withReadExtras } from "@/lib/flowFieldModel";

const f = (key: string, label: string, type: string) => ({
  key, label, value: "x", type, meaning: null, confidence: 1, location: null, notOnPage: false, listed: true, edited: false,
});

describe("fieldListFromRead", () => {
  it("keeps keys, labels and types, with nothing required", () => {
    const read: ReadResult = {
      kindLabel: null, truncated: false,
      fields: [f("number", "Number", "code"), f("total", "Total", "money")],
      tables: [{
        key: "lines", label: "Lines", listed: true, rows: [],
        columns: [{ key: "item", label: "Item", type: "text", meaning: null }, { key: "qty", label: "Qty", type: "number", meaning: null }],
      }],
    };
    expect(fieldListFromRead(read)).toEqual({
      fields: [
        { key: "number", label: "Number", type: "code", meaning: null, required: false },
        { key: "total", label: "Total", type: "money", meaning: null, required: false },
      ],
      tables: [{
        key: "lines", label: "Lines",
        columns: [
          { key: "item", label: "Item", type: "text", meaning: null, required: false },
          { key: "qty", label: "Qty", type: "number", meaning: null, required: false },
        ],
      }],
    });
  });
});

describe("withReadExtras", () => {
  it("keeps the flow's fields and adds what the read has, unticked", () => {
    const tbl = (columns: string[]) => ({
      key: "lines", label: "Lines", listed: true, rows: [],
      columns: columns.map((key) => ({ key, label: key, type: "text", meaning: null })),
    });
    const read: ReadResult = {
      kindLabel: null, truncated: false,
      fields: [f("po", "PO number", "code"), f("total", "Total", "money")],
      tables: [tbl(["item", "qty"]), { ...tbl(["x"]), key: "taxes" }],
    };
    const own = { key: "po", label: "Order", type: "code", meaning: null, required: true };
    const item = { key: "item", label: "Item", type: "text", meaning: null, required: false };
    const { list, off } = withReadExtras({ fields: [own], tables: [{ key: "lines", label: "Lines", columns: [item] }] }, read);
    expect(list.fields.map((x) => [x.key, x.label])).toEqual([["po", "Order"], ["total", "Total"]]);
    expect(list.tables.map((t) => [t.key, t.columns.map((c) => c.key)])).toEqual([["lines", ["item", "qty"]], ["taxes", ["x"]]]);
    expect([...off].sort()).toEqual(["lines/qty", "taxes", "total"]);
    const clash = withReadExtras({ fields: [{ ...own, key: "notes" }], tables: [] }, { ...read, fields: [], tables: [{ ...tbl(["x"]), key: "notes" }] });
    expect(clash.list.tables).toEqual([]);
    expect(clash.off.has("notes")).toBe(false);
    expect(withReadExtras({ fields: [own], tables: [] }, undefined)).toEqual({ list: { fields: [own], tables: [] }, off: new Set() });
  });
});

describe("addReadExtra", () => {
  it("adds exactly the chosen field and keeps the flow's labels", () => {
    const read: ReadResult = { kindLabel: null, truncated: false, fields: [f("po", "PO number", "code"), f("total", "Total", "money"), f("date", "Date", "date")], tables: [] };
    const own = { key: "po", label: "Order", type: "code", meaning: null, required: true };
    expect(addReadExtra({ fields: [own], tables: [] }, read, "total").fields.map((x) => [x.key, x.label])).toEqual([["po", "Order"], ["total", "Total"]]);
  });
});
