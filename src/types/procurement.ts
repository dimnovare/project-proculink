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

export type OrderStatus = "pending_review" | "ready" | "transforming" | "delivered";

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
