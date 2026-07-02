import type {
  Order,
  OrderSummary,
  OrderStatus,
  OrdersPage,
  GetOrdersParams,
  Supplier,
  UploadResult,
  ResolvePayload,
  SupplierMapping,
  TransformResult,
  DownloadUrl,
  CreateSupplierPayload,
  RenameSupplierPayload,
  AuditEvent,
  OnboardingStatus,
  DashboardStats,
  DashboardTopology,
  PassportDto,
  SupplierConfirmation,
  OrdersSummary,
  CalibrationSummary,
} from "@/types/procurement";

// Shared API-layer primitives now live in a single source of truth (./api/core)
// so there is exactly ONE ApiHttpError class identity and one place to change
// auth / mock / timeout policy. Re-exported below to preserve the public surface.
import {
  API_BASE_URL,
  USE_MOCK,
  isApiMockMode,
  authHeader,
  fetchWithTimeout,
  delay,
  ApiHttpError,
} from "./api/core";

/**
 * Normalised public API base (no trailing slash). Exported so UI that needs to
 * display a backend URL — e.g. the inbound ingress endpoint on the Settings →
 * API keys tab — reuses the same normalization instead of re-reading the env.
 */
export const apiBaseUrl = API_BASE_URL;

// Re-export the shared primitives so every existing `@/lib/api-client` import
// (incl. ApiHttpError, isApiMockMode) keeps working unchanged.
export { ApiHttpError, isApiMockMode };

// ─── Support contact ───
// Placed near the top of api-client.ts so the support form chip doesn't
// merge-conflict with the concurrent runSampleOrder chip landing at the bottom.
export interface SupportContactPayload {
  category: "general" | "bug" | "billing" | "security";
  subject?: string;
  message: string;
  userEmail?: string;
  route?: string;
}

/**
 * True only in the live QA-bypass e2e harness (NEXT_PUBLIC_QA_BYPASS_AUTH=true),
 * paired with PROCULINK_QA_BYPASS_AUTH on the backend. In that mode the browser
 * has NO Clerk session, so the usual `clerkReady` data-query gate would starve
 * every query. This flag lets queries run anyway. It is unset in prod and mock,
 * so production/mock behavior is unchanged.
 */
export const isQaBypass = process.env.NEXT_PUBLIC_QA_BYPASS_AUTH === "true";

// ── Mock data ─────────────────────────────────────────────────────────────

const MOCK_SUPPLIERS: Supplier[] = [
  { id: "11111111-1111-1111-1111-111111111111", name: "FastParts Inc" },
  { id: "22222222-2222-2222-2222-222222222222", name: "ElectroSupply Co" },
  { id: "33333333-3333-3333-3333-333333333333", name: "GlobalComponents" },
  { id: "44444444-4444-4444-4444-444444444444", name: "PrecisionMfg" },
];

/** Mock mappings — keyed by supplierId, each entry has an id for delete. */
const mockMappings: Record<string, SupplierMapping[]> = {
  "22222222-2222-2222-2222-222222222222": [
    { id: "m-001", buyerItemCode: "TB-CAP-100", supplierItemCode: "ES-CAP-100UF" },
    { id: "m-002", buyerItemCode: "TB-LED-RED", supplierItemCode: "ES-LED-R5MM" },
  ],
  "11111111-1111-1111-1111-111111111111": [
    { id: "m-003", buyerItemCode: "ACM-BOLT-001", supplierItemCode: "FP-B001" },
    { id: "m-004", buyerItemCode: "ACM-NUT-001",  supplierItemCode: "FP-N001" },
  ],
};

/** Central mock order store — Phase 2 Order shape throughout. */
const mockOrders: Order[] = [
  {
    id: "ord-001",
    poNumber: "PO-2024-001234",
    supplierId: "11111111-1111-1111-1111-111111111111",
    supplierName: "FastParts Inc",
    buyerName: "Acme Manufacturing",
    orderDate: "2024-01-10",
    currency: "USD",
    status: "ready",
    sourceFileKey: "orgs/demo/orders/po-001234.xlsx",
    createdAt: "2024-01-10T14:30:00Z",
    updatedAt: "2024-01-10T14:30:00Z",
    lines: [
      { id: "l-001-1", lineNumber: 1, buyerItemCode: "ACM-BOLT-001",   supplierItemCode: "FP-B001",   description: "Steel Bolt M10x50",   quantity: 500,  unit: "PCS", unitPrice: 0.45, confidence: 1.0, needsReview: false },
      { id: "l-001-2", lineNumber: 2, buyerItemCode: "ACM-NUT-001",    supplierItemCode: "FP-N001",   description: "Steel Nut M10",       quantity: 500,  unit: "PCS", unitPrice: 0.25, confidence: 1.0, needsReview: false },
      { id: "l-001-3", lineNumber: 3, buyerItemCode: "ACM-WASHER-001", supplierItemCode: "FP-W001",   description: "Steel Washer M10",    quantity: 1000, unit: "PCS", unitPrice: 0.10, confidence: 1.0, needsReview: false },
    ],
    artifacts: [],
  },
  {
    id: "ord-002",
    poNumber: "PO-2024-005678",
    supplierId: "22222222-2222-2222-2222-222222222222",
    supplierName: "ElectroSupply Co",
    buyerName: "Nordic Electronics",
    orderDate: "2024-01-12",
    currency: "EUR",
    status: "pending_review",
    sourceFileKey: "orgs/demo/orders/po-005678.pdf",
    createdAt: "2024-01-12T09:15:00Z",
    updatedAt: "2024-01-12T09:15:00Z",
    lines: [
      { id: "l-002-1", lineNumber: 1, buyerItemCode: "TB-CAP-100", supplierItemCode: "ES-CAP-100UF", description: "Capacitor 100µF",     quantity: 200, unit: "PCS", unitPrice: 0.35,  confidence: 1.0, needsReview: false },
      {
        id: "l-002-2",
        lineNumber: 2,
        buyerItemCode: "TB-RES-220",
        supplierItemCode: null,
        description: "Resistor 220Ω",
        quantity: 500,
        unit: "PCS",
        unitPrice: 0.02,
        confidence: 0.0,
        needsReview: true,
        aiSuggestion: {
          supplierItemCode: "ES-RES-220R",
          confidence: 0.84,
          reason: "Buyer code and description match ElectroSupply resistor naming.",
          provenance: "Buyer code/description evidence plus nearby supplier mapping pattern",
        },
      },
      { id: "l-002-3", lineNumber: 3, buyerItemCode: "TB-LED-RED", supplierItemCode: "ES-LED-R5MM",   description: "LED Red 5mm",         quantity: 100, unit: "PCS", unitPrice: 0.15,  confidence: 1.0, needsReview: false },
      {
        id: "l-002-4",
        lineNumber: 4,
        buyerItemCode: "TB-WIRE-22",
        supplierItemCode: null,
        description: "Wire 22AWG Black 100m",
        quantity: 5,
        unit: "M",
        unitPrice: 12.50,
        confidence: 0.0,
        needsReview: true,
        aiSuggestion: {
          supplierItemCode: "ES-WIRE-22BK-100",
          confidence: 0.72,
          reason: "Description indicates 22AWG black wire in a 100m length.",
          provenance: "Buyer description evidence; no confirmed saved mapping",
        },
      },
    ],
    artifacts: [],
  },
  {
    id: "ord-003",
    poNumber: "PO-2024-009012",
    supplierId: "11111111-1111-1111-1111-111111111111",
    supplierName: "FastParts Inc",
    buyerName: "Acme Manufacturing",
    orderDate: "2024-01-14",
    currency: "USD",
    status: "delivered",
    sourceFileKey: "orgs/demo/orders/po-009012.csv",
    createdAt: "2024-01-14T11:45:00Z",
    updatedAt: "2024-01-14T12:30:00Z",
    lines: [
      { id: "l-003-1", lineNumber: 1, buyerItemCode: "MM-SHAFT-A1",     supplierItemCode: "FP-SH-A1",   description: "Drive Shaft Type A",    quantity: 25, unit: "PCS", unitPrice: 145.00, confidence: 1.0, needsReview: false },
      { id: "l-003-2", lineNumber: 2, buyerItemCode: "MM-BEARING-6205", supplierItemCode: "FP-BR-6205", description: "Ball Bearing 6205-2RS", quantity: 50, unit: "PCS", unitPrice: 8.75,   confidence: 1.0, needsReview: false },
    ],
    artifacts: [
      { id: "a-003-1", format: "xml", fileKey: "mock/ord-003/artifacts/a-003-1.xml", createdAt: "2024-01-14T12:30:00Z" },
    ],
  },
];

// ── Suppliers ─────────────────────────────────────────────────────────────

/** Mutable copy of MOCK_SUPPLIERS — mutated by create/rename/delete mocks. */
let mockSupplierList = [...MOCK_SUPPLIERS];

async function mockGetSuppliersFn(): Promise<Supplier[]> {
  await delay(200);
  return [...mockSupplierList];
}

async function realGetSuppliersFn(): Promise<Supplier[]> {
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/suppliers`, { headers: await authHeader() });
  if (!res.ok) throw new Error(`Failed to fetch suppliers: ${res.statusText}`);
  return res.json() as Promise<Supplier[]>;
}

// ─── Support contact ───

async function mockSubmitSupportRequest(payload: SupportContactPayload): Promise<{ ok: true; delivered: boolean; contactEmail: string }> {
  await delay(400);
  console.info("[mock] submitSupportRequest", payload);
  return { ok: true, delivered: true, contactEmail: "support@proculink.eu" };
}

async function realSubmitSupportRequest(payload: SupportContactPayload): Promise<{ ok: true; delivered: boolean; contactEmail: string }> {
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/support/contact`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeader().catch(() => ({} as Record<string, string>))),
    },
    body: JSON.stringify(payload),
  }, 30000);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `submitSupportRequest failed: ${res.status}`);
  }
  return res.json() as Promise<{ ok: true; delivered: boolean; contactEmail: string }>;
}

// ── Upload ────────────────────────────────────────────────────────────────

async function mockUploadPurchaseOrder(file: File, supplierId: string): Promise<UploadResult> {
  await delay(1500);
  const supplier    = MOCK_SUPPLIERS.find(s => s.id === supplierId);
  const supplierName = supplier?.name ?? "Unknown Supplier";
  const orderId     = `ord-${Date.now()}`;
  const now         = new Date().toISOString();
  const poNumber    = `PO-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 100000)).padStart(6, "0")}`;

  const lines: Order["lines"] = [
    {
      id: crypto.randomUUID(),
      lineNumber: 1,
      buyerItemCode: "ITEM-001",
      supplierItemCode: null,
      description: "Sample Part A",
      quantity: 100,
      unit: "PCS",
      unitPrice: 25.00,
      confidence: 0.0,
      needsReview: true,
      aiSuggestion: {
        supplierItemCode: "SUP-001",
        confidence: 0.79,
        reason: "Buyer code sequence matches existing supplier-code pattern.",
        provenance: "Buyer code evidence and sibling order line pattern",
      },
    },
    { id: crypto.randomUUID(), lineNumber: 2, buyerItemCode: "ITEM-002", supplierItemCode: "SUP-002", description: "Sample Part B", quantity: 50,  unit: "PCS", unitPrice: 15.50, confidence: 1.0, needsReview: false },
    {
      id: crypto.randomUUID(),
      lineNumber: 3,
      buyerItemCode: "ITEM-003",
      supplierItemCode: null,
      description: "Sample Part C",
      quantity: 200,
      unit: "PCS",
      unitPrice: 8.25,
      confidence: 0.0,
      needsReview: true,
      aiSuggestion: {
        supplierItemCode: "SUP-003",
        confidence: 0.68,
        reason: "Supplier-code pattern appears sequential but still needs review.",
        provenance: "Buyer code evidence and sibling order line pattern",
      },
    },
  ];
  const unresolvedCount = lines.filter(l => l.needsReview).length;

  const order: Order = {
    id: orderId, poNumber, supplierId, supplierName,
    orderDate: now.substring(0, 10), currency: "USD",
    status: unresolvedCount > 0 ? "pending_review" : "ready",
    sourceFileKey: null, createdAt: now, updatedAt: now,
    lines, artifacts: [],
  };

  mockOrders.unshift(order);
  return { order, validationMessages: unresolvedCount > 0 ? [`${unresolvedCount} line(s) require supplier item codes`] : [] };
}

async function realUploadPurchaseOrder(file: File, supplierId: string): Promise<UploadResult> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("supplierId", supplierId);

  const res = await fetchWithTimeout(`${API_BASE_URL}/api/orders/upload`, {
    method: "POST", headers: await authHeader(), body: formData,
  }, 60000);
  if (!res.ok) {
    const contentType = res.headers.get("content-type") ?? "";
    const body = contentType.includes("application/json")
      ? await res.json().catch(() => null)
      : await res.text().catch(() => "");
    const message =
      typeof body === "string"
        ? body
        : body && typeof body === "object" && "error" in body
          ? String((body as { error?: unknown }).error)
          : res.statusText;
    throw new ApiHttpError(`Upload failed: ${message || res.statusText}`, res.status, body);
  }
  return res.json() as Promise<UploadResult>;
}

// ── Order list / detail ───────────────────────────────────────────────────

/** Project an Order onto the lighter OrderSummary used by list views. */
function orderToSummary(o: Order): OrderSummary {
  const ext = o.sourceFileKey
    ? o.sourceFileKey.split(".").pop()?.toLowerCase() ?? null
    : null;
  const sourceFormat = ext === "pdf"  ? "pdf"
                     : ext === "csv"  ? "csv"
                     : ext === "xlsx" || ext === "xls" ? "xlsx"
                     : ext === "xml"  || ext === "cxml" ? "cxml"
                     : ext === "edi"  || ext === "x12"  ? "edi"
                     : null;
  return {
    id: o.id,
    poNumber: o.poNumber,
    supplierName: o.supplierName,
    buyerName: o.buyerName ?? null,
    orderDate: o.orderDate,
    status: o.status,
    lineCount: o.lines.length,
    unresolvedCount: o.lines.filter(l => l.needsReview).length,
    totalValue: o.lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0),
    currency: o.currency,
    sourceFormat,
    createdAt: o.createdAt,
  };
}

async function mockGetOrders(params: GetOrdersParams = {}): Promise<OrdersPage> {
  await delay(300);
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.max(1, params.pageSize ?? 25);

  let source = mockOrders;
  if (params.supplierId) source = source.filter(o => o.supplierId === params.supplierId);

  let items = source.map(orderToSummary);
  if (params.status) items = items.filter(o => o.status === params.status);
  if (params.search) {
    const q = params.search.toLowerCase();
    items = items.filter(o =>
      o.poNumber.toLowerCase().includes(q) ||
      o.supplierName.toLowerCase().includes(q) ||
      (o.buyerName ?? "").toLowerCase().includes(q),
    );
  }

  const totalCount = items.length;
  const start = (page - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), totalCount, page, pageSize };
}

async function realGetOrders(params: GetOrdersParams = {}): Promise<OrdersPage> {
  const qs = new URLSearchParams();
  qs.set("page", String(params.page ?? 1));
  qs.set("pageSize", String(params.pageSize ?? 25));
  if (params.status)     qs.set("status", params.status);
  if (params.supplierId) qs.set("supplierId", params.supplierId);
  if (params.search)     qs.set("search", params.search);
  if (params.dateFrom)   qs.set("dateFrom", params.dateFrom);
  if (params.dateTo)     qs.set("dateTo", params.dateTo);

  const res = await fetchWithTimeout(`${API_BASE_URL}/api/orders?${qs.toString()}`, { headers: await authHeader() });
  if (!res.ok) throw new Error(`Failed to fetch orders: ${res.statusText}`);
  return res.json() as Promise<OrdersPage>;
}

async function mockGetOrdersSummary(): Promise<OrdersSummary> {
  await delay(100);
  const byStatus: Partial<Record<OrderStatus, number>> = {};
  for (const o of mockOrders) {
    byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;
  }
  return { byStatus, total: mockOrders.length };
}

async function realGetOrdersSummary(): Promise<OrdersSummary> {
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/orders/summary`, { headers: await authHeader() });
  if (!res.ok) throw new Error(`Failed to fetch orders summary: ${res.statusText}`);
  return res.json() as Promise<OrdersSummary>;
}

// ── V9 AI confidence calibration insight ────────────────────────────────────
// GET /api/ai/calibration → the org's empirical reliability curve. Read-only,
// org-scoped. `isActive` is false during cold-start — callers must render the
// honest "not enough history yet" state rather than a misleading empty curve.

async function mockGetAiCalibration(): Promise<CalibrationSummary> {
  await delay(120);
  // A representative ACTIVE curve so the insight surface is demoable in mock
  // mode: high buckets accept more often than low ones, top bucket trusted.
  return {
    isActive: true,
    totalDecisions: 47,
    minBucketSamples: 8,
    minOrgSamples: 20,
    buckets: [
      { label: "[0, 0.5)",     lowerInclusive: 0,    upperExclusive: 0.5,  accepted: 1,  rejected: 6, total: 7,  smoothedAcceptRate: 0.22, isTrusted: false },
      { label: "[0.5, 0.75)",  lowerInclusive: 0.5,  upperExclusive: 0.75, accepted: 5,  rejected: 5, total: 10, smoothedAcceptRate: 0.50, isTrusted: true },
      { label: "[0.75, 0.85)", lowerInclusive: 0.75, upperExclusive: 0.85, accepted: 8,  rejected: 3, total: 11, smoothedAcceptRate: 0.69, isTrusted: true },
      { label: "[0.85, 0.95)", lowerInclusive: 0.85, upperExclusive: 0.95, accepted: 9,  rejected: 2, total: 11, smoothedAcceptRate: 0.77, isTrusted: true },
      { label: "[0.95, 1]",    lowerInclusive: 0.95, upperExclusive: 1,    accepted: 7,  rejected: 1, total: 8,  smoothedAcceptRate: 0.80, isTrusted: true },
    ],
  };
}

async function realGetAiCalibration(): Promise<CalibrationSummary> {
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/ai/calibration`, { headers: await authHeader() });
  if (!res.ok) throw new Error(`Failed to fetch AI calibration: ${res.statusText}`);
  return res.json() as Promise<CalibrationSummary>;
}

