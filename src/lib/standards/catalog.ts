// ──────────────────────────────────────────────────────────────────────────
// ProcuLink — Standards catalog (Group M)
//
// Typed, hand-transcribed catalog of which procurement standards ProcuLink
// supports, in which direction, at what conformance level — plus the
// canonical-PO-field → standards-reference map that powers the
// `StandardsFieldPopover` and the `/library/standards` comparison screen.
//
// SOURCE OF TRUTH (transcribed, not parsed at build time — a typed constant is
// cleaner and reviewable):
//   ProcuLink/docs/standards-matrix.md        (per-standard matrix + field table)
//   ProcuLink/docs/canonical-po-model.md      (canonical field definitions)
//
// ── Accuracy / honesty note (read before editing a status) ────────────────
// Statuses below are reconciled against the *actual backend code* on main
// (ProcuLink.Api/Program.cs DI registrations + ProcuLink.Transform classes),
// which is ahead of the dated matrix doc. The rule is: never claim a format is
// `supported` unless its parser/transformer is registered AND production-ready.
// Under-claiming (marking in-flight work `planned`/`partial`) is the safe error.
//
//   cXML 1.2 ............ parse supported · transform supported  (CxmlOrderParser / CxmlTransformService, registered)
//   UBL 2.1 Order ....... parse supported · transform supported  (UblOrderParser / UblOrderTransformService, registered)
//   Peppol BIS Order 3.0  partial both — rides the UBL pipeline; full BIS 3.0 conformance still hardening
//   EDIFACT ORDERS ...... parse partial · transform planned     (EdifactOrderParser registered; EdiFabric library decision pending; NO output transformer)
//   ANSI X12 850 ........ parse planned · transform planned      (X12OrderParser/X12TransformService scaffolding on main but in active Group M development — not production-certified)
//   JSON / REST payload . parse partial · transform supported    (inline parse in OrderService; JsonTransformService registered)
//   CSV (buyer template)  parse supported · transform supported  (CsvOrderParser / CsvTransformService, registered)
//   XLSX (buyer template) parse supported · transform none       (XlsxOrderParser registered; no XLSX output)
//   Text-based PDF ...... parse supported · transform none       (PdfOrderParser via PdfPig, registered)
//
// ISO 20022 is reference-only (documentation alignment; no transport in scope).
// ──────────────────────────────────────────────────────────────────────────

export type SupportLevel = "supported" | "partial" | "planned" | "none";

/** Coarse grouping used by the comparison screen. */
export type StandardFamily = "xml" | "edi" | "tabular" | "reference";

export interface StandardSupport {
  /** Stable id (kebab) used as a React key / palette routing token. */
  id: string;
  name: string;
  version: string;
  family: StandardFamily;
  /** Can ProcuLink ingest this format into the canonical PO model? */
  parse: SupportLevel;
  /** Can ProcuLink emit this format from the canonical PO model? */
  transform: SupportLevel;
  /** Typical transport / how it moves between buyer and supplier. */
  transport: string;
  /** Honest one-line conformance note — what works today, what is pending. */
  conformance: string;
  /** External spec reference. */
  referenceUrl: string;
}

export interface CanonicalFieldStandards {
  /** Canonical field name as defined in canonical-po-model.md (C# field name). */
  canonicalField: string;
  /** Human-friendly label for display. */
  label: string;
  /** Header vs line — for grouping in the popover/screen. */
  scope: "header" | "line";
  ubl?: string;
  peppolBis?: string;
  edifact?: string;
  x12?: string;
  cxml?: string;
}

// ── Standards support matrix ───────────────────────────────────────────────

