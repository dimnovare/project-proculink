import { describe, expect, it } from "vitest";
import type { DocumentDetail } from "@/lib/api/documents";
import { parseAmount, pasteGrid, rowsSum } from "./reviewSheet";

const cell = (value: string) => ({ value, confidence: 1, location: null, notOnPage: false, edited: false });
const read = (amounts: string[], total: string, meaning: string | null = "line_amount") => ({
  kindLabel: null, truncated: false,
  fields: [{ key: "total", label: "Total", value: total, type: "number", meaning: "total_gross", confidence: 1, location: null, notOnPage: false, listed: true, edited: false }],
  tables: [{ key: "lines", label: "Lines", listed: true, columns: [{ key: "amount", label: "Amount", type: "number", meaning }], rows: amounts.map((a) => ({ cells: { amount: cell(a) } })) }],
}) as unknown as DocumentDetail["read"];

describe("reviewSheet", () => {
  it("reads an amount however its thousands and decimals are written, and nothing else", () => {
    expect(parseAmount("1 303,40")).toBe(1303.4);
    expect(parseAmount("1,303.40")).toBe(1303.4);
    expect(parseAmount("1.303,40")).toBe(1303.4);
    expect(parseAmount("1,303")).toBe(1303);
    expect(parseAmount("12,5")).toBe(12.5);
    expect(parseAmount("-170.54")).toBe(-170.54);
    expect(parseAmount("KS-100")).toBeNull();
    expect(parseAmount("")).toBeNull();
  });

  it("splits what a spreadsheet copies into rows and cells, and leaves one plain value alone", () => {
    expect(pasteGrid("KS-100\t10\t12.50\r\nKS-214\t4\t186.00\r\n")).toEqual([["KS-100", "10", "12.50"], ["KS-214", "4", "186.00"]]);
    expect(pasteGrid("one value")).toBeNull();
  });

  it("adds the line amounts up beside the total, counts what is being typed, and says nothing it cannot know", () => {
    expect(rowsSum(read(["490.00", "673.40", "140.00"], "1303.40"), {})).toEqual({ table: "lines", sum: "1303.40", same: "Total", other: null });
    expect(rowsSum(read(["490.00", "673.40", "140.00"], "1303.40"), { "cell:lines/2/amount": "150" }))
      .toEqual({ table: "lines", sum: "1313.40", same: null, other: { label: "Total", value: "1303.40" } });
    expect(rowsSum(read(["490.00", "n/a"], "490.00"), {})).toBeNull();
    expect(rowsSum(read(["490.00"], "490.00", null), {})).toBeNull();
  });
});
