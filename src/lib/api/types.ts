// PO Mapping Engine

export interface ManipulatorEntry {
  type: string;
  params: string[];
}

export interface FieldMappingEntry {
  externalField?: string;
  fixedValue?: string;
  fieldManipulators?: ManipulatorEntry[];
}

export interface PoMappingConfig {
  hasHeaderRecord: boolean;
  separator: string;
  header: Record<string, FieldMappingEntry>;
  lines: Record<string, FieldMappingEntry>;
}

export interface MappedOrderLine {
  lineNumber?: string;
  buyerItemCode?: string;
  description?: string;
  quantity?: string;
  unit?: string;
  unitPrice?: string;
}

export interface MappedOrder {
  poNumber?: string;
  orderDate?: string;
  buyerName?: string;
  currency?: string;
  lines: MappedOrderLine[];
}

export interface TestPoMappingRequest {
  headerRow: Record<string, string>;
  lineRows: Record<string, string>[];
  config: PoMappingConfig;
}

// ── Per-order mapping override (heart-piece-flex) ────────────────────────────
// Stored in the order's canonical_json; default (no override) leaves the transform
// byte-identical. OutputFieldRule reuses ManipulatorEntry (the existing engine).

export interface OutputFieldRule {
  /** The field name/path in the delivered document (e.g. "ItemCode"). */
  outputPath: string;
  /** Canonical field name (PoNumber/SupplierItemCode/…) or a customFields key. */
  canonicalField?: string | null;
  /** A literal value instead of a source field. */
  fixedValue?: string | null;
  /** Ordered manipulators applied to the resolved value (Trim/Replace/Concat/…). */
  fieldManipulators: ManipulatorEntry[];
}

export interface OutputMappingConfig {
  header: Record<string, OutputFieldRule>;
  lines: Record<string, OutputFieldRule>;
}

export interface CustomField {
  key: string;
  label: string;
  scope: "header" | "line";
  value?: string | null;
  lineValues?: Record<string, string> | null;
}

/**
 * One source→canonical re-derive rule (SourceMap engine, backend `SourceFieldRule`).
 * The effective canonical value for a field comes from a source token (by id), a fixed
 * literal, or — when both are null — the original parsed value, then runs through the
 * manipulator chain. Omitting a field from the SourceMap is always safe (pass-through).
 */
export interface SourceFieldRule {
  /** Stable source-token id to use as the raw value (e.g. "cell:r1c3" for CSV, an XPath for XML). */
  sourceToken?: string | null;
  /** Constant value used when `sourceToken` is null or yields no match. */
  fixedValue?: string | null;
  /** Ordered manipulator chain applied to the resolved value (reuses the existing engine). */
  manipulators: ManipulatorEntry[];
}

export interface OrderMappingOverride {
  customFields: CustomField[];
  output?: OutputMappingConfig | null;
  /**
   * Optional source→canonical remapping, keyed by canonical field NAME
   * (header: PoNumber/OrderDate/BuyerName/Currency/SupplierName;
   *  line: LineNumber/BuyerItemCode/SupplierItemCode/Description/Quantity/Unit/UnitPrice/LineTotal).
   * Null/absent = the parsed canonical values are used unchanged (byte-for-byte identical).
   */
  sourceMap?: Record<string, SourceFieldRule> | null;
  /**
   * Whole-document Scriban template. When non-blank, the transform renders the ENTIRE
   * output document from this single template (highest precedence — overrides `output`
   * field rules). Null/blank = field-by-field / default transform. See
   * docs/qa/2026-06-09-scriban-template-namespace.md for the available variables.
   */
  outputTemplate?: string | null;
  /**
   * MIME type stamped on the template-rendered artifact (default "application/json").
   * The file extension follows the content type (application/xml → .xml, text/plain → .txt).
   */
  outputTemplateContentType?: string | null;
}

/**
 * A single addressable value from the order's source file (backend `SourceToken`).
 * The `id` is the stable lookup key written into `SourceFieldRule.sourceToken`.
 */
export interface SourceToken {
  /** Stable, format-specific address (CSV: "cell:r{row}c{col}"; XML: an XPath). */
  id: string;
  /** Human-readable display name for the token chip. */
  label: string;
  /** The raw text value extracted from the source file. */
  value: string;
  /** "header" | "line" grouping hint, or null when the format has no distinction. */
  group?: string | null;
}

