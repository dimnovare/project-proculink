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
  BillingStatus,
  EmailSettings,
  UpdateEmailSettingsPayload,
  PassportDto,
  SupplierConfirmation,
  OrdersSummary,
  OrderDirection,
  OrgSettings,
  SetOrgLimitsRequest,
  OrgLimitsResponse,
} from "@/types/procurement";

function normalizeApiBaseUrl(raw: string | undefined): string {
  const value = (raw || "http://localhost:5223").trim().replace(/\/+$/, "");
  if (!value) return "http://localhost:5223";
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value}`;
}

const API_BASE_URL = normalizeApiBaseUrl(process.env.NEXT_PUBLIC_API_BASE_URL);
/**
 * Normalised public API base (no trailing slash). Exported so UI that needs to
 * display a backend URL — e.g. the inbound ingress endpoint on the Settings →
 * API keys tab — reuses the same normalization instead of re-reading the env.
 */
export const apiBaseUrl = API_BASE_URL;
// Mock mode is opt-in AND dev-only. Production builds NEVER render mock data
// regardless of env var, so prospects/customers never see staged content.
// (J2) Previously defaulted to true when env was absent, which leaked demo
// state into Vercel deploys without `NEXT_PUBLIC_USE_MOCK=false` set.
const USE_MOCK =
  process.env.NEXT_PUBLIC_USE_MOCK === "true" &&
  process.env.NODE_ENV !== "production";

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

/** True when the frontend uses in-memory mocks instead of the ASP.NET API. */
export const isApiMockMode = USE_MOCK;

/**
 * True only in the live QA-bypass e2e harness (NEXT_PUBLIC_QA_BYPASS_AUTH=true),
 * paired with PROCULINK_QA_BYPASS_AUTH on the backend. In that mode the browser
 * has NO Clerk session, so the usual `clerkReady` data-query gate would starve
 * every query. This flag lets queries run anyway. It is unset in prod and mock,
 * so production/mock behavior is unchanged.
 */
export const isQaBypass = process.env.NEXT_PUBLIC_QA_BYPASS_AUTH === "true";

/**
 * Returns an Authorization header with the current Clerk session JWT.
 * Uses window.Clerk (set by ClerkProvider) so this works outside React components.
 */
async function authHeader(): Promise<Record<string, string>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const token = await (window as any).Clerk?.session?.getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export class ApiHttpError extends Error {
  status: number;
  body: unknown;

  constructor(message: string, status: number, body: unknown = null) {
    super(message);
    this.name = "ApiHttpError";
    this.status = status;
    this.body = body;
  }
}

async function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit, timeoutMs = 8000) {
  const controller = new AbortController();
  let didTimeout = false;
  const timeout = globalThis.setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (err) {
    // Re-throw AbortError as a clearer timeout error so callers (and the user)
    // can distinguish "backend didn't respond in time" from a generic network
    // failure. Preserves the original error chain via `cause`.
    if (didTimeout || (err instanceof DOMException && err.name === "AbortError")) {
      throw new Error(`Request timed out after ${timeoutMs}ms`, { cause: err });
    }
    throw err;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

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
  if (payload.orderDate !== undefined) order.orderDate = payload.orderDate;
  if (payload.buyerName !== undefined) order.buyerName = payload.buyerName;
  if (payload.currency  !== undefined) order.currency  = payload.currency;

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
  if (!res.ok) { const t = await res.text(); throw new Error(`Resolution failed: ${t || res.statusText}`); }
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
async function mockCreateSupplierProfile(p: import("@/types/procurement").SupplierProfile) {
  await delay(400);
  if (mockSupplierProfiles.find(x => x.supplierName === p.supplierName)) throw new Error("Supplier profile already exists");
  mockSupplierProfiles.push(p); return p;
}
async function mockUpdateSupplierProfile(name: string, data: Omit<import("@/types/procurement").SupplierProfile, "supplierName">) {
  await delay(400);
  const i = mockSupplierProfiles.findIndex(p => p.supplierName === name);
  if (i === -1) throw new Error("Not found");
  const u = { ...data, supplierName: name }; mockSupplierProfiles[i] = u; return u;
}
async function mockDeleteSupplierProfile(name: string) {
  await delay(300);
  const i = mockSupplierProfiles.findIndex(p => p.supplierName === name);
  if (i === -1) throw new Error("Not found");
  mockSupplierProfiles.splice(i, 1);
}

// Backend routes (SuppliersController, route prefix "api/suppliers"):
//   GET  /api/suppliers/profiles              → list all profiles for the org
//   GET  /api/suppliers/profiles/{name}       → get profile by supplier name
//   POST /api/suppliers/{id}/profiles         → upsert profile (supplier-GUID-scoped)
// There is no separate PUT or DELETE for profiles — the POST is an upsert.
// Only the two read endpoints below are wired live. The mock create/update/delete
// profile helpers are retained for dev/mock mode; a live upsert/delete client must
// be (re)introduced against the supplier-GUID-scoped route above when needed.
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
  const hasSupplier        = mockSupplierList.length > 0;
  const hasUpload          = mockOrders.length > 0;
  const hasResolvedMapping = mockOrders.some(o => o.lines.some(l => l.supplierItemCode != null));
  const hasDelivery        = mockOrders.some(o => o.status === "delivered");
  return { hasSupplier, hasUpload, hasResolvedMapping, hasDelivery };
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

  // ─── Magic Mapping Preview ───
  getMappingPreview:      USE_MOCK ? mockGetMappingPreview     : realGetMappingPreview,
  acceptAiSuggestions:    USE_MOCK ? mockAcceptAiSuggestions   : realAcceptAiSuggestions,

  /**
   * Commit resolved supplier-item codes for an order, plus optional header-field
   * corrections (orderDate / buyerName / currency). Thin wrapper around
   * resolvePurchaseOrder with saveMappings: true.
   *
   * Only the header fields actually passed are forwarded — the backend treats
   * null/absent as "no change", so a header-only edit can ride along even with
   * an empty resolutions list. PO number + supplier are NOT editable.
   */
  commitMappings(
    orderId: string,
    resolutions: { lineNumber: number; supplierItemCode: string }[],
    header?: { orderDate?: string; buyerName?: string; currency?: string },
  ) {
    return (USE_MOCK ? mockResolvePurchaseOrder : realResolvePurchaseOrder)(orderId, {
      lineResolutions: resolutions,
      saveMappings: true,
      // Spread only present keys so absent fields stay absent on the wire.
      ...(header?.orderDate !== undefined ? { orderDate: header.orderDate } : {}),
      ...(header?.buyerName !== undefined ? { buyerName: header.buyerName } : {}),
      ...(header?.currency  !== undefined ? { currency:  header.currency  } : {}),
    });
  },
};

// ── Delivery reliability: dead-letter count (ops view) ──────────────────────

/** Number of orders currently in the terminal delivery_dead_letter state. */
export async function getDeadLetterCount(): Promise<number> {
  if (USE_MOCK) { await delay(120); return 0; }
  const headers = await authHeader();
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/orders/dead-letter-count`, { headers });
  if (!res.ok) throw new Error(`dead-letter-count: ${res.status}`);
  const data = await res.json() as { count: number };
  return data.count;
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