async function mockGetOrderById(id: string): Promise<Order | null> {
  await delay(200);
  return mockOrders.find(o => o.id === id) ?? null;
}

async function realGetOrderById(id: string): Promise<Order | null> {
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/orders/${id}`, { headers: await authHeader() });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to fetch order: ${res.statusText}`);
  return res.json() as Promise<Order>;
}

// ── PO Passport ─────────────────────────────────────────────────────────────

async function mockGetOrderPassport(orderId: string): Promise<PassportDto> {
  await delay(200);
  const o = mockOrders.find(x => x.id === orderId);
  if (!o) throw new ApiHttpError(`Order ${orderId} not found`, 404);

  const ext = o.sourceFileKey ? o.sourceFileKey.split(".").pop()?.toLowerCase() ?? null : null;
  const totalValue = o.lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
  const totalQuantity = o.lines.reduce((s, l) => s + l.quantity, 0);
  const profile = mockSupplierProfiles.find(p => p.supplierName === o.supplierName);
  const artifact = o.artifacts[0] ?? null;
  const isDelivered = o.status === "delivered";

  const timeline: PassportDto["timeline"] = [
    { action: "Uploaded", at: o.createdAt, payload: { source: o.sourceFileKey } },
  ];
  if (o.status !== "parsing") timeline.push({ action: "Parsed", at: o.updatedAt, payload: { lineCount: o.lines.length } });
  if (!o.lines.some(l => l.needsReview)) {
    timeline.push({ action: "Validated", at: o.updatedAt, payload: null });
    timeline.push({ action: "Mapped", at: o.updatedAt, payload: null });
  }
  if (artifact) timeline.push({ action: "Transformed", at: artifact.createdAt, payload: { format: artifact.format } });
  if (isDelivered) timeline.push({ action: "Delivered", at: o.updatedAt, payload: { format: artifact?.format ?? "xml" } });

  return {
    order: {
      id: o.id, poNumber: o.poNumber, status: o.status,
      supplierId: o.supplierId, supplierName: o.supplierName, buyerName: o.buyerName ?? null,
      currency: o.currency, orderDate: o.orderDate, createdAt: o.createdAt, updatedAt: o.updatedAt,
      isSample: o.isSample ?? false,
    },
    sourceArtifact: { storageKey: o.sourceFileKey ?? null, detectedFormat: ext },
    canonical: { lineCount: o.lines.length, currency: o.currency, totalValue, totalQuantity },
    supplierProfile: profile
      ? { protocol: "https", outputFormat: profile.acceptedFormats[0] ?? "xml", acceptedFormats: profile.acceptedFormats, version: "1.0", lastUpdatedAt: o.updatedAt }
      : null,
    validationResults: [],
    mappingDecisions: o.lines.map(l => ({
      lineNumber: l.lineNumber,
      buyerCode: l.buyerItemCode,
      supplierCode: l.supplierItemCode ?? l.aiSuggestion?.supplierItemCode ?? null,
      source: l.supplierItemCode ? "deterministic" : l.aiSuggestion ? "ai" : "unresolved",
      confidence: l.supplierItemCode ? 1 : l.aiSuggestion?.confidence ?? null,
    })),
    manualCorrections: [],
    aiSuggestions: o.lines
      .filter(l => l.aiSuggestion)
      .map(l => ({
        lineNumber: l.lineNumber,
        code: l.aiSuggestion!.supplierItemCode,
        confidence: l.aiSuggestion!.confidence,
        reason: l.aiSuggestion!.reason,
        provenance: l.aiSuggestion!.provenance,
        status: l.supplierItemCode ? "accepted" : "suggested",
      })),
    outputArtifact: artifact
      ? { id: artifact.id, format: artifact.format, fileKey: artifact.fileKey, createdAt: artifact.createdAt }
      : null,
    deliveryAttempts: isDelivered
      ? [{ attemptNumber: 1, status: "delivered", channel: "https", destination: `https://${o.supplierName.toLowerCase().replace(/\s+/g, "")}.example.com/po`, attemptedAt: o.updatedAt, responseCode: 200, acknowledgedAt: o.updatedAt, rejectionReason: null, errorMessage: null }]
      : [],
    supplierResponse: isDelivered
      ? { outcome: "acknowledged", acknowledgedAt: o.updatedAt, rejectionReason: null, responseCode: 200, responseBody: null }
      : null,
    finalStatus: o.status,
    timeline,
    notes: [],
  };
}

async function realGetOrderPassport(orderId: string): Promise<PassportDto> {
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/orders/${orderId}/passport`, { headers: await authHeader() });
  if (res.status === 404) throw new ApiHttpError(`Order ${orderId} not found`, 404);
  if (!res.ok) throw new Error(`Failed to fetch passport: ${res.statusText}`);
  return res.json() as Promise<PassportDto>;
}

// ── Supplier response / order confirmation ───────────────────────────────────

async function mockGetOrderConfirmation(orderId: string): Promise<SupplierConfirmation[]> {
  await delay(200);
  const o = mockOrders.find(x => x.id === orderId);
  if (!o || o.status !== "delivered") return [];
  return [
    {
      id: `conf-${o.id}`,
      status: "accepted_with_changes",
      supplierReference: `ACK-${o.poNumber}`,
      receivedAt: o.updatedAt,
      notes: "One line short-shipped; revised delivery date proposed.",
      lines: o.lines.map((l, i) => ({
        lineNumber: l.lineNumber,
        buyerItemCode: l.buyerItemCode,
        supplierItemCode: l.supplierItemCode ?? null,
        orderedQuantity: l.quantity,
        confirmedQuantity: i === 0 ? Math.max(0, l.quantity - 5) : l.quantity,
        orderedUnitPrice: l.unitPrice,
        confirmedUnitPrice: l.unitPrice,
        orderedDeliveryDate: o.orderDate,
        confirmedDeliveryDate: i === 0 ? o.orderDate : o.orderDate,
        state: i === 0 ? "changed" : "confirmed",
      })),
    },
  ];
}

async function realGetOrderConfirmation(orderId: string): Promise<SupplierConfirmation[]> {
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/orders/${orderId}/confirmation`, { headers: await authHeader() });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`Failed to fetch supplier response: ${res.statusText}`);
  return res.json() as Promise<SupplierConfirmation[]>;
}

// ── Resolve ───────────────────────────────────────────────────────────────

async function mockResolvePurchaseOrder(
  id: string, payload: ResolvePayload,
): Promise<{ order: Order; validationMessages: string[] }> {
  await delay(800);
  const idx = mockOrders.findIndex(o => o.id === id);
  if (idx === -1) throw new Error("Order not found");

  const order: Order = { ...mockOrders[idx], lines: mockOrders[idx].lines.map(l => ({ ...l })) };

  // Item 2: echo edited header fields so a refetch in mock mode shows the
  // "persisted" values (real backend persists; mock just mirrors the request).
  // poNumber + supplierName are display-only here too (supplierName never changes
  // the routed supplierId — same as the real backend).
  if (payload.orderDate    !== undefined) order.orderDate    = payload.orderDate;
  if (payload.buyerName    !== undefined) order.buyerName    = payload.buyerName;
  if (payload.currency     !== undefined) order.currency     = payload.currency;
  if (payload.poNumber     !== undefined) order.poNumber     = payload.poNumber;
  if (payload.supplierName !== undefined) order.supplierName = payload.supplierName;

  for (const res of payload.lineResolutions) {
    const li = order.lines.findIndex(l => l.lineNumber === res.lineNumber);
    if (li !== -1) {
      order.lines[li] = {
        ...order.lines[li],
        supplierItemCode: res.supplierItemCode,
        needsReview: false,
        confidence: 1.0,
        aiSuggestion: null,
      };
    }
  }

  if (payload.saveMappings) {
    const mappings = mockMappings[order.supplierId] ?? [];
    for (const res of payload.lineResolutions) {
      const line = order.lines.find(l => l.lineNumber === res.lineNumber);
      if (line?.buyerItemCode) {
        const mi = mappings.findIndex(m => m.buyerItemCode === line.buyerItemCode);
        const m: SupplierMapping = { id: `m-${Date.now()}`, buyerItemCode: line.buyerItemCode, supplierItemCode: res.supplierItemCode };
        if (mi >= 0) mappings[mi] = m; else mappings.push(m);
      }
    }
    mockMappings[order.supplierId] = mappings;
  }

  const unresolvedCount = order.lines.filter(l => l.needsReview).length;
  order.status    = unresolvedCount > 0 ? "pending_review" : "ready";
  order.updatedAt = new Date().toISOString();
  mockOrders[idx] = order;

  return { order, validationMessages: unresolvedCount > 0 ? [`${unresolvedCount} line(s) still require supplier item codes`] : [] };
}

async function realResolvePurchaseOrder(
  id: string, payload: ResolvePayload,
): Promise<{ order: Order; validationMessages: string[] }> {
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/orders/${id}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await authHeader() },
    body: JSON.stringify(payload),
  }, 30000);
  if (!res.ok) {
    const t = await res.text();
    // The backend returns 400 with a JSON body `{ "error": "<sentence>" }` for validation
    // failures (e.g. "At least one line resolution or header correction is required."). Surface
    // the clean sentence rather than dumping the raw `{error: …}` JSON into the toast.
    if (res.status === 400 && t) {
      let cleanError: string | null = null;
      try { cleanError = (JSON.parse(t) as { error?: string })?.error ?? null; } catch { /* not JSON → use raw text */ }
      if (cleanError) throw new Error(cleanError);
    }
    throw new Error(`Resolution failed: ${t || res.statusText}`);
  }
  // Backend returns OrderDto directly (not wrapped)
  const order = await res.json() as Order;
  return { order, validationMessages: [] };
}

// ── Transform ─────────────────────────────────────────────────────────────

type TransformFormat = "xml" | "csv" | "cxml" | "json" | "ubl" | "x12";

async function mockTransformOrder(orderId: string, format: TransformFormat = "xml"): Promise<TransformResult> {
  await delay(300); // simulate fast enqueue
  const idx = mockOrders.findIndex(o => o.id === orderId);
  if (idx === -1) throw new Error("Order not found");
  if (mockOrders[idx].lines.some(l => l.needsReview)) throw new Error("Resolve all lines before transforming.");

  // Set status to "transforming" immediately; simulate job completing after 3 s
  const now = new Date().toISOString();
  mockOrders[idx] = { ...mockOrders[idx], status: "transforming", updatedAt: now };

  setTimeout(() => {
    const i = mockOrders.findIndex(o => o.id === orderId);
    if (i === -1) return;
    const artifactId = crypto.randomUUID();
    const at = new Date().toISOString();
    const artifact = { id: artifactId, format, fileKey: `mock/${orderId}/artifacts/${artifactId}.${format}`, createdAt: at };
    mockOrders[i] = { ...mockOrders[i], status: "delivered", updatedAt: at, artifacts: [artifact, ...mockOrders[i].artifacts] };
  }, 3_000);

  return { artifactId: "", format, createdAt: now };
}

// format omitted → backend resolves the supplier's configured output format (or default).
async function realTransformOrder(orderId: string, format?: TransformFormat): Promise<TransformResult> {
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/orders/${orderId}/transform`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await authHeader() },
    body: JSON.stringify(format ? { format } : {}),
  }, 30000);
  if (res.status === 422) { const t = await res.text(); throw new Error(`Unresolved lines: ${t}`); }
  if (!res.ok) { const t = await res.text(); throw new Error(`Transform failed: ${t || res.statusText}`); }
  // 202 Accepted — job enqueued; return a placeholder result
  const body = await res.json() as Record<string, unknown>;
  return { artifactId: "", format: format ?? "xml", createdAt: new Date().toISOString(), ...body } as TransformResult;
}

// ── Retry delivery (operator replay + dead-letter) ────────────────────────

async function mockRetryDelivery(orderId: string): Promise<{ status: string }> {
  await delay(400);
  const idx = mockOrders.findIndex(o => o.id === orderId);
  if (idx !== -1) {
    // Simulate the retry succeeding shortly after enqueue.
    setTimeout(() => {
      const i = mockOrders.findIndex(o => o.id === orderId);
      if (i !== -1) mockOrders[i] = { ...mockOrders[i], status: "delivered", updatedAt: new Date().toISOString() };
    }, 2_500);
  }
  return { status: "delivering" };
}

async function realRetryDelivery(orderId: string): Promise<{ status: string }> {
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/orders/${orderId}/retry-delivery`, {
    method: "POST",
    headers: await authHeader(),
  }, 30000);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const message =
      body && typeof body === "object" && "error" in body
        ? String((body as { error?: unknown }).error)
        : res.statusText;
    throw new ApiHttpError(`retry-delivery failed: ${message || res.status}`, res.status, body);
  }
  return res.json() as Promise<{ status: string }>;
}

// ── Download ──────────────────────────────────────────────────────────────

async function mockGetDownloadUrl(orderId: string, artifactId: string): Promise<DownloadUrl> {
  await delay(200);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  return { url: `https://example.com/mock-download/${orderId}/${artifactId}`, expiresAt };
}

async function realGetDownloadUrl(orderId: string, artifactId: string): Promise<DownloadUrl> {
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/orders/${orderId}/artifacts/${artifactId}/download`, {
    headers: await authHeader(),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`Download URL failed: ${t || res.statusText}`); }
  return res.json() as Promise<DownloadUrl>;
}

// ── Supplier mappings ─────────────────────────────────────────────────────

async function mockGetSupplierMappings(supplierId: string): Promise<SupplierMapping[]> {
  await delay(300);
  return mockMappings[supplierId] ?? [];
}

async function realGetSupplierMappings(supplierId: string): Promise<SupplierMapping[]> {
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/suppliers/${supplierId}/mappings`, {
    headers: await authHeader(),
  });
  if (!res.ok) throw new Error(`Failed to fetch mappings: ${res.statusText}`);
  return res.json() as Promise<SupplierMapping[]>;
}

async function mockDeleteSupplierMapping(supplierId: string, mappingId: string): Promise<void> {
  await delay(300);
  const list = mockMappings[supplierId];
  if (list) mockMappings[supplierId] = list.filter(m => m.id !== mappingId);
}

async function realDeleteSupplierMapping(supplierId: string, mappingId: string): Promise<void> {
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/suppliers/${supplierId}/mappings/${mappingId}`, {
    method: "DELETE", headers: await authHeader(),
  }, 30000);
  if (!res.ok) { const t = await res.text(); throw new Error(`Delete failed: ${t || res.statusText}`); }
}

async function mockCreateSupplierMapping(
  supplierId: string,
  payload: { buyerItemCode: string; supplierItemCode: string }
): Promise<SupplierMapping> {
  await delay(300);
  const m: SupplierMapping = { id: `m-${Date.now()}`, ...payload, confidence: 1.0, source: "manual" };
  const list = mockMappings[supplierId] ?? [];
  list.push(m);
  mockMappings[supplierId] = list;
  return m;
}

async function mockUpdateSupplierMapping(
  supplierId: string,
  mappingId: string,
  payload: { buyerItemCode: string; supplierItemCode: string }
): Promise<SupplierMapping> {
  await delay(300);
  const list = mockMappings[supplierId] ?? [];
  const i = list.findIndex(m => m.id === mappingId);
  if (i !== -1) list[i] = { ...list[i], ...payload };
  return list[i] ?? { id: mappingId, ...payload };
}

async function mockImportSupplierMappings(
  supplierId: string,
  _file: File
): Promise<{ created: number; updated: number }> {
  await delay(600);
  void supplierId;
  return { created: 3, updated: 1 };
}

async function realCreateSupplierMapping(
  supplierId: string,
  payload: { buyerItemCode: string; supplierItemCode: string }
): Promise<SupplierMapping> {
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/suppliers/${supplierId}/mappings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await authHeader() },
    body: JSON.stringify(payload),
  }, 30000);
  if (!res.ok) { const t = await res.text(); throw new Error(t || res.statusText); }
  return res.json() as Promise<SupplierMapping>;
}

async function realUpdateSupplierMapping(
  supplierId: string,
  mappingId: string,
  payload: { buyerItemCode: string; supplierItemCode: string }
): Promise<SupplierMapping> {
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/suppliers/${supplierId}/mappings/${mappingId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...await authHeader() },
    body: JSON.stringify(payload),
  }, 30000);
  if (!res.ok) { const t = await res.text(); throw new Error(t || res.statusText); }
  return res.json() as Promise<SupplierMapping>;
}

async function realImportSupplierMappings(
  supplierId: string,
  file: File
): Promise<{ created: number; updated: number }> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/suppliers/${supplierId}/mappings/import`, {
    method: "POST",
    headers: await authHeader(),
    body: fd,
  }, 60000);
  if (!res.ok) { const t = await res.text(); throw new Error(t || res.statusText); }
  return res.json();
}

