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
//   Peppol BIS Order 3.0  parse partial · transform PLANNED — a BIS Order file IS a UBL 2.1 Order, so it parses;
//                         BIS-conformant OUTPUT does not exist and must not be advertised (see the row's conformance note)
//   Peppol BIS Billing 3.0 (INVOICE, not an order) parse partial · transform partial — the generator
//                         emits the profile identifiers but nothing verifies them; no Schematron exists here,
//                         so BIS conformance is NOT checked and must not be advertised. API-only, no screen.
//   SAP IDoc ORDERS05 ... parse supported · transform none     (IDocOrders05Parser registered; hand-rolled XML, no EdiFabric; INBOUND only — no IDoc output; live-verified on prod 2026-06-08)
//   EDIFACT ORDERS ...... parse partial · transform planned     (EdifactOrderParser registered; EdiFabric library decision pending; NO output transformer)
//   ANSI X12 850 ........ parse supported · transform supported  (X12OrderParser / X12TransformService, registered; 004010/005010 header + line-item fidelity, output selectable per supplier)
//   JSON / REST payload . parse partial · transform supported    (inline parse in OrderService; JsonTransformService registered)
//   CSV (buyer template)  parse supported · transform supported  (CsvOrderParser / CsvTransformService, registered)
//   XLSX (buyer template) parse supported · transform none       (XlsxOrderParser registered; no XLSX output)
//   Text-based PDF ...... parse supported · transform none       (PdfPig text layer → AI structured extraction; PdfOrderParser regex is the no-key/offline fallback. Scanned/image-only PDFs use an AI vision fallback — every line flagged for review.)
//
// ISO 20022 is reference-only (documentation alignment; no transport in scope).
// ──────────────────────────────────────────────────────────────────────────

