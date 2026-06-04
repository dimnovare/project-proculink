export interface SupplierProfile {
  supplierName: string;
  requiresSupplierItemCode: boolean;
  requiredFields: string[];
  supportsPartialAutomation: boolean;
  acceptedFormats: string[];
}

// ── Core types ────────────────────────────────────────────────────────────

export interface BuyerDto {
  id: string;
  name: string;
  code: string;
  orderCount: number;
  lastOrderAge: string | null;
  formats: string[];
}

export interface Supplier {
  id: string;
  name: string;
}

export interface CreateSupplierPayload {
  name: string;
}

export interface RenameSupplierPayload {
  name: string;
}

export interface UpsertSupplierProfilePayload {
  outputFormat: string;
  destinationType: string;
  destinationConfig?: string | null;
  acceptedFormats?: string[];
}

export type OrderStatus =
  | "parsing"
  | "pending_review"
  | "ready"
  | "transforming"
  | "ready_to_deliver"
  | "delivered"
  | "failed"
  | "transform_failed"
  | "delivery_failed"
  | "delivery_dead_letter"
  | "rejected_by_supplier";

export interface OrderLine {
  id: string;
  lineNumber: number;
  buyerItemCode: string;
  supplierItemCode?: string | null;
  description?: string | null;
  quantity: number;
  unit?: string | null;
  unitPrice: number;
  confidence: number;
  needsReview: boolean;
  aiSuggestion?: AiMappingSuggestion | null;
}

export interface AiMappingSuggestion {
  supplierItemCode: string;
  confidence: number;
  reason: string;
  provenance: string;
}

export interface Artifact {
  id: string;
  format: string;
  fileKey: string;
  createdAt: string;
}

export interface Order {
  id: string;
  poNumber: string;
  supplierId: string;
  supplierName: string;
  /** Buyer name extracted from canonical JSON after parsing; null while parsing. */
  buyerName?: string | null;
  orderDate: string; // "yyyy-MM-dd"
  currency: string;
  status: OrderStatus;
  sourceFileKey?: string | null;
  createdAt: string;
  updatedAt: string;
  lines: OrderLine[];
  artifacts: Artifact[];
  /** True when this order was created by the onboarding sample-order endpoint. */
  isSample?: boolean;
  /** Human-readable error from the newest *Failed audit event; null for non-failed orders. */
  errorMessage?: string | null;
}

export interface OrderSummary {
  id: string;
  poNumber: string;
  supplierName: string;
  buyerName?: string | null;
  orderDate: string;
  status: OrderStatus;
  lineCount: number;
  unresolvedCount: number;
  totalValue?: number;
  currency?: string;
  sourceFormat?: string | null;
  createdAt: string;
}

export interface UploadResult {
  order: Order;
  validationMessages: string[];
}

export interface LineResolution {
  lineNumber: number;
  supplierItemCode: string;
}

export interface ResolvePayload {
  saveMappings: boolean;
  lineResolutions: LineResolution[];
}

export interface ResolveResult {
  order: Order;
}

export interface TransformResult {
  artifactId: string;
  format: string;
  createdAt: string;
}

export interface DownloadUrl {
  url: string;
  expiresAt: string;
}

export interface SupplierMapping {
  id: string;
  buyerItemCode: string;
  supplierItemCode: string;
  confidence?: number;
  source?: string;
}

// ── Audit trail ───────────────────────────────────────────────────────────

export interface AuditEvent {
  action: string;
  payload: Record<string, unknown> | null;
  createdAt: string;
}

// ── Onboarding ────────────────────────────────────────────────────────────

export interface OnboardingStatus {
  hasSupplier: boolean;
  hasUpload: boolean;
  hasResolvedMapping: boolean;
  hasDelivery: boolean;
}

// ── Dashboard ─────────────────────────────────────────────────────────────

export interface DashboardStats {
  totalOrdersThisMonth: number;
  pendingReview: number;
  delivered: number;
  totalOrders: number;
}

export interface TopologyBuyer {
  id: string;
  name: string;
  code: string;
  volume: string;
}

export interface TopologySupplier {
  id: string;
  name: string;
  code: string;
  volume: string;
  health: number;
}