// ── Supplier product catalog (ground truth for AI suggestions) ───────────────

const _mockCatalog: Record<string, import("@/lib/api/types").SupplierProduct[]> = {};

export async function getSupplierCatalog(
  supplierId: string, q?: string, take = 100,
): Promise<import("@/lib/api/types").SupplierCatalogPage> {
  if (USE_MOCK) {
    await delay(120);
    let items = _mockCatalog[supplierId] ?? [];
    if (q) { const t = q.toLowerCase(); items = items.filter(p => `${p.code} ${p.name ?? ""} ${p.barcode ?? ""}`.toLowerCase().includes(t)); }
    return { total: items.length, items: items.slice(0, take) };
  }
  const headers = await authHeader();
  const url = `${API_BASE_URL}/api/suppliers/${supplierId}/catalog?take=${take}${q ? `&q=${encodeURIComponent(q)}` : ""}`;
  const res = await fetchWithTimeout(url, { headers });
  if (!res.ok) throw new Error(`catalog: ${res.status}`);
  return res.json();
}

export async function importSupplierCatalog(
  supplierId: string, file: File,
): Promise<import("@/lib/api/types").SupplierCatalogImportResult> {
  if (USE_MOCK) {
    await delay(300);
    const text = await file.text();
    const rows = text.split(/\r?\n/).filter(Boolean).slice(1); // skip header
    const list = _mockCatalog[supplierId] ?? (_mockCatalog[supplierId] = []);
    let created = 0;
    for (const r of rows) {
      const [code, name] = r.split(",");
      if (!code?.trim()) continue;
      list.push({ id: crypto.randomUUID(), code: code.trim(), name: name?.trim() ?? null });
      created++;
    }
    return { created, updated: 0, skipped: 0, total: list.length };
  }
  const fd = new FormData(); fd.append("file", file);
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/suppliers/${supplierId}/catalog/import`, {
    method: "POST", headers: await authHeader(), body: fd,
  }, 60000);
  if (!res.ok) { const t = await res.text(); throw new Error(t || res.statusText); }
  return res.json();
}

export async function clearSupplierCatalog(supplierId: string): Promise<{ deleted: number }> {
  if (USE_MOCK) { await delay(150); const n = (_mockCatalog[supplierId] ?? []).length; _mockCatalog[supplierId] = []; return { deleted: n }; }
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/suppliers/${supplierId}/catalog`, { method: "DELETE", headers: await authHeader() }, 30000);
  if (!res.ok) { const t = await res.text(); throw new Error(t || res.statusText); }
  return res.json();
}

// ── Supplier CRUD ─────────────────────────────────────────────────────────

async function mockCreateSupplier(payload: CreateSupplierPayload): Promise<Supplier> {
  await delay(400);
  const trimmed = payload.name.trim();
  if (mockSupplierList.some(s => s.name.toLowerCase() === trimmed.toLowerCase()))
    throw new Error(`A supplier named '${trimmed}' already exists.`);
  const s: Supplier = { id: crypto.randomUUID(), name: trimmed };
  mockSupplierList.push(s);
  return s;
}

async function realCreateSupplier(payload: CreateSupplierPayload): Promise<Supplier> {
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/suppliers`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await authHeader() },
    body: JSON.stringify(payload),
  }, 30000);
  if (!res.ok) { const t = await res.text(); throw new Error(t || res.statusText); }
  return res.json() as Promise<Supplier>;
}

async function mockRenameSupplier(id: string, payload: RenameSupplierPayload): Promise<Supplier> {
  await delay(300);
  const i = mockSupplierList.findIndex(s => s.id === id);
  if (i === -1) throw new Error("Supplier not found");
  mockSupplierList[i] = { ...mockSupplierList[i], name: payload.name.trim() };
  return mockSupplierList[i];
}

async function realRenameSupplier(id: string, payload: RenameSupplierPayload): Promise<Supplier> {
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/suppliers/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...await authHeader() },
    body: JSON.stringify(payload),
  }, 30000);
  if (!res.ok) { const t = await res.text(); throw new Error(t || res.statusText); }
  return res.json() as Promise<Supplier>;
}

async function mockDeleteSupplier(id: string): Promise<void> {
  await delay(300);
  mockSupplierList = mockSupplierList.filter(s => s.id !== id);
}

async function realDeleteSupplier(id: string): Promise<void> {
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/suppliers/${id}`, {
    method: "DELETE",
    headers: await authHeader(),
  }, 30000);
  if (!res.ok) { const t = await res.text(); throw new Error(t || res.statusText); }
}

// ── Supplier profiles ─────────────────────────────────────────────────────

const mockSupplierProfiles: import("@/types/procurement").SupplierProfile[] = [
  { supplierName: "FastParts Inc",  requiresSupplierItemCode: true,  requiredFields: ["quantity", "unitPrice"],                  supportsPartialAutomation: false, acceptedFormats: ["XML", "CSV"] },
  { supplierName: "ElectroSupply Co", requiresSupplierItemCode: true, requiredFields: ["quantity", "unitPrice", "description"], supportsPartialAutomation: true,  acceptedFormats: ["XML"] },
  { supplierName: "GlobalComponents", requiresSupplierItemCode: false, requiredFields: ["quantity"],                             supportsPartialAutomation: true,  acceptedFormats: ["CSV", "JSON"] },
];

async function mockGetSupplierProfiles() { await delay(300); return [...mockSupplierProfiles]; }
async function mockGetSupplierProfile(n: string) { await delay(200); return mockSupplierProfiles.find(p => p.supplierName === n) ?? null; }
// Backend routes (SuppliersController, route prefix "api/suppliers"):
//   GET  /api/suppliers/profiles              → list all profiles for the org
//   GET  /api/suppliers/profiles/{name}       → get profile by supplier name
//   POST /api/suppliers/{id}/profiles         → upsert profile (supplier-GUID-scoped)
// There is no separate PUT or DELETE for profiles — the POST is an upsert.
// Only the two read endpoints below are wired live. A live upsert/delete client
// must be introduced against the supplier-GUID-scoped route above when needed.
async function realGetSupplierProfiles() { const r = await fetchWithTimeout(`${API_BASE_URL}/api/suppliers/profiles`, { headers: await authHeader() }); if (!r.ok) throw new Error(r.statusText); return r.json(); }
async function realGetSupplierProfile(n: string) { const r = await fetchWithTimeout(`${API_BASE_URL}/api/suppliers/profiles/${encodeURIComponent(n)}`, { headers: await authHeader() }); if (r.status === 404) return null; if (!r.ok) throw new Error(r.statusText); return r.json(); }

// ── Audit trail ───────────────────────────────────────────────────────────

async function mockRedeliverOrder(_orderId: string): Promise<void> {
  await delay(800);
  // Mock always succeeds — live wiring verified by manual QA
}

async function mockGetOrderAudit(orderId: string): Promise<AuditEvent[]> {
  await delay(200);
  const order = mockOrders.find(o => o.id === orderId);
  if (!order) return [];
  const now = new Date().toISOString();
  // Synthesise a plausible mock audit trail
  const events: AuditEvent[] = [
    { action: "Created", payload: { poNumber: order.poNumber }, createdAt: order.createdAt },
  ];
  if (order.status !== "parsing") {
    events.unshift({ action: "Parsed", payload: { lineCount: order.lines.length }, createdAt: order.updatedAt });
  }
  if (order.status === "delivered") {
    events.unshift({ action: "Delivered", payload: { format: order.artifacts[0]?.format ?? "xml" }, createdAt: now });
  }
  return events;
}

async function realRedeliverOrder(orderId: string): Promise<void> {
  const res = await fetchWithTimeout(
    `${API_BASE_URL}/api/orders/${orderId}/redeliver`,
    { method: "POST", headers: await authHeader() },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as Record<string, unknown>);
    throw new Error(
      (body as { error?: string }).error ?? `Redeliver failed: ${res.statusText}`,
    );
  }
}

async function realGetOrderAudit(orderId: string): Promise<AuditEvent[]> {
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/orders/${orderId}/audit`, {
    headers: await authHeader(),
  });
  if (!res.ok) throw new Error(`Failed to fetch audit: ${res.statusText}`);
  return res.json() as Promise<AuditEvent[]>;
}

// ── Onboarding ────────────────────────────────────────────────────────────

async function mockGetOnboardingStatus(): Promise<OnboardingStatus> {
  await delay(150);
  // Representative MID-PROGRESS payload (extended B1 shape). Supplier, catalog,
  // upload, and resolve are derived from the mock data set; delivery is pinned
  // to "config saved but not test-fired, nothing delivered" so the checklist's
  // intermediate step-5 state and completion gating stay exercisable in
  // mock/demo mode (deriving hasDelivery from mock orders would show 6/6 and
  // graduate the card away on first paint).
  const hasSupplier        = mockSupplierList.length > 0;
  const hasUpload          = mockOrders.length > 0;
  const hasResolvedMapping = mockOrders.some(o => o.lines.some(l => l.supplierItemCode != null));
  const sampleOrder        = mockOrders.find(o => o.isSample === true);
  const firstActionable    =
    mockOrders.find(o => o.lines.some(l => l.supplierItemCode == null)) ?? mockOrders[0];
  return {
    hasSupplier,
    hasUpload,
    hasResolvedMapping,
    hasDelivery:            false,
    hasCatalog:             true,
    hasItemMappings:        hasResolvedMapping,
    hasDeliveryConfig:      true,
    hasTestFired:           false,
    firstSupplierId:        mockSupplierList[0]?.id ?? null,
    firstActionableOrderId: firstActionable?.id ?? null,
    supplierCount:          mockSupplierList.length,
    orderCount:             mockOrders.length,
    deliveredCount:         0,
    hasSampleOrder:         sampleOrder != null,
    sampleOrderId:          sampleOrder?.id ?? null,
  };
}

async function realGetOnboardingStatus(): Promise<OnboardingStatus> {
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/onboarding/status`, {
    headers: await authHeader(),
  });
  if (!res.ok) throw new Error(`Failed to fetch onboarding status: ${res.statusText}`);
  return res.json() as Promise<OnboardingStatus>;
}

// ── Dashboard stats ───────────────────────────────────────────────────────

async function mockGetDashboardStats(): Promise<DashboardStats> {
  await delay(150);
  const monthStart = new Date();
  monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  return {
    totalOrdersThisMonth: mockOrders.filter(o => new Date(o.createdAt) >= monthStart).length,
    pendingReview:         mockOrders.filter(o => o.status === "pending_review").length,
    delivered:             mockOrders.filter(o => o.status === "delivered").length,
    totalOrders:           mockOrders.length,
  };
}

async function realGetDashboardStats(): Promise<DashboardStats> {
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/dashboard/stats`, {
    headers: await authHeader(),
  });
  if (!res.ok) throw new Error(`Failed to fetch dashboard stats: ${res.statusText}`);
  return res.json() as Promise<DashboardStats>;
}

// ── Dashboard topology (Wire Topology canvas) ─────────────────────────────

async function mockGetDashboardTopology(): Promise<DashboardTopology> {
  await delay(120);
  return {
    buyers: [
      { id: "b1", name: "Heinrich Industries",   code: "HEI", volume: "412/wk" },
      { id: "b2", name: "Nordmark Logistics",    code: "NRD", volume: "287/wk" },
      { id: "b3", name: "Steelhouse Const.",     code: "SHC", volume: "198/wk" },
      { id: "b4", name: "Centralis Pharma",      code: "CPH", volume: "94/wk"  },
      { id: "b5", name: "Westmark Tools",        code: "WMT", volume: "76/wk"  },
      { id: "b6", name: "Atlas Reseller AG",     code: "ARA", volume: "142/wk" },
    ],
    suppliers: [
      { id: "s1", name: "Acme Components",    code: "ACM", volume: "610/wk", health: 97 },
      { id: "s2", name: "BoltWorks BV",       code: "BWK", volume: "382/wk", health: 91 },
      { id: "s3", name: "VanDerBerg Metaal",  code: "VDB", volume: "245/wk", health: 88 },
      { id: "s4", name: "Nordix Distribution",code: "NDX", volume: "178/wk", health: 73 },
      { id: "s5", name: "MedicaSupply OY",    code: "MDS", volume: "99/wk",  health: 96 },
    ],
    wires: [
      { buyerId: "b1", supplierId: "s1", weight: 4, health: "ok",   alert: 3 },
      { buyerId: "b1", supplierId: "s2", weight: 2, health: "ok" },
      { buyerId: "b2", supplierId: "s3", weight: 3, health: "risk", alert: 1 },
      { buyerId: "b2", supplierId: "s2", weight: 2, health: "ok" },
      { buyerId: "b3", supplierId: "s3", weight: 2, health: "ok" },
      { buyerId: "b3", supplierId: "s2", weight: 3, health: "ok" },
      { buyerId: "b4", supplierId: "s5", weight: 1, health: "ok" },
      { buyerId: "b4", supplierId: "s4", weight: 1, health: "down", alert: 6 },
      { buyerId: "b5", supplierId: "s1", weight: 1, health: "ok" },
      { buyerId: "b6", supplierId: "s4", weight: 2, health: "risk", alert: 1 },
      { buyerId: "b6", supplierId: "s1", weight: 2, health: "ok" },
    ],
  };
}

async function realGetDashboardTopology(): Promise<DashboardTopology> {
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/dashboard/topology`, { headers: await authHeader() });
  if (!res.ok) throw new Error(`Failed to fetch dashboard topology: ${res.statusText}`);
  return res.json() as Promise<DashboardTopology>;
}

// ── Format detection ─────────────────────────────────────────────────────

export interface DetectFormatResult {
  format: "csv" | "xlsx" | "pdf" | "cxml" | "ubl" | "edifact" | "x12" | "unknown";
  confidence: number;
  suggestedParser: string | null;
  detectedPoNumber: string | null;
  detectedSupplier: string | null;
  estimatedLineCount: number | null;
  reasoning: string[];
  /** Org-scoped schema fingerprint: how many times we've parsed this exact column layout before. Null when new/unknown. */
  seenCount: number | null;
}

async function mockDetectFormat(_file: File): Promise<DetectFormatResult> {
  await delay(400);
  return {
    format: "csv",
    confidence: 0.92,
    suggestedParser: "csv-tabular",
    detectedPoNumber: "PO-DETECT-DEMO",
    detectedSupplier: null,
    estimatedLineCount: 12,
    reasoning: ["CSV header detected", "Comma-separated values", "12 data rows"],
    seenCount: 3,
  };
}

async function realDetectFormat(file: File): Promise<DetectFormatResult> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetchWithTimeout(
    `${API_BASE_URL}/api/upload/detect-format`,
    { method: "POST", headers: await authHeader(), body: formData },
    3000,
  );
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`detect-format failed: ${t || res.statusText}`);
  }
  return res.json() as Promise<DetectFormatResult>;
}

// ── Onboarding sample order ──────────────────────────────────────────────

async function mockRunSampleOrder(): Promise<{ orderId: string; isSample: true }> {
  await delay(800);
  const orderId = `ord-sample-${Date.now()}`;
  const now = new Date().toISOString();
  const order: Order = {
    id: orderId,
    poNumber: `SAMPLE-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 100000)).padStart(6, "0")}`,
    supplierId: "00000000-0000-0000-0000-000000000000",
    supplierName: "__sample__",
    buyerName: "Sample Buyer",
    orderDate: now.substring(0, 10),
    currency: "EUR",
    status: "ready",
    sourceFileKey: "orgs/demo/orders/sample.csv",
    createdAt: now,
    updatedAt: now,
    lines: [
      { id: crypto.randomUUID(), lineNumber: 1, buyerItemCode: "SAMPLE-A1", supplierItemCode: "SUP-SAMPLE-A1", description: "Sample item A", quantity: 10, unit: "PCS", unitPrice: 9.99, confidence: 1.0, needsReview: false },
      { id: crypto.randomUUID(), lineNumber: 2, buyerItemCode: "SAMPLE-B2", supplierItemCode: "SUP-SAMPLE-B2", description: "Sample item B", quantity: 4,  unit: "PCS", unitPrice: 24.50, confidence: 1.0, needsReview: false },
    ],
    artifacts: [],
    isSample: true,
  };
  mockOrders.unshift(order);
  return { orderId, isSample: true };
}

