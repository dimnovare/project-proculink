// PO Mapping Engine

export interface ManipulatorEntry {
  type: string;
  params: string[];
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
  /**
   * A Scriban expression, evaluated instead of any binding above it. Mirrors
   * `OrderMappingOverride.OutputFieldRule.Expression` and sits at the TOP of the
   * backend's resolution precedence (`MappedTransformService.ResolveExpressionOrField`):
   * when this is set, `canonicalField`, `sourceToken` and `fixedValue` are ignored.
   *
   * Declared here because the designer's rule writers SPREAD the previous rule. Before
   * WP-15 they rebuilt it from a five-key literal, so an expression authored in the
   * template editor was destroyed the next time anyone rebound that node or changed
   * its date format — and the delivered document quietly changed with it.
   */
  expression?: string | null;
  /** Fixed-width output only: the column's width in characters, 1–1000. */
  width?: number;
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
  /**
   * JSON only — emit this leaf as a typed value instead of a string: "number" | "boolean" | "null".
   * Absent, and any unrecognised value, means STRING, which is what every leaf has always been, so
   * an absent declaration is byte-identical. CSV and XML ignore it: neither has types on the wire.
   *
   * A value that does not fit the declared type FAILS THE TRANSFORM rather than falling back to a
   * string — a receiver validating `quantity` as a number rejects the whole document, and would do
   * so after we had already reported the order delivered.
   */
  valueType?: string | null;
  /**
   * JSON only — "omit" drops the PROPERTY from its object when the leaf resolves to nothing
   * (whitespace counts). That is the distinction a receiver makes between "absent" and "empty
   * string", which nothing about a value can express. Null writes the empty value, as before.
   */
  emptyValue?: string | null;
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
  /**
   * CSV wire details (WP-15). Ignored by JSON/XML.
   *
   * Every member is optional and every absent member means "exactly the bytes the emitter produced
   * before dialects existed" — the promotion path proves a designed tree by BYTE PARITY, so a
   * default anywhere in here would change the output of every existing CSV supplier.
   *
   * Founder ruling 2026-07-31: existing layouts keep what they have; layouts created after that
   * default to CRLF, and the DESIGNER writes that in — the emitter never assumes it.
   */
  csvDialect?: CsvDialect | null;
}