// ── Billing ────────────────────────────────────────────────────────────────

export async function getBillingStatus(): Promise<BillingStatus> {
  if (USE_MOCK) {
    return {
      plan:                   "pilot",
      accountStatus:          "trialing",
      ordersThisMonth:        5,
      orderLimit:             20,
      suppliersUsed:          1,
      supplierLimit:          1,
      trialStartedAt:         new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
      trialEndsAt:            new Date(Date.now() + 9 * 24 * 60 * 60 * 1000).toISOString(),
      isTrialExpired:         false,
      isOrderLimitReached:    false,
      isSupplierLimitReached: true,
      canProcessOrders:       true,
      canAddSupplier:         false,
      stripeCustomerId:       null,
      stripeSubscriptionId:   null,
      overageOrders:          0,
      overageAmountEur:       0,
      nearLimit:              false,
      atLimit:                false,
    };
  }
  const headers = await authHeader();
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/billing/status`, { headers });
  if (!res.ok) throw new Error(`billing/status: ${res.status}`);
  return res.json();
}

export async function createCheckoutSession(plan: string, billingInterval: "monthly" | "yearly" = "monthly"): Promise<string> {
  const headers = await authHeader();
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/billing/checkout`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ plan, billingInterval }),
  }, 30000);
  if (!res.ok) throw new Error(`billing/checkout: ${res.status}`);
  const data = await res.json();
  return data.url as string;
}