export interface TopologyWire {
  buyerId: string;
  supplierId: string;
  weight: number;
  health: "ok" | "risk" | "down";
  alert?: number;
}

export interface DashboardTopology {
  buyers: TopologyBuyer[];
  suppliers: TopologySupplier[];
  wires: TopologyWire[];
}

// ── Billing ────────────────────────────────────────────────────────────────

export type BillingPlan =
  | "pilot"
  | "growth"
  | "operations"
  | "integration"
  | "distributor"
  | "enterprise";

export interface BillingStatus {
  plan:                   BillingPlan;
  accountStatus:          string;
  ordersThisMonth:        number;
  orderLimit:             number;
  suppliersUsed:          number;
  supplierLimit:          number;
  trialStartedAt:         string | null;
  trialEndsAt:            string | null;
  isTrialExpired:         boolean;
  isOrderLimitReached:    boolean;
  isSupplierLimitReached: boolean;
  canProcessOrders:       boolean;
  canAddSupplier:         boolean;
  stripeCustomerId:       string | null;
  stripeSubscriptionId:   string | null;
}

// ── Email polling settings ────────────────────────────────────────────────

export interface EmailSettings {
  enabled: boolean;
  host: string;
  port: number;
  useSsl: boolean;
  username: string;
  folder: string;
  defaultSupplierId: string | null;
  hasPassword: boolean;
  passwordDisplay?: string | null;
  lastPolledAt?: string | null;
  updatedAt?: string | null;
}

export interface UpdateEmailSettingsPayload {
  enabled: boolean;
  host: string;
  port: number;
  useSsl: boolean;
  username: string;
  password?: string | null;
  folder: string;
  defaultSupplierId?: string | null;
}

// ── Order list pagination ───────────────────────────────────────────────────
// GET /api/orders now returns a paginated envelope instead of a bare array.

export interface OrdersPage {
  items: OrderSummary[];
  totalCount: number;
  page: number;
  pageSize: number;
}

