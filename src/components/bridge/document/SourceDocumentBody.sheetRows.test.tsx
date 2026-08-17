/* ── "This sheet is empty." for a sheet that is full ──────────────────────────
 *
 * THE DEFECT, VERBATIM (SourceDocumentBody.tsx):
 *
 *     if (table.rows.length === 0) {
 *       return <Message>This sheet is empty.</Message>;
 *     }
 *
 * A zero-row table does not establish that. `parseXlsxWorkbook`'s own docblock states the
 * contract this breaks — it "throws when the bytes are not a readable OOXML zip … rather than
 * pretending the sheet is empty" — and two paths inside it return no rows without throwing:
 *
 *   • sheetPreview.ts:318-319 — `readSheetRows` starts `const doc = parseXml(xml); if (!doc)
 *     return [];`, so a worksheet part the platform DOMParser rejects yields zero rows.
 *   • sheetPreview.ts:399     — `xml ? readSheetRows(…) : []`, so a worksheet part named by
 *     the workbook relationships but absent from the zip yields zero rows.
 *
 * Either way the operator — who opened this pane to check line 14's item code against the
 * paper — is told the spreadsheet is empty, and stops. The file is right there, one button
 * below, and nothing on screen suggests looking at it.
 *
 * THE DISTINCTION IS THE TEST, and it is driven through the REAL parser rather than a stub:
 * a genuinely empty sheet and an unreadable one are the same `rows: []` by the time this
 * component sees them, which is exactly why the copy may not choose between them. The three
 * inputs below are the same component in three different states — unreadable part, missing
 * part, and a real sheet with real rows.
 * ──────────────────────────────────────────────────────────────────────────── */

import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { zipSync, strToU8 } from "fflate";
import { SourceDocumentBody } from "./SourceDocumentBody";
import { parseXlsxWorkbook } from "@/lib/sheetPreview";
import type { SourceDocument } from "@/lib/sourceDocument";

afterEach(cleanup);

// jsdom's Blob has no `arrayBuffer()`, so without this every fixture below would reach the
// component as a REJECTED decode — i.e. the honest "we couldn't read this spreadsheet" branch
// — and the zero-row branch under test would never render at all. Same shim, same reason, as
// scrollRegion.test.tsx.
if (typeof Blob.prototype.arrayBuffer !== "function") {
  Blob.prototype.arrayBuffer = function arrayBuffer(this: Blob) {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this);
    });
  };
}

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const WORKBOOK = `<?xml version="1.0"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Orders" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;

const RELS = `<?xml version="1.0"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`;

const GOOD_SHEET = `<?xml version="1.0"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1"><c r="A1" t="str"><v>Item code</v></c><c r="B1" t="str"><v>Qty</v></c></row>
    <row r="2"><c r="A2" t="str"><v>ACM-BLT-M8</v></c><c r="B2"><v>140</v></c></row>
  </sheetData>
</worksheet>`;

/** Well-formed zip, malformed worksheet XML — sheetPreview.ts:318-319. */
const UNREADABLE_SHEET = "<worksheet><sheetData><row><c><v>ACM-BLT-M8</c></row>";

function xlsx(parts: Record<string, string>): Blob {
  const zipped = zipSync(
    Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, strToU8(v)])),
  );
  // Uint8Array → Blob, which is what the source endpoint hands this component.
  return new Blob([zipped.slice().buffer as ArrayBuffer], { type: XLSX_TYPE });
}

function doc(blob: Blob): SourceDocument {
  return { blob, contentType: XLSX_TYPE, filename: "orders.xlsx" };
}

function mount(document: SourceDocument) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <SourceDocumentBody cacheKey="ord-1" document={document} bounded={false} />
    </QueryClientProvider>,
  );
}

const UNREADABLE_XLSX = xlsx({
  "xl/workbook.xml": WORKBOOK,
  "xl/_rels/workbook.xml.rels": RELS,
  "xl/worksheets/sheet1.xml": UNREADABLE_SHEET,
});

const MISSING_PART_XLSX = xlsx({
  "xl/workbook.xml": WORKBOOK,
  "xl/_rels/workbook.xml.rels": RELS,
  // sheet1.xml is simply not in the zip — sheetPreview.ts:399.
  "xl/sharedStrings.xml": "<sst/>",
});

const GOOD_XLSX = xlsx({
  "xl/workbook.xml": WORKBOOK,
  "xl/_rels/workbook.xml.rels": RELS,
  "xl/worksheets/sheet1.xml": GOOD_SHEET,
});

describe("the fixtures really do reach this component as zero rows", () => {
  // ANTI-VACUITY FLOOR, and the point of the whole file: without this, the two DOM cases
  // below could be passing because the fixtures failed some earlier way — a thrown parse, an
  // unreadable zip — rather than through the silent-empty path they are written for.
  it("parses without throwing and yields no rows", async () => {
    for (const blob of [UNREADABLE_XLSX, MISSING_PART_XLSX]) {
      const wb = parseXlsxWorkbook(new Uint8Array(await blob.arrayBuffer()));
      expect(wb.tables).toHaveLength(1);
      expect(wb.tables[0].rows).toHaveLength(0);
    }
  });

  it("and the control fixture yields real rows through the same parser", async () => {
    const wb = parseXlsxWorkbook(new Uint8Array(await GOOD_XLSX.arrayBuffer()));
    expect(wb.tables[0].rows.length).toBeGreaterThan(0);
  });
});

describe("a sheet we could not read is not reported as an empty sheet", () => {
  it("says so when the worksheet XML is malformed", async () => {
    mount(doc(UNREADABLE_XLSX));

    const message = await screen.findByTestId("source-document-no-rows");
    // The defect, stated as the assertion.
    expect(message.textContent).not.toMatch(/this sheet is empty/i);
    // What is actually known, plus the escape hatch that is one button below.
    expect(message.textContent).toMatch(/couldn.t read any rows/i);
    expect(message.textContent).toMatch(/download/i);
  });

  it("says so when the worksheet part is missing from the workbook", async () => {
    mount(doc(MISSING_PART_XLSX));

    const message = await screen.findByTestId("source-document-no-rows");
    expect(message.textContent).not.toMatch(/this sheet is empty/i);
  });

  it("renders the grid, not a message, when rows really did come back", async () => {
    // ANTI-VACUITY: a component that showed the "couldn't read" line unconditionally would
    // pass both cases above. Same component, same parser, readable input.
    mount(doc(GOOD_XLSX));

    const grid = await screen.findByTestId("source-document-sheet");
    expect(grid.textContent).toContain("ACM-BLT-M8");
    await waitFor(() => expect(screen.queryByTestId("source-document-no-rows")).toBeNull());
  });
});