export async function createPortalSession(): Promise<string> {
  const headers = await authHeader();
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/billing/portal`, {
    method: "POST",
    headers,
  }, 30000);
  if (!res.ok) throw new Error(`billing/portal: ${res.status}`);
  const data = await res.json();
  return data.url as string;
}

// ── Platform admin (owner area) ───────────────────────────────────────────
// All endpoints sit under /api/admin behind a SERVER-SIDE platform-admin gate:
//   401 → unauthenticated, 403 → authenticated but not on the admin allowlist.
// The allowlist (Admin__UserIds / Admin__Emails) is server-side only — the
// frontend can never see it, so a 403 is the canonical "you are not an admin"
// signal. AdminAccessError carries the distinction so the page can render a
// clean "no access" view (403) vs prompting sign-in (401) instead of a generic
// "something broke" banner.

/** Thrown when an /api/admin call is refused — 401 (signed out) or 403 (not an admin). */
export class AdminAccessError extends Error {
  status: 401 | 403;
  constructor(status: 401 | 403) {
    super(status === 401 ? "Not authenticated" : "Not authorized for the admin area");
    this.name = "AdminAccessError";
    this.status = status;
  }
}

export interface AdminOverview {
  /** Monthly recurring revenue in EUR, sourced from the DB account/plan ladder. */
  mrr: number;
  /** Annualised recurring revenue in EUR (mrr * 12). */
  arr: number;
  /** MRR as Stripe reports it, or null when Stripe MRR couldn't be sourced. */
  stripeMrr: number | null;
  /** True when the DB MRR reconciles with Stripe MRR. */
  reconciled: boolean;
  /** Raw account-status → count map (trialing | active | trial_expired | past_due | read_only | cancelled). */
  countsByAccountStatus: Record<string, number>;
  newOrgsThisMonth: number;
  /** Trial→paid conversion as a 0..1 fraction. */
  trialToPaidConversion: number;
}

export interface AdminOrganisation {
  id: string;
  name: string;
  slug: string;
  plan: string;
  accountStatus: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  /** This org's contribution to MRR in EUR. */
  mrrContribution: number;
  createdAt: string;
  lastOrderActivity: string | null;
  orderVolume30d: number;
  supplierCount: number;
}

export interface CreateAdminInvoiceLineItem {
  description: string;
  /** PER-UNIT amount in cents (>0). */
  amountCents: number;
  /** Defaults to 1 on the backend when omitted. */
  quantity?: number;
}

export interface CreateAdminInvoiceRequest {
  organisationId: string;
  lineItems: CreateAdminInvoiceLineItem[];
  /** ISO-4217 lowercase; defaults to "eur" on the backend. */
  currency?: string;
}

export interface CreateAdminInvoiceResult {
  invoiceId: string;
  hostedInvoiceUrl: string | null;
  status: string;
}

/** Read an /api/admin error body and re-throw as AdminAccessError (401/403) or a message-bearing Error. */
async function adminError(res: Response, label: string): Promise<never> {
  if (res.status === 401 || res.status === 403) {
    throw new AdminAccessError(res.status);
  }
  const body = await res.json().catch(() => null);
  const message =
    body && typeof body === "object" && "error" in body
      ? String((body as { error?: unknown }).error)
      : res.statusText;
  throw new ApiHttpError(`${label}: ${message || res.status}`, res.status, body);
}

export async function getAdminOverview(): Promise<AdminOverview> {
  const headers = await authHeader();
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/admin/overview`, { headers });
  if (!res.ok) return adminError(res, "admin/overview");
  return res.json() as Promise<AdminOverview>;
}