async function realRunSampleOrder(): Promise<{ orderId: string; isSample: true }> {
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/onboarding/sample-order`, {
    method: "POST",
    headers: await authHeader(),
  }, 30000);
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(t || `sample-order: ${res.status}`);
  }
  const data = await res.json() as { orderId: string; isSample?: boolean };
  return { orderId: data.orderId, isSample: true };
}

// ── Magic Mapping Preview ─────────────────────────────────────────────────

export interface MappingPreviewLine {
  lineNumber: number;
  sourceFields: Record<string, string | null>;
  canonicalField: string;
  buyerItemCode: string | null;
  /** Supplier code already confirmed on this line (status === "resolved"). */
  resolvedSupplierCode: string | null;
  aiSuggestedSupplierCode: string | null;
  confidence: number | null;
  provenance: string | null;
  reason: string | null;
  status: "suggested" | "resolved" | "unresolved";
}

export interface MappingPreview {
  orderId: string;
  orderStatus: Order["status"];
  sourceFormat: string | null;
  detectedConfidence: number | null;
  lines: MappingPreviewLine[];
}

async function mockGetMappingPreview(orderId: string): Promise<MappingPreview> {
  const order = await mockGetOrderById(orderId);
  if (!order) throw new ApiHttpError(`Order ${orderId} not found`, 404);

  const ext = order.sourceFileKey
    ? order.sourceFileKey.split(".").pop()?.toLowerCase() ?? null
    : null;
  const sourceFormat = ext === "pdf"  ? "pdf"
                     : ext === "csv"  ? "csv"
                     : ext === "xlsx" || ext === "xls" ? "xlsx"
                     : ext === "xml"  || ext === "cxml" ? "cxml"
                     : ext === "edi"  || ext === "x12"  ? "edi"
                     : null;

  const lines: MappingPreviewLine[] = order.lines.map(l => {
    const status: MappingPreviewLine["status"] =
      l.supplierItemCode != null
        ? "resolved"
        : l.aiSuggestion
        ? "suggested"
        : "unresolved";
    return {
      lineNumber: l.lineNumber,
      sourceFields: {
        buyerItemCode: l.buyerItemCode ?? null,
        description: l.description ?? null,
        quantity: String(l.quantity),
        unit: l.unit ?? null,
        unitPrice: String(l.unitPrice),
      },
      canonicalField: "supplierItemCode",
      buyerItemCode: l.buyerItemCode ?? null,
      resolvedSupplierCode: l.supplierItemCode ?? null,
      aiSuggestedSupplierCode: l.aiSuggestion?.supplierItemCode ?? null,
      confidence: l.aiSuggestion?.confidence ?? null,
      provenance: l.aiSuggestion?.provenance ?? null,
      reason: l.aiSuggestion?.reason ?? null,
      status,
    };
  });

  return { orderId, orderStatus: order.status, sourceFormat, detectedConfidence: null, lines };
}

async function realGetMappingPreview(orderId: string): Promise<MappingPreview> {
  const res = await fetchWithTimeout(
    `${API_BASE_URL}/api/orders/${orderId}/mapping-preview`,
    { headers: await authHeader() },
  );
  if (res.status === 404) throw new ApiHttpError(`Order ${orderId} not found`, 404);
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new ApiHttpError(`mapping-preview failed: ${t || res.statusText}`, res.status);
  }
  return res.json() as Promise<MappingPreview>;
}

// ── Accept all high-confidence AI suggestions ─────────────────────────────

async function mockAcceptAiSuggestions(
  orderId: string,
  minConfidence: number,
): Promise<{ accepted: number }> {
  await delay(400);
  const idx = mockOrders.findIndex(o => o.id === orderId);
  if (idx === -1) return { accepted: 0 };
  let accepted = 0;
  const order: Order = { ...mockOrders[idx], lines: mockOrders[idx].lines.map(l => ({ ...l })) };
  for (const line of order.lines) {
    if (line.needsReview && line.aiSuggestion != null && line.aiSuggestion.confidence >= minConfidence) {
      line.supplierItemCode = line.aiSuggestion.supplierItemCode;
      line.confidence = line.aiSuggestion.confidence;
      line.needsReview = false;
      accepted++;
    }
  }
  order.status = order.lines.some(l => l.needsReview) ? "pending_review" : "ready";
  order.updatedAt = new Date().toISOString();
  mockOrders[idx] = order;
  return { accepted };
}

async function realAcceptAiSuggestions(
  orderId: string,
  minConfidence: number,
): Promise<{ accepted: number }> {
  const res = await fetchWithTimeout(
    `${API_BASE_URL}/api/orders/${orderId}/accept-ai-suggestions?minConfidence=${minConfidence}`,
    { method: "POST", headers: await authHeader() },
  );
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new ApiHttpError(`accept-ai-suggestions failed: ${t || res.statusText}`, res.status);
  }
  return res.json() as Promise<{ accepted: number }>;
}

// ── Exported API client ───────────────────────────────────────────────────

export const apiClient = {
  // ─── Support contact ───
  // Kept at the very top of the methods section so the concurrent runSampleOrder
  // chip (added near the bottom) does not merge-conflict with this entry.
  submitSupportRequest:   USE_MOCK ? mockSubmitSupportRequest  : realSubmitSupportRequest,

  // Suppliers — list + CRUD
  getSuppliers:           USE_MOCK ? mockGetSuppliersFn        : realGetSuppliersFn,
  createSupplier:         USE_MOCK ? mockCreateSupplier        : realCreateSupplier,
  renameSupplier:         USE_MOCK ? mockRenameSupplier        : realRenameSupplier,
  deleteSupplier:         USE_MOCK ? mockDeleteSupplier        : realDeleteSupplier,

  // Orders
  uploadPurchaseOrder:    USE_MOCK ? mockUploadPurchaseOrder   : realUploadPurchaseOrder,
  getOrders:              USE_MOCK ? mockGetOrders             : realGetOrders,
  getOrdersSummary:       USE_MOCK ? mockGetOrdersSummary     : realGetOrdersSummary,
  getOrderById:           USE_MOCK ? mockGetOrderById          : realGetOrderById,
  getOrderPassport:       USE_MOCK ? mockGetOrderPassport      : realGetOrderPassport,
  getOrderConfirmation:   USE_MOCK ? mockGetOrderConfirmation  : realGetOrderConfirmation,
  resolvePurchaseOrder:   USE_MOCK ? mockResolvePurchaseOrder  : realResolvePurchaseOrder,
  transformOrder:         USE_MOCK ? mockTransformOrder        : realTransformOrder,
  retryDelivery:          USE_MOCK ? mockRetryDelivery         : realRetryDelivery,
  getDownloadUrl:         USE_MOCK ? mockGetDownloadUrl        : realGetDownloadUrl,

  // Supplier mappings
  getSupplierMappings:    USE_MOCK ? mockGetSupplierMappings   : realGetSupplierMappings,
  deleteSupplierMapping:  USE_MOCK ? mockDeleteSupplierMapping : realDeleteSupplierMapping,
  createSupplierMapping:  USE_MOCK ? mockCreateSupplierMapping  : realCreateSupplierMapping,
  updateSupplierMapping:  USE_MOCK ? mockUpdateSupplierMapping  : realUpdateSupplierMapping,
  importSupplierMappings: USE_MOCK ? mockImportSupplierMappings : realImportSupplierMappings,

  // Supplier profiles (legacy admin) — read-only client; create/update/delete
  // had no matching backend route and were removed (mock helpers retained below).
  getSupplierProfiles:    USE_MOCK ? mockGetSupplierProfiles   : realGetSupplierProfiles,
  getSupplierProfile:     USE_MOCK ? mockGetSupplierProfile    : realGetSupplierProfile,

  // Audit trail
  getOrderAudit:          USE_MOCK ? mockGetOrderAudit         : realGetOrderAudit,
  redeliverOrder:         USE_MOCK ? mockRedeliverOrder        : realRedeliverOrder,

  // Onboarding + dashboard
  getOnboardingStatus:    USE_MOCK ? mockGetOnboardingStatus   : realGetOnboardingStatus,
  getDashboardStats:      USE_MOCK ? mockGetDashboardStats     : realGetDashboardStats,
  getDashboardTopology:   USE_MOCK ? mockGetDashboardTopology  : realGetDashboardTopology,

  // ─── Onboarding sample order ───
  runSampleOrder:         USE_MOCK ? mockRunSampleOrder        : realRunSampleOrder,

  // ─── Format detection ───
  detectFormat:           USE_MOCK ? mockDetectFormat          : realDetectFormat,

  // ─── V9 AI confidence calibration insight ───
  getAiCalibration:       USE_MOCK ? mockGetAiCalibration      : realGetAiCalibration,

  // ─── Magic Mapping Preview ───
  getMappingPreview:      USE_MOCK ? mockGetMappingPreview     : realGetMappingPreview,
  acceptAiSuggestions:    USE_MOCK ? mockAcceptAiSuggestions   : realAcceptAiSuggestions,

  /**
   * Commit resolved supplier-item codes for an order, plus optional header-field
   * corrections (orderDate / buyerName / currency / poNumber / supplierName).
   * Thin wrapper around resolvePurchaseOrder with saveMappings: true.
   *
   * Only the header fields actually passed are forwarded — the backend treats
   * null/absent as "no change", so a header-only edit can ride along even with
   * an empty resolutions list. poNumber + supplierName are display-only: the
   * backend trims them (max 256) and supplierName does NOT change routing/SupplierId.
   */
  commitMappings(
    orderId: string,
    resolutions: { lineNumber: number; supplierItemCode: string }[],
    header?: { orderDate?: string; buyerName?: string; currency?: string; poNumber?: string; supplierName?: string },
  ) {
    return (USE_MOCK ? mockResolvePurchaseOrder : realResolvePurchaseOrder)(orderId, {
      lineResolutions: resolutions,
      saveMappings: true,
      // Spread only present keys so absent fields stay absent on the wire.
      ...(header?.orderDate    !== undefined ? { orderDate:    header.orderDate }    : {}),
      ...(header?.buyerName    !== undefined ? { buyerName:    header.buyerName }    : {}),
      ...(header?.currency     !== undefined ? { currency:     header.currency }     : {}),
      ...(header?.poNumber     !== undefined ? { poNumber:     header.poNumber }     : {}),
      ...(header?.supplierName !== undefined ? { supplierName: header.supplierName } : {}),
    });
  },
};

// ── Delivery reliability: dead-letter count (moved to src/lib/api/operations.ts) ──
export { getDeadLetterCount } from "@/lib/api/operations";

// ── Per-order mapping override (heart-piece-flex) ────────────────────────────
// Default (no override) leaves the transform byte-identical; these power the
// "Edit mapping manually" power-user editor + live preview.

const _mockOverrides: Record<string, import("@/lib/api/types").OrderMappingOverride> = {};

export async function getMappingOverride(
  orderId: string,
): Promise<import("@/lib/api/types").OrderMappingOverride | null> {
  if (USE_MOCK) { await delay(120); return _mockOverrides[orderId] ?? null; }
  const headers = await authHeader();
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/orders/${orderId}/mapping-override`, { headers });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`mapping-override: ${res.status}`);
  const data = await res.json().catch(() => null);
  return data ?? null; // 200 with null body when no override is set
}

export async function upsertMappingOverride(
  orderId: string,
  override: import("@/lib/api/types").OrderMappingOverride,
): Promise<import("@/lib/api/types").OrderMappingOverride> {
  if (USE_MOCK) { await delay(150); _mockOverrides[orderId] = override; return override; }
  const headers = await authHeader();
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/orders/${orderId}/mapping-override`, {
    method: "PUT", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(override),
  }, 30000);
  if (!res.ok) {
    const b = await res.json().catch(() => null) as { error?: string } | null;
    throw new Error(b?.error || `Couldn't save the mapping: ${res.status}`);
  }
  return res.json();
}

/**
 * Normalise the several preview-response shapes the backend may return into the
 * canonical MappingOverridePreview. We tolerate:
 *   • the legacy field shape          { format, contentType, content, warning }
 *   • the template shape (success)    { ok: true,  output, contentType }
 *   • the template shape (error)      { ok: false, error }  (HTTP 200)
 *   • a raw string body              "…rendered document…"
 * A template compile/render error is surfaced via `error`, NOT thrown, so the
 * editor shows it inline (amber) instead of crashing.
 */
function normalizeMappingPreview(
  body: unknown,
  format: string,
): import("@/lib/api/types").MappingOverridePreview {
  if (typeof body === "string") {
    return { format, content: body };
  }
  if (body && typeof body === "object") {
    const o = body as Record<string, unknown>;
    const contentType = typeof o.contentType === "string" ? o.contentType : undefined;
    const warning = typeof o.warning === "string" ? o.warning : undefined;
    // Template-mode { ok, output, error }
    if ("ok" in o || "output" in o) {
      if (o.ok === false || typeof o.error === "string") {
        return { format, contentType, content: null, error: typeof o.error === "string" ? o.error : "Template render failed" };
      }
      const output = typeof o.output === "string" ? o.output
        : typeof o.content === "string" ? o.content : null;
      return { format, contentType, content: output, warning };
    }
    // Legacy field shape { content, warning }
    if ("content" in o) {
      return {
        format: typeof o.format === "string" ? o.format : format,
        contentType,
        content: typeof o.content === "string" ? o.content : null,
        warning,
        error: typeof o.error === "string" ? o.error : null,
      };
    }
  }
  return { format, content: null };
}

/**
 * Live mapping-override preview.
 *
 * `honorFormat` is the EXPLORATORY opt-in: by default (false) a revision-pinned order's preview
 * swaps to the pinned revision's snapshotted output format so "preview == delivered bytes". Passing
 * `honorFormat=true` tells the backend to skip that swap and render the requested `format` from the
 * canonical order — a "what would this order look like as X" view. It is read-only and NEVER changes
 * delivery (still governed by the pinned revision).
 */
/**
 * Mock-only: render a realistic delivered document from an order's actual values so the
 * mock live-preview mirrors the real backend (and the value-based hover highlight has real
 * tokens to light). CSV → header + one row per line; XML/cXML/UBL/X12 → a compact element
 * tree. Pure display; never used in real mode.
 */
function mockRenderPreview(order: Order, format: string): string {
  const lines = order.lines;
  if (format === "csv") {
    const head = "PoNumber,SupplierItemCode,Description,Quantity,UnitPrice";
    const rows = lines.map((l) =>
      [order.poNumber, l.supplierItemCode ?? l.buyerItemCode ?? "", l.description ?? "", l.quantity ?? "", l.unitPrice ?? ""].join(","),
    );
    return [head, ...rows].join("\n");
  }
  if (format === "cxml") {
    const items = lines.map((l) =>
      `    <ItemOut quantity="${l.quantity ?? ""}" lineNumber="${l.lineNumber}">\n      <ItemID><SupplierPartID>${l.supplierItemCode ?? l.buyerItemCode ?? ""}</SupplierPartID></ItemID>\n      <ItemDetail><Description>${l.description ?? ""}</Description>\n        <UnitPrice><Money currency="${order.currency}">${l.unitPrice ?? ""}</Money></UnitPrice></ItemDetail>\n    </ItemOut>`,
    ).join("\n");
    return `<cXML>\n  <Request><OrderRequest>\n    <OrderRequestHeader orderID="${order.poNumber}" type="new"/>\n${items}\n  </OrderRequest></Request>\n</cXML>`;
  }
  // Generic XML / UBL / X12 fallback tree.
  const items = lines.map((l) =>
    `  <Line number="${l.lineNumber}">\n    <SupplierItemCode>${l.supplierItemCode ?? l.buyerItemCode ?? ""}</SupplierItemCode>\n    <Description>${l.description ?? ""}</Description>\n    <Quantity>${l.quantity ?? ""}</Quantity>\n    <UnitPrice>${l.unitPrice ?? ""}</UnitPrice>\n  </Line>`,
  ).join("\n");
  return `<Order>\n  <PoNumber>${order.poNumber}</PoNumber>\n  <SupplierName>${order.supplierName}</SupplierName>\n${items}\n</Order>`;
}

export async function previewMappingOverride(
  orderId: string,
  override: import("@/lib/api/types").OrderMappingOverride,
  format = "csv",
  honorFormat = false,
): Promise<import("@/lib/api/types").MappingOverridePreview> {
  if (USE_MOCK) {
    await delay(150);
    const tmpl = override.outputTemplate?.trim();
    if (tmpl) {
      return {
        format,
        contentType: override.outputTemplateContentType ?? "application/json",
        content: `{ "preview": "rendered from template (${tmpl.length} chars)" }`,
      };
    }
    // Render a REALISTIC document from the order's actual values so the mock preview mirrors
    // what the real backend returns — including the review-blocked state (content: null +
    // "lines still need review") the real endpoint returns while any line is unresolved. This
    // keeps the cross-column hover highlight (which matches on the field's resolved VALUE)
    // exercisable in mock mode, and makes the honest "preview available once resolved" state real.
    const ord = mockOrders.find((o) => o.id === orderId);
    if (ord && ord.lines.some((l) => l.needsReview)) {
      return { format, contentType: "text/plain", content: null, error: "Cannot transform: lines still need review." };
    }
    if (ord) {
      const content = mockRenderPreview(ord, (format || "csv").toLowerCase());
      return { format, contentType: format === "csv" ? "text/csv" : "application/xml", content };
    }
    return { format, contentType: "text/csv", content: override.output ? "code,qty\n(mapped preview)" : "(default transform)" };
  }
  const headers = await authHeader();
  const qs = `format=${encodeURIComponent(format)}${honorFormat ? "&honorFormat=true" : ""}`;
  const res = await fetchWithTimeout(
    `${API_BASE_URL}/api/orders/${orderId}/mapping-override/preview?${qs}`,
    { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(override) },
    30000,
  );
  if (!res.ok) {
    const b = await res.json().catch(() => null) as { error?: string } | null;
    throw new Error(b?.error || `Preview failed: ${res.status}`);
  }
  const contentType = res.headers.get("content-type") ?? "";
  const raw: unknown = contentType.includes("application/json")
    ? await res.json().catch(() => null)
    : await res.text().catch(() => "");
  return normalizeMappingPreview(raw, format);
}

