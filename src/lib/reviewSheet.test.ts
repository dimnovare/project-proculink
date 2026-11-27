import { describe, expect, it } from "vitest";
import type { DocumentDetail, Flow } from "@/lib/api/documents";
import { numberOf, pasteGrid, rowsSum } from "./reviewSheet";

const cell = (value: string) => ({ value, confidence: 1, location: null, notOnPage: false, edited: false });
const header = (key: string, value: string, meaning: string | null) => ({ key, label: key, value, type: "text", meaning, confidence: 1, location: null, notOnPage: false, listed: true, edited: false });
const read = (amounts: string[], fields: ReturnType<typeof header>[], column: string | null = "line_amount") => ({
  kindLabel: null, truncated: false, fields,
  tables: [{ key: "lines", label: "Lines", listed: true, columns: [{ key: "amount", label: "Amount", type: "number", meaning: column }], rows: amounts.map((a) => ({ cells: { amount: cell(a) } })) }],
}) as unknown as DocumentDetail["read"];
const unlisted = { fields: { fields: [], tables: [] } } as unknown as Pick<Flow, "fields">;

describe("reviewSheet", () => {
  // The same cases as the backend's FieldValueParser.Number.
  it("reads a number only when it has exactly one reading", () => {
    expect(numberOf("1 303,40")).toBe(1303.4);
    expect(numberOf("1,303.40")).toBe(1303.4);
    expect(numberOf("1.303,40")).toBe(1303.4);
    expect(numberOf("1,234,567")).toBe(1234567);          // a separator that repeats is a thousands mark
    expect(numberOf("1.234.567")).toBe(1234567);
    expect(numberOf("12,5")).toBe(12.5);
    expect(numberOf("-170.54")).toBe(-170.54);
    expect(numberOf("€ 100,00")).toBe(100);
    expect(numberOf("100.00 EUR")).toBe(100);
    for (const two of ["1,500", "1.500", "-1.500"]) expect(numberOf(two), two).toBeNull();   // a thousand and a half, or one and a half
    for (const none of ["KS-100", "12abc", "", ",", null]) expect(numberOf(none), String(none)).toBeNull();
  });

  it("splits what a spreadsheet copies into rows and cells, and leaves one plain value alone", () => {
    expect(pasteGrid("KS-100\t10\t12.50\r\nKS-214\t4\t186.00\r\n")).toEqual([["KS-100", "10", "12.50"], ["KS-214", "4", "186.00"]]);
    expect(pasteGrid("one value")).toBeNull();
  });

  it("adds the lines up beside the net total, or the gross one for tax-included lines, with the flow's meanings and the currency's decimals", () => {
    const net = header("net", "1303.40", "total_net");
    const lines = ["490.00", "673.40", "140.00"];
    expect(rowsSum(read(lines, [net]), unlisted, {})).toEqual({ table: "lines", sum: "1303.40", same: true, label: "net", value: "1303.40" });
    // Said in the document's own number style.
    expect(rowsSum(read(["490,00", "673,40", "140,00"], [header("net", "1 303,40", "total_net")]), unlisted, {})).toMatchObject({ sum: "1 303,40", same: true });
    // What is being typed counts.
    expect(rowsSum(read(lines, [net]), unlisted, { "cell:lines/2/amount": "150" })).toMatchObject({ sum: "1313.40", same: false, value: "1303.40" });
    // Never against the gross total: an invoice with VAT is not a mismatch.
    expect(rowsSum(read(["1000.00"], [header("total", "1240.00", "total_gross")]), unlisted, {})).toBeNull();
    // A receipt prices its lines with tax included: they match the gross total, as the backend's check now accepts.
    const totals = [header("net", "10.00", "total_net"), header("total", "12.40", "total_gross")];
    expect(rowsSum(read(["12.40"], totals), unlisted, {})).toMatchObject({ same: true, label: "total", value: "12.40" });
    expect(rowsSum(read(["12.00"], totals), unlisted, {})).toMatchObject({ same: false, label: "net", value: "10.00" });
    // Nothing is said about a number with two readings, a column with no meaning, or a flow that is not known yet.
    expect(rowsSum(read(["1.500", "250"], [header("net", "1.750", "total_net")]), unlisted, {})).toBeNull();
    expect(rowsSum(read(["490.00"], [net], null), unlisted, {})).toBeNull();
    expect(rowsSum(read(lines, [net]), undefined, {})).toBeNull();
    // Once the flow lists fields, its meanings decide: here it says the value is not a net total.
    const listed = { fields: { fields: [{ key: "net", label: "net", type: "number", meaning: null, required: false }], tables: [] } } as unknown as Pick<Flow, "fields">;
    expect(rowsSum(read(lines, [net]), listed, {})).toBeNull();
    // Three decimals for a dinar: 0.004 apart is not "the same" (the backend's tolerance is one smallest unit).
    const kwd = [header("net", "3015.379", "total_net"), header("cur", "KWD", "currency")];
    expect(rowsSum(read(["1010.125", "2005.250"], kwd), unlisted, {})).toMatchObject({ sum: "3015.375", same: false, value: "3015.379" });
  });
});