export async function getAdminOrganisations(): Promise<AdminOrganisation[]> {
  const headers = await authHeader();
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/admin/organisations`, { headers });
  if (!res.ok) return adminError(res, "admin/organisations");
  return res.json() as Promise<AdminOrganisation[]>;
}

export async function createAdminInvoice(
  req: CreateAdminInvoiceRequest,
): Promise<CreateAdminInvoiceResult> {
  const headers = await authHeader();
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/admin/invoices`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(req),
  }, 30000);
  if (!res.ok) return adminError(res, "admin/invoices");
  return res.json() as Promise<CreateAdminInvoiceResult>;
}

/**
 * Adjust a single org's effective limits / pilot window.
 * POST /api/admin/organisations/{id}/limits — behind the server-side [AdminOnly]
 * gate (401 signed out / 403 not an admin, surfaced as AdminAccessError).
 *
 * Every field is optional and independent; the matching clear* flag resets that
 * field to its plan default. Returns the saved overrides + the resulting
 * effective limits so the caller can show what actually applies now.
 *
 * Mock mode echoes the request back as a no-op success (no backend), defaulting
 * effective limits to the requested overrides or sensible Pilot defaults.
 */
export async function setOrgLimits(
  orgId: string,
  body: SetOrgLimitsRequest,
): Promise<OrgLimitsResponse> {
  if (USE_MOCK) {
    await delay(400);
    const now = Date.now();
    const trialEnd = body.clearTrialEnds
      ? null
      : body.trialEndsAtOverride
        ? body.trialEndsAtOverride
        : body.extendTrialDays != null
          ? new Date(now + body.extendTrialDays * 86_400_000).toISOString()
          : null;
    return {
      id: orgId,
      name: "Mock organisation",
      plan: "pilot",
      accountStatus: "trialing",
      orderLimitOverride: body.clearOrderLimit ? null : body.orderLimitOverride ?? null,
      supplierLimitOverride: body.clearSupplierLimit ? null : body.supplierLimitOverride ?? null,
      trialEndsAtOverride: trialEnd,
      effectiveOrderLimit: body.clearOrderLimit ? 20 : body.orderLimitOverride ?? 20,
      effectiveSupplierLimit: body.clearSupplierLimit ? 1 : body.supplierLimitOverride ?? 1,
      effectiveTrialEndsAt: trialEnd,
    };
  }
  const headers = await authHeader();
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/admin/organisations/${orgId}/limits`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, 30000);
  if (!res.ok) return adminError(res, "admin/organisations/limits");
  return res.json() as Promise<OrgLimitsResponse>;
}

// ── Email polling settings ────────────────────────────────────────────────

export async function getEmailSettings(): Promise<EmailSettings> {
  if (USE_MOCK) {
    return {
      enabled: false,
      host: "",
      port: 993,
      useSsl: true,
      username: "",
      folder: "INBOX",
      defaultSupplierId: null,
      hasPassword: false,
      passwordDisplay: null,
      lastPolledAt: null,
      updatedAt: null,
    };
  }

  const headers = await authHeader();
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/settings/email`, { headers });
  if (!res.ok) throw new Error(`settings/email: ${res.status}`);
  return res.json();
}