/**
 * Phase D — infer an output-structure template from a pasted sample of the file the supplier
 * requires. Deterministic backend (JSON/CSV); returns a tree the designer opens shaped to match.
 */
export async function inferOutputStructure(
  orderId: string,
  sample: string,
  format: string,
): Promise<import("@/lib/api/types").OutputNodeTemplate> {
  const headers = await authHeader();
  const res = await fetchWithTimeout(
    `${API_BASE_URL}/api/orders/${orderId}/infer-output-structure`,
    { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ sample, format }) },
    30000,
  );
  if (!res.ok) {
    const b = await res.json().catch(() => null) as { error?: string } | null;
    throw new Error(b?.error || `Infer failed: ${res.status}`);
  }
  return res.json() as Promise<import("@/lib/api/types").OutputNodeTemplate>;
}

// ── Source→canonical mapping (drag-to-wire on the order review heart-piece) ──

/**
 * Every addressable value (token) in the order's stored source file, used as the
 * draggable "source field" set on the review screen. Returns [] for unsupported
 * formats / no stored file (the backend never throws), so the UI degrades cleanly.
 */
export async function getSourceTokens(
  orderId: string,
): Promise<import("@/lib/api/types").SourceToken[]> {
  if (USE_MOCK) {
    await delay(120);
    return [
      { id: "cell:r1c1", label: "PO Number",  value: "PO-DEMO-001",      group: "header" },
      { id: "cell:r1c2", label: "Order Date", value: "2026-01-10",        group: "header" },
      { id: "cell:r1c3", label: "Buyer",      value: "Acme Manufacturing", group: "header" },
      { id: "cell:r1c4", label: "Currency",   value: "EUR",               group: "header" },
      { id: "cell:r2c1", label: "Item Code",  value: "ACM-BOLT-001",      group: "line" },
      { id: "cell:r2c2", label: "Quantity",   value: "500",               group: "line" },
    ];
  }
  const headers = await authHeader();
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/orders/${orderId}/source-tokens`, { headers });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`source-tokens: ${res.status}`);
  return res.json();
}

/**
 * Promote this order's per-order SourceMap into the supplier's reusable inbound PO
 * mapping, so the SAME source layout auto-applies to future orders from that supplier.
 * Persist any pending SourceMap edits via upsertMappingOverride FIRST — promote reads
 * the SourceMap stored in canonical_json, not the request body.
 */
export async function promoteMapping(
  orderId: string,
): Promise<import("@/lib/api/types").PromoteMappingResult> {
  if (USE_MOCK) {
    await delay(150);
    const sm = _mockOverrides[orderId]?.sourceMap ?? {};
    const keys = Object.keys(sm);
    const lineKeys = new Set(["LineNumber", "BuyerItemCode", "SupplierItemCode", "Description", "Quantity", "Unit", "UnitPrice", "LineTotal"]);
    return {
      supplierId: "00000000-0000-0000-0000-000000000000",
      headerFieldsPromoted: keys.filter((k) => !lineKeys.has(k)).length,
      lineFieldsPromoted: keys.filter((k) => lineKeys.has(k)).length,
      schemaFingerprintHash: null,
    };
  }
  const headers = await authHeader();
  const res = await fetchWithTimeout(
    `${API_BASE_URL}/api/orders/${orderId}/mapping-override/promote`,
    { method: "POST", headers },
    30000,
  );
  if (res.status === 404) throw new Error("No saved mapping to promote yet for this order.");
  if (!res.ok) {
    const b = await res.json().catch(() => null) as { error?: string } | null;
    throw new Error(b?.error || `Couldn't save the supplier mapping: ${res.status}`);
  }
  return res.json();
}

// ── Buyers ─────────────────────────────────────────────────────────────────

export async function getBuyers(): Promise<import("@/types/procurement").BuyerDto[]> {
  if (USE_MOCK) {
    return [
      { id: "b1", name: "Heinrich Industries GmbH", code: "HEI", orderCount: 1820, lastOrderAge: "2m",  formats: ["PDF", "XLSX"] },
      { id: "b2", name: "Nordmark Logistics A/S",   code: "NRD", orderCount: 1104, lastOrderAge: "14m", formats: ["cXML", "EDI"] },
      { id: "b3", name: "Steelhouse Construction",  code: "SHC", orderCount: 812,  lastOrderAge: "1h",  formats: ["XLSX", "CSV"] },
    ];
  }
  const headers = await authHeader();
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/buyers`, { headers });
  if (!res.ok) throw new Error(`buyers: ${res.status}`);
  return res.json();
}

export async function createBuyer(name: string, code: string): Promise<import("@/types/procurement").BuyerDto> {
  const headers = await authHeader();
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/buyers`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ name, code }),
  }, 30000);
  if (!res.ok) throw new Error(`buyers/create: ${res.status}`);
  return res.json();
}

export async function updateBuyer(id: string, name: string, code: string): Promise<import("@/types/procurement").BuyerDto> {
  const headers = await authHeader();
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/buyers/${id}`, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ name, code }),
  }, 30000);
  if (!res.ok) throw new Error(`buyers/update: ${res.status}`);
  return res.json();
}

export async function deleteBuyer(id: string): Promise<void> {
  const headers = await authHeader();
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/buyers/${id}`, { method: "DELETE", headers }, 30000);
  if (!res.ok) throw new Error(`buyers/delete: ${res.status}`);
}

// ── Audit log ──────────────────────────────────────────────────────────────

export interface AuditLogEntry {
  id: string;
  ts: string;
  orderId: string | null;
  poNumber: string | null;
  buyerName: string | null;
  supplierName: string | null;
  format: string | null;
  action: string;
  actorType: "user" | "system" | "ai";
  actorName: string;
  actorInitials: string;
  message: string;
  payload: unknown;
}

export interface AuditLogPage {
  events: AuditLogEntry[];
  total: number;
  page: number;
  pageSize: number;
}

export async function getAuditLog(page = 1, pageSize = 50): Promise<AuditLogPage> {
  if (USE_MOCK) {
    return {
      events: [
        { id: "e1", ts: new Date(Date.now() - 2*60000).toISOString(), orderId: "demo-001", poNumber: "PO-DEMO-001", buyerName: "Heinrich Industries", supplierName: "Acme Components", format: "PDF", action: "flagged", actorType: "ai", actorName: "Extraction engine", actorInitials: "AI", message: "3 validation errors flagged", payload: null },
        { id: "e2", ts: new Date(Date.now() - 14*60000).toISOString(), orderId: "nrd9981", poNumber: "PO-NRD-9981", buyerName: "Nordmark Logistics", supplierName: "BoltWorks BV", format: "cXML", action: "created", actorType: "system", actorName: "System", actorInitials: "SY", message: "Order created from upload", payload: null },
      ],
      total: 2,
      page: 1,
      pageSize: 50,
    };
  }
  const headers = await authHeader();
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/audit?page=${page}&pageSize=${pageSize}`, { headers });
  if (!res.ok) throw new Error(`audit: ${res.status}`);
  return res.json();
}

// ── Validation rules ───────────────────────────────────────────────────────

export interface RuleDto {
  id: string;
  name: string;
  description: string;
  severity: "error" | "warning" | "info";
  entity: string;
  enabled: boolean;
  autoBlock: boolean;
  triggerCount: number;
  lastTriggered: string | null;
  createdAt: string;
}

export async function getRules(): Promise<RuleDto[]> {
  if (USE_MOCK) return []; // ValidationRules.tsx keeps its own RULES mock array
  const headers = await authHeader();
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/rules`, { headers });
  if (!res.ok) throw new Error(`rules: ${res.status}`);
  return res.json();
}

export async function createRule(payload: Omit<RuleDto, "id"|"triggerCount"|"lastTriggered"|"createdAt"> & { enabled: boolean; autoBlock: boolean }): Promise<RuleDto> {
  const headers = await authHeader();
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/rules`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }, 30000);
  if (!res.ok) throw new Error(`rules/create: ${res.status}`);
  return res.json();
}

export async function updateRule(id: string, payload: Omit<RuleDto, "id"|"triggerCount"|"lastTriggered"|"createdAt">): Promise<RuleDto> {
  const headers = await authHeader();
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/rules/${id}`, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }, 30000);
  if (!res.ok) throw new Error(`rules/update: ${res.status}`);
  return res.json();
}

export async function toggleRule(id: string): Promise<RuleDto> {
  const headers = await authHeader();
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/rules/${id}/toggle`, { method: "PATCH", headers }, 30000);
  if (!res.ok) throw new Error(`rules/toggle: ${res.status}`);
  return res.json();
}

export async function deleteRule(id: string): Promise<void> {
  const headers = await authHeader();
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/rules/${id}`, { method: "DELETE", headers }, 30000);
  if (!res.ok) throw new Error(`rules/delete: ${res.status}`);
}

// ── Output templates ───────────────────────────────────────────────────────

export interface TemplateDto {
  id: string;
  name: string;
  format: string;
  version: string;
  suppliersCount: number;
  lastUsed: string;
  config: unknown;
}

export async function getTemplates(): Promise<TemplateDto[]> {
  if (USE_MOCK) return []; // templates page keeps its own mock array for demo mode
  const headers = await authHeader();
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/templates`, { headers });
  if (!res.ok) throw new Error(`templates: ${res.status}`);
  return res.json();
}

export async function createTemplate(payload: Pick<TemplateDto, "name"|"format"|"version"> & { config?: unknown }): Promise<TemplateDto> {
  const headers = await authHeader();
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/templates`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }, 30000);
  if (!res.ok) throw new Error(`templates/create: ${res.status}`);
  return res.json();
}

export async function updateTemplate(id: string, payload: Pick<TemplateDto, "name"|"format"|"version"> & { config?: unknown }): Promise<TemplateDto> {
  const headers = await authHeader();
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/templates/${id}`, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }, 30000);
  if (!res.ok) throw new Error(`templates/update: ${res.status}`);
  return res.json();
}

export async function deleteTemplate(id: string): Promise<void> {
  const headers = await authHeader();
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/templates/${id}`, { method: "DELETE", headers }, 30000);
  if (!res.ok) throw new Error(`templates/delete: ${res.status}`);
}

// ── Billing + admin (moved to src/lib/api/billing.ts) ─────────────────────────
export {
  getBillingStatus,
  createCheckoutSession,
  createPortalSession,
  AdminAccessError,
  getAdminOverview,
  getAdminOrganisations,
  checkAdminAccess,
  createAdminInvoice,
  setOrgLimits,
} from "@/lib/api/billing";
export type {
  AdminOverview,
  AdminOrganisation,
  CreateAdminInvoiceLineItem,
  CreateAdminInvoiceRequest,
  CreateAdminInvoiceResult,
} from "@/lib/api/billing";

// ── Email / org / ingress settings (moved to src/lib/api/settings.ts) ─────────
export {
  getEmailSettings,
  updateEmailSettings,
  getOrgSettings,
  updateOrgSettings,
  getSftpSettings,
  updateSftpSettings,
  getS3Settings,
  updateS3Settings,
} from "@/lib/api/settings";
export type {
  SftpIngressSettings,
  UpdateSftpIngressPayload,
  S3IngressSettings,
  UpdateS3IngressPayload,
} from "@/lib/api/settings";

// ── Supplier catalog pull-source config (plan 2026-06-12) ─────────────────────
export {
  getCatalogSource,
  upsertCatalogSource,
  deleteCatalogSource,
  testFetchCatalogSource,
} from "@/lib/api/catalogSources";
export type {
  CatalogSource,
  CatalogSourceProtocol,
  CatalogSyncStatus,
  CatalogHttpAuthMethod,
  CatalogHttpAuthConfig,
  UpsertCatalogSourcePayload,
  UpsertCatalogSourceResult,
  CatalogSourceTestResult,
  CatalogMappedField,
} from "@/lib/api/catalogSources";

// ── Wave 4: API Keys ──────────────────────────────────────────────────────

export interface ApiKey {
  id: string;
  label: string;
  keyPrefix: string;
  isActive: boolean;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
}

export interface CreateApiKeyResponse extends ApiKey {
  /** Raw key shown ONCE. Never stored on the server. */
  rawKey: string;
}

const _mockApiKeys: ApiKey[] = [];

export async function getApiKeys(): Promise<ApiKey[]> {
  if (USE_MOCK) {
    await delay(300);
    return [..._mockApiKeys];
  }
  const headers = await authHeader();
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/api-keys`, { headers });
  if (!res.ok) throw new Error(`api-keys: ${res.status}`);
  return res.json();
}

export async function createApiKey(label: string): Promise<CreateApiKeyResponse> {
  if (USE_MOCK) {
    await delay(500);
    const rawKey = "plk_" + Math.random().toString(36).slice(2).padEnd(40, "0");
    const key: ApiKey = {
      id: crypto.randomUUID(),
      label,
      keyPrefix: rawKey.slice(0, 8),
      isActive: true,
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      expiresAt: null,
    };
    _mockApiKeys.unshift(key);
    return { ...key, rawKey };
  }
  const headers = await authHeader();
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/api-keys`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ label }),
  }, 30000);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `api-keys POST: ${res.status}`);
  }
  return res.json();
}

export async function revokeApiKey(id: string): Promise<void> {
  if (USE_MOCK) {
    await delay(300);
    const key = _mockApiKeys.find(k => k.id === id);
    if (key) key.isActive = false;
    return;
  }
  const headers = await authHeader();
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/api-keys/${id}`, {
    method: "DELETE",
    headers,
  }, 30000);
  if (!res.ok && res.status !== 204) throw new Error(`api-keys DELETE: ${res.status}`);
}

// ── Wave 4: Integration Subscriptions ────────────────────────────────────

export interface IntegrationSubscription {
  id: string;
  platform: string;
  eventType: string;
  targetUrl: string;
  isActive: boolean;
  failureCount: number;
  createdAt: string;
  updatedAt: string;
}

const _mockIntegrations: IntegrationSubscription[] = [];

export async function getIntegrations(): Promise<IntegrationSubscription[]> {
  if (USE_MOCK) {
    await delay(300);
    return [..._mockIntegrations];
  }
  const headers = await authHeader();
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/integrations`, { headers });
  if (!res.ok) throw new Error(`integrations: ${res.status}`);
  return res.json();
}

export async function createIntegration(payload: {
  platform: string;
  eventType: string;
  targetUrl: string;
  secret?: string;
}): Promise<IntegrationSubscription> {
  if (USE_MOCK) {
    await delay(500);
    const sub: IntegrationSubscription = {
      id: crypto.randomUUID(),
      platform: payload.platform,
      eventType: payload.eventType,
      targetUrl: payload.targetUrl,
      isActive: true,
      failureCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    _mockIntegrations.unshift(sub);
    return sub;
  }
  const headers = await authHeader();
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/integrations`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }, 30000);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `integrations POST: ${res.status}`);
  }
  return res.json();
}

export async function toggleIntegration(id: string): Promise<{ id: string; isActive: boolean }> {
  if (USE_MOCK) {
    await delay(300);
    const sub = _mockIntegrations.find(s => s.id === id);
    if (sub) sub.isActive = !sub.isActive;
    return { id, isActive: sub?.isActive ?? false };
  }
  const headers = await authHeader();
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/integrations/${id}/toggle`, {
    method: "PATCH",
    headers,
  }, 30000);
  if (!res.ok) throw new Error(`integrations PATCH toggle: ${res.status}`);
  return res.json();
}

