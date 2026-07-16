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

// ── Order direction (per-org presentation setting) ──────────────────────────
// ProcuLink's built-in model is OUTBOUND (the org is the BUYER sending POs out
// to suppliers). Inbound orgs are the SUPPLIER receiving customer POs. The data
// model is direction-agnostic — this setting only changes DISPLAY labels.
// API contract is PascalCase ("Outbound" | "Inbound"); we normalise to lowercase
// internally (see api-client getOrgSettings/updateOrgSettings).
export type OrderDirection = "outbound" | "inbound";

export interface OrgSettings {
  direction: OrderDirection;
  /**
   * Org slug used to build the inbound ingress endpoint
   * (`{API_BASE}/api/ingress/<slug>/orders`). Optional because the backend
   * org-settings response may not include it yet (older API / mid-rollout);
   * the UI shows "generating…" when absent.
   */
  slug?: string;
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
  // Delivery paused because the plan can't process orders right now (billing).
  // Not a failure: the supplier file is intact, and the backend releases the order
  // back to ready_to_deliver automatically once billing is in good standing.
  | "delivery_held"
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
  /** Phase 4 enrichment — stated line amount as extracted from the source document. */
  lineAmount?: number | null;
  /** Phase 4 enrichment — per-line tax/VAT rate as a percentage. */
  taxRate?: number | null;
  /** Phase 4 enrichment — per-line delivery date, ISO "yyyy-MM-dd". */
  deliveryDate?: string | null;
}

export interface AiMappingSuggestion {
  supplierItemCode: string;
  /**
   * RAW model confidence (0–1) — never mutated by the V9 calibration layer.
   * The durable decision history keeps recording this raw value so the
   * empirical curve stays sound.
   */
  confidence: number;
  reason: string;
  provenance: string;
  // ── V9 confidence calibration (display-only overlay; backend OrderLineDto →
  // AiMappingSuggestionDto). All three are OPTIONAL so that an order fetched
  // before V9 was deployed degrades gracefully to "not calibrated". The
  // calibrated number is computed by the BACKEND from this org's accept/reject
  // history — it is NEVER recomputed client-side.
  /** Empirically-adjusted confidence (0–1). Equals `confidence` exactly when `isCalibrated` is false. */
  calibratedConfidence?: number;
  /** True only when a sufficiently-sampled empirical bucket backed the number; false during cold-start / thin buckets / AI off. */
  isCalibrated?: boolean;
  /** Truthful explanation, e.g. "calibrated from 23 of your past decisions" vs "model estimate — not enough history yet". */
  calibrationBasis?: string;
}

/**
 * The org-wide confidence-calibration summary from `GET /api/ai/calibration`
 * (backend CalibrationSummaryDto). Drives the "how reliable are our AI
 * suggestions" insight surface. `isActive` is false during cold-start — render
 * the honest "not enough history yet" state, not a misleading empty curve.
 */
export interface CalibrationSummary {
  isActive: boolean;
  totalDecisions: number;
  minBucketSamples: number;
  minOrgSamples: number;
  buckets: CalibrationBucket[];
}

/** One confidence bucket's empirical statistics (backend CalibrationBucketDto). */
export interface CalibrationBucket {
  /** Human-readable interval, e.g. "[0.85, 0.95)". */
  label: string;
  lowerInclusive: number;
  upperExclusive: number;
  accepted: number;
  rejected: number;
  total: number;
  /** Beta(1,1)-smoothed accept rate (accepted+1)/(total+2). */
  smoothedAcceptRate: number;
  /** True when the bucket has enough samples to drive a calibrated number. */
  isTrusted: boolean;
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
  // ── Phase 4 enrichment (header) ───────────────────────────────────────────
  /** Extracted document subtotal (before tax); null when not captured. */
  subTotal?: number | null;
  /** Extracted total tax/VAT amount; null when not captured. */
  taxTotal?: number | null;
  /** Extracted document grand total; prefer this over any client-computed total. */
  grandTotal?: number | null;
  /** Extracted payment terms as printed (e.g. "Net 30"); null when not captured. */
  paymentTerms?: string | null;
  /** Detected document type: "purchase_order" | "invoice" | "other" | null. */
  documentType?: string | null;
  /** Supplier name AS PRINTED ON THE DOCUMENT (extracted) — NOT the resolved supplier. */
  documentSupplierName?: string | null;
  // ── Auto-filled address / contact (structured-format writers emit these) ────
  // For structured formats (cXML / X12 / UBL) the backend writer fills the
  // address + contact blocks automatically from the order's canonical fields.
  // They appear in the live preview but are NOT editable in the mapper, so we
  // surface them READ-ONLY in "What we'll send" so the user can verify them.
  // ALL optional + `string | null` — the backend that supplies them may not be
  // deployed yet; consumers MUST optional-chain and render nothing when absent.
  /** Ship-to party name. */
  shipToName?: string | null;
  shipToStreet?: string | null;
  shipToCity?: string | null;
  shipToPostalCode?: string | null;
  shipToCountry?: string | null;
  /** Free-text "deliver to" / attention line for each party. */
  shipToDeliverTo?: string | null;
  /** Bill-to party name. */
  billToName?: string | null;
  billToDeliverTo?: string | null;
  billToStreet?: string | null;
  billToCity?: string | null;
  billToPostalCode?: string | null;
  billToCountry?: string | null;
  /** Primary contact for the order. */
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  /** Buyer tax / VAT registration id. */
  buyerTaxId?: string | null;
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
  // ── Optional header-field corrections (Item 2) ─────────────────────────────
  // Sent ONLY for fields the user actually edited in the order-review header.
  // The backend treats null/absent as "no change", so omitting a field leaves
  // the parsed value untouched. ISO "yyyy-MM-dd" for orderDate, ISO-4217 for
  // currency.
  orderDate?: string;
  buyerName?: string;
  currency?: string;
  // ── PO number + printed supplier name (display-only corrections) ───────────
  // The backend accepts both (trimmed, max 256). poNumber corrects the document
  // identity shown across the UI; supplierName corrects ONLY the printed/display
  // name and does NOT change routing/SupplierId (delivery still goes to the
  // resolved supplier). A header-only edit (poNumber with zero line resolutions)
  // is accepted by the resolve endpoint.
  poNumber?: string;
  supplierName?: string;
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