/** Summary returned by POST /api/orders/{id}/mapping-override/promote. */
export interface PromoteMappingResult {
  supplierId: string;
  headerFieldsPromoted: number;
  lineFieldsPromoted: number;
  /** Output-side mapping fields promoted (added 2026-06-09 backend). */
  outputHeaderFieldsPromoted?: number;
  outputLineFieldsPromoted?: number;
  /** Total across inbound source + output sides. */
  totalFieldsPromoted?: number;
  /** True when there was nothing promotable (show as info, not success). */
  nothingToPromote?: boolean;
  /** Human-readable result for both the success and nothing-to-save cases. */
  message?: string;
  schemaFingerprintHash?: string | null;
}

export interface MappingOverridePreview {
  format: string;
  contentType?: string;
  content: string | null;
  warning?: string;
  /**
   * Template-mode render error (Scriban compile/render failure). The endpoint returns
   * HTTP 200 with { ok:false, error } so the editor can surface it inline rather than
   * crashing. Null/absent on success.
   */
  error?: string | null;
}

/** The 8 manipulators ManipulatorRegistry supports, with their param hints. */
export const MANIPULATOR_TYPES: ReadonlyArray<{ type: string; params: string[]; hint: string }> = [
  { type: "Trim",       params: [],                 hint: "Remove leading/trailing whitespace" },
  { type: "Replace",    params: ["find", "replace"],hint: "Replace text (exactly 2 params)" },
  { type: "DateFormat", params: ["from", "to"],     hint: "Reformat a date (e.g. yyyy-MM-dd → dd/MM/yyyy)" },
  { type: "Concat",     params: ["suffix"],         hint: "Append text / join" },
  { type: "Fallback",   params: ["default"],        hint: "Use a default when the value is empty" },
  { type: "Split",      params: ["sep", "index"],   hint: "Split on a separator, take the Nth part" },
  { type: "Multiply",   params: ["factor"],         hint: "Multiply a number" },
  { type: "Divide",     params: ["divisor"],        hint: "Divide a number" },
];

/** Canonical fields selectable as a source in the mapping editor. */
export const CANONICAL_HEADER_FIELDS = ["PoNumber", "OrderDate", "BuyerName", "Currency", "SupplierName"] as const;
export const CANONICAL_LINE_FIELDS = ["LineNumber", "BuyerItemCode", "SupplierItemCode", "Description", "Quantity", "Unit", "UnitPrice", "LineTotal"] as const;

// ── Whole-document Scriban template mode ─────────────────────────────────────
// Mirrors docs/qa/2026-06-09-scriban-template-namespace.md (the backend source of
// truth). Used by the "proposed structure / available fields" reference panel.

/** A clickable template variable: the {{ token }} it inserts + a short note. */
export interface ScribanTemplateField {
  /** The exact text inserted at the cursor (already wrapped in {{ }}). */
  token: string;
  /** Short human-readable hint. */
  hint: string;
}

export interface ScribanTemplateGroup {
  label: string;
  fields: ScribanTemplateField[];
}