export async function updateEmailSettings(payload: UpdateEmailSettingsPayload): Promise<EmailSettings> {
  const headers = await authHeader();
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/settings/email`, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }, 30000);

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `settings/email: ${res.status}`);
  }

  return res.json();
}

// ── Organisation settings (order direction) ───────────────────────────────
// Backend contract:
//   GET  /api/settings/organisation -> 200 { "direction": "Outbound" | "Inbound" }  (PascalCase)
//   PUT  /api/settings/organisation  body { "direction": "Inbound" } -> 200 { "direction": "Inbound" }
// Input is case-insensitive; the property name is camelCase `direction`.
// We NORMALISE the response to lowercase internally and SEND PascalCase on write.

/** Lowercase whatever the API returns ("Outbound"/"Inbound") to our internal union. */
function normalizeDirection(raw: unknown): OrderDirection {
  return String(raw ?? "Outbound").toLowerCase() === "inbound" ? "inbound" : "outbound";
}

/** PascalCase for the wire ("inbound" -> "Inbound"). */
function toApiDirection(direction: OrderDirection): "Outbound" | "Inbound" {
  return direction === "inbound" ? "Inbound" : "Outbound";
}

export async function getOrgSettings(): Promise<OrgSettings> {
  // Mock mode has no backend/Clerk session — default to outbound so mock/e2e don't break.
  if (USE_MOCK) {
    return { direction: "outbound", slug: "demo-workspace" };
  }

  const headers = await authHeader();
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/settings/organisation`, { headers });
  if (!res.ok) throw new Error(`settings/organisation: ${res.status}`);
  const body = await res.json().catch(() => ({}));
  const raw = body as { direction?: unknown; slug?: unknown };
  // `slug` is added by the backend org-settings response; tolerate its absence
  // (older API / mid-rollout) by leaving it undefined so the UI shows "generating…".
  const slug = typeof raw.slug === "string" && raw.slug.trim() ? raw.slug.trim() : undefined;
  return { direction: normalizeDirection(raw.direction), slug };
}

