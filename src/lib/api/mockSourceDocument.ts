// mockSourceDocument — stand-in bytes for `GET /api/orders/{id}/source` in mock mode.
//
// Mock mode is what `bun run dev` and the Playwright suite run against, so if this returned
// nothing the document view would never execute its own renderers outside production. These
// are therefore REAL bytes of each format, not placeholders: a genuine CSV, a genuine XML
// interchange, and a genuine (very small) PDF that pdf.js actually parses and rasterises.
//
// Everything here is dead code in a production build — `USE_MOCK` is a build-time constant that
// is false whenever `NODE_ENV === "production"`, so the ternary that selects the real client
// shakes this module out.

/** Media types exactly as `SourceDocumentMediaType` on the server would send them. */
const CSV = "text/csv";
const XML = "application/xml";
const TEXT = "text/plain";
const PDF = "application/pdf";

const DEMO_CSV = `PO Number,Line,Supplier Item,Description,Qty,Unit,Unit Price,Currency,Delivery Date
PO-2026-0142,1,ACM-BLT-M8,"Hex bolt M8x40, zinc",480,PCE,0.42,EUR,2026-06-18
PO-2026-0142,2,ACM-NUT-M8,"Hex nut M8, zinc",480,PCE,0.11,EUR,2026-06-18
PO-2026-0142,3,ACM-WSH-M8,"Flat washer M8, DIN 125",960,PCE,0.04,EUR,2026-06-18
PO-2026-0142,4,ACM-SLV-22,"Bearing sleeve 22mm",36,PCE,7.90,EUR,2026-06-25
`;

const DEMO_XML = `<?xml version="1.0" encoding="UTF-8"?>
<OrderRequest>
  <OrderRequestHeader orderID="PO-2026-0142" orderDate="2026-06-01" type="new">
    <Total><Money currency="EUR">539.64</Money></Total>
    <ShipTo>
      <Address>
        <Name>Receiving Bay 3</Name>
        <PostalAddress>
          <Street>Industriestrasse 14</Street>
          <City>Bremen</City>
          <PostalCode>28195</PostalCode>
          <Country isoCountryCode="DE">Germany</Country>
        </PostalAddress>
      </Address>
    </ShipTo>
  </OrderRequestHeader>
  <ItemOut quantity="480" lineNumber="1">
    <ItemID><SupplierPartID>ACM-BLT-M8</SupplierPartID></ItemID>
    <ItemDetail>
      <UnitPrice><Money currency="EUR">0.42</Money></UnitPrice>
      <Description xml:lang="en">Hex bolt M8x40, zinc</Description>
      <UnitOfMeasure>PCE</UnitOfMeasure>
    </ItemDetail>
  </ItemOut>
</OrderRequest>
`;

const DEMO_EDI = `UNA:+.? '
UNB+UNOC:3+BUYER123:14+SUPPLIER456:14+260601:0930+000000042'
UNH+1+ORDERS:D:96A:UN'
BGM+220+PO-2026-0142+9'
DTM+137:20260601:102'
DTM+2:20260618:102'
NAD+BY+BUYER123::9'
NAD+SU+SUPPLIER456::9'
LIN+1++ACM-BLT-M8:SA'
IMD+F++:::Hex bolt M8x40 zinc'
QTY+21:480:PCE'
PRI+AAA:0.42'
UNS+S'
CNT+2:4'
UNT+14+1'
UNZ+1+000000042'
`;

/**
 * The smallest PDF that is genuinely a PDF: catalog → pages → one page → one content stream,
 * with a correct cross-reference table. Offsets are computed rather than hard-coded so an edit
 * to the visible text cannot silently corrupt the file.
 */
function buildDemoPdf(): Uint8Array {
  const lines = [
    "PURCHASE ORDER  PO-2026-0142",
    "Buyer: Heinrich Industries GmbH",
    "Supplier: Acme Components BV",
    "",
    "1  ACM-BLT-M8   Hex bolt M8x40, zinc     480 PCE   0.42 EUR",
    "2  ACM-NUT-M8   Hex nut M8, zinc         480 PCE   0.11 EUR",
    "3  ACM-WSH-M8   Flat washer M8 DIN 125   960 PCE   0.04 EUR",
    "4  ACM-SLV-22   Bearing sleeve 22mm       36 PCE   7.90 EUR",
    "",
    "Total 539.64 EUR      Delivery 2026-06-18",
  ];
  // `(` `)` and `\` are the only bytes that need escaping inside a PDF literal string.
  const escape = (s: string) => s.replace(/([\\()])/g, "\\$1");
  const text = lines
    .map((l, i) => `BT /F1 11 Tf 48 ${780 - i * 20} Td (${escape(l)}) Tj ET`)
    .join("\n");
  const stream = `${text}\n`;

  const objects = [
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Kids[3 0 R]/Count 1>>",
    "<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>",
    "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
    `<</Length ${stream.length}>>\nstream\n${stream}endstream`,
  ];

  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });

  const xrefStart = body.length;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) xref += `${String(off).padStart(10, "0")} 00000 n \n`;
  body += `${xref}trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xrefStart}\n%%EOF\n`;

  // Every byte above is ASCII, so a per-char code is a faithful encoding and avoids depending
  // on TextEncoder in a Node test environment.
  const bytes = new Uint8Array(body.length);
  for (let i = 0; i < body.length; i++) bytes[i] = body.charCodeAt(i) & 0xff;
  return bytes;
}

export interface MockSourceBytes {
  blob: Blob;
  contentType: string;
  filename: string;
}

/**
 * Pick demo bytes from the fixture's stored key. The EXTENSION is the right input here and only
 * here: this is standing in for the server's content sniff over bytes we are inventing, so the
 * key is the only thing that says what the fixture is meant to be. Production never reads it.
 *
 * `null` = this fixture has no displayable document, which is a state the UI must handle.
 */
export function mockSourceBytesForKey(key: string | null | undefined): MockSourceBytes | null {
  if (!key) return null;
  const name = key.split("/").pop() || key;
  const ext = name.split(".").pop()?.toLowerCase();
  const make = (body: string | Uint8Array, contentType: string): MockSourceBytes => ({
    // `as BlobPart` keeps the Uint8Array acceptable across the DOM lib versions in play.
    blob: new Blob([body as BlobPart], { type: contentType }),
    contentType,
    filename: name,
  });

  switch (ext) {
    case "csv":
      return make(DEMO_CSV, CSV);
    case "xml":
    case "cxml":
      return make(DEMO_XML, XML);
    case "edi":
    case "txt":
      return make(DEMO_EDI, TEXT);
    case "pdf":
      return make(buildDemoPdf(), PDF);
    default:
      // XLSX and anything else: no honest demo bytes, so the UI shows its "no document" state.
      return null;
  }
}