/** Header/global scope variables, the ShippingAddress object, and the Lines loop. */
export const SCRIBAN_TEMPLATE_GROUPS: ReadonlyArray<ScribanTemplateGroup> = [
  {
    label: "Header / globals",
    fields: [
      { token: "{{ OrderNr }}", hint: "PO number (alias of PoNumber)" },
      { token: "{{ OrderDate }}", hint: "Order date, ISO yyyy-MM-dd" },
      { token: "{{ Currency }}", hint: "e.g. EUR" },
      { token: "{{ BuyerName }}", hint: "Buyer name (empty if unknown)" },
      { token: "{{ SupplierName }}", hint: "Resolved supplier name" },
    ],
  },
  {
    label: "Shipping address",
    fields: [
      { token: "{{ ShippingAddress.Company }}", hint: "" },
      { token: "{{ ShippingAddress.FirstName }}", hint: "" },
      { token: "{{ ShippingAddress.LastName }}", hint: "" },
      { token: "{{ ShippingAddress.Address1 }}", hint: "" },
      { token: "{{ ShippingAddress.Address2 }}", hint: "" },
      { token: "{{ ShippingAddress.City }}", hint: "" },
      { token: "{{ ShippingAddress.ProvinceCode }}", hint: "" },
      { token: "{{ ShippingAddress.State }}", hint: "" },
      { token: "{{ ShippingAddress.PostalCode }}", hint: "" },
      { token: "{{ ShippingAddress.CountryCode }}", hint: "" },
      { token: "{{ ShippingAddress.Phone }}", hint: "" },
      { token: "{{ ShippingAddress.Email }}", hint: "" },
    ],
  },
  {
    label: "Lines loop — inside {{ for Line in Lines }} … {{ end }}",
    fields: [
      { token: "{{ for Line in Lines }}", hint: "Start the per-line loop" },
      { token: "{{ end }}", hint: "Close a for / if block" },
      { token: "{{ Line.LineNr }}", hint: "Line number (alias of LineNumber)" },
      { token: "{{ Line.SupplierItemCode }}", hint: "Resolved supplier item code" },
      { token: "{{ Line.DistributorPid }}", hint: "Alias of SupplierItemCode (Ingram-style)" },
      { token: "{{ Line.BuyerItemCode }}", hint: "The buyer's own code" },
      { token: "{{ Line.Description }}", hint: "Item description" },
      { token: "{{ Line.Qty }}", hint: "Quantity (real number, unquoted)" },
      { token: "{{ Line.UnitPrice }}", hint: "Unit price (real number, unquoted)" },
      { token: "{{ Line.LineTotal }}", hint: "Quantity × UnitPrice" },
      { token: "{{ if !for.last }},{{ end }}", hint: "Comma between JSON array items" },
    ],
  },
];

/** Content types a whole-document template can stamp on its artifact. */
export const TEMPLATE_CONTENT_TYPES: ReadonlyArray<{ value: string; label: string }> = [
  { value: "application/json", label: "JSON" },
  { value: "application/xml", label: "XML" },
  { value: "text/plain", label: "Plain text" },
];

/** Output formats the field-mapping live preview can render (backend supports all 6). */
export const PREVIEW_FORMATS: ReadonlyArray<{ value: OutputFormatId; label: string }> = [
  { value: "csv", label: "CSV" },
  { value: "json", label: "JSON" },
  { value: "xml", label: "XML" },
  { value: "cxml", label: "cXML" },
  { value: "ubl", label: "UBL" },
  { value: "x12", label: "X12" },
];

/** A realistic Ingram-Micro-style starter template for "Insert starter template". */
export const SCRIBAN_STARTER_TEMPLATE = `{
  "customerOrderNumber": "{{ OrderNr }}",
  "notes": "Order for {{ ShippingAddress.Company }}",
  "shipToInfo": {
    "contact": "{{ ShippingAddress.FirstName }} {{ ShippingAddress.LastName }}",
    "address1": "{{ ShippingAddress.Address1 }}",
    "city": "{{ ShippingAddress.City }}",
    "postalCode": "{{ ShippingAddress.PostalCode }}",
    "countryCode": "{{ ShippingAddress.CountryCode }}"
  },
  "lines": [{{ for Line in Lines }}
    {
      "customerLineNumber": "{{ Line.LineNr }}",
      "ingramPartNumber": "{{ Line.DistributorPid }}",
      "description": "{{ Line.Description }}",
      "quantity": {{ Line.Qty }},
      "unitPrice": {{ Line.UnitPrice }}
    }{{ if !for.last }},{{ end }}{{ end }}
  ]
}
`;

// Supplier delivery configuration

export type DeliveryProtocol = "http" | "sftp" | "ftps" | "smtp" | "erp_erply" | "erp_directo";

export type OutputFormatId = "xml" | "csv" | "cxml" | "json" | "ubl" | "x12";

