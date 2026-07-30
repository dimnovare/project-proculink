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
  /**
   * Bind this output node DIRECTLY to a source field (F-1). Holds the BARE SourceToken id
   * (e.g. "cell:r2c5", "/Order/Header/VatId", "raw:VAT number") — NOT prefixed with `src::`;
   * the backend prefixes `src::` on lookup. Twin of SourceFieldRule.sourceToken. Resolution
   * precedence is SourceToken OVER CanonicalField, so the two are alternative bindings: setting
   * one clears the other. Null/absent = bind by canonicalField (the original behaviour).
   */
  sourceToken?: string | null;
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

// ── OutputNode tree (Phase B/C — the structured output designer) ─────────────
// A recursive output template: build ARBITRARY structure (nesting, repeating groups,
// attributes, custom names) instead of a flat field list. Mirrors the backend
// OutputNodeTemplate / OutputNode. Node types are camelCase strings on the wire.

/** Output serialization format. NOTE cXML is "cXml" (the enum's camelCase name), not "cxml". */
export type OutputFormat = "csv" | "json" | "xml" | "cXml" | "ubl" | "x12";

export type OutputNodeType = "object" | "array" | "field" | "attribute";

export interface OutputNode {
  /** Element / JSON property / CSV column / EDI segment id. */
  name: string;
  nodeType: OutputNodeType;
  /** Children of an object/array node. */
  children?: OutputNode[];
  /** Leaf value recipe (field/attribute nodes) — reuses OutputFieldRule. */
  rule?: OutputFieldRule | null;
  /** For an array node: the collection to repeat over (v1: "lines", the default). */
  collection?: string | null;
  /**
   * Optional XML namespace URI bound to this element/attribute (e.g. the UBL CommonBasicComponents-2
   * URI for a `cbc:` element). Null → the legacy no-namespace emit (byte-identical). JSON/CSV ignore
   * it. MUST be carried through every tree edit unchanged or an inferred namespaced tree silently
   * loses its namespaces on save (data loss). Pairs with `prefix`.
   */
  namespace?: string | null;
  /**
   * Optional XML prefix (e.g. "cac"/"cbc") bound to `namespace`. Null prefix + non-null `namespace` →
   * a default namespace (no prefix). A prefix with NO `namespace` is an unrenderable half-state the
   * backend emitter rejects — always set/clear the two together (see setNodeNamespace). JSON/CSV
   * ignore it.
   */
  prefix?: string | null;
  /**
   * Optional CONDITIONAL inclusion — a bare Scriban boolean condition (no `{{ }}`), e.g.
   * `line.Quantity > 0` or `order.Currency == "EUR"`. Falsy → this node is skipped (a field is
   * omitted; on a list's item template, that line is dropped). Null/blank → always included.
   */
  includeWhen?: string | null;
}

export interface X12Envelope {
  isaSenderQualifier?: string | null;
  isaSenderId?: string | null;
  isaReceiverQualifier?: string | null;
  isaReceiverId?: string | null;
  version?: string | null;
  usageIndicator?: string | null;
}

export interface CxmlEnvelope {
  fromDomain?: string | null; fromIdentity?: string | null;
  toDomain?: string | null; toIdentity?: string | null;
  senderDomain?: string | null; senderIdentity?: string | null;
}

export interface EnvelopeConfig {
  x12?: X12Envelope | null;
  cxml?: CxmlEnvelope | null;
}

export interface OutputNodeTemplate {
  format: OutputFormat;
  root: OutputNode;
  /** Optional XML root namespaces (prefix → uri). Ignored by JSON/CSV. */
  namespaces?: Record<string, string> | null;
  /** EDI/cXML identity as data (WS-12). */
  envelope?: EnvelopeConfig | null;
}