  // ── Extended status (onboarding-overhaul B1 shape) ────────────────────────
  // ALL extended fields are OPTIONAL: the backend extension may not be deployed
  // yet. Consumers must treat an absent field as "unknown" and degrade
  // gracefully (e.g. omit the step it backs) — never fabricate a 0/6 state.
  /** Org has at least one catalog row on a real (non-sample) supplier. */
  hasCatalog?: boolean;
  /** Org has at least one saved item mapping on a real supplier. */
  hasItemMappings?: boolean;
  /** Org has a saved delivery config on a real supplier. */
  hasDeliveryConfig?: boolean;
  /** A delivery-config test-fire succeeded (DeliveryAttempt with null OrderId). */
  hasTestFired?: boolean;
  /** First real supplier's id — checklist deep-link target; null when none. */
  firstSupplierId?: string | null;
  /** Order the resolve/send steps should open (unresolved first); null when none. */
  firstActionableOrderId?: string | null;
  /** Non-sample supplier count. */
  supplierCount?: number;
  /** Non-sample order count. */
  orderCount?: number;
  /** Non-sample orders that reached `delivered`. */
  deliveredCount?: number;
  /** Org has run the practice/sample order at least once. */
  hasSampleOrder?: boolean;
  /** Most recent sample order id; null when none. */
  sampleOrderId?: string | null;
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
  /** EFFECTIVE order limit = admin override ?? plan default. */
  orderLimit:             number;
  suppliersUsed:          number;
  /** EFFECTIVE supplier limit = admin override ?? plan default. */
  supplierLimit:          number;
  trialStartedAt:         string | null;
  trialEndsAt:            string | null;
  isTrialExpired:         boolean;
  isOrderLimitReached:    boolean;
  isSupplierLimitReached: boolean;
  /** TRUE for active paid plans even over the cap — paid orders are never blocked. */
  canProcessOrders:       boolean;
  canAddSupplier:         boolean;
  stripeCustomerId:       string | null;
  stripeSubscriptionId:   string | null;
  // ── Overage (paid plans bill extra orders at €0.50 each; never blocked) ─────
  /** Orders processed beyond the monthly cap this period (0 when within cap). */
  overageOrders:          number;
  /** EUR billed for those overage orders this period (overageOrders × €0.50). */
  overageAmountEur:       number;
  /** True at ≥80% of the order limit (gentle "approaching" heads-up). */
  nearLimit:              boolean;
  /** True at ≥100% of the order limit (over-cap overage messaging). */
  atLimit:                boolean;
  /**
   * Payment interval of the active Stripe subscription, derived server-side
   * from the persisted price id: "yearly" when it matches a `*YearlyPriceId`,
   * "monthly" otherwise, null when no Stripe subscription is on file (Pilot /
   * manual Enterprise). Informational only — the order quota stays a
   * calendar-month allowance regardless. Optional so older fixtures/responses
   * that omit it stay valid (treat absent as null → hide the interval line).
   */
  billingInterval?:       "monthly" | "yearly" | null;
}

// ── Admin: per-org limit / pilot overrides ──────────────────────────────────
// POST /api/admin/organisations/{id}/limits  (behind [AdminOnly]; 403 for non-admins).
// Every override is independent and optional; the matching clear* flag resets a
// field back to its plan default. extendTrialDays adds days to the current trial
// end; trialEndsAtOverride sets an absolute end date (ISO 8601).

export interface SetOrgLimitsRequest {
  orderLimitOverride?:    number;
  supplierLimitOverride?: number;
  /** Absolute trial end (ISO 8601). */
  trialEndsAtOverride?:   string;
  /** Relative extension added to the current trial end. */
  extendTrialDays?:       number;
  clearOrderLimit?:       boolean;
  clearSupplierLimit?:    boolean;
  clearTrialEnds?:        boolean;
}

export interface OrgLimitsResponse {
  id:                      string;
  name:                    string;
  plan:                    string;
  accountStatus:           string;
  orderLimitOverride?:     number | null;
  supplierLimitOverride?:  number | null;
  trialEndsAtOverride?:    string | null;
  effectiveOrderLimit:     number;
  effectiveSupplierLimit:  number;
  effectiveTrialEndsAt?:   string | null;
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
    /** Plain-language headline from the rule catalog (e.g. "Unit price at most"); message is the why+fix. */
    title?: string;
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