export interface DeliveryConfig {
  supplierId: string;
  protocol: DeliveryProtocol;
  autoDeliver: boolean;
  configJson: string;
  outputFormat?: string | null;
  hasCredentials: boolean;
  credentialsDisplay?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertDeliveryConfigRequest {
  protocol: DeliveryProtocol;
  autoDeliver: boolean;
  configJson: string;
  credentialsJson?: string | null;
  outputFormat?: string | null;
}

export interface DeliveryTestResult {
  success: boolean;
  errorMessage?: string | null;
  responseCode?: number | null;
}

// ── Supplier product catalog (ground truth for AI suggestions) ───────────────

export interface SupplierProduct {
  id: string;
  code: string;
  name?: string | null;
  unit?: string | null;
  price?: number | null;
  currency?: string | null;
  barcode?: string | null;
  externalId?: string | null;
}

export interface SupplierCatalogPage {
  total: number;
  items: SupplierProduct[];
}

export interface SupplierCatalogImportResult {
  created: number;
  updated: number;
  skipped: number;
  total: number;
}

// ── Group V1 — versioned Supplier Connection ─────────────────────────────────
// Mirrors the backend contracts in ProcuLink.Api/Contracts/ConnectionDto.cs and
// the lifecycle on ProcuLink.Core/Entities/SupplierConnectionRevision.cs. A
// connection is the durable (org, supplier) handle; its ActiveRevisionId points
// at whichever immutable revision is currently published. Every order pins a
// ConnectionRevisionId — published revisions are immutable forever.

/** draft → test → published → archived. */
export type ConnectionRevisionStatus = "draft" | "test" | "published" | "archived";

/** Row shape for the Connections list (one per supplier in V1). */
export interface ConnectionSummary {
  id: string;
  supplierId: string;
  name: string;
  /** Null until the first publish. */
  activeRevisionId: string | null;
  /** Version number of the active published revision, or null when none is live. */
  activeVersionNo: number | null;
  createdAt: string;
  updatedAt: string;
}

/** A revision as shown in the revision-history list (no bundle body). */
export interface ConnectionRevisionSummary {
  id: string;
  versionNo: number;
  status: ConnectionRevisionStatus | string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  publishedAt: string | null;
  createdAt: string;
}

/** A connection plus its revision history (the detail-page header). */
export interface ConnectionDetail {
  id: string;
  supplierId: string;
  name: string;
  activeRevisionId: string | null;
  createdAt: string;
  updatedAt: string;
  /** Newest version first (backend orders by VersionNo descending). */
  revisions: ConnectionRevisionSummary[];
}

/** One product-code mapping carried by a revision. */
export interface ConnectionItemMapping {
  buyerItemCode: string;
  supplierItemCode: string;
  confidence: number;
  source: string;
}

/** The full revision bundle (input mapping + output template + delivery + …). */
export interface ConnectionRevision {
  id: string;
  connectionId: string;
  versionNo: number;
  status: ConnectionRevisionStatus | string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  publishedAt: string | null;
  createdAt: string;
  /** Snapshot of the supplier PO mapping config JSON (null = none). */
  inputMappingJson: string | null;
  /** Snapshot of the assigned output template config JSON (null = fixed transformer). */
  outputMappingJson: string | null;
  /** 'xml' | 'csv' | 'cxml' | 'json' | 'ubl' | 'x12'. */
  outputFormat: string | null;
  /** 'http' | 'sftp' | 'ftp' | 'erp_erply' | 'erp_directo'; null = no delivery configured. */
  deliveryProtocol: string | null;
  /** Non-secret delivery config JSON (endpoint, host, path, headers, timeout…). */
  deliveryConfigJson: string | null;
  deliveryAutoDeliver: boolean;
  /** True when an encrypted credential payload is present (the secret is never returned). */
  hasCredentials: boolean;
  acceptanceProfileId: string | null;
  acceptanceVersionNo: number | null;
  /** 'live' in V1 — the catalog is read live at ingest (no snapshot). */
  catalogMode: string;
  itemMappings: ConnectionItemMapping[];
}

/** The mutable bundle a caller may set when creating/updating a DRAFT revision. */
export interface ConnectionRevisionBundle {
  inputMappingJson?: string | null;
  outputMappingJson?: string | null;
  outputFormat?: string | null;
  deliveryProtocol?: string | null;
  deliveryConfigJson?: string | null;
  deliveryAutoDeliver: boolean;
  credentialsRef?: string | null;
  acceptanceProfileId?: string | null;
  acceptanceVersionNo?: number | null;
  /** Defaults to "live" on the backend when blank. */
  catalogMode: string;
  itemMappings?: ConnectionItemMapping[] | null;
}

/** Body for POST /api/connections/{id}/revisions. */
export interface CreateConnectionRevisionRequest {
  /** When true (default) and an active revision exists, the draft is cloned from it. */
  cloneFromActive: boolean;
  bundle?: ConnectionRevisionBundle | null;
}
