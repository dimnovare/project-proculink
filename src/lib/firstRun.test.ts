import { describe, expect, it } from "vitest";
import {
  destinationNameFor, firstRunAddress, firstRunOf, foundSummary, isFirstFlow, keepsSummary, readFirstRunAddress, suggestFlowName, tableSummary, welcomeKinds,
} from "./firstRun";
import type { Flow, ReadField, ReadTable } from "./api/documents";

const field = (label: string): ReadField => ({
  key: label.toLowerCase(), label, value: "x", type: "text", meaning: null, confidence: 0.97, location: null, notOnPage: false, listed: true, edited: false,
});
const nine = ["A", "B", "C", "D", "E", "F", "G", "H", "I"].map(field);
const one = field("Total");
const cols = ["Code", "Item", "Qty", "Price", "Amount"];
const lines: ReadTable = {
  key: "lines", label: "Lines", listed: true,
  columns: cols.map((c) => ({ key: c.toLowerCase(), label: c, type: "text", meaning: null })),
  rows: [1, 2, 3].map(() => ({ cells: {} })),
};
const flow = (o: Partial<Flow>) => ({ id: "f", fieldsConfirmed: false, documentCount: 0, ...o }) as Flow;

describe("first run", () => {
  it("reads only an address it understands, and writes it back the same way", () => {
    const read = (q: string) => readFirstRunAddress(new URLSearchParams(q));
    expect(read("")).toEqual({ step: "add", flow: null, doc: null });
    expect(read("step=bogus&flow=f")).toEqual({ step: "add", flow: "f", doc: null });
    expect(read("step=send")).toEqual({ step: "add", flow: null, doc: null });
    expect(read("step=check&step=send&flow=f")).toEqual({ step: "add", flow: "f", doc: null });
    expect(read("step=check&flow=f")).toEqual({ step: "add", flow: "f", doc: null });
    expect(read("step=send&flow=f&doc=d")).toEqual({ step: "send", flow: "f", doc: "d" });
    expect(read("step=ready&flow=f&doc=d")).toEqual({ step: "ready", flow: "f", doc: "d" });
    expect(firstRunAddress({ step: "add", flow: "f" })).toBe("/flows/new?flow=f");
    expect(firstRunAddress({ step: "check", flow: "f", doc: "d" })).toBe("/flows/new?step=check&flow=f&doc=d");
    expect(isFirstFlow([flow({})], "f")).toBe(true);
    expect(isFirstFlow([flow({}), flow({ id: "g" })], "f")).toBe(false);
  });

  it("knows who is new only once the flows answered", () => {
    expect(firstRunOf(undefined)).toEqual({ state: "unknown" });
    expect(firstRunOf([])).toEqual({ state: "new", flow: null });
    expect(firstRunOf([flow({})])).toMatchObject({ state: "new", flow: { id: "f" } });
    expect(firstRunOf([flow({ documentCount: 1 })])).toEqual({ state: "returning" });
    expect(firstRunOf([flow({ fieldsConfirmed: true })])).toEqual({ state: "returning" });
    expect(firstRunOf([flow({}), flow({ id: "g" })])).toEqual({ state: "returning" });
  });

  it("words only what is known", () => {
    expect(suggestFlowName("Invoice")).toBe("Invoice");
    expect(suggestFlowName("Arve")).toBe("Arve");
    expect(suggestFlowName("")).toBeNull();
    expect(foundSummary({ fields: nine, tables: [lines] })).toBe("9 values and 1 table");
    expect(foundSummary({ fields: [one], tables: [] })).toBe("1 value");
    expect(foundSummary({ fields: [], tables: [lines, lines] })).toBe("2 tables");
    expect(foundSummary({ fields: [], tables: [] })).toBe("");
    expect(tableSummary(lines)).toBe("3 rows, 5 columns (Code, Item, Qty, Price, Amount)");
    expect(keepsSummary(9, 9)).toBe("keeps all 9 values and makes a CSV file");
    expect(keepsSummary(7, 9)).toBe("keeps 7 of 9 values and makes a CSV file");
    expect(keepsSummary(9, 9, 1)).toBe("keeps all 9 values and the table, and makes a CSV file");
    expect(keepsSummary(9, 9, 2)).toBe("keeps all 9 values and the 2 tables, and makes a CSV file");
    expect(destinationNameFor("sftp", "Invoices")).toBe("Invoices server");
    expect(destinationNameFor("google_sheets", "Invoices")).toBe("Invoices sheet");
    expect(destinationNameFor("carrier_pigeon", "Invoices")).toBe("Invoices destination");
    expect(welcomeKinds(undefined)).toBe("A PDF, an Excel or CSV file, or a photo of a paper document. Up to 10 MB.");
    expect(welcomeKinds({ scansOn: true, formatsOn: true })).toBe(
      "A PDF, a Word or Excel file, or a photo of a paper document. CSV, text, XML and JSON work too. Up to 10 MB.");
    expect(welcomeKinds({ scansOn: false, formatsOn: false })).toBe("A PDF, an Excel or CSV file. Up to 10 MB.");
  });
});