export async function deleteIntegration(id: string): Promise<void> {
  if (USE_MOCK) {
    await delay(300);
    const i = _mockIntegrations.findIndex(s => s.id === id);
    if (i !== -1) _mockIntegrations.splice(i, 1);
    return;
  }
  const headers = await authHeader();
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/integrations/${id}`, {
    method: "DELETE",
    headers,
  }, 30000);
  if (!res.ok && res.status !== 204) throw new Error(`integrations DELETE: ${res.status}`);
}

// ── PO Mapping starter templates ──────────────────────────────────────────────

/** A pre-built PO mapping template returned by GET /api/po-mapping-templates. */
export interface StarterTemplate {
  id: string;
  erp: string;
  name: string;
  description: string;
  config: import("@/lib/api/types").PoMappingConfig;
}

/** Returns all available PO mapping starter templates (Erply, Directo, …). */
export async function getPoMappingTemplates(): Promise<StarterTemplate[]> {
  if (USE_MOCK) {
    await delay(200);
    // Mock templates mirror the embedded backend fixtures in
    // ProcuLink.Api/Fixtures/po-templates/ so local QA does not hide missing
    // starter coverage.
    return [
      {
        id: "generic-csv",
        erp: "CSV",
        name: "Generic CSV purchase order",
        description: "Maps common buyer CSV exports with separate header and line columns.",
        config: {
          hasHeaderRecord: true,
          separator: ",",
          header: {
            PoNumber:     { externalField: "po_number" },
            OrderDate:    { externalField: "order_date", fieldManipulators: [{ type: "DateFormat", params: ["yyyy-MM-dd", "yyyy-MM-dd"] }] },
            BuyerName:    { externalField: "buyer_name" },
            SupplierName: { externalField: "supplier_name" },
            Currency:     { externalField: "currency", fieldManipulators: [{ type: "Trim", params: [] }] },
          },
          lines: {
            BuyerItemCode: { externalField: "buyer_item_code" },
            Description:   { externalField: "description" },
            Quantity:      { externalField: "quantity" },
            Unit:          { externalField: "unit", fieldManipulators: [{ type: "Trim", params: [] }] },
            UnitPrice:     { externalField: "unit_price" },
          },
        },
      },
      {
        id: "buyer-excel",
        erp: "Excel",
        name: "Buyer Excel order sheet",
        description: "Maps common spreadsheet purchase orders exported from procurement teams.",
        config: {
          hasHeaderRecord: true,
          separator: ",",
          header: {
            PoNumber:  { externalField: "PO No", fieldManipulators: [{ type: "Trim", params: [] }] },
            OrderDate: { externalField: "PO Date", fieldManipulators: [{ type: "DateFormat", params: ["dd/MM/yyyy", "yyyy-MM-dd"] }] },
            BuyerName: { externalField: "Buyer", fieldManipulators: [{ type: "Trim", params: [] }] },
            Currency:  { externalField: "Currency", fieldManipulators: [{ type: "Trim", params: [] }] },
          },
          lines: {
            BuyerItemCode: { externalField: "Item code", fieldManipulators: [{ type: "Trim", params: [] }] },
            Description:   { externalField: "Item description" },
            Quantity:      { externalField: "Qty" },
            Unit:          { externalField: "UOM", fieldManipulators: [{ type: "Trim", params: [] }] },
            UnitPrice:     { externalField: "Net price" },
          },
        },
      },
      {
        id: "cxml-orderrequest",
        erp: "cXML",
        name: "cXML OrderRequest",
        description: "Maps cXML OrderRequest paths from PunchOut and procurement platforms.",
        config: {
          hasHeaderRecord: false,
          separator: ",",
          header: {
            PoNumber:     { externalField: "Request/OrderRequest/OrderRequestHeader/@orderID" },
            OrderDate:    { externalField: "Request/OrderRequest/OrderRequestHeader/@orderDate", fieldManipulators: [{ type: "DateFormat", params: ["yyyy-MM-ddTHH:mm:sszzz", "yyyy-MM-dd"] }] },
            BuyerName:    { externalField: "Request/OrderRequest/OrderRequestHeader/BillTo/Address/Name" },
            SupplierName: { externalField: "Request/OrderRequest/ItemOut/SupplierID" },
            Currency:     { externalField: "Request/OrderRequest/OrderRequestHeader/Total/Money/@currency", fieldManipulators: [{ type: "Trim", params: [] }] },
          },
          lines: {
            BuyerItemCode:    { externalField: "Request/OrderRequest/ItemOut/ItemID/BuyerPartID" },
            SupplierItemCode: { externalField: "Request/OrderRequest/ItemOut/ItemID/SupplierPartID" },
            Description:      { externalField: "Request/OrderRequest/ItemOut/ItemDetail/Description" },
            Quantity:         { externalField: "Request/OrderRequest/ItemOut/@quantity" },
            Unit:             { externalField: "Request/OrderRequest/ItemOut/ItemDetail/UnitOfMeasure" },
            UnitPrice:        { externalField: "Request/OrderRequest/ItemOut/ItemDetail/UnitPrice/Money" },
          },
        },
      },
      {
        id: "erply",
        erp: "Erply",
        name: "Erply PO starter",
        description: "Maps Erply getPurchaseDocuments CSV export columns to ProcuLink canonical fields. Verify column names against your actual export before saving.",
        config: {
          hasHeaderRecord: true,
          separator: ",",
          header: {
            PoNumber:  { externalField: "number" },
            OrderDate: { externalField: "date", fieldManipulators: [{ type: "DateFormat", params: ["yyyy-MM-dd", "yyyy-MM-dd"] }] },
            BuyerName: { externalField: "clientName" },
            Currency:  { externalField: "currencyCode" },
          },
          lines: {
            BuyerItemCode: { externalField: "code" },
            Description:   { externalField: "itemName" },
            Quantity:      { externalField: "amount" },
            Unit:          { externalField: "unitName" },
            UnitPrice:     { externalField: "price" },
          },
        },
      },
      {
        id: "directo",
        erp: "Directo",
        name: "Directo PO starter",
        description: "Maps Directo REST API CSV export columns to ProcuLink canonical fields. Verify column names against your actual export before saving.",
        config: {
          hasHeaderRecord: true,
          separator: ",",
          header: {
            PoNumber:  { externalField: "number" },
            OrderDate: { externalField: "date", fieldManipulators: [{ type: "DateFormat", params: ["yyyy-MM-dd", "yyyy-MM-dd"] }] },
            BuyerName: { externalField: "customer_name" },
            Currency:  { externalField: "currency" },
          },
          lines: {
            BuyerItemCode: { externalField: "row_item" },
            Description:   { externalField: "row_description" },
            Quantity:      { externalField: "row_quantity" },
            Unit:          { externalField: "unit" },
            UnitPrice:     { externalField: "row_price" },
          },
        },
      },
    ];
  }
  const headers = await authHeader();
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/po-mapping-templates`, { headers });
  if (!res.ok) throw new Error(`po-mapping-templates: ${res.status}`);
  return res.json() as Promise<StarterTemplate[]>;
}

/**
 * Applies a starter template to a supplier's PO mapping config.
 *
 * Server-side copy: the backend looks up the read-only template, persists its
 * config onto the supplier (equivalent to PUT-ing the template config), and
 * returns the saved {@link PoMappingConfig} so the editor can show it for
 * review. Replaces any existing mapping for that supplier.
 *
 * POST /api/suppliers/{id}/po-mapping/apply-template  body { templateId }
 *   404 — unknown supplier or unknown template
 *   400 — blank templateId
 */
export async function applyPoMappingTemplate(
  supplierId: string,
  templateId: string,
): Promise<import("@/lib/api/types").PoMappingConfig> {
  if (USE_MOCK) {
    await delay(220);
    const templates = await getPoMappingTemplates();
    const tpl = templates.find(t => t.id === templateId);
    if (!tpl) throw new ApiHttpError(`Unknown starter template '${templateId}'.`, 404);
    // Mirror the backend: the persisted config is the template config verbatim.
    return tpl.config;
  }
  const headers = await authHeader();
  const res = await fetchWithTimeout(
    `${API_BASE_URL}/api/suppliers/${supplierId}/po-mapping/apply-template`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ templateId }),
    },
  );
  if (!res.ok) {
    let body: unknown = null;
    try { body = await res.json(); } catch { /* non-JSON error body */ }
    throw new ApiHttpError(`apply-template: ${res.status}`, res.status, body);
  }
  return res.json() as Promise<import("@/lib/api/types").PoMappingConfig>;
}

// ── Standalone suppliers export (for components that prefer named imports) ────
export const getSuppliers = USE_MOCK ? mockGetSuppliersFn : realGetSuppliersFn;

// ── Connectors / delivery config ─────────────────────────────────────────────

export interface DeliveryConfigSummary {
  protocol: string | null;
  endpointUrl: string | null;
  isActive: boolean;
  lastTestedAt: string | null;
}

export async function getSupplierDeliveryConfig(supplierId: string): Promise<DeliveryConfigSummary | null> {
  if (USE_MOCK) return null;
  const headers = await authHeader();
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/suppliers/${supplierId}/delivery-config`, { headers });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`delivery-config GET: ${res.status}`);
  return res.json();
}

export async function testFireDeliveryConfig(supplierId: string): Promise<{ success: boolean; message: string }> {
  if (USE_MOCK) {
    await delay(800);
    return { success: true, message: "Test delivery sent (mock mode)" };
  }
  const headers = await authHeader();
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/suppliers/${supplierId}/delivery-config/test-fire`, {
    method: "POST",
    headers,
  }, 30000);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.message ?? `test-fire: ${res.status}`);
  }
  return res.json();
}

// ── Inbound: Invoices ─────────────────────────────────────────────────────────

export interface InvoiceDto {
  id: string;
  supplierId: string | null;
  supplierName: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  totalAmount: number | null;
  currency: string | null;
  status: string;
  lineCount: number;
  createdAt: string;
}

const _mockInvoices: InvoiceDto[] = [
  { id: "inv-001", supplierId: null, supplierName: "FastParts Inc",    invoiceNumber: "INV-2026-001", invoiceDate: "2026-05-01", totalAmount: 2450.00, currency: "EUR", status: "pending",  lineCount: 3, createdAt: new Date().toISOString() },
  { id: "inv-002", supplierId: null, supplierName: "ElectroSupply Co", invoiceNumber: "INV-2026-002", invoiceDate: "2026-05-10", totalAmount:  890.50, currency: "EUR", status: "approved", lineCount: 1, createdAt: new Date().toISOString() },
];

export async function getInvoices(): Promise<InvoiceDto[]> {
  if (USE_MOCK) { await delay(400); return [..._mockInvoices]; }
  const headers = await authHeader();
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/invoices`, { headers });
  if (!res.ok) throw new Error(`invoices: ${res.status}`);
  return res.json();
}

export async function uploadInvoice(file: File, supplierId?: string): Promise<InvoiceDto> {
  const headers = await authHeader();
  const form = new FormData();
  form.append("file", file);
  const url = supplierId
    ? `${API_BASE_URL}/api/invoices/upload?supplierId=${supplierId}`
    : `${API_BASE_URL}/api/invoices/upload`;
  const res = await fetchWithTimeout(url, { method: "POST", headers, body: form }, 60000);
  if (!res.ok) { const b = await res.json().catch(() => null); throw new Error(b?.error ?? `invoices upload: ${res.status}`); }
  return res.json();
}

export async function approveInvoice(id: string): Promise<InvoiceDto> {
  if (USE_MOCK) {
    await delay(300);
    const inv = _mockInvoices.find(i => i.id === id);
    if (inv) inv.status = "approved";
    return inv ?? _mockInvoices[0];
  }
  const headers = await authHeader();
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/invoices/${id}/approve`, { method: "POST", headers }, 30000);
  if (!res.ok) throw new Error(`invoices approve: ${res.status}`);
  return res.json();
}

// Backend GET /api/invoices/{id}/download returns a BINARY file (File(bytes,...)),
// not JSON. Read the blob and return an object URL the caller can open + revoke.
export async function downloadInvoice(id: string, format = "csv"): Promise<{ url: string }> {
  if (USE_MOCK) { return { url: `#mock-invoice-download/${id}` }; }
  const headers = await authHeader();
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/invoices/${id}/download?format=${format}`, { headers });
  if (!res.ok) {
    const b = await res.json().catch(() => null);
    throw new Error(b?.error ?? `invoices download: ${res.status}`);
  }
  const blob = await res.blob();
  return { url: URL.createObjectURL(blob) };
}

// ── Inbound: ASNs (Advance Shipping Notices) ──────────────────────────────────

export interface AsnDto {
  id: string;
  supplierId: string | null;
  supplierName: string | null;
  asnNumber: string | null;
  shipDate: string | null;
  packageCount: number;
  status: string;
  createdAt: string;
}

const _mockAsns: AsnDto[] = [
  { id: "asn-001", supplierId: null, supplierName: "FastParts Inc",    asnNumber: "ASN-2026-001", shipDate: "2026-05-15", packageCount: 3, status: "received", createdAt: new Date().toISOString() },
  { id: "asn-002", supplierId: null, supplierName: "GlobalComponents", asnNumber: "ASN-2026-002", shipDate: "2026-05-20", packageCount: 1, status: "pending",  createdAt: new Date().toISOString() },
];

export async function getAsns(): Promise<AsnDto[]> {
  if (USE_MOCK) { await delay(400); return [..._mockAsns]; }
  const headers = await authHeader();
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/asns`, { headers });
  if (!res.ok) throw new Error(`asns: ${res.status}`);
  return res.json();
}

export async function uploadAsn(file: File, supplierId?: string): Promise<AsnDto> {
  const headers = await authHeader();
  const form = new FormData();
  form.append("file", file);
  const url = supplierId
    ? `${API_BASE_URL}/api/asns/upload?supplierId=${supplierId}`
    : `${API_BASE_URL}/api/asns/upload`;
  const res = await fetchWithTimeout(url, { method: "POST", headers, body: form }, 60000);
  if (!res.ok) { const b = await res.json().catch(() => null); throw new Error(b?.error ?? `asns upload: ${res.status}`); }
  return res.json();
}

// ── Acceptance profile ────────────────────────────────────────────────────────
// GET /api/suppliers/{id}/acceptance-profile
// POST /api/suppliers/{id}/acceptance-profile
// POST /api/suppliers/{id}/acceptance-profile/{versionNo}/activate

import type { AcceptanceRule, AcceptanceProfile, OrderValidationResult, OrderException } from "@/types/procurement";

async function mockGetAcceptanceProfile(_supplierId: string): Promise<AcceptanceProfile | null> {
  await delay(200);
  return null;
}

async function realGetAcceptanceProfile(supplierId: string): Promise<AcceptanceProfile | null> {
  const res = await fetchWithTimeout(
    `${API_BASE_URL}/api/suppliers/${supplierId}/acceptance-profile`,
    { headers: await authHeader() },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`acceptance-profile GET: ${res.status}`);
  return res.json() as Promise<AcceptanceProfile>;
}

async function mockSaveAcceptanceProfile(
  supplierId: string,
  body: { protocol?: string; outputFormat?: string; rules: AcceptanceRule[] },
): Promise<AcceptanceProfile> {
  await delay(400);
  return {
    id: crypto.randomUUID(),
    supplierId,
    versionNo: 1,
    status: "draft",
    protocol: body.protocol,
    outputFormat: body.outputFormat,
    rules: body.rules,
    createdAt: new Date().toISOString(),
  };
}

async function realSaveAcceptanceProfile(
  supplierId: string,
  body: { protocol?: string; outputFormat?: string; rules: AcceptanceRule[] },
): Promise<AcceptanceProfile> {
  const res = await fetchWithTimeout(
    `${API_BASE_URL}/api/suppliers/${supplierId}/acceptance-profile`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...await authHeader() },
      body: JSON.stringify(body),
    },
    30000,
  );
  if (!res.ok) { const t = await res.text(); throw new Error(t || `acceptance-profile POST: ${res.status}`); }
  return res.json() as Promise<AcceptanceProfile>;
}

async function mockActivateAcceptanceVersion(_supplierId: string, _versionNo: number): Promise<void> {
  await delay(300);
}

async function realActivateAcceptanceVersion(supplierId: string, versionNo: number): Promise<void> {
  const res = await fetchWithTimeout(
    `${API_BASE_URL}/api/suppliers/${supplierId}/acceptance-profile/${versionNo}/activate`,
    { method: "POST", headers: await authHeader() },
    30000,
  );
  if (!res.ok) { const t = await res.text(); throw new Error(t || `acceptance-profile activate: ${res.status}`); }
}

async function mockValidateOrder(_orderId: string): Promise<OrderValidationResult> {
  await delay(300);
  return { orderId: _orderId, passed: true, results: [] };
}

async function realValidateOrder(orderId: string): Promise<OrderValidationResult> {
  const res = await fetchWithTimeout(
    `${API_BASE_URL}/api/orders/${orderId}/validate`,
    { method: "POST", headers: await authHeader() },
    30000,
  );
  if (!res.ok) { const t = await res.text(); throw new Error(t || `validate: ${res.status}`); }
  // The backend returns a bare array of flat result rows
  // ({ lineNumber, severity, status, code, message }); some builds wrap them in an
  // { orderId, passed, results } envelope. Normalise BOTH into the envelope shape
  // the UI expects, so an empty result (e.g. a supplier with no acceptance profile
  // → []) renders cleanly instead of crashing on `.results.length`.
  type Row = { lineNumber?: number | null; severity?: string; status?: string; code?: string; message?: string; title?: string | null };
  const raw: unknown = await res.json();
  const rows: Row[] = Array.isArray(raw)
    ? (raw as Row[])
    : Array.isArray((raw as { results?: unknown })?.results)
      ? (raw as { results: Row[] }).results
      : [];
  return {
    orderId,
    // An EMPTY result set is NOT a pass. Validation always emits mandatory invariant rows now, so
    // this is defensive: `[].every()` is vacuously true, which previously reported a green "Passed"
    // for an order that was never actually checked.
    passed: rows.length > 0 && rows.every((r) => r.status === "pass"),
    results: rows.map((r) => {
      const severity: "error" | "warning" = r.severity === "warning" ? "warning" : "error";
      const code = r.code ?? "";
      return {
        rule: {
          scope: (r.lineNumber != null ? "line" : "order") as "order" | "line",
          fieldPath: code.split(".")[0] || code || "rule",
          operator: "equals" as const,
          severity,
          blockOnFail: severity === "error",
        },
        passed: r.status === "pass",
        message: r.message ?? undefined,
        title: r.title ?? undefined,
        lineNumber: r.lineNumber ?? undefined,
        severity,
      };
    }),
  };
}

// ── Order exceptions ──────────────────────────────────────────────────────────
// GET /api/orders/{id}/exceptions

async function mockGetOrderExceptions(_orderId: string): Promise<OrderException[]> {
  await delay(150);
  return [];
}

async function realGetOrderExceptions(orderId: string): Promise<OrderException[]> {
  const res = await fetchWithTimeout(
    `${API_BASE_URL}/api/orders/${orderId}/exceptions`,
    { headers: await authHeader() },
  );
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`order-exceptions: ${res.status}`);
  return res.json() as Promise<OrderException[]>;
}

// ── Acceptance + exceptions exports ──────────────────────────────────────────

