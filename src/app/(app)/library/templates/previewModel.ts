// Pure preview helpers for the output-templates editor. Extracted from page.tsx so
// they can be unit-tested without pulling in the client component (React Query / the
// api-client). page.tsx re-exports/uses these; no behaviour change.

// Illustrative envelope previews — {tokens} are filled from the canonical order
// at delivery time. Keyed by uppercased format.
export const PREVIEW_BY_FORMAT: Record<string, string[]> = {
  CXML: ['<cXML payloadID="..." xml:lang="en-US">', "  <Request>", "    <OrderRequest>", '      <OrderRequestHeader orderID="{po}"', '          orderDate="{date}" type="new">', '        <Total><Money currency="{cur}">{total}</Money></Total>', "      </OrderRequestHeader>", '      <ItemOut quantity="{qty}">…</ItemOut>', "    </OrderRequest>", "  </Request>", "</cXML>"],
  UBL:  ['<Order xmlns="urn:oasis:...:Order-2">', "  <cbc:ID>{po}</cbc:ID>", "  <cbc:IssueDate>{date}</cbc:IssueDate>", "  <cac:OrderLine>", "    <cac:LineItem>", '      <cbc:Quantity unitCode="{uom}">{qty}</cbc:Quantity>', '      <cbc:LineExtensionAmount currencyID="{cur}">{amt}</cbc:LineExtensionAmount>', "    </cac:LineItem>", "  </cac:OrderLine>", "</Order>"],
  EDI:  ["UNH+1+ORDERS:D:96A:UN'", "BGM+220+{po}+9'", "DTM+137:{date}:102'", "NAD+BY+{buyer}'", "NAD+SU+{supplier}'", "LIN+1++{item}:VP'", "QTY+21:{qty}'", "UNS+S'", "UNT+12+1'"],
  EDIFACT: ["UNH+1+ORDERS:D:96A:UN'", "BGM+220+{po}+9'", "DTM+137:{date}:102'", "NAD+BY+{buyer}'", "NAD+SU+{supplier}'", "LIN+1++{item}:VP'", "QTY+21:{qty}'", "UNS+S'", "UNT+12+1'"],
  X12:  ["ST*850*0001~", "BEG*00*NE*{po}**{date}~", "REF*DP*DEPT~", "PO1*1*{qty}*EA*{price}**VP*{item}~", "CTT*1~", "SE*6*0001~"],
  JSON: ["{", '  "orderId": "{po}",', '  "orderDate": "{date}",', '  "currency": "{cur}",', '  "lines": [', '    { "item": "{item}", "qty": {qty}, "price": "{price}" }', "  ]", "}"],
  CSV:  ["po_number,order_date,supplier,currency", "{po},{date},{supplier},{cur}", "line,item,qty,unit_price", "1,{item},{qty},{price}"],
};

export function previewFor(fmt: string): string[] {
  return PREVIEW_BY_FORMAT[fmt.toUpperCase()] ?? PREVIEW_BY_FORMAT.JSON;
}

// The lines to preview AND export for a card: prefer the user's authored body
// (config.body) when present so a saved template shows/exports what was actually
// written — fall back to the static per-format skeleton only when there's no body.
export function bodyForPreview(card: { fmt: string; config?: { body?: string } | null }): string[] {
  const body = card.config?.body?.trim();
  return body ? body.split("\n") : previewFor(card.fmt);
}
