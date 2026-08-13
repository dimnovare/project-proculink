import { describe, it, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import {
  MAX_PREVIEW_ROWS,
  columnIndexFromRef,
  detectDelimiter,
  excelSerialToDisplay,
  formatCodeIsDate,
  parseCsvRows,
  parseCsvTable,
  parseXlsxWorkbook,
} from "./sheetPreview";

describe("detectDelimiter", () => {
  it("picks the separator that actually separates", () => {
    expect(detectDelimiter("a,b,c\n1,2,3")).toBe(",");
    expect(detectDelimiter("a;b;c\n1;2;3")).toBe(";");
    expect(detectDelimiter("a\tb\tc\n1\t2\t3")).toBe("\t");
  });

  it("ignores candidates inside quoted fields", () => {
    // The real case: a semicolon-separated export whose address column contains commas. Counting
    // inside the quotes would make this a comma file and shear every row apart.
    const csv = 'Item;Address;Qty\nACM-1;"Bremen, DE, 28195";4\nACM-2;"Berlin, DE, 10115";7';
    expect(detectDelimiter(csv)).toBe(";");
  });
});

describe("parseCsvRows", () => {
  it("handles quoted fields, doubled quotes and embedded newlines", () => {
    const csv = 'a,"b,c","say ""hi""","two\nlines"';
    expect(parseCsvRows(csv, ",")).toEqual([["a", "b,c", 'say "hi"', "two\nlines"]]);
  });

  it("keeps a last row that has no trailing newline", () => {
    expect(parseCsvRows("a,b\nc,d", ",")).toEqual([["a", "b"], ["c", "d"]]);
  });

  it("a trailing newline does not manufacture an empty final row", () => {
    expect(parseCsvRows("a,b\nc,d\n", ",")).toEqual([["a", "b"], ["c", "d"]]);
  });

  it("survives CRLF", () => {
    expect(parseCsvRows("a,b\r\nc,d\r\n", ",")).toEqual([["a", "b"], ["c", "d"]]);
  });

  it("empty input is no rows, not one empty row", () => {
    expect(parseCsvRows("", ",")).toEqual([]);
  });
});

describe("parseCsvTable", () => {
  it("strips the BOM Excel writes, so it never lands in the first header cell", () => {
    const table = parseCsvTable("﻿PO Number,Line\nPO-1,1");
    expect(table.rows[0][0]).toBe("PO Number");
  });

  it("pads ragged rows to the widest row so the grid stays rectangular", () => {
    const table = parseCsvTable("a,b,c\n1,2");
    expect(table.rows).toEqual([["a", "b", "c"], ["1", "2", ""]]);
  });

  it("caps rows and says so, rather than locking the tab up on a huge export", () => {
    const many = Array.from({ length: MAX_PREVIEW_ROWS + 40 }, (_, i) => `PO-${i},${i}`).join("\n");
    const table = parseCsvTable(many);
    expect(table.rows.length).toBe(MAX_PREVIEW_ROWS);
    expect(table.truncatedRows).toBe(true);
  });

  it("a small file is not reported as truncated", () => {
    expect(parseCsvTable("a,b\n1,2").truncatedRows).toBe(false);
  });
});

describe("columnIndexFromRef", () => {
  it("maps spreadsheet references to zero-based columns", () => {
    expect(columnIndexFromRef("A1")).toBe(0);
    expect(columnIndexFromRef("Z9")).toBe(25);
    expect(columnIndexFromRef("AA1")).toBe(26);
    expect(columnIndexFromRef("BC12")).toBe(54);
  });

  it("a reference with no column letters is refused rather than guessed", () => {
    expect(columnIndexFromRef("12")).toBe(-1);
  });
});

describe("formatCodeIsDate", () => {
  it("recognises real date formats", () => {
    expect(formatCodeIsDate("dd/mm/yyyy")).toBe(true);
    expect(formatCodeIsDate("[$-409]d/m/yyyy")).toBe(true);
    expect(formatCodeIsDate("yyyy-mm-dd hh:mm")).toBe(true);
  });

  it("does not read a currency literal as a date", () => {
    // `"kr"#,##0.00` carries a `d`-free literal, but `"Dec"#,##0` does not — quoted text must
    // be stripped before the test, or every price in that workbook renders as 1970.
    expect(formatCodeIsDate('"kr"#,##0.00')).toBe(false);
    expect(formatCodeIsDate('"Dcm" #,##0.00')).toBe(false);
    expect(formatCodeIsDate("#,##0.00")).toBe(false);
    expect(formatCodeIsDate("0.00%")).toBe(false);
    expect(formatCodeIsDate("General")).toBe(false);
  });
});

describe("excelSerialToDisplay", () => {
  it("uses the epoch that accounts for Excel's non-existent 1900-02-29", () => {
    // Serial 61 is 1900-03-01 in Excel because serial 60 is a day that never happened. Every
    // serial a purchase order can carry is above that, which is why the 1899-12-30 epoch is the
    // correct one; the price of it is that serials 1–59 land a day early, and no real delivery
    // date is in January 1900.
    expect(excelSerialToDisplay(61)).toBe("1900-03-01");
    expect(excelSerialToDisplay(46191)).toBe("2026-06-18");
  });

  it("adds the time only when the value carries one", () => {
    expect(excelSerialToDisplay(46191)).toBe("2026-06-18");
    expect(excelSerialToDisplay(46191.5)).toBe("2026-06-18 12:00");
  });
});

// ── XLSX ─────────────────────────────────────────────────────────────────────
// The fixture is a real OOXML zip built here, so the reader is exercised end to end (inflate →
// three XML parts → typed cells) rather than against a hand-shaped object.

function xlsxFixture(): Uint8Array {
  const rel = (id: string, target: string) =>
    `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="${target}"/>`;

  return zipSync({
    "[Content_Types].xml": strToU8('<?xml version="1.0"?><Types/>'),
    "xl/workbook.xml": strToU8(
      '<?xml version="1.0"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"' +
        ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<sheets><sheet name="Order" sheetId="1" r:id="rId1"/>' +
        '<sheet name="Notes" sheetId="2" r:id="rId2"/></sheets></workbook>',
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        rel("rId1", "worksheets/sheet1.xml") +
        rel("rId2", "worksheets/sheet2.xml") +
        "</Relationships>",
    ),
    "xl/sharedStrings.xml": strToU8(
      '<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        "<si><t>Supplier Item</t></si>" +
        "<si><t>Delivery</t></si>" +
        "<si><r><t>ACM-</t></r><r><t>BLT-M8</t></r></si>" +
        "<si><t>Discount</t></si>" +
        "</sst>",
    ),
    // cellXfs index 0 = General, 1 = builtin date (14), 2 = builtin percent (9),
    // 3 = a custom currency format that contains no y/m/d once its literal is stripped.
    "xl/styles.xml": strToU8(
      '<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;kr&quot;#,##0.00"/></numFmts>' +
        '<cellStyleXfs count="1"><xf numFmtId="0"/></cellStyleXfs>' +
        '<cellXfs count="4"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="9"/>' +
        '<xf numFmtId="164"/></cellXfs></styleSheet>',
    ),
    "xl/worksheets/sheet1.xml": strToU8(
      '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
        '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c>' +
        '<c r="C1" t="s"><v>3</v></c><c r="D1" t="inlineStr"><is><t>Price</t></is></c></row>' +
        // Column B is skipped on purpose in row 3 — sparse cells are the normal XLSX shape.
        '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" s="1"><v>46191</v></c>' +
        '<c r="C2" s="2"><v>0.15</v></c><c r="D2" s="3"><v>1234.5</v></c></row>' +
        '<row r="3"><c r="A3" t="str"><v>ACM-NUT-M8</v></c><c r="C3" t="b"><v>1</v></c></row>' +
        "</sheetData></worksheet>",
    ),
    "xl/worksheets/sheet2.xml": strToU8(
      '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
        '<row r="1"><c r="A1" t="inlineStr"><is><t>Second tab</t></is></c></row>' +
        "</sheetData></worksheet>",
    ),
  });
}

describe("parseXlsxWorkbook", () => {
  it("reads sheets in tab order, using the workbook's own names", () => {
    const wb = parseXlsxWorkbook(xlsxFixture());
    expect(wb.tables.map((t) => t.name)).toEqual(["Order", "Notes"]);
    expect(wb.omittedSheetNames).toEqual([]);
  });

  it("resolves shared strings, including multi-run cells", () => {
    const [order] = parseXlsxWorkbook(xlsxFixture()).tables;
    expect(order.rows[0][0]).toBe("Supplier Item");
    // `<si><r><t>ACM-</t></r><r><t>BLT-M8</t></r></si>` is one value, not two.
    expect(order.rows[1][0]).toBe("ACM-BLT-M8");
  });

  it("reads inline strings, formula strings and booleans", () => {
    const [order] = parseXlsxWorkbook(xlsxFixture()).tables;
    expect(order.rows[0][3]).toBe("Price");
    expect(order.rows[2][0]).toBe("ACM-NUT-M8");
    expect(order.rows[2][2]).toBe("TRUE");
  });

  it("renders a date-styled serial as a date, because 46191 is not what the sheet shows", () => {
    const [order] = parseXlsxWorkbook(xlsxFixture()).tables;
    expect(order.rows[1][1]).toBe("2026-06-18");
  });

  it("renders a percent-styled 0.15 as 15%, for the same reason", () => {
    const [order] = parseXlsxWorkbook(xlsxFixture()).tables;
    expect(order.rows[1][2]).toBe("15%");
  });

  it("leaves an ordinary number alone — no invented currency formatting", () => {
    const [order] = parseXlsxWorkbook(xlsxFixture()).tables;
    expect(order.rows[1][3]).toBe("1234.5");
  });

  it("keeps sparse cells in their real columns instead of shifting the row left", () => {
    const [order] = parseXlsxWorkbook(xlsxFixture()).tables;
    // Row 3 has A and C but no B: the boolean must stay under the "Discount" header.
    expect(order.rows[2]).toEqual(["ACM-NUT-M8", "", "TRUE", ""]);
  });

  it("throws on bytes that are not a readable workbook, rather than reporting an empty sheet", () => {
    expect(() => parseXlsxWorkbook(new Uint8Array([1, 2, 3, 4]))).toThrow();
  });
});
