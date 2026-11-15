import { describe, it, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { csvCells, exportLookupCsv, importCandidateCsv, lookupEntries, readTableFile, tableName } from "./lookupCsv";

describe("lookup CSV", () => {
  it("reads an Excel-style CSV: headings skipped, the later row wins in place", () => {
    const text = "﻿From;To\r\nBLT-10;A-7\r\n\r\n\"NUT, 4\";B-2\r\n blt-10 ;A-8\r\n;C-1\r\n";
    expect(lookupEntries(csvCells(text))).toEqual([{ from: "blt-10", to: "A-8" }, { from: "NUT, 4", to: "B-2" }]);
    expect(lookupEntries(csvCells("Code,Ours\n"))).toEqual([]);
    expect([tableName("supplier-codes.xlsx"), tableName(" .csv"), tableName("a.b.csv")]).toEqual(["supplier-codes", "Imported table", "a.b"]);
  });

  it("export quotes what needs quoting and reads back unchanged", () => {
    const entries = [
      { from: "NUT, 4", to: 'say "hi"' }, { from: "BLT-10", to: "A-7" },
      { from: "A;B;C", to: "=1+1" }, { from: "-5", to: "x" }, { from: "'=x", to: "''+y" },
    ];
    const csv = exportLookupCsv(entries);
    expect(csv).toContain("'=1+1");
    expect(lookupEntries(csvCells(csv))).toEqual(entries);
  });

  it("reads the first sheet of a workbook past the preview cap, and says when a file is too long", async () => {
    const sheet = (n: number) => zipSync({
      "xl/workbook.xml": strToU8('<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Codes" sheetId="1" r:id="rId1"/></sheets></workbook>'),
      "xl/_rels/workbook.xml.rels": strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'),
      "xl/worksheets/sheet1.xml": strToU8('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
        Array.from({ length: n }, (_, i) => `<row r="${i + 1}"><c r="A${i + 1}" t="inlineStr"><is><t>K${i}</t></is></c><c r="B${i + 1}" t="inlineStr"><is><t>V${i}</t></is></c></row>`).join("") +
        "</sheetData></worksheet>"),
    });
    const file = (bytes: Uint8Array, name: string) => new File([bytes], name);
    const read = await readTableFile(file(sheet(700), "codes.xlsx"));
    expect(read.cut).toBe(false);
    expect(lookupEntries(read.cells)).toHaveLength(699);
    expect((await readTableFile(file(sheet(20_003), "big.xlsx"))).cut).toBe(true);
    await expect(readTableFile(file(strToU8("PK\u0003\u0004junk"), "x.xlsx"))).rejects.toThrow();
    const csv = await readTableFile(new File(["From,To\nA,1\n"], "a.csv", { type: "text/csv" }));
    expect(csv).toEqual({ cells: [["From", "To"], ["A", "1"]], cut: false });
  });

  it("reads a list to choose from: column 1 is the value, the rest describe it", () => {
    const csv = ["﻿Code,Name,Unit", "SUP-1,Pilsner bottle,0.5L", "'=SUP-2,,", "sup-1,Pilsner can,", ",orphan,", `LONG-1,${"x".repeat(600)},`, ""].join("\n");
    expect(importCandidateCsv(csv, true)).toEqual([
      { value: "sup-1", description: "Pilsner can" },
      { value: "=SUP-2", description: null },
      { value: "LONG-1", description: "x".repeat(500) },
    ]);
  });
});
