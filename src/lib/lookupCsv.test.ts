import { describe, it, expect } from "vitest";
import { importLookupCsv, exportLookupCsv } from "./lookupCsv";

describe("lookup CSV", () => {
  it("imports an Excel-style CSV and lets the later row win", () => {
    const text = "\uFEFFFrom;To\r\nBLT-10;A-7\r\n\r\n\"NUT, 4\";B-2\r\n blt-10 ;A-8\r\n;C-1\r\n";
    expect(importLookupCsv(text, [{ from: "NUT, 4", to: "old" }], true)).toEqual({
      entries: [{ from: "NUT, 4", to: "B-2" }, { from: "blt-10", to: "A-8" }],
      added: 1,
      changed: 2,
    });
  });

  it("export quotes what needs quoting and re-imports unchanged", () => {
    const entries = [
      { from: "NUT, 4", to: 'say "hi"' }, { from: "BLT-10", to: "A-7" },
      { from: "A;B;C", to: "=1+1" }, { from: "-5", to: "x" },
    ];
    const csv = exportLookupCsv(entries);
    expect(csv).toContain("'=1+1");
    expect(importLookupCsv(csv, [], true).entries).toEqual(entries);
    const rows600 = Array.from({ length: 600 }, (_, k) => `K${k},V${k}`);
    const big = ["From,To", ...rows600].join(String.fromCharCode(10));
    expect(importLookupCsv(big, [], true).added).toBe(600);
  });
});