export const STANDARDS: StandardSupport[] = [
  // ── XML-based ────────────────────────────────────────────────────────────
  {
    id: "cxml-1-2",
    name: "cXML",
    version: "1.2.024",
    family: "xml",
    parse: "supported",
    transform: "supported",
    transport: "HTTPS POST (OrderRequest envelope), supplier portals",
    conformance:
      "Header + line fidelity for OrderRequest; envelope round-trip; payloadID + timestamp emitted.",
    referenceUrl: "http://cxml.org/",
  },
  {
    id: "ubl-2-1-order",
    name: "UBL Order",
    version: "2.1 (OASIS)",
    family: "xml",
    parse: "supported",
    transform: "supported",
    transport: "HTTPS · Peppol Access Point · SMTP attachment",
    conformance:
      "Parses and emits the UBL 2.1 Order document (namespace Order-2); mandatory ID, IssueDate, OrderLine/LineItem covered.",
    referenceUrl:
      "http://docs.oasis-open.org/ubl/os-UBL-2.1/UBL-2.1.html",
  },
  {
    id: "peppol-bis-order-3",
    name: "Peppol BIS Order",
    version: "3.0",
    family: "xml",
    parse: "partial",
    transform: "partial",
    transport: "Peppol Access Point (AS4)",
    conformance:
      "Rides the UBL 2.1 pipeline; full BIS 3.0 business-rule conformance (UBL-CR / EN 16931 alignment) is still hardening. Access Point delivery is partner-wrapped.",
    referenceUrl:
      "https://docs.peppol.eu/poacc/upgrade-3/profiles/3-order/",
  },
  // ── EDI ──────────────────────────────────────────────────────────────────
  {
    id: "edifact-orders",
    name: "EDIFACT ORDERS",
    version: "UN D.96A",
    family: "edi",
    parse: "partial",
    transform: "planned",
    transport: "AS2 (partner-wrap) · SFTP · VAN",
    conformance:
      "EdifactOrderParser reads UNA/UNB/ORDERS segments; full segment coverage pending the EdiFabric-vs-open-source library decision. No outbound transformer yet.",
    referenceUrl:
      "https://service.unece.org/trade/untdid/d96a/trmd/orders_c.htm",
  },
  {
    id: "x12-850",
    name: "ANSI X12 850",
    version: "004010 / 005010",
    family: "edi",
    parse: "supported",
    transform: "supported",
    transport: "HTTPS · SFTP/FTPS · email · AS2 (on request)",
    conformance:
      "ANSI X12 850 parsing and outbound transform are live (004010/005010) with header + line-item fidelity, and the output is selectable per supplier. AS2/VAN transport is available on request.",
    referenceUrl: "https://x12.org/codes/transaction-sets",
  },
  // ── Tabular / document / API ───────────────────────────────────────────────
  {
    id: "json-rest",
    name: "JSON / REST PO payload",
    version: "canonical",
    family: "tabular",
    parse: "partial",
    transform: "supported",
    transport: "HTTPS POST (webhook), API ingress/egress",
    conformance:
      "JsonTransformService emits the canonical JSON artifact. Inbound JSON is parsed inline in OrderService (no standalone parser class yet).",
    referenceUrl: "https://www.json.org/",
  },
  {
    id: "csv",
    name: "CSV",
    version: "buyer-defined template",
    family: "tabular",
    parse: "supported",
    transform: "supported",
    transport: "HTTPS upload · SFTP · email attachment",
    conformance:
      "Column-alias matching; delimiter auto-detection (',' / ';'); RFC 4180 escaping on output.",
    referenceUrl: "https://www.rfc-editor.org/rfc/rfc4180",
  },
  {
    id: "xlsx",
    name: "XLSX",
    version: "buyer-defined template",
    family: "tabular",
    parse: "supported",
    transform: "none",
    transport: "HTTPS upload",
    conformance:
      "ClosedXML; first worksheet only; header-row matching with multi-alias columns. Input only — no XLSX output.",
    referenceUrl:
      "https://learn.microsoft.com/openspecs/office_standards/ms-xlsx/",
  },
  {
    id: "pdf-text",
    name: "Text-based PDF",
    version: "PO layout",
    family: "tabular",
    parse: "supported",
    transform: "none",
    transport: "HTTPS upload · email attachment",
    conformance:
      "PdfPig regex header + line extraction; conservative parsing; non-scanned only. Scanned/OCR is deferred.",
    referenceUrl: "https://github.com/UglyToad/PdfPig",
  },
  // ── Reference-only ───────────────────────────────────────────────────────
  {
    id: "iso-20022",
    name: "ISO 20022 (purchase-side)",
    version: "2013+",
    family: "reference",
    parse: "none",
    transform: "none",
    transport: "n/a — documentation alignment only",
    conformance:
      "Reference-only: canonical PO model concepts mapped to ISO 20022 procurement-relevant messages. No transport in scope.",
    referenceUrl: "https://www.iso20022.org/",
  },
];

// ── Canonical PO field → standards reference map ────────────────────────────
// Transcribed from the "Canonical PO Model fields" table in standards-matrix.md.
// Peppol BIS Order 3.0 constrains UBL 2.1 syntax, so its element paths match UBL.