export const getAcceptanceProfile = USE_MOCK ? mockGetAcceptanceProfile : realGetAcceptanceProfile;
export const saveAcceptanceProfile = USE_MOCK ? mockSaveAcceptanceProfile : realSaveAcceptanceProfile;
export const activateAcceptanceVersion = USE_MOCK ? mockActivateAcceptanceVersion : realActivateAcceptanceVersion;
export const validateOrder = USE_MOCK ? mockValidateOrder : realValidateOrder;
export const getOrderExceptions = USE_MOCK ? mockGetOrderExceptions : realGetOrderExceptions;

// ── Exceptions + ops/health (moved to src/lib/api/operations.ts) ──────────────
export {
  getExceptions,
  resolveException,
  ignoreException,
  getOpsHealth,
  getDeadLetterOrders,
  requeueDelivery,
} from "@/lib/api/operations";
export type { OpsHealth, DeadLetterOrder } from "@/lib/api/operations";

// ── Group V8 — standards conformance report (GET /api/orders/{id}/conformance) ──
// Backend: ProcuLink.Api/Controllers/OrdersController.cs GetConformance. Read-only,
// non-mutating — transforms the order to the named standards format IN MEMORY and
// validates the produced bytes against the named profile (cXML 1.2 / UBL 2.1 / X12 850).
// Org-scoped server-side. `?format=cxml|ubl|x12` is explicit; omitting it resolves the
// supplier's configured delivery format and 400s if none. `?download=md` returns a
// downloadable text/markdown report (handled separately via conformanceReportDownloadUrl).

/** One named, profile-referenced conformance check row. Mirrors ConformanceCheckDto. */
export interface ConformanceCheck {
  /** Stable machine code, e.g. "ubl.id". */
  code: string;
  /** "Error" | "Warning" | "Info". */
  severity: string;
  passed: boolean;
  message: string;
  /** The exact element / segment / cardinality reference in the named profile. */
  profileRef: string;
}

/** A standards conformance report for one order's would-be outbound document. Mirrors ConformanceReportDto. */
export interface ConformanceReport {
  orderId: string;
  /** The output format the report was produced for (e.g. "cxml", "ubl", "x12"). */
  format: string;
  /** The named profile enum value, e.g. "Ubl21Order". */
  profile: string;
  /** Human-readable profile name, e.g. "UBL 2.1 Order (Peppol BIS Order-only 3.0)". */
  profileName: string;
  /** Profile version, e.g. "2.1" / "004010" / "D.96A". */
  profileVersion: string;
  /** True when no Error-severity check failed. */
  overallPass: boolean;
  errorCount: number;
  warningCount: number;
  checks: ConformanceCheck[];
}

export type ConformanceFormat = "cxml" | "ubl" | "x12";

async function mockGetConformanceReport(orderId: string, format: ConformanceFormat = "cxml"): Promise<ConformanceReport> {
  await delay(250);
  const profiles: Record<ConformanceFormat, { profile: string; name: string; version: string }> = {
    cxml: { profile: "Cxml12OrderRequest", name: "cXML 1.2 OrderRequest", version: "1.2.060" },
    ubl:  { profile: "Ubl21Order",         name: "UBL 2.1 Order (Peppol BIS Order-only 3.0)", version: "2.1" },
    x12:  { profile: "X12_850",            name: "X12 850 Purchase Order", version: "004010" },
  };
  const p = profiles[format];
  const checks: ConformanceCheck[] = [
    { code: `${format}.id`,       severity: "Error",   passed: true,  message: "Order identifier present.",        profileRef: format === "ubl" ? "cbc:ID" : format === "x12" ? "BEG03" : "OrderRequestHeader/@orderID" },
    { code: `${format}.currency`, severity: "Error",   passed: true,  message: "Document currency present.",        profileRef: format === "ubl" ? "cbc:DocumentCurrencyCode" : format === "x12" ? "CUR02" : "Total/Money/@currency" },
    { code: `${format}.lines`,    severity: "Error",   passed: format !== "x12", message: format === "x12" ? "At least one PO1 line segment is required." : "Order has at least one line.", profileRef: format === "ubl" ? "cac:OrderLine" : format === "x12" ? "PO1" : "ItemOut" },
    { code: `${format}.shipto`,   severity: "Warning", passed: false, message: "Ship-to party is recommended but missing.", profileRef: format === "ubl" ? "cac:Delivery/cac:DeliveryLocation" : format === "x12" ? "N1*ST" : "ShipTo/Address" },
  ];
  const errorCount = checks.filter(c => c.severity === "Error" && !c.passed).length;
  const warningCount = checks.filter(c => c.severity === "Warning" && !c.passed).length;
  return {
    orderId, format, profile: p.profile, profileName: p.name, profileVersion: p.version,
    overallPass: errorCount === 0, errorCount, warningCount, checks,
  };
}

async function realGetConformanceReport(orderId: string, format?: ConformanceFormat): Promise<ConformanceReport> {
  const qs = format ? `?format=${format}` : "";
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/orders/${orderId}/conformance${qs}`, {
    headers: await authHeader(),
  }, 30000);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const message = body && typeof body === "object" && "error" in body
      ? String((body as { error?: unknown }).error) : res.statusText;
    throw new ApiHttpError(message || `conformance: ${res.status}`, res.status, body);
  }
  return res.json() as Promise<ConformanceReport>;
}

export const getConformanceReport = USE_MOCK ? mockGetConformanceReport : realGetConformanceReport;

/**
 * Build the absolute URL for the downloadable Markdown conformance report. The
 * backend serves it at the same route with `?download=md`; the link must still
 * carry the Clerk JWT, so callers fetch it via downloadConformanceReport (below)
 * rather than navigating directly.
 */
export function conformanceReportDownloadUrl(orderId: string, format: ConformanceFormat): string {
  return `${API_BASE_URL}/api/orders/${orderId}/conformance?format=${format}&download=md`;
}

/**
 * Fetch the Markdown conformance report (authenticated) and return it as a Blob so
 * the UI can trigger a client-side download. In mock mode it synthesises Markdown
 * from the mock JSON report so the button still produces a file in dev/demo.
 */
async function realDownloadConformanceReport(orderId: string, format: ConformanceFormat): Promise<Blob> {
  const res = await fetchWithTimeout(conformanceReportDownloadUrl(orderId, format), {
    headers: await authHeader(),
  }, 30000);
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new ApiHttpError(t || `conformance download: ${res.status}`, res.status, null);
  }
  return res.blob();
}

async function mockDownloadConformanceReport(orderId: string, format: ConformanceFormat): Promise<Blob> {
  const report = await mockGetConformanceReport(orderId, format);
  const md = conformanceReportToMarkdown(report);
  return new Blob([md], { type: "text/markdown" });
}

export const downloadConformanceReport = USE_MOCK ? mockDownloadConformanceReport : realDownloadConformanceReport;

/** Render a ConformanceReport to Markdown (client-side fallback mirroring the backend's ToMarkdown). */
export function conformanceReportToMarkdown(report: ConformanceReport): string {
  const lines: string[] = [];
  lines.push(`# Conformance report — ${report.profileName}`);
  lines.push("");
  lines.push(`- Order: ${report.orderId}`);
  lines.push(`- Format: ${report.format}`);
  lines.push(`- Profile: ${report.profile} (v${report.profileVersion})`);
  lines.push(`- Result: ${report.overallPass ? "PASS" : "FAIL"} (${report.errorCount} error${report.errorCount === 1 ? "" : "s"}, ${report.warningCount} warning${report.warningCount === 1 ? "" : "s"})`);
  lines.push("");
  lines.push("| Result | Severity | Code | Message | Profile reference |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const c of report.checks) {
    lines.push(`| ${c.passed ? "PASS" : "FAIL"} | ${c.severity} | ${c.code} | ${c.message.replace(/\|/g, "\\|")} | ${c.profileRef.replace(/\|/g, "\\|")} |`);
  }
  lines.push("");
  return lines.join("\n");
}

// ── Group V4 — rule definitions catalog + supplier bindings ───────────────────
// Backend: ProcuLink.Api/Controllers/RuleDefinitionsController.cs.
//   GET /api/rule-definitions                       → RuleDefinitionDto[]   (the org catalog)
//   GET /api/rule-definitions/{definitionId}        → RuleDefinitionDto
//   GET /api/suppliers/{supplierId}/rule-bindings   → SupplierRuleBindingDto[]
// Read-only (authoring lives in the supplier Acceptance tab). Org-scoped server-side.

/** A reusable rule definition (template) in the org's catalog. Mirrors RuleDefinitionDto. */
export interface RuleDefinition {
  id: string;
  code: string;
  title: string;
  description: string | null;
  scope: string;
  fieldPath: string;
  operator: string;
  defaultSeverity: string;
  defaultExpectedValue: string | null;
  paramHint: string | null;
  ublRef: string | null;
  edifactRef: string | null;
  x12Ref: string | null;
  cxmlRef: string | null;
  isSystem: boolean;
  createdAt: string;
}

/** A supplier's executable acceptance rule joined to the definition it binds to. Mirrors SupplierRuleBindingDto. */
export interface SupplierRuleBinding {
  ruleId: string;
  ruleDefinitionId: string | null;
  ruleCode: string | null;
  scope: string;
  fieldPath: string;
  operator: string;
  expectedValue: string | null;
  severity: string;
  blockOnFail: boolean;
  /** Null for an unlinked legacy rule. */
  definition: RuleDefinition | null;
}

const MOCK_RULE_DEFINITIONS: RuleDefinition[] = [
  { id: "rd-1", code: "ORDER.CURRENCY.REQUIRED", title: "Order currency is present", description: "Every order must carry a document currency.", scope: "order", fieldPath: "currency", operator: "required", defaultSeverity: "error", defaultExpectedValue: null, paramHint: null, ublRef: "cbc:DocumentCurrencyCode", edifactRef: "CUX C504 6345", x12Ref: "CUR02", cxmlRef: "Total/Money/@currency", isSystem: true, createdAt: "2026-06-01T00:00:00Z" },
  { id: "rd-2", code: "LINE.SUPPLIERCODE.REQUIRED", title: "Every line has a supplier item code", description: "Each line must resolve to a supplier item code before delivery.", scope: "line", fieldPath: "supplierItemCode", operator: "required", defaultSeverity: "error", defaultExpectedValue: null, paramHint: null, ublRef: "cac:Item/cac:SellersItemIdentification/cbc:ID", edifactRef: "LIN C212 7140", x12Ref: "PO107", cxmlRef: "ItemID/SupplierPartID", isSystem: true, createdAt: "2026-06-01T00:00:00Z" },
  { id: "rd-3", code: "LINE.QTY.POSITIVE", title: "Quantity greater than zero", description: "Reject any line whose ordered quantity is zero or negative.", scope: "line", fieldPath: "quantity", operator: "greater_than", defaultSeverity: "error", defaultExpectedValue: "0", paramHint: "numeric", ublRef: "cbc:Quantity", edifactRef: "QTY C186 6060", x12Ref: "PO102", cxmlRef: "ItemOut/@quantity", isSystem: true, createdAt: "2026-06-01T00:00:00Z" },
];

async function mockListRuleDefinitions(): Promise<RuleDefinition[]> {
  await delay(200);
  return [...MOCK_RULE_DEFINITIONS];
}

async function realListRuleDefinitions(): Promise<RuleDefinition[]> {
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/rule-definitions`, { headers: await authHeader() });
  if (!res.ok) throw new Error(`rule-definitions: ${res.status}`);
  return res.json() as Promise<RuleDefinition[]>;
}

async function mockGetSupplierRuleBindings(supplierId: string): Promise<SupplierRuleBinding[]> {
  await delay(200);
  void supplierId;
  return [
    { ruleId: "b-1", ruleDefinitionId: "rd-1", ruleCode: "ORDER.CURRENCY.REQUIRED", scope: "order", fieldPath: "currency", operator: "equals", expectedValue: "EUR", severity: "error", blockOnFail: true, definition: MOCK_RULE_DEFINITIONS[0] },
    { ruleId: "b-2", ruleDefinitionId: "rd-2", ruleCode: "LINE.SUPPLIERCODE.REQUIRED", scope: "line", fieldPath: "supplierItemCode", operator: "required", expectedValue: null, severity: "error", blockOnFail: true, definition: MOCK_RULE_DEFINITIONS[1] },
  ];
}

async function realGetSupplierRuleBindings(supplierId: string): Promise<SupplierRuleBinding[]> {
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/suppliers/${supplierId}/rule-bindings`, { headers: await authHeader() });
  if (!res.ok) throw new Error(`rule-bindings: ${res.status}`);
  return res.json() as Promise<SupplierRuleBinding[]>;
}

export const listRuleDefinitions = USE_MOCK ? mockListRuleDefinitions : realListRuleDefinitions;
export const getSupplierRuleBindings = USE_MOCK ? mockGetSupplierRuleBindings : realGetSupplierRuleBindings;

// ── Group V1 — versioned Supplier Connection (GET/POST/PUT /api/connections) ──
// Backend: ProcuLink.Api/Controllers/ConnectionsController.cs (route "api/connections").
// All routes are org-scoped server-side via ICurrentTenantService (the auth header
// carries the Clerk JWT). Lifecycle endpoints return 204 No Content; this client
// resolves them to void and surfaces the backend's 409 (immutable/illegal
// transition) as an ApiHttpError so the UI can show a clear message.

import type {
  ConnectionSummary,
  ConnectionDetail,
  ConnectionRevision,
  ConnectionRevisionStatus,
  ConnectionTestEvidence,
  CreateConnectionRevisionRequest,
  ConnectionRevisionBundle,
  ReplayRequest,
  ReplayResponse,
} from "@/lib/api/types";

// In mock mode the Connections UI runs against an in-memory store so the screens
// are explorable without a backend. The store is seeded from MOCK_SUPPLIERS.
const _mockConnections: ConnectionDetail[] = MOCK_SUPPLIERS.slice(0, 2).map((s, i) => {
  const now = new Date(Date.now() - (i + 1) * 86_400_000).toISOString();
  const publishedRevId = `rev-${s.id}-1`;
  return {
    id: `conn-${s.id}`,
    supplierId: s.id,
    name: s.name,
    activeRevisionId: i === 0 ? publishedRevId : null,
    createdAt: now,
    updatedAt: now,
    revisions:
      i === 0
        ? [
            { id: `rev-${s.id}-2`, versionNo: 2, status: "draft", effectiveFrom: null, effectiveTo: null, publishedAt: null, createdAt: now },
            { id: publishedRevId, versionNo: 1, status: "published", effectiveFrom: now, effectiveTo: null, publishedAt: now, createdAt: now },
          ]
        : [
            { id: `rev-${s.id}-1`, versionNo: 1, status: "draft", effectiveFrom: null, effectiveTo: null, publishedAt: null, createdAt: now },
          ],
  };
});

function _mockRevisionBundle(connId: string, revId: string): ConnectionRevision {
  const conn = _mockConnections.find((c) => c.id === connId);
  const summary = conn?.revisions.find((r) => r.id === revId);
  return {
    id: revId,
    connectionId: connId,
    versionNo: summary?.versionNo ?? 1,
    status: summary?.status ?? "draft",
    effectiveFrom: summary?.effectiveFrom ?? null,
    effectiveTo: summary?.effectiveTo ?? null,
    publishedAt: summary?.publishedAt ?? null,
    createdAt: summary?.createdAt ?? new Date().toISOString(),
    inputMappingJson: '{"hasHeaderRecord":true,"separator":","}',
    outputMappingJson: null,
    outputFormat: "csv",
    deliveryProtocol: "http",
    deliveryConfigJson: '{"endpoint":"https://supplier.example.com/orders"}',
    deliveryAutoDeliver: false,
    hasCredentials: true,
    acceptanceProfileId: null,
    acceptanceVersionNo: null,
    catalogMode: "live",
    itemMappings: [
      { buyerItemCode: "ACM-BOLT-001", supplierItemCode: "FP-B001", confidence: 1, source: "manual" },
    ],
  };
}

async function mockListConnections(): Promise<ConnectionSummary[]> {
  await delay(200);
  return _mockConnections.map((c) => ({
    id: c.id,
    supplierId: c.supplierId,
    name: c.name,
    activeRevisionId: c.activeRevisionId,
    activeVersionNo: c.revisions.find((r) => r.id === c.activeRevisionId)?.versionNo ?? null,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  }));
}

async function realListConnections(): Promise<ConnectionSummary[]> {
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/connections`, { headers: await authHeader() });
  if (!res.ok) throw new ApiHttpError(`Failed to list connections: ${res.statusText}`, res.status);
  return res.json() as Promise<ConnectionSummary[]>;
}

async function mockGetConnection(connectionId: string): Promise<ConnectionDetail | null> {
  await delay(200);
  return _mockConnections.find((c) => c.id === connectionId) ?? null;
}

async function realGetConnection(connectionId: string): Promise<ConnectionDetail | null> {
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/connections/${connectionId}`, { headers: await authHeader() });
  if (res.status === 404) return null;
  if (!res.ok) throw new ApiHttpError(`Failed to fetch connection: ${res.statusText}`, res.status);
  return res.json() as Promise<ConnectionDetail>;
}