export async function updateOrgSettings(direction: OrderDirection): Promise<OrgSettings> {
  // Mock mode: no-op success so the control still flips locally without a backend.
  if (USE_MOCK) {
    return { direction };
  }

  const headers = await authHeader();
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/settings/organisation`, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ direction: toApiDirection(direction) }),
  }, 30000);

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `settings/organisation: ${res.status}`);
  }

  const body = await res.json().catch(() => ({}));
  const raw = body as { direction?: unknown; slug?: unknown };
  const slug = typeof raw.slug === "string" && raw.slug.trim() ? raw.slug.trim() : undefined;
  return { direction: normalizeDirection(raw.direction), slug };
}

// ── SFTP / S3 pull-ingress settings ───────────────────────────────────────

export interface SftpIngressSettings {
  enabled: boolean;
  host: string;
  port: number;
  username: string;
  remoteDirectory: string;
  defaultSupplierId: string | null;
  hasPassword: boolean;
  passwordDisplay: string | null;
  updatedAt: string | null;
}
export interface UpdateSftpIngressPayload {
  enabled: boolean;
  host: string;
  port: number;
  username: string;
  password?: string | null;
  remoteDirectory: string;
  defaultSupplierId: string | null;
}
export interface S3IngressSettings {
  enabled: boolean;
  bucketName: string;
  keyPrefix: string;
  region: string;
  accessKeyId: string;
  defaultSupplierId: string | null;
  hasSecretKey: boolean;
  secretKeyDisplay: string | null;
  updatedAt: string | null;
  serviceUrl: string | null;
}
export interface UpdateS3IngressPayload {
  enabled: boolean;
  bucketName: string;
  keyPrefix: string;
  region: string;
  accessKeyId: string;
  secretKey?: string | null;
  defaultSupplierId: string | null;
  serviceUrl?: string | null;
}

export async function getSftpSettings(): Promise<SftpIngressSettings> {
  if (USE_MOCK) return { enabled: false, host: "", port: 22, username: "", remoteDirectory: "", defaultSupplierId: null, hasPassword: false, passwordDisplay: null, updatedAt: null };
  const headers = await authHeader();
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/settings/sftp`, { headers });
  if (!res.ok) throw new Error(`settings/sftp: ${res.status}`);
  return res.json();
}
export async function updateSftpSettings(payload: UpdateSftpIngressPayload): Promise<SftpIngressSettings> {
  const headers = await authHeader();
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/settings/sftp`, {
    method: "PUT", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(payload),
  }, 30000);
  if (!res.ok) { const b = await res.json().catch(() => null); throw new Error(b?.error ?? `settings/sftp: ${res.status}`); }
  return res.json();
}
export async function getS3Settings(): Promise<S3IngressSettings> {
  if (USE_MOCK) return { enabled: false, bucketName: "", keyPrefix: "", region: "", accessKeyId: "", defaultSupplierId: null, hasSecretKey: false, secretKeyDisplay: null, updatedAt: null, serviceUrl: null };
  const headers = await authHeader();
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/settings/s3`, { headers });
  if (!res.ok) throw new Error(`settings/s3: ${res.status}`);
  return res.json();
}
export async function updateS3Settings(payload: UpdateS3IngressPayload): Promise<S3IngressSettings> {
  const headers = await authHeader();
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/settings/s3`, {
    method: "PUT", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(payload),
  }, 30000);
  if (!res.ok) { const b = await res.json().catch(() => null); throw new Error(b?.error ?? `settings/s3: ${res.status}`); }
  return res.json();
}

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

export async function downloadInvoice(id: string, format = "csv"): Promise<{ url: string }> {
  if (USE_MOCK) { return { url: `#mock-invoice-download/${id}` }; }
  const headers = await authHeader();
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/invoices/${id}/download?format=${format}`, { headers });
  if (!res.ok) throw new Error(`invoices download: ${res.status}`);
  return res.json();
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
  type Row = { lineNumber?: number | null; severity?: string; status?: string; code?: string; message?: string };
  const raw: unknown = await res.json();
  const rows: Row[] = Array.isArray(raw)
    ? (raw as Row[])
    : Array.isArray((raw as { results?: unknown })?.results)
      ? (raw as { results: Row[] }).results
      : [];
  return {
    orderId,
    passed: rows.every((r) => r.status === "pass"),
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

// ── All-orders exception dashboard ────────────────────────────────────────────
// GET   /api/exceptions?state=open|resolved|ignored   → OrderException[]
// PATCH /api/exceptions/{id}/resolve                   → 204
// PATCH /api/exceptions/{id}/ignore                    → 204

const _mockExceptions: OrderException[] = [
  {
    id: "exc-001",
    orderId: "ord-002",
    lineId: "l-002-2",
    stage: "validate",
    code: "UNRESOLVED_SUPPLIER_CODE",
    severity: "error",
    state: "open",
    message: "Line 2 (TB-RES-220) has no confirmed supplier item code.",
    createdAt: new Date(Date.now() - 12 * 60_000).toISOString(),
    resolvedAt: null,
  },
  {
    id: "exc-002",
    orderId: "ord-002",
    lineId: null,
    stage: "transform",
    code: "MISSING_DELIVERY_CONFIG",
    severity: "warning",
    state: "open",
    message: "Supplier has no delivery configuration; order cannot be sent.",
    createdAt: new Date(Date.now() - 48 * 60_000).toISOString(),
    resolvedAt: null,
  },
  {
    id: "exc-003",
    orderId: "ord-003",
    lineId: null,
    stage: "deliver",
    code: "SUPPLIER_HTTP_422",
    severity: "critical",
    state: "open",
    message: "Supplier endpoint rejected the order (HTTP 422).",
    createdAt: new Date(Date.now() - 3 * 60 * 60_000).toISOString(),
    resolvedAt: null,
  },
  {
    id: "exc-004",
    orderId: "ord-001",
    lineId: null,
    stage: "parse",
    code: "CURRENCY_ASSUMED",
    severity: "info",
    state: "resolved",
    message: "Currency was not present in source; assumed USD from buyer default.",
    createdAt: new Date(Date.now() - 26 * 60 * 60_000).toISOString(),
    resolvedAt: new Date(Date.now() - 25 * 60 * 60_000).toISOString(),
  },
  {
    id: "exc-005",
    orderId: "ord-003",
    lineId: null,
    stage: "validate",
    code: "DUPLICATE_PO_NUMBER",
    severity: "warning",
    state: "ignored",
    message: "A previous order used PO number PO-2024-009012.",
    createdAt: new Date(Date.now() - 50 * 60 * 60_000).toISOString(),
    resolvedAt: null,
  },
];

async function mockGetExceptions(state?: string): Promise<OrderException[]> {
  await delay(200);
  const list = state ? _mockExceptions.filter(e => e.state === state) : _mockExceptions;
  // Newest first — mirrors the live endpoint ordering.
  return [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function realGetExceptions(state?: string): Promise<OrderException[]> {
  const qs = state ? `?state=${encodeURIComponent(state)}` : "";
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/exceptions${qs}`, { headers: await authHeader() });
  if (!res.ok) throw new Error(`exceptions: ${res.status}`);
  return res.json() as Promise<OrderException[]>;
}