export const FIELD_STANDARDS: CanonicalFieldStandards[] = [
  // ── Header (ParsedOrder) ──────────────────────────────────────────────────
  {
    canonicalField: "PoNumber",
    label: "PO number",
    scope: "header",
    ubl: "cbc:ID",
    peppolBis: "cbc:ID",
    edifact: "BGM 1004",
    x12: "BEG03",
    cxml: "OrderRequestHeader/@orderID",
  },
  {
    canonicalField: "OrderDate",
    label: "Order date",
    scope: "header",
    ubl: "cbc:IssueDate",
    peppolBis: "cbc:IssueDate",
    edifact: "DTM C507/2380",
    x12: "BEG05",
    cxml: "OrderRequestHeader/@orderDate",
  },
  {
    canonicalField: "BuyerName",
    label: "Buyer",
    scope: "header",
    ubl: "cac:BuyerCustomerParty/cac:Party/cac:PartyName/cbc:Name",
    peppolBis: "cac:BuyerCustomerParty/cac:Party/cac:PartyName/cbc:Name",
    edifact: "NAD BY",
    x12: "N1*BY",
    cxml: "OrderRequestHeader/Contact[@role='buyer']/Name",
  },
  {
    canonicalField: "Currency",
    label: "Currency",
    scope: "header",
    ubl: "cbc:DocumentCurrencyCode",
    peppolBis: "cbc:DocumentCurrencyCode",
    edifact: "CUX C504/6347",
    x12: "CUR02",
    cxml: "OrderRequestHeader/Total/Money/@currency",
  },
  {
    canonicalField: "Lines",
    label: "Lines",
    scope: "header",
    ubl: "cac:OrderLine",
    peppolBis: "cac:OrderLine",
    edifact: "LIN",
    x12: "PO1",
    cxml: "ItemOut",
  },
  // ── Line (ParsedOrderLine) ────────────────────────────────────────────────
  {
    canonicalField: "LineNumber",
    label: "Line number",
    scope: "line",
    ubl: "cbc:ID",
    peppolBis: "cbc:ID",
    edifact: "LIN 1082",
    x12: "PO101",
    cxml: "ItemOut/@lineNumber",
  },
  {
    canonicalField: "BuyerItemCode",
    label: "Buyer item code",
    scope: "line",
    ubl: "cac:Item/cac:BuyersItemIdentification/cbc:ID",
    peppolBis: "cac:Item/cac:BuyersItemIdentification/cbc:ID",
    edifact: "LIN C212 (IN)",
    x12: "PO107/PO109",
    cxml: "ItemOut/ItemID/BuyerPartID",
  },
  {
    canonicalField: "Description",
    label: "Description",
    scope: "line",
    ubl: "cac:Item/cbc:Description",
    peppolBis: "cac:Item/cbc:Description",
    edifact: "IMD C273/7008",
    x12: "PID05",
    cxml: "ItemOut/ItemDetail/Description",
  },
  {
    canonicalField: "Quantity",
    label: "Quantity",
    scope: "line",
    ubl: "cbc:Quantity",
    peppolBis: "cbc:Quantity",
    edifact: "QTY C186/6060",
    x12: "PO102",
    cxml: "ItemOut/@quantity",
  },
  {
    canonicalField: "Unit",
    label: "Unit of measure",
    scope: "line",
    ubl: "cbc:Quantity/@unitCode",
    peppolBis: "cbc:Quantity/@unitCode",
    edifact: "QTY C186/6411",
    x12: "PO103",
    cxml: "ItemOut/UnitOfMeasure",
  },
  {
    canonicalField: "UnitPrice",
    label: "Unit price",
    scope: "line",
    ubl: "cac:Price/cbc:PriceAmount",
    peppolBis: "cac:Price/cbc:PriceAmount",
    edifact: "PRI C509/5118",
    x12: "PO104",
    cxml: "ItemOut/UnitPrice/Money",
  },
];

// ── Lookup helpers ──────────────────────────────────────────────────────────

/** Standard label → its column key on CanonicalFieldStandards, in display order. */
export const STANDARD_REF_COLUMNS: ReadonlyArray<{
  key: keyof Pick<
    CanonicalFieldStandards,
    "ubl" | "peppolBis" | "edifact" | "x12" | "cxml"
  >;
  label: string;
}> = [
  { key: "ubl", label: "UBL" },
  { key: "peppolBis", label: "Peppol BIS" },
  { key: "edifact", label: "EDIFACT" },
  { key: "x12", label: "X12" },
  { key: "cxml", label: "cXML" },
];

const FIELD_INDEX: Record<string, CanonicalFieldStandards> = (() => {
  const index: Record<string, CanonicalFieldStandards> = {};
  for (const entry of FIELD_STANDARDS) {
    index[entry.canonicalField.toLowerCase()] = entry;
    index[entry.label.toLowerCase()] = entry;
  }
  return index;
})();

/**
 * Resolve standards references for a canonical field. Tolerant of either the
 * canonical C# field name ("PoNumber") or the human label ("PO number").
 * Returns undefined when no mapping exists.
 */
export function getFieldStandards(
  canonicalField: string,
): CanonicalFieldStandards | undefined {
  return FIELD_INDEX[canonicalField.trim().toLowerCase()];
}

/**
 * The standards references that actually have a value for a field, in display
 * order — used by StandardsFieldPopover so empty columns are skipped.
 */
export function fieldRefList(
  canonicalField: string,
): Array<{ label: string; ref: string }> {
  const entry = getFieldStandards(canonicalField);
  if (!entry) return [];
  return STANDARD_REF_COLUMNS.flatMap(({ key, label }) => {
    const ref = entry[key];
    return ref ? [{ label, ref }] : [];
  });
}

/** Human label for a support level, for badge text. */
export function supportLabel(level: SupportLevel): string {
  switch (level) {
    case "supported":
      return "Supported";
    case "partial":
      return "Partial";
    case "planned":
      return "Planned";
    case "none":
      return "—";
  }
}