/** See `OutputNodeTemplate.csvDialect`. Mirrors `ProcuLink.Core.Services.Mapping.CsvDialect`. */
export interface CsvDialect {
  /** Field separator. Absent → ",". A tab is the literal tab character. */
  delimiter?: string | null;
  /** "minimal" (absent/default, RFC 4180) or "always" — some importers need every field quoted. */
  quotePolicy?: string | null;
  /**
   * Row terminator, "
" or "
". Absent means the server's `Environment.NewLine`, which is
   * PLATFORM-DEPENDENT (LF on the container, CRLF on a Windows box) — preserved deliberately,
   * because pinning it is what would change existing suppliers' bytes.
   */
  lineEnding?: string | null;
  /** Output encoding by name, e.g. "windows-1252". Absent → UTF-8, no BOM. */
  encoding?: string | null;
  /** Absent/true writes the header row; false omits it for data-only feeds. */
  writeHeaderRow?: boolean | null;
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
  /**
   * 0..1 when a scorer actually ran. **`null` means NOTHING scored this pairing** — it is
   * not a low score and it must never be substituted with a number.
   *
   * This was `number` until the endpoint was caught sending a hard-coded `0.95` for every
   * entry of a supplier's saved PO mapping, which the mapper then rendered as
   * "AI confidence 95%". No model produced that value; the suggester is deliberately never
   * invoked on the saved-mapping path. Read `basis` to know which one you have.
   */
  confidence: number | null;
  /** Short human reason ("label 'Ihre Materialnr' ~ manufacturerPartNumber"). */
  reason: string;
  /** "canonical" | "raw" | "custom" — provenance of the source. */
  sourceKind: "canonical" | "raw" | "custom";
  /**
   * Where the suggestion came from:
   *  • "saved_mapping" — read back from the supplier's saved PO mapping. A configured
   *    fact, not a probability, so `confidence` is `null`.
   *  • "model" — a real scorer ran and `confidence` carries its number.
   *
   * Optional because responses from a backend deployed before this field existed omit it.
   * Do not branch on it by hand: `suggestionConfidenceDisplay` in
   * `src/components/bridge/mapper/suggestionBasisModel.ts` owns the rollout rule.
   */
  basis?: "saved_mapping" | "model";
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
/**
 * The manipulators an author may put on an output field, mirroring
 * `ProcuLink.Transform/Mapping/ManipulatorRegistry.cs`.
 *
 * **These are contracts, not labels.** The registry resolves each entry to a real C#
 * class whose constructor validates its own arity, so a wrong `params` list here does
 * not produce a bad label — it produces a failed transform, or worse, a silently wrong
 * document. Two entries were wrong before WP-15 and both were shipping hazards:
 *
 *   • `Concat` was declared `["suffix"]`. `ConcatManipulator` requires **≥ 2** params
 *     (`[separator, col1, col2, …]`), reads NAMED ROW COLUMNS, and ignores the incoming
 *     value entirely — it is the two-field JOIN, natively. One param throws
 *     `ArgumentException("Concat requires at least 2 params")` at transform time.
 *
 *   • `Fallback` was declared `["default"]`, hinted "use a default when the value is
 *     empty". `FallbackManipulator` treats every param as a COLUMN NAME and returns
 *     **null** when none of them holds a value. Used as a literal default it silently
 *     BLANKS the supplier's column.
 *
 * `LoadCatalogProduct` is in the registry and deliberately NOT here: it is the catalog
 * enrichment step wired by the catalog pipeline, not a formatting choice.
 *
 * `outputRuleModel.test.ts` pins every arity and both corrected hints.
 */
export const MANIPULATOR_TYPES: ReadonlyArray<{ type: string; params: string[]; hint: string }> = [
  { type: "Trim",         params: [],                        hint: "Remove leading and trailing spaces" },
  { type: "Replace",      params: ["find", "replace"],       hint: "Replace text (exactly 2 params)" },
  { type: "DateFormat",   params: ["from", "to"],            hint: "Reformat a date (e.g. yyyy-MM-dd → dd/MM/yyyy)" },
  { type: "NumberFormat", params: ["format"],                hint: "Reformat a number (e.g. 0.00)" },
  { type: "Concat",       params: ["separator", "field", "field…"],
    hint: "Join two or more FIELDS with a separator. Ignores this node's own value — the fields named here are the whole result." },
  { type: "Fallback",     params: ["field", "field…"],
    hint: "If this is empty, use another FIELD instead. Names fields, not literal text — and produces nothing when they are all empty." },
  { type: "Split",        params: ["separator", "index"],    hint: "Split on a separator, take the Nth part (0-based)" },
  { type: "Multiply",     params: ["factor"],                hint: "Multiply a number" },
  { type: "Divide",       params: ["divisor"],               hint: "Divide a number" },
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

/** Output formats the field-mapping live preview can render (backend supports all 6). */
export const PREVIEW_FORMATS: ReadonlyArray<{ value: OutputFormatId; label: string }> = [
  { value: "csv", label: "CSV" },
  { value: "json", label: "JSON" },
  { value: "xml", label: "XML" },
  { value: "cxml", label: "cXML" },
  { value: "ubl", label: "UBL" },
  { value: "x12", label: "X12" },
];

// Supplier delivery configuration

export type DeliveryProtocol = "manual" | "http" | "sftp" | "ftps" | "smtp" | "email" | "erp_erply" | "erp_directo" | "s3";

export type OutputFormatId = "xml" | "csv" | "cxml" | "json" | "ubl" | "x12" | "pdf";