import { BINDABLE_HEADER_FIELDS, BINDABLE_LINE_FIELDS } from "@/lib/api/types";

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
    transport: "HTTPS · Peppol Access Point · email attachment",
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
    // `transform` was "partial", which read as "mostly there". It is not. Nothing in either repo
    // can substantiate BIS 3.0 conformance, and two mandatory-field violations are visible in the
    // emitter itself, so the honest level is `planned` — the work is understood, not delivered.
    // Downgraded 2026-08-01 alongside dropping the claim from every user-facing surface.
    //
    // 2026-08-06: the emitted DOCUMENT was brought into line with this row. Until then every UBL
    // order ProcuLink sent self-declared as BIS Order-only 3.0 via cbc:CustomizationID and
    // cbc:ProfileID, and the one order-side check asserted only that those two elements were
    // non-empty — on a document the emitter had just written them into, so it could never fail.
    // Both elements are now absent (they are minOccurs="0" in UBL 2.1) and both checks are gone.
    transform: "planned",
    transport: "Peppol Access Point (AS4)",
    conformance:
      "Inbound: a Peppol BIS Order file IS a UBL 2.1 Order, so it parses on the UBL pipeline (UblOrderParser has no BIS-specific branch). Outbound: BIS-CONFORMANT OUTPUT IS NOT OFFERED AND MUST NOT BE ADVERTISED. The emitted UBL order declares no Peppol profile at all — no cbc:CustomizationID and no cbc:ProfileID — because a receiving access point routes and validates on those, and nothing here can back the claim: there is no Schematron anywhere in either repo, and PeppolBisValidator is invoice-only. UblProfileChecker now checks OASIS UBL 2.1 mandatory elements and cardinalities only, and says so in its profile name. The emitter also writes the supplier GUID into SellerSupplierParty/PartyName/Name when no name is stored (UblOrderTransformService, flagged a placeholder in its own comment). No emitted order has been accepted by a real Access Point. Access Point delivery is partner-wrapped in any case.",
    referenceUrl:
      "https://docs.peppol.eu/poacc/upgrade-3/profiles/3-order/",
  },
  // The INVOICE profile, and a different document from the order row above. It has its own row
  // because it is the one format still declaring a Peppol profile, and a format that makes a
  // standards claim while absent from this catalog is invisible to every guard that reads it.
  //
  // Direction note: `parse`/`transform` are defined at the top of this file against the canonical
  // PO model, and an invoice is not a PO — it runs through InvoiceEntity, UblInvoiceParser and
  // PeppolBisInvoiceTransformService. The levels below describe that pipeline.
  {
    id: "peppol-bis-billing-3",
    name: "Peppol BIS Billing (invoice)",
    version: "3.0",
    family: "xml",
    // A BIS Billing file IS a UBL 2.1 Invoice, so it reads on the UBL invoice pipeline
    // (UblInvoiceParser has no BIS-specific branch) — same argument as the order row.
    parse: "partial",
    // NOT `supported`. The generator is registered and emits a BIS-shaped document covering the
    // business terms listed in PeppolBisInvoiceTransformService, but nothing validates the profile
    // it declares, so the catalog's own rule at the top of this file applies: under-claim.
    transform: "partial",
    transport: "Peppol Access Point (AS4) — ProcuLink does not provide the transport",
    conformance:
      "Outbound: the generator emits cbc:CustomizationID and cbc:ProfileID, and ProcuLink does not " +
      "verify them — the declaration is unverified, not a conformance result. Unlike the order row " +
      "above the identifiers are NOT removed, because they are a substring of the Peppol document " +
      "type identifier used for SMP lookup and AS4 routing (POLICY 20), so a document without them " +
      "cannot be addressed rather than being merely undeclared; the same is true of orders, which " +
      "is not why the order path dropped them. The official PEPPOL-EN16931-UBL Schematron is not " +
      "run: there is no Schematron in either repo, and .NET cannot execute the XSLT 2.0 it compiles " +
      "to without a new dependency. Covered are the mandatory business terms and arithmetic checks " +
      "in PeppolBisValidator; NOT covered are codelists, scheme-id correctness, allowances/charges, " +
      "payment means and mixed-rate VAT. No invoice has been accepted by a live access point. Treat " +
      "the file as input to an access point's validator. The generator is reachable only through " +
      "the API (GET /api/invoices/{id}/download?format=peppol and .../validate-peppol); no screen " +
      "offers it.",
    referenceUrl: "https://docs.peppol.eu/poacc/billing/3.0/",
  },
  {
    id: "sap-idoc-orders05",
    name: "SAP IDoc ORDERS05",
    version: "ORDERS05 (basic type)",
    family: "xml",
    parse: "supported",
    transform: "none",
    transport: "HTTPS upload · email attachment · SFTP",
    conformance:
      "Hand-rolled System.Xml.Linq parser (IDocOrders05Parser) — no commercial EDI library. The root <ORDERS05> is routed ahead of UBL/cXML; it maps E1EDK01/E1EDK02 header (BELNR, currency, order date), E1EDKA1 parties (AG buyer / LF supplier), and E1EDP01 lines (E1EDP19 IDTNR + E1EDPT1 long text). Inbound only — ProcuLink ingests the SAP IDoc and emits the supplier's chosen format; there is no IDoc output.",
    referenceUrl: "https://help.sap.com/docs/",
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
    // Two different directions, named separately on purpose: orders come IN over
    // the REST ingress endpoint, and go OUT as an HTTPS POST to the supplier's
    // URL. There is no webhook a counterparty can post orders to.
    transport: "REST ingress endpoint (in); HTTPS POST delivery (out)",
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
      "PdfPig reads the text layer, then AI structured extraction maps it to the canonical order (every emitted number is checked against the source) — the high-confidence primary path. A deterministic parser is the no-key/offline fallback. Scanned/image-only PDFs (no text layer) are read by an AI vision fallback; because there is no text to verify against, every line is flagged for review.",
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

// ── How much of the canonical model this reference actually covers ──────────
//
// FIELD_STANDARDS is a TRANSCRIPTION of the field table in standards-matrix.md, not a
// projection of the canonical model. It carries the fields somebody researched paths for and
// stops there. The model an output rule may bind is far larger — BINDABLE_HEADER_FIELDS +
// BINDABLE_LINE_FIELDS, mirroring `ProcuLink.Transform/Output/CanonicalRowFields.cs` — and
// the gap includes `SupplierItemCode`, the resolved code the product exists to produce.
//
// DO NOT CLOSE THE GAP BY ADDING ROWS. A field's UBL / EDIFACT / X12 / cXML path is real
// research; a guessed one is worse than a blank cell, because a blank cell does not get
// pasted into a supplier's onboarding spec.
//
// The gap gets DISCLOSED instead, and disclosed with numbers nobody types. This is the shape
// `requiresPlan()` uses in src/lib/gatedCapabilities.ts, for the same reason: a count typed
// into copy is a claim that stops tracking the data the moment either side moves. Three
// surfaces said otherwise until 2026-08-14 — the landing page promised "Every order field",
// /library/standards answered "No fields match" for fields the product carries, and
// /help/output-templates routed the reader to that screen.

/** Every canonical field an output rule may bind, both scopes — the denominator. */
const BINDABLE_CANONICAL_FIELDS: readonly string[] = [
  ...BINDABLE_HEADER_FIELDS,
  ...BINDABLE_LINE_FIELDS,
];

/** Canonical field names that carry a row in FIELD_STANDARDS. */
const REFERENCED_FIELDS: ReadonlySet<string> = new Set(
  FIELD_STANDARDS.map((f) => f.canonicalField),
);

export interface StandardsFieldCoverage {
  /** Bindable canonical fields that carry a standards reference row. */
  referenced: number;
  /** Bindable canonical fields in total. */
  total: number;
}

/**
 * `{ referenced: 10, total: 53 }` — the coverage of the field reference table, for copy that
 * needs to state it.
 *
 * Counted as an INTERSECTION rather than `FIELD_STANDARDS.length`, because the table also
 * carries the structural `Lines` container (`cac:OrderLine` / `PO1`), which is not a bindable
 * field — the row count overstates coverage by one. Derived from both registries, so adding a
 * reference row moves the numerator and adding a canonical field moves the denominator, with
 * no copy to update in either direction.
 */
export const STANDARDS_FIELD_COVERAGE: StandardsFieldCoverage = {
  referenced: BINDABLE_CANONICAL_FIELDS.filter((f) => REFERENCED_FIELDS.has(f)).length,
  total: BINDABLE_CANONICAL_FIELDS.length,
};

/**
 * A readable name for a canonical field — `"SupplierItemCode"` → `"Supplier item code"`.
 *
 * Prefers the catalog's own label when the field has a row; otherwise splits the PascalCase
 * key. Sentence case, because it renders inside a sentence.
 */
export function canonicalFieldLabel(field: string): string {
  const row = FIELD_STANDARDS.find((f) => f.canonicalField === field);
  if (row) return row.label;
  const words = field.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

/**
 * Canonical fields matching a free-text query that ProcuLink carries but has no standards
 * reference for. Empty for a blank query, and empty for a name the product does not have.
 *
 * This is the difference between the two honest empty states on /library/standards: "we have
 * no such field" and "we have this field, we just have not written its standards path down".
 * The screen said the first for both until 2026-08-14, so a search for `SupplierItemCode` —
 * the central resolved field — reported that it did not exist.
 */
export function canonicalFieldsWithoutStandards(query: string): readonly string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return BINDABLE_CANONICAL_FIELDS.filter(
    (f) =>
      !REFERENCED_FIELDS.has(f) &&
      (f.toLowerCase().includes(q) || canonicalFieldLabel(f).toLowerCase().includes(q)),
  );
}

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