async function mockResolveException(id: string): Promise<void> {
  await delay(200);
  const e = _mockExceptions.find(x => x.id === id);
  if (e) { e.state = "resolved"; e.resolvedAt = new Date().toISOString(); }
}

async function realResolveException(id: string): Promise<void> {
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/exceptions/${id}/resolve`, {
    method: "PATCH",
    headers: await authHeader(),
  }, 30000);
  if (!res.ok && res.status !== 204) throw new Error(`exceptions/resolve: ${res.status}`);
}

async function mockIgnoreException(id: string): Promise<void> {
  await delay(200);
  const e = _mockExceptions.find(x => x.id === id);
  if (e) e.state = "ignored";
}

async function realIgnoreException(id: string): Promise<void> {
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/exceptions/${id}/ignore`, {
    method: "PATCH",
    headers: await authHeader(),
  }, 30000);
  if (!res.ok && res.status !== 204) throw new Error(`exceptions/ignore: ${res.status}`);
}

// ── Acceptance + exceptions exports ──────────────────────────────────────────

export const getAcceptanceProfile = USE_MOCK ? mockGetAcceptanceProfile : realGetAcceptanceProfile;
export const saveAcceptanceProfile = USE_MOCK ? mockSaveAcceptanceProfile : realSaveAcceptanceProfile;
export const activateAcceptanceVersion = USE_MOCK ? mockActivateAcceptanceVersion : realActivateAcceptanceVersion;
export const validateOrder = USE_MOCK ? mockValidateOrder : realValidateOrder;
export const getOrderExceptions = USE_MOCK ? mockGetOrderExceptions : realGetOrderExceptions;
export const getExceptions = USE_MOCK ? mockGetExceptions : realGetExceptions;
export const resolveException = USE_MOCK ? mockResolveException : realResolveException;
export const ignoreException = USE_MOCK ? mockIgnoreException : realIgnoreException;

// ── Operator job-health (GET /api/ops/*) ─────────────────────────────────────

/** Aggregate pipeline-health counts for the org. Mirrors backend OpsHealthDto. */
export interface OpsHealth {
  parsingStuck: number;
  deliveringStuck: number;
  transformFailed: number;
  deliveryFailed: number;
  deliveryDeadLetter: number;
  rejectedBySupplier: number;
  failed: number;
  slaBreached: number;
  openExceptions: number;
  stuckThresholdMinutes: number;
  totalProblemOrders: number;
  // Worker / Hangfire-server health — surfaces a dead Worker (which stalls the pipeline).
  workerHealthy: boolean;
  activeWorkers: number;
  lastWorkerHeartbeatUtc: string | null;
  secondsSinceWorkerHeartbeat: number | null;
}