export interface OrderMappingOverride {
  customFields: CustomField[];
  output?: OutputMappingConfig | null;
  /**
   * Optional STRUCTURED output template (Phase B — the OutputNode tree). HIGHEST precedence:
   * when present, the whole document is rendered from this tree, letting a supplier's exact
   * required structure be designed visually. Null = off (byte-identical to today).
   */
  outputTree?: OutputNodeTemplate | null;
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

// ── Phase 3 — unified mapper view-model + Phase-2 engine contracts ────────────
// Additive. The mapper renders three lanes (source universe / canonical spine /
// target schema) and wires between them via the EXISTING OrderMappingOverride
// (sourceMap = source→canonical; output = canonical→target). These types describe
// the spine's extensibility (Tier-2 custom fields), AI suggestions, catalog
// enrichment, and validation — surfaced as the badges/ghost-wires in the UI.

/** "header" | "line" — which scope a custom canonical field lives in. */
export type CanonicalFieldScope = "header" | "line";

/**
 * A Tier-2 user-defined canonical field (Phase-2 `CanonicalFieldDef`). Added inline
 * in the mapper's "+ Add field"; removal soft-deletes. Scoped to org/connection.
 */
export interface CanonicalFieldDef {
  /** Stable key used as the canonical field NAME in OrderMappingOverride.sourceMap/output. */
  key: string;
  label: string;
  scope: CanonicalFieldScope;
  type: "string" | "number" | "date" | "bool";
  /** Optional standards reference shown on demand (e.g. "UBL cbc:ID"). */
  standardsRef?: string | null;
  order?: number;
  /** True for the built-in spine fields (not removable). */
  system?: boolean;
}

/**
 * An AI-proposed source→target (or source→canonical) mapping, rendered as a ghost
 * wire the user accepts/rejects. Reuses the catalog allow-list discipline (never
 * an invented value). `sourceId` is a SourceToken id or a canonical field key.
 */
export interface MappingSuggestion {
  /** Target/output field path OR canonical field key being suggested a source for. */
  targetKey: string;
  /** Suggested source: a SourceToken id (raw/structured) or a canonical field key. */
  sourceId: string;
  /** 0..1. Rendered as a confidence ring; coloring reuses confidenceTier(). */
  confidence: number;
  /** Short human reason ("label 'Ihre Materialnr' ~ manufacturerPartNumber"). */
  reason: string;
  /** "canonical" | "raw" | "custom" — provenance of the source. */
  sourceKind: "canonical" | "raw" | "custom";
}

/** Per-field validation outcome surfaced as a green/amber badge. */
export interface FieldValidationState {
  /** Field key/path this applies to (canonical key or output path). */
  key: string;
  state: "valid" | "review";
  /** Tooltip reason when state="review" (e.g. "City looks like a label: 'UIDNr'"). */
  reason?: string | null;
  /** True = blocks delivery; false = advisory only. */
  blocking?: boolean;
}

/** A catalog price/code suggestion for a resolved line (Phase-2 `catalog.*`). */
export interface CatalogPriceHint {
  /** Line key this applies to. */
  lineKey: string;
  catalogCode: string;
  catalogPrice: number | null;
  poPrice: number | null;
  /** (catalog - po)/po as a percentage; null when either price is missing. */
  variancePercent: number | null;
  currency?: string | null;
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
  /**
   * F-1 Phase 4: the ordinal-stripped RELATIVE address of a line-group token, identical across
   * every line (CSV "cell:c{c}", XML "/Order/Lines/Line/Qty", EDI "seg:LIN.el1", JSON the array
   * index replaced with a star, e.g. "json:/lines/N/sku" without N). Binding
   * `sourceToken = relativeId` makes ONE output rule emit EACH line's own value. Null for
   * header/non-line tokens (they fill all lines via the header bag); undefined when the backend
   * hasn't deployed the field yet (back-compat).
   */
  relativeId?: string | null;
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

/**
 * The DEFAULT outgoing-document spine: the columns a supplier with no configured output is shown.
 *
 * Deliberately NOT the same list as BINDABLE_*_FIELDS below. These two were one list until WP-14,
 * which conflated "what the document shows by default" with "what an author may bind". Widening
 * this one to all 53 names would have turned the outgoing-document lane into 53 columns as a side
 * effect of a picker change. Pinned as a strict subset by `canonicalFields.test.ts`.
 */
export const CANONICAL_HEADER_FIELDS = ["PoNumber", "OrderDate", "BuyerName", "Currency", "SupplierName"] as const;
export const CANONICAL_LINE_FIELDS = ["LineNumber", "BuyerItemCode", "SupplierItemCode", "Description", "Quantity", "Unit", "UnitPrice", "LineTotal"] as const;

// ── WP-14: everything a custom output may bind ───────────────────────────────
//
// Mirror of `ProcuLink.Transform/Output/CanonicalRowFields.cs` (`Header` / `Line`) in the backend
// repo — the keys `BuildHeaderRow` / `BuildLineRow` actually put in the row bag. Binding a name
// that is not in that bag silently emits nothing, which is exactly how the old gap stayed
// invisible: the picker offered 13 names, the backend exposed 21, and the entity carried 52.
//
// Two repos cannot share a compile-time constant, so the pair is guarded from both ends:
// `canonicalFields.test.ts` here fails if this list drifts from the pinned expectation, and
// `CanonicalRowFieldsCompletenessTests` there fails if an entity field is neither exposed nor
// explicitly excluded with a written reason. Update both in the same change.

/** Header-scope canonical fields an output rule may bind. */
export const BINDABLE_HEADER_FIELDS = [
  // identity + document basics
  "PoNumber", "OrderDate", "BuyerName", "Currency", "SupplierName",
  // money + terms
  "SubTotal", "TaxTotal", "GrandTotal", "PaymentTerms", "RequestedDeliveryDate",
  // buyer identity + references
  "BuyerOrderRef", "BuyerTaxId",
  // ordering contact
  "ContactName", "ContactEmail", "ContactPhone",
  // shipping terms
  "Incoterms", "ShippingMethod",
  // ship-to address block
  "ShipToName", "ShipToDeliverTo", "ShipToStreet", "ShipToCity",
  "ShipToPostalCode", "ShipToCountry", "ShipToEmail", "ShipToPhone",
  // bill-to address block
  "BillToName", "BillToDeliverTo", "BillToStreet", "BillToCity",
  "BillToPostalCode", "BillToCountry", "BillToEmail", "BillToPhone",
] as const;

/** Line-scope canonical fields an output rule may bind. */
export const BINDABLE_LINE_FIELDS = [
  // identity + quantities
  "LineNumber", "BuyerItemCode", "SupplierItemCode", "Description",
  "Quantity", "Unit", "UnitPrice", "LineTotal",
  // money
  "LineAmount", "TaxRate", "DeliveryDate", "TaxAmount", "DiscountPercent", "NetAmount",
  // product identity
  "ManufacturerPartNumber", "ManufacturerName", "CustomerPartNumber", "Unspsc",
  // line-level routing / contract references
  "Recipient", "ContractNumber",
] as const;

/** One scope's worth of bindable fields, for a picker that groups its options. */
export interface CanonicalFieldGroup {
  scope: "header" | "line";
  label: string;
  fields: readonly string[];
}

/**
 * The bindable set grouped by scope. 53 names in one flat list is a wall; grouped, an operator
 * looking for a delivery address scans one section. The picker derives an option's group from
 * these lists rather than taking it as a prop, so every caller groups identically.
 */
export const CANONICAL_FIELD_GROUPS: ReadonlyArray<CanonicalFieldGroup> = [
  { scope: "header", label: "Order fields", fields: BINDABLE_HEADER_FIELDS },
  { scope: "line", label: "Line item fields", fields: BINDABLE_LINE_FIELDS },
];

/** The scope a canonical field belongs to, or null when the name is not a built-in field. */
export function canonicalFieldScope(field: string): "header" | "line" | null {
  if ((BINDABLE_LINE_FIELDS as readonly string[]).includes(field)) return "line";
  if ((BINDABLE_HEADER_FIELDS as readonly string[]).includes(field)) return "header";
  return null;
}

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

export type DeliveryProtocol = "http" | "sftp" | "ftps" | "smtp" | "email" | "erp_erply" | "erp_directo";

export type OutputFormatId = "xml" | "csv" | "cxml" | "json" | "ubl" | "x12";

/**
 * cXML network identities returned by the API (cleartext) plus a flag for the write-only Sender
 * shared secret. The secret value itself is never returned. Null on DeliveryConfig when the
 * supplier has no cXML credentials configured.
 */
export interface CxmlCredentials {
  fromDomain?: string | null;
  fromIdentity?: string | null;
  toDomain?: string | null;
  toIdentity?: string | null;
  senderDomain?: string | null;
  senderIdentity?: string | null;
  hasSharedSecret: boolean;
  /**
   * Configurable cXML `<!DOCTYPE>` DTD (T7). Free-text per supplier so any cXML version works.
   * `dtdSystemId` = the SYSTEM id / URI; `dtdPublicId` = optional PUBLIC id. Both unset = no DOCTYPE
   * (byte-identical to today). Optional — degrade gracefully if the API omits them.
   */
  dtdSystemId?: string | null;
  dtdPublicId?: string | null;
}

/**
 * cXML network credentials sent on upsert. Identities are cleartext; `senderSharedSecret` is
 * write-only — omit to keep the saved secret, send a value to replace it.
 */
export interface CxmlCredentialsInput {
  fromDomain?: string | null;
  fromIdentity?: string | null;
  toDomain?: string | null;
  toIdentity?: string | null;
  senderDomain?: string | null;
  senderIdentity?: string | null;
  senderSharedSecret?: string | null;
  /**
   * Configurable cXML `<!DOCTYPE>` DTD (T7). Persisted into the same cXML config the backend reads
   * as `CxmlConfigJson`. `dtdSystemId` = SYSTEM id / URI; `dtdPublicId` = optional PUBLIC id. Both
   * blank → omitted → no DOCTYPE (byte-identical to today).
   */
  dtdSystemId?: string | null;
  dtdPublicId?: string | null;
}

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
  cxmlCredentials?: CxmlCredentials | null;
}

export interface UpsertDeliveryConfigRequest {
  protocol: DeliveryProtocol;
  autoDeliver: boolean;
  configJson: string;
  credentialsJson?: string | null;
  outputFormat?: string | null;
  cxmlCredentials?: CxmlCredentialsInput;
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

// ── Group V7 — Connector Manifests ───────────────────────────────────────────

/**
 * A single configuration field descriptor within a connector manifest.
 * Mirrors ConnectorConfigFieldDto (ProcuLink.Api/Contracts/ConnectorManifestDto.cs).
 */
export interface ConnectorConfigField {
  /** JSON key the dispatcher reads (e.g. "url", "host", "port"). */
  name: string;
  /** Human-readable label for UI display. */
  label: string;
  /** Data type hint: "string", "number", "bool", "secret", or "url". */
  type: string;
  /** True when the dispatcher validates this field as required. */
  required: boolean;
  /** True when the field is stored in encrypted credentials rather than plain config JSON. */
  secret: boolean;
  /** Optional one-sentence help text for UI, or null. */
  helpText: string | null;
}

/**
 * API representation of a connector manifest.
 * Mirrors ConnectorManifestDto (ProcuLink.Api/Contracts/ConnectorManifestDto.cs).
 */
export interface ConnectorManifest {
  /** Protocol key (e.g. "http", "sftp", "erp_erply"). Matches DeliveryProtocolConstants. */
  key: string;
  /** Human-readable display name (e.g. "HTTP / REST", "SFTP"). */
  displayName: string;
  /** Transport category (e.g. "http", "sftp", "ftps", "smtp", "erp"). */
  transport: string;
  /** Supported authentication types (free-text description). */
  authType: string;
  /** Ordered configuration field descriptors. */
  fields: ConnectorConfigField[];
  /** Short capability notes, or null. */
  capabilities: string | null;
  /** Optional documentation URL, or null. */
  docsRef: string | null;
  /**
   * At-least-once resend caveat, e.g. "a repeat send overwrites the same file; no
   * duplicate" vs "we can't tell whether a repeat would arrive twice". Optional and
   * NOT part of ConnectorManifestDto — the backend's per-dispatcher ResendSafety
   * classification (ProcuLink.Core.Services.Delivery.ResendSafety) has no wire
   * representation yet, so this is attached client-side (see connectors.ts) from a
   * static, protocol-keyed lookup, for both mock AND live manifests.
   */
  resendCaveat?: string | null;
}

/**
 * Result of POST /api/connector-manifests/{key}/validate-config.
 * Mirrors ValidateConfigResultDto (ProcuLink.Api/Contracts/ConnectorManifestDto.cs).
 */
export interface ValidateConnectorConfigResult {
  /** True when all required fields are present and no unknown keys were posted. */
  valid: boolean;
  /** Required field names that are absent from the posted config object. */
  missing: string[];
  /** Keys present in the posted config object that are not declared in the manifest. */
  unknown: string[];
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
  // Launch batch 3 — stored test evidence (null/absent on never-tested revisions).
  testPassed?: boolean | null;
  testedAt?: string | null;
  testResultJson?: string | null;
}

/**
 * Evidence returned by POST /api/connections/{id}/revisions/{revId}/test.
 * The backend RUNS the real test pack (replay over recent orders + a conformance
 * check; never delivers), stores the evidence on the revision, marks it `test`,
 * and returns this summary. A FAILED pack still returns 200 with passed=false —
 * failure to PASS is not failure to RUN. `summaryJson` is the stored camelCase
 * TestPackSummary: { replay, conformance, error }.
 */
export interface ConnectionTestEvidence {
  passed: boolean;
  testedAt: string;
  summaryJson: string;
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

// ── Group V2 — replay / impact preview ───────────────────────────────────────
// Mirrors the backend contracts in ProcuLink.Api/Contracts/ReplayDto.cs. Replay
// runs historical orders through a revision (typically a DRAFT being vetted before
// publish) and returns a per-order DIFF vs. the order's CURRENT result. The call
// is NON-MUTATING and never delivers — nothing is written.
// Bounded server-side at ReplayService.MaxOrders (50) per call.

/** Body for POST /api/connections/{id}/revisions/{revisionId}/replay. */
export interface ReplayRequest {
  /**
   * Explicit order ids to replay (org-scoped, capped at 50). When null/empty,
   * the most recent {@link recentLimit} orders for the supplier are used.
   */
  orderIds?: string[] | null;
  /**
   * When orderIds is empty, replay the most recent N orders for the supplier.
   * Default 20; the backend clamps to 1..50.
   */
  recentLimit?: number;
}

/** "header" or "line" — scope of an effective-value or validation change. */
export type ReplayChangeScope = "header" | "line" | string;

/** "pass" or "fail" — a rule's outcome under one side of a validation diff. */
export type ReplayRuleStatus = "pass" | "fail" | string;

/** A single effective canonical-value change (header- or line-scoped). */
export interface ReplayFieldChange {
  /** "header" or "line". */
  scope: ReplayChangeScope;
  /** Line number for line-scope changes; null for header-scope. */
  lineNumber: number | null;
  field: string;
  currentValue: string | null;
  draftValue: string | null;
}

/** Aggregate pass/fail counts for one side of a validation diff. */
export interface ReplayValidationSummary {
  /** True when no rule failed (an order with no bound profile is considered passing). */
  passed: boolean;
  passCount: number;
  failCount: number;
  /** True when a bound acceptance profile was evaluated. */
  hasProfile: boolean;
}

/** One rule whose pass/fail status differs between the current and replayed validation. */
export interface ReplayValidationFlip {
  code: string;
  lineNumber: number | null;
  /** "pass"|"fail" under the order's current bound profile (null when the rule did not exist there). */
  currentStatus: ReplayRuleStatus | null;
  /** "pass"|"fail" under the replayed revision's bound profile (null when the rule does not exist there). */
  draftStatus: ReplayRuleStatus | null;
  message: string;
}

/**
 * The diff for one replayed order: the would-be output + validation under the
 * replayed revision, vs. the order's CURRENT result. Nothing here is persisted.
 */
export interface ReplayOrderDiff {
  orderId: string;
  poNumber: string;
  /** The output format the replayed revision would emit (e.g. "Csv", "Xml"). */
  outputFormat: string;

  // Output diff
  /** True when the replayed revision's output text differs from the order's current output text. */
  outputChanged: boolean;
  /** The order's CURRENT would-be output. Null if it could not be produced (e.g. unresolved lines). */
  currentOutput: string | null;
  /** The output the DRAFT/replayed revision would produce. Null if it could not be produced. */
  draftOutput: string | null;
  /** Set when the replayed revision's output could not be produced (broken template, unresolved lines, …). */
  outputError: string | null;

  // Canonical / effective-value diff
  effectiveValueChanges: ReplayFieldChange[];

  // Validation diff
  /** True when the order's pass/fail outcome flips under the replayed revision's bound profile. */
  validationChanged: boolean;
  currentValidation: ReplayValidationSummary;
  draftValidation: ReplayValidationSummary;
  validationFlips: ReplayValidationFlip[];
}

/** Response from POST /api/connections/{id}/revisions/{revisionId}/replay. */
export interface ReplayResponse {
  connectionId: string;
  revisionId: string;
  revisionVersionNo: number;
  revisionStatus: string;
  /** How many orders were actually replayed (after the cap / recent-window resolution). */
  orderCount: number;
  orders: ReplayOrderDiff[];
}
