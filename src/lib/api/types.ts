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

export interface OrderMappingOverride {
  customFields: CustomField[];
  output?: OutputMappingConfig | null;
}

export interface MappingOverridePreview {
  format: string;
  contentType?: string;
  content: string | null;
  warning?: string;
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