export interface GetOrdersParams {
  page?: number;
  pageSize?: number;
  status?: string;
  supplierId?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface OrdersSummary {
  byStatus: Partial<Record<OrderStatus, number>>;
  total: number;
}

// ── PO Passport (GET /api/orders/{id}/passport) ─────────────────────────────
// A full provenance/acceptance record for one order: every stage, every
// decision, every delivery attempt, and the supplier's response.

export interface PassportOrder {
  id: string;
  poNumber: string;
  status: string;
  supplierId: string | null;
  supplierName: string | null;
  buyerName: string | null;
  currency: string | null;
  orderDate: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  isSample: boolean;
}

export interface PassportSourceArtifact {
  storageKey: string | null;
  detectedFormat: string | null;
}

export interface PassportCanonical {
  lineCount: number;
  currency: string | null;
  totalValue: number | null;
  totalQuantity: number | null;
}

export interface PassportSupplierProfile {
  protocol: string | null;
  outputFormat: string | null;
  acceptedFormats: string[] | null;
  version: string | null;
  lastUpdatedAt: string | null;
}

export interface PassportValidationResult {
  ruleName?: string | null;
  severity?: string | null;
  message?: string | null;
  field?: string | null;
  passed?: boolean | null;
}

export interface PassportMappingDecision {
  lineNumber: number;
  buyerCode: string | null;
  supplierCode: string | null;
  source: "deterministic" | "ai" | "unresolved" | string;
  confidence: number | null;
}

/** Timeline/correction entries share the shape { action, at, payload }. */
export interface PassportEvent {
  action: string;
  at: string | null;
  payload?: Record<string, unknown> | null;
}

export interface PassportAiSuggestion {
  lineNumber: number;
  code: string | null;
  confidence: number | null;
  reason: string | null;
  provenance: string | null;
  status: string | null;
}

export interface PassportOutputArtifact {
  id: string;
  format: string | null;
  fileKey: string | null;
  createdAt: string | null;
}

export interface PassportDeliveryAttempt {
  attemptNumber: number;
  status: string | null;
  channel: string | null;
  destination: string | null;
  attemptedAt: string | null;
  responseCode: number | string | null;
  acknowledgedAt: string | null;
  rejectionReason: string | null;
  errorMessage: string | null;
}

export interface PassportSupplierResponse {
  outcome: "acknowledged" | "rejected" | "unknown" | string;
  acknowledgedAt: string | null;
  rejectionReason: string | null;
  responseCode: number | string | null;
  responseBody: string | null;
}

/** A free-text note; some backends return objects, so accept both. */
export type PassportNote = string | { text?: string | null; author?: string | null; at?: string | null };

export interface PassportDto {
  order: PassportOrder;
  sourceArtifact: PassportSourceArtifact | null;
  canonical: PassportCanonical | null;
  supplierProfile: PassportSupplierProfile | null;
  validationResults: PassportValidationResult[];
  mappingDecisions: PassportMappingDecision[];
  manualCorrections: PassportEvent[];
  aiSuggestions: PassportAiSuggestion[];
  outputArtifact: PassportOutputArtifact | null;
  deliveryAttempts: PassportDeliveryAttempt[];
  supplierResponse: PassportSupplierResponse | null;
  finalStatus: string | null;
  timeline: PassportEvent[];
  notes: PassportNote[];
}

// ── Supplier response / order confirmation (GET /api/orders/{id}/confirmation) ─

export type ConfirmationStatus =
  | "sent"
  | "accepted"
  | "accepted_with_changes"
  | "needs_review"
  | "rejected"
  | "no_response";

export type ConfirmationLineState = "confirmed" | "changed" | "rejected";

export interface SupplierConfirmationLine {
  lineNumber: number;
  buyerItemCode: string | null;
  supplierItemCode: string | null;
  orderedQuantity: number | null;
  confirmedQuantity: number | null;
  orderedUnitPrice: number | null;
  confirmedUnitPrice: number | null;
  orderedDeliveryDate: string | null;
  confirmedDeliveryDate: string | null;
  state: ConfirmationLineState | string;
}

export interface SupplierConfirmation {
  id: string;
  status: ConfirmationStatus | string;
  supplierReference: string | null;
  receivedAt: string | null;
  notes: string | null;
  lines: SupplierConfirmationLine[];
}

// ── Acceptance profile (GET/POST /api/suppliers/{id}/acceptance-profile) ──────

export interface AcceptanceRule {
  id?: string;
  scope: "order" | "line";
  fieldPath: string;
  operator: "equals" | "not_equals" | "contains" | "greater_than" | "less_than" | "required" | "max_length" | "in" | "min" | "max";
  expectedValue?: string;
  severity: "error" | "warning";
  blockOnFail: boolean;
}

export interface AcceptanceProfile {
  id: string;
  supplierId: string;
  versionNo: number;
  status: "draft" | "active";
  protocol?: string;
  outputFormat?: string;
  rules: AcceptanceRule[];
  createdAt: string;
}

export interface OrderValidationResult {
  orderId: string;
  passed: boolean;
  results: Array<{
    rule: AcceptanceRule;
    passed: boolean;
    message?: string;
    lineNumber?: number;
    severity: "error" | "warning";
  }>;
}

// ── Order exceptions ──────────────────────────────────────────────────────────
// Per-order:  GET /api/orders/{id}/exceptions
// All-orders: GET /api/exceptions?state=open|resolved|ignored
//
// The all-orders dashboard endpoint returns the richer shape (orderId, lineId,
// stage, code, state); the per-order endpoint may omit those, so they are
// optional here to keep both callers type-safe against the same interface.

export type ExceptionSeverity = "info" | "warning" | "error" | "critical";
export type ExceptionState = "open" | "resolved" | "ignored";

export interface OrderException {
  id: string;
  severity: ExceptionSeverity | string;
  message: string;
  createdAt: string;
  resolvedAt?: string | null;
  /** Owning order — present on the all-orders dashboard endpoint. */
  orderId?: string | null;
  /** Owning order line, when the exception is line-scoped. */
  lineId?: string | null;
  /** Pipeline stage that raised it (e.g. parse / validate / transform / deliver). */
  stage?: string | null;
  /** Machine-readable exception code. */
  code?: string | null;
  /** Lifecycle state — present on the all-orders dashboard endpoint. */
  state?: ExceptionState | string | null;
}
