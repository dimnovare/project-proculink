export interface SupplierProfile {
  supplierName: string;
  requiresSupplierItemCode: boolean;
  requiredFields: string[];
  supportsPartialAutomation: boolean;
  acceptedFormats: string[];
}

// ── Core types ────────────────────────────────────────────────────────────

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
  | "delivery_failed";

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
  orderDate: string; // "yyyy-MM-dd"
  currency: string;
  status: OrderStatus;
  sourceFileKey?: string | null;
  createdAt: string;
  updatedAt: string;
  lines: OrderLine[];
  artifacts: Artifact[];
}

export interface OrderSummary {
  id: string;
  poNumber: string;
  supplierName: string;
  orderDate: string;
  status: OrderStatus;
  lineCount: number;
  unresolvedCount: number;
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
  hasDelivery: boolean;
}

// ── Dashboard ─────────────────────────────────────────────────────────────

export interface DashboardStats {
  totalOrdersThisMonth: number;
  pendingReview: number;
  delivered: number;
  totalOrders: number;
}

// ── Billing ────────────────────────────────────────────────────────────────

export type BillingPlan =
  | "pilot"
  | "growth"
  | "operations"
  | "integration"
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