async function mockEnsureConnection(supplierId: string): Promise<ConnectionDetail | null> {
  await delay(200);
  const existing = _mockConnections.find((c) => c.supplierId === supplierId);
  if (existing) return existing;
  const supplier = mockSupplierList.find((s) => s.id === supplierId);
  if (!supplier) return null;
  const now = new Date().toISOString();
  const conn: ConnectionDetail = {
    id: `conn-${supplierId}`,
    supplierId,
    name: supplier.name,
    activeRevisionId: null,
    createdAt: now,
    updatedAt: now,
    revisions: [],
  };
  _mockConnections.push(conn);
  return conn;
}

async function realEnsureConnection(supplierId: string): Promise<ConnectionDetail | null> {
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/connections/ensure/${supplierId}`, {
    method: "POST",
    headers: await authHeader(),
  }, 30000);
  if (res.status === 404) return null;
  if (!res.ok) throw new ApiHttpError(`Failed to ensure connection: ${res.statusText}`, res.status);
  return res.json() as Promise<ConnectionDetail>;
}

async function mockGetConnectionRevision(connectionId: string, revisionId: string): Promise<ConnectionRevision | null> {
  await delay(150);
  const conn = _mockConnections.find((c) => c.id === connectionId);
  if (!conn || !conn.revisions.some((r) => r.id === revisionId)) return null;
  return _mockRevisionBundle(connectionId, revisionId);
}

async function realGetConnectionRevision(connectionId: string, revisionId: string): Promise<ConnectionRevision | null> {
  const res = await fetchWithTimeout(
    `${API_BASE_URL}/api/connections/${connectionId}/revisions/${revisionId}`,
    { headers: await authHeader() },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new ApiHttpError(`Failed to fetch revision: ${res.statusText}`, res.status);
  return res.json() as Promise<ConnectionRevision>;
}

async function mockCreateConnectionDraft(
  connectionId: string,
  _request?: CreateConnectionRevisionRequest,
): Promise<ConnectionRevision | null> {
  await delay(300);
  const conn = _mockConnections.find((c) => c.id === connectionId);
  if (!conn) return null;
  const nextVersion = (conn.revisions.reduce((m, r) => Math.max(m, r.versionNo), 0) || 0) + 1;
  const now = new Date().toISOString();
  const revId = `rev-${conn.supplierId}-${nextVersion}`;
  conn.revisions.unshift({
    id: revId, versionNo: nextVersion, status: "draft",
    effectiveFrom: null, effectiveTo: null, publishedAt: null, createdAt: now,
  });
  conn.updatedAt = now;
  return _mockRevisionBundle(connectionId, revId);
}

async function realCreateConnectionDraft(
  connectionId: string,
  request?: CreateConnectionRevisionRequest,
): Promise<ConnectionRevision | null> {
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/connections/${connectionId}/revisions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await authHeader() },
    body: JSON.stringify(request ?? { cloneFromActive: true }),
  }, 30000);
  if (res.status === 404) return null;
  if (!res.ok) throw new ApiHttpError(`Failed to create draft: ${res.statusText}`, res.status);
  return res.json() as Promise<ConnectionRevision>;
}

async function mockUpdateConnectionDraft(
  _connectionId: string,
  _revisionId: string,
  _bundle: ConnectionRevisionBundle,
): Promise<void> {
  await delay(300);
}

async function realUpdateConnectionDraft(
  connectionId: string,
  revisionId: string,
  bundle: ConnectionRevisionBundle,
): Promise<void> {
  const res = await fetchWithTimeout(
    `${API_BASE_URL}/api/connections/${connectionId}/revisions/${revisionId}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...await authHeader() },
      body: JSON.stringify({ bundle }),
    },
    30000,
  );
  if (res.ok || res.status === 204) return;
  if (res.status === 409) throw new ApiHttpError("Published/archived revisions cannot be edited.", 409);
  throw new ApiHttpError(`Failed to update draft: ${res.statusText}`, res.status);
}

/**
 * Best-effort extraction of the backend's error message from a non-OK response.
 * ConnectionsController returns Conflict("plain message") (text/plain), but be
 * tolerant of a JSON-string body or ProblemDetails-ish object shapes too.
 */
async function readErrorBodyText(res: Response): Promise<string | null> {
  try {
    const raw = (await res.text()).trim();
    if (!raw) return null;
    if (raw.startsWith('"') && raw.endsWith('"')) {
      try { return JSON.parse(raw) as string; } catch { return raw.slice(1, -1); }
    }
    if (raw.startsWith("{")) {
      try {
        const obj = JSON.parse(raw) as Record<string, unknown>;
        const msg = obj.message ?? obj.error ?? obj.detail ?? obj.title;
        return typeof msg === "string" && msg ? msg : null;
      } catch { return null; }
    }
    return raw;
  } catch {
    return null;
  }
}

/**
 * Drive a revision through publish/archive. Returns void; 409 → ApiHttpError
 * carrying the BACKEND's message (e.g. publish without test evidence returns
 * "Run tests on this revision before publishing.") so the UI shows the real
 * reason inline, not a stale guess. (The test action lives separately in
 * markConnectionRevisionTest — it RUNS the test pack and returns evidence.)
 */
async function realConnectionLifecycle(
  connectionId: string,
  revisionId: string,
  action: "publish" | "archive",
): Promise<void> {
  const res = await fetchWithTimeout(
    `${API_BASE_URL}/api/connections/${connectionId}/revisions/${revisionId}/${action}`,
    { method: "POST", headers: await authHeader() },
    30000,
  );
  if (res.ok || res.status === 204) return;
  if (res.status === 409) {
    const serverMsg = await readErrorBodyText(res);
    const fallback =
      action === "publish"
        ? "This revision cannot be published in its current state."
        : "This revision cannot be archived.";
    throw new ApiHttpError(serverMsg || fallback, 409);
  }
  if (res.status === 404) throw new ApiHttpError("Connection or revision not found.", 404);
  throw new ApiHttpError(`Failed to ${action} revision: ${res.statusText}`, res.status);
}

function mockConnectionLifecycle(action: "publish" | "archive") {
  return async (connectionId: string, revisionId: string): Promise<void> => {
    await delay(300);
    const conn = _mockConnections.find((c) => c.id === connectionId);
    const rev = conn?.revisions.find((r) => r.id === revisionId);
    if (!conn || !rev) return;
    const now = new Date().toISOString();
    if (action === "publish") {
      for (const r of conn.revisions) {
        if (r.status === "published") { r.status = "archived"; r.effectiveTo = now; }
      }
      rev.status = "published";
      rev.publishedAt = now;
      rev.effectiveFrom = now;
      conn.activeRevisionId = rev.id;
    } else {
      rev.status = "archived";
      if (conn.activeRevisionId === rev.id) conn.activeRevisionId = null;
    }
    conn.updatedAt = now;
  };
}

// ── Launch batch 3 — run the test pack + rollback ─────────────────────────────
// POST .../test RUNS the real test pack server-side (replay over recent orders +
// conformance; never delivers), stores the evidence, marks the revision `test`,
// and returns the evidence summary (200 even when the pack FAILED — passed:false).
// POST .../rollback clones a previously-published (now archived) revision into a
// NEW published revision and flips the active pointer; the target stays archived.

async function mockMarkConnectionRevisionTest(
  connectionId: string,
  revisionId: string,
): Promise<ConnectionTestEvidence> {
  await delay(400);
  const conn = _mockConnections.find((c) => c.id === connectionId);
  const rev = conn?.revisions.find((r) => r.id === revisionId);
  const now = new Date().toISOString();
  if (conn && rev) {
    rev.status = "test";
    conn.updatedAt = now;
  }
  return {
    passed: true,
    testedAt: now,
    summaryJson: JSON.stringify({
      replay: { passed: true, orderCount: 3, outputErrors: 0, outputChanged: 1, validationChanged: 0, note: null },
      conformance: { skipped: false, passed: true, profile: "CSV baseline", errors: 0, warnings: 0, note: null },
      error: null,
    }),
  };
}

async function realMarkConnectionRevisionTest(
  connectionId: string,
  revisionId: string,
): Promise<ConnectionTestEvidence> {
  const res = await fetchWithTimeout(
    `${API_BASE_URL}/api/connections/${connectionId}/revisions/${revisionId}/test`,
    { method: "POST", headers: await authHeader() },
    60000, // the pack replays recent orders server-side — allow it time
  );
  if (res.status === 409) {
    throw new ApiHttpError(
      (await readErrorBodyText(res)) || "Only draft or test revisions can be tested.",
      409,
    );
  }
  if (res.status === 404) throw new ApiHttpError("Connection or revision not found.", 404);
  if (!res.ok) throw new ApiHttpError(`Failed to run tests: ${res.statusText}`, res.status);
  return res.json() as Promise<ConnectionTestEvidence>;
}

async function mockRollbackConnectionRevision(
  connectionId: string,
  revisionId: string,
): Promise<ConnectionRevision | null> {
  await delay(300);
  const conn = _mockConnections.find((c) => c.id === connectionId);
  const target = conn?.revisions.find((r) => r.id === revisionId);
  if (!conn || !target) return null;
  const now = new Date().toISOString();
  for (const r of conn.revisions) {
    if (r.status === "published") { r.status = "archived"; r.effectiveTo = now; }
  }
  const nextVersion = conn.revisions.reduce((m, r) => Math.max(m, r.versionNo), 0) + 1;
  const revId = `rev-${conn.supplierId}-${nextVersion}`;
  conn.revisions.unshift({
    id: revId, versionNo: nextVersion, status: "published",
    effectiveFrom: now, effectiveTo: null, publishedAt: now, createdAt: now,
  });
  conn.activeRevisionId = revId;
  conn.updatedAt = now;
  return _mockRevisionBundle(connectionId, revId);
}

async function realRollbackConnectionRevision(
  connectionId: string,
  revisionId: string,
): Promise<ConnectionRevision | null> {
  const res = await fetchWithTimeout(
    `${API_BASE_URL}/api/connections/${connectionId}/revisions/${revisionId}/rollback`,
    { method: "POST", headers: await authHeader() },
    30000,
  );
  if (res.status === 409) {
    throw new ApiHttpError(
      (await readErrorBodyText(res)) ||
        "Rollback target must be a previously published (now archived) revision.",
      409,
    );
  }
  if (res.status === 404) throw new ApiHttpError("Connection or revision not found.", 404);
  if (!res.ok) throw new ApiHttpError(`Failed to roll back: ${res.statusText}`, res.status);
  return res.json() as Promise<ConnectionRevision>;
}

// ── Group V2 — replay / impact preview ───────────────────────────────────────
// POST /api/connections/{connectionId}/revisions/{revisionId}/replay. Runs
// historical orders through the revision and returns a per-order diff vs. the
// order's CURRENT result. Non-mutating, never delivers. Backend:
// ProcuLink.Api/Services/ReplayService.cs (MaxOrders=50, recentLimit clamp 1..50).

function _mockReplayOrders(): ReplayResponse["orders"] {
  return [
    {
      orderId: "ord-mock-1",
      poNumber: "PO-2026-0481",
      outputFormat: "Csv",
      outputChanged: true,
      currentOutput:
        "PoNumber,LineNo,ItemCode,Qty,UnitPrice\nPO-2026-0481,1,FP-B001,12,4.50\nPO-2026-0481,2,FP-W210,4,18.00",
      draftOutput:
        "PoNumber,LineNo,ItemCode,Qty,UnitPrice\nPO-2026-0481,1,FP-B001,12,4.500\nPO-2026-0481,2,SUP-W210,4,18.000",
      outputError: null,
      effectiveValueChanges: [
        { scope: "line", lineNumber: 2, field: "SupplierItemCode", currentValue: "FP-W210", draftValue: "SUP-W210" },
        { scope: "line", lineNumber: 1, field: "UnitPrice", currentValue: "4.50", draftValue: "4.500" },
      ],
      validationChanged: true,
      currentValidation: { passed: true, passCount: 6, failCount: 0, hasProfile: true },
      draftValidation: { passed: false, passCount: 5, failCount: 1, hasProfile: true },
      validationFlips: [
        {
          code: "ITEM_IN_CATALOG",
          lineNumber: 2,
          currentStatus: "pass",
          draftStatus: "fail",
          message: "Supplier item code 'SUP-W210' was not found in the supplier catalog.",
        },
      ],
    },
    {
      orderId: "ord-mock-2",
      poNumber: "PO-2026-0479",
      outputFormat: "Csv",
      outputChanged: true,
      currentOutput: "PoNumber,LineNo,ItemCode,Qty\nPO-2026-0479,1,FP-B001,3",
      draftOutput: "PoNumber,LineNo,ItemCode,Qty\nPO-2026-0479,1,FP-B001,3.0",
      outputError: null,
      effectiveValueChanges: [
        { scope: "line", lineNumber: 1, field: "Quantity", currentValue: "3", draftValue: "3.0" },
      ],
      validationChanged: false,
      currentValidation: { passed: true, passCount: 4, failCount: 0, hasProfile: true },
      draftValidation: { passed: true, passCount: 4, failCount: 0, hasProfile: true },
      validationFlips: [],
    },
    {
      orderId: "ord-mock-3",
      poNumber: "PO-2026-0470",
      outputFormat: "Xml",
      outputChanged: false,
      currentOutput: null,
      draftOutput: null,
      outputError: "Template render failed: unknown variable 'Line.Sku' at line 8.",
      effectiveValueChanges: [],
      validationChanged: false,
      currentValidation: { passed: true, passCount: 0, failCount: 0, hasProfile: false },
      draftValidation: { passed: true, passCount: 0, failCount: 0, hasProfile: false },
      validationFlips: [],
    },
  ];
}

async function mockReplayConnectionRevision(
  connectionId: string,
  revisionId: string,
  body?: ReplayRequest,
): Promise<ReplayResponse> {
  await delay(450);
  const conn = _mockConnections.find((c) => c.id === connectionId);
  const rev = conn?.revisions.find((r) => r.id === revisionId);
  const limit = Math.max(1, Math.min(50, body?.recentLimit && body.recentLimit > 0 ? body.recentLimit : 20));
  const orders = _mockReplayOrders().slice(0, Math.min(limit, 3));
  return {
    connectionId,
    revisionId,
    revisionVersionNo: rev?.versionNo ?? 1,
    revisionStatus: rev?.status ?? "draft",
    orderCount: orders.length,
    orders,
  };
}

async function realReplayConnectionRevision(
  connectionId: string,
  revisionId: string,
  body?: ReplayRequest,
): Promise<ReplayResponse> {
  const res = await fetchWithTimeout(
    `${API_BASE_URL}/api/connections/${connectionId}/revisions/${revisionId}/replay`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...await authHeader() },
      body: JSON.stringify({
        orderIds: body?.orderIds ?? null,
        recentLimit: body?.recentLimit ?? 20,
      }),
    },
    60000,
  );
  if (res.status === 404) throw new ApiHttpError("Connection or revision not found.", 404);
  if (!res.ok) throw new ApiHttpError(`Replay failed: ${res.statusText}`, res.status);
  return res.json() as Promise<ReplayResponse>;
}

export const replayConnectionRevision: (
  connectionId: string,
  revisionId: string,
  body?: ReplayRequest,
) => Promise<ReplayResponse> =
  USE_MOCK ? mockReplayConnectionRevision : realReplayConnectionRevision;

export const listConnections: () => Promise<ConnectionSummary[]> =
  USE_MOCK ? mockListConnections : realListConnections;
export const getConnection: (connectionId: string) => Promise<ConnectionDetail | null> =
  USE_MOCK ? mockGetConnection : realGetConnection;
export const ensureConnection: (supplierId: string) => Promise<ConnectionDetail | null> =
  USE_MOCK ? mockEnsureConnection : realEnsureConnection;
export const getConnectionRevision: (connectionId: string, revisionId: string) => Promise<ConnectionRevision | null> =
  USE_MOCK ? mockGetConnectionRevision : realGetConnectionRevision;
export const createConnectionDraft: (connectionId: string, request?: CreateConnectionRevisionRequest) => Promise<ConnectionRevision | null> =
  USE_MOCK ? mockCreateConnectionDraft : realCreateConnectionDraft;
export const updateConnectionDraft: (connectionId: string, revisionId: string, bundle: ConnectionRevisionBundle) => Promise<void> =
  USE_MOCK ? mockUpdateConnectionDraft : realUpdateConnectionDraft;
export const markConnectionRevisionTest: (connectionId: string, revisionId: string) => Promise<ConnectionTestEvidence> =
  USE_MOCK ? mockMarkConnectionRevisionTest : realMarkConnectionRevisionTest;
export const publishConnectionRevision: (connectionId: string, revisionId: string) => Promise<void> =
  USE_MOCK ? mockConnectionLifecycle("publish") : (c, r) => realConnectionLifecycle(c, r, "publish");
export const archiveConnectionRevision: (connectionId: string, revisionId: string) => Promise<void> =
  USE_MOCK ? mockConnectionLifecycle("archive") : (c, r) => realConnectionLifecycle(c, r, "archive");
export const rollbackConnectionRevision: (connectionId: string, revisionId: string) => Promise<ConnectionRevision | null> =
  USE_MOCK ? mockRollbackConnectionRevision : realRollbackConnectionRevision;

export type {
  ConnectionSummary,
  ConnectionDetail,
  ConnectionRevision,
  ConnectionRevisionStatus,
  ConnectionRevisionBundle,
  ConnectionTestEvidence,
  CreateConnectionRevisionRequest,
  ReplayRequest,
  ReplayResponse,
};