/** A dead-lettered (or failed) delivery awaiting operator review. Mirrors DeadLetterOrderDto. */
export interface DeadLetterOrder {
  orderId: string;
  poNumber: string;
  supplierId: string | null;
  supplierName: string | null;
  status: string;
  deliveryAttempts: number;
  lastError: string | null;
  lastResponseCode: number | null;
  lastAttemptAt: string | null;
  createdAt: string;
  updatedAt: string;
}

async function mockGetOpsHealth(): Promise<OpsHealth> {
  await delay(200);
  return {
    parsingStuck: 0, deliveringStuck: 0, transformFailed: 0, deliveryFailed: 1,
    deliveryDeadLetter: 1, rejectedBySupplier: 0, failed: 0, slaBreached: 0,
    openExceptions: 2, stuckThresholdMinutes: 30, totalProblemOrders: 2,
    workerHealthy: true, activeWorkers: 1,
    lastWorkerHeartbeatUtc: new Date(Date.now() - 6000).toISOString(),
    secondsSinceWorkerHeartbeat: 6,
  };
}

async function realGetOpsHealth(): Promise<OpsHealth> {
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/ops/health`, { headers: await authHeader() });
  if (!res.ok) throw new Error(`ops/health: ${res.status}`);
  return res.json() as Promise<OpsHealth>;
}

async function mockGetDeadLetterOrders(includeFailed = false): Promise<DeadLetterOrder[]> {
  await delay(200);
  const now = new Date().toISOString();
  const rows: DeadLetterOrder[] = [
    { orderId: "mock-dl-1", poNumber: "PO-2026-0142", supplierId: "s1", supplierName: "Acme Components",
      status: "delivery_dead_letter", deliveryAttempts: 3, lastError: "HTTP 503: supplier endpoint unavailable",
      lastResponseCode: 503, lastAttemptAt: now, createdAt: now, updatedAt: now },
  ];
  return includeFailed
    ? rows.concat({ orderId: "mock-dl-2", poNumber: "PO-2026-0151", supplierId: "s2", supplierName: "BoltWorks BV",
        status: "delivery_failed", deliveryAttempts: 1, lastError: "Connection timed out", lastResponseCode: null,
        lastAttemptAt: now, createdAt: now, updatedAt: now })
    : rows;
}

async function realGetDeadLetterOrders(includeFailed = false): Promise<DeadLetterOrder[]> {
  const qs = includeFailed ? "?includeFailed=true" : "";
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/ops/dead-letter${qs}`, { headers: await authHeader() });
  if (!res.ok) throw new Error(`ops/dead-letter: ${res.status}`);
  return res.json() as Promise<DeadLetterOrder[]>;
}

async function mockRequeueDelivery(_orderId: string): Promise<{ status: string }> {
  await delay(300);
  return { status: "delivering" };
}

async function realRequeueDelivery(orderId: string): Promise<{ status: string }> {
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/ops/orders/${orderId}/requeue-delivery`, {
    method: "POST",
    headers: await authHeader(),
  }, 30000);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const message = body && typeof body === "object" && "error" in body
      ? String((body as { error?: unknown }).error) : res.statusText;
    throw new ApiHttpError(`requeue-delivery failed: ${message || res.status}`, res.status, body);
  }
  return res.json() as Promise<{ status: string }>;
}

export const getOpsHealth = USE_MOCK ? mockGetOpsHealth : realGetOpsHealth;
export const getDeadLetterOrders = USE_MOCK ? mockGetDeadLetterOrders : realGetDeadLetterOrders;
export const requeueDelivery = USE_MOCK ? mockRequeueDelivery : realRequeueDelivery;
