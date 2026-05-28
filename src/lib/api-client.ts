import type {
  Order,
  OrderSummary,
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
  BillingStatus,
  EmailSettings,
  UpdateEmailSettingsPayload,
} from "@/types/procurement";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:5223";
// Default to mock mode unless explicitly set to false
const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK !== "false";

/** True when the frontend uses in-memory mocks instead of the ASP.NET API. */
export const isApiMockMode = USE_MOCK;

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
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
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
  const res = await fetch(`${API_BASE_URL}/api/suppliers`, { headers: await authHeader() });
  if (!res.ok) throw new Error(`Failed to fetch suppliers: ${res.statusText}`);
  return res.json() as Promise<Supplier[]>;
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

  const res = await fetch(`${API_BASE_URL}/api/orders/upload`, {
    method: "POST", headers: await authHeader(), body: formData,
  });
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

async function mockGetOrders(): Promise<OrderSummary[]> {
  await delay(300);
  return mockOrders.map(o => {
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
  });
}

async function realGetOrders(): Promise<OrderSummary[]> {
  const res = await fetch(`${API_BASE_URL}/api/orders`, { headers: await authHeader() });
  if (!res.ok) throw new Error(`Failed to fetch orders: ${res.statusText}`);
  return res.json() as Promise<OrderSummary[]>;
}

async function mockGetOrderById(id: string): Promise<Order | null> {
  await delay(200);
  return mockOrders.find(o => o.id === id) ?? null;
}

async function realGetOrderById(id: string): Promise<Order | null> {
  const res = await fetch(`${API_BASE_URL}/api/orders/${id}`, { headers: await authHeader() });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to fetch order: ${res.statusText}`);
  return res.json() as Promise<Order>;
}

// ── Resolve ───────────────────────────────────────────────────────────────

async function mockResolvePurchaseOrder(
  id: string, payload: ResolvePayload,
): Promise<{ order: Order; validationMessages: string[] }> {
  await delay(800);
  const idx = mockOrders.findIndex(o => o.id === id);
  if (idx === -1) throw new Error("Order not found");

  const order: Order = { ...mockOrders[idx], lines: mockOrders[idx].lines.map(l => ({ ...l })) };

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
  const res = await fetch(`${API_BASE_URL}/api/orders/${id}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await authHeader() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`Resolution failed: ${t || res.statusText}`); }
  // Backend returns OrderDto directly (not wrapped)
  const order = await res.json() as Order;
  return { order, validationMessages: [] };
}

// ── Transform ─────────────────────────────────────────────────────────────

async function mockTransformOrder(orderId: string, format: "xml" | "csv"): Promise<TransformResult> {
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

async function realTransformOrder(orderId: string, format: "xml" | "csv"): Promise<TransformResult> {
  const res = await fetch(`${API_BASE_URL}/api/orders/${orderId}/transform`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await authHeader() },
    body: JSON.stringify({ format }),
  });
  if (res.status === 422) { const t = await res.text(); throw new Error(`Unresolved lines: ${t}`); }
  if (!res.ok) { const t = await res.text(); throw new Error(`Transform failed: ${t || res.statusText}`); }
  // 202 Accepted — job enqueued; return a placeholder result
  const body = await res.json() as Record<string, unknown>;
  return { artifactId: "", format, createdAt: new Date().toISOString(), ...body } as TransformResult;
}

// ── Download ──────────────────────────────────────────────────────────────

async function mockGetDownloadUrl(orderId: string, artifactId: string): Promise<DownloadUrl> {
  await delay(200);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  return { url: `https://example.com/mock-download/${orderId}/${artifactId}`, expiresAt };
}

async function realGetDownloadUrl(orderId: string, artifactId: string): Promise<DownloadUrl> {
  const res = await fetch(`${API_BASE_URL}/api/orders/${orderId}/artifacts/${artifactId}/download`, {
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
  const res = await fetch(`${API_BASE_URL}/api/suppliers/${supplierId}/mappings`, {
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
  const res = await fetch(`${API_BASE_URL}/api/suppliers/${supplierId}/mappings/${mappingId}`, {
    method: "DELETE", headers: await authHeader(),
  });
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
  const res = await fetch(`${API_BASE_URL}/api/suppliers/${supplierId}/mappings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await authHeader() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(t || res.statusText); }
  return res.json() as Promise<SupplierMapping>;
}

async function realUpdateSupplierMapping(
  supplierId: string,
  mappingId: string,
  payload: { buyerItemCode: string; supplierItemCode: string }
): Promise<SupplierMapping> {
  const res = await fetch(`${API_BASE_URL}/api/suppliers/${supplierId}/mappings/${mappingId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...await authHeader() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(t || res.statusText); }
  return res.json() as Promise<SupplierMapping>;
}

async function realImportSupplierMappings(
  supplierId: string,
  file: File
): Promise<{ created: number; updated: number }> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch(`${API_BASE_URL}/api/suppliers/${supplierId}/mappings/import`, {
    method: "POST",
    headers: await authHeader(),
    body: fd,
  });
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
  const res = await fetch(`${API_BASE_URL}/api/suppliers`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await authHeader() },
    body: JSON.stringify(payload),
  });
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
  const res = await fetch(`${API_BASE_URL}/api/suppliers/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...await authHeader() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(t || res.statusText); }
  return res.json() as Promise<Supplier>;
}

async function mockDeleteSupplier(id: string): Promise<void> {
  await delay(300);
  mockSupplierList = mockSupplierList.filter(s => s.id !== id);
}

async function realDeleteSupplier(id: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/suppliers/${id}`, {
    method: "DELETE",
    headers: await authHeader(),
  });
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

async function realGetSupplierProfiles() { const r = await fetch(`${API_BASE_URL}/api/supplier-profiles`, { headers: await authHeader() }); if (!r.ok) throw new Error(r.statusText); return r.json(); }
async function realGetSupplierProfile(n: string) { const r = await fetch(`${API_BASE_URL}/api/supplier-profiles/${encodeURIComponent(n)}`, { headers: await authHeader() }); if (r.status === 404) return null; if (!r.ok) throw new Error(r.statusText); return r.json(); }
async function realCreateSupplierProfile(p: import("@/types/procurement").SupplierProfile) { const r = await fetch(`${API_BASE_URL}/api/supplier-profiles`, { method: "POST", headers: { "Content-Type": "application/json", ...await authHeader() }, body: JSON.stringify(p) }); if (!r.ok) { const t = await r.text(); throw new Error(t || r.statusText); } return r.json(); }
async function realUpdateSupplierProfile(n: string, d: Omit<import("@/types/procurement").SupplierProfile, "supplierName">) { const r = await fetch(`${API_BASE_URL}/api/supplier-profiles/${encodeURIComponent(n)}`, { method: "PUT", headers: { "Content-Type": "application/json", ...await authHeader() }, body: JSON.stringify(d) }); if (!r.ok) { const t = await r.text(); throw new Error(t || r.statusText); } return r.json(); }
async function realDeleteSupplierProfile(n: string) { const r = await fetch(`${API_BASE_URL}/api/supplier-profiles/${encodeURIComponent(n)}`, { method: "DELETE", headers: await authHeader() }); if (!r.ok) { const t = await r.text(); throw new Error(t || r.statusText); } }

// ── Audit trail ───────────────────────────────────────────────────────────

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

async function realGetOrderAudit(orderId: string): Promise<AuditEvent[]> {
  const res = await fetch(`${API_BASE_URL}/api/orders/${orderId}/audit`, {
    headers: await authHeader(),
  });
  if (!res.ok) throw new Error(`Failed to fetch audit: ${res.statusText}`);
  return res.json() as Promise<AuditEvent[]>;
}

// ── Onboarding ────────────────────────────────────────────────────────────

async function mockGetOnboardingStatus(): Promise<OnboardingStatus> {
  await delay(150);
  const hasSupplier  = mockSupplierList.length > 0;
  const hasUpload    = mockOrders.length > 0;
  const hasDelivery  = mockOrders.some(o => o.status === "delivered");
  return { hasSupplier, hasUpload, hasDelivery };
}

async function realGetOnboardingStatus(): Promise<OnboardingStatus> {
  const res = await fetch(`${API_BASE_URL}/api/onboarding/status`, {
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
  const res = await fetch(`${API_BASE_URL}/api/dashboard/stats`, {
    headers: await authHeader(),
  });
  if (!res.ok) throw new Error(`Failed to fetch dashboard stats: ${res.statusText}`);
  return res.json() as Promise<DashboardStats>;
}

// ── Exported API client ───────────────────────────────────────────────────

export const apiClient = {
  // Suppliers — list + CRUD
  getSuppliers:           USE_MOCK ? mockGetSuppliersFn        : realGetSuppliersFn,
  createSupplier:         USE_MOCK ? mockCreateSupplier        : realCreateSupplier,
  renameSupplier:         USE_MOCK ? mockRenameSupplier        : realRenameSupplier,
  deleteSupplier:         USE_MOCK ? mockDeleteSupplier        : realDeleteSupplier,

  // Orders
  uploadPurchaseOrder:    USE_MOCK ? mockUploadPurchaseOrder   : realUploadPurchaseOrder,
  getOrders:              USE_MOCK ? mockGetOrders             : realGetOrders,
  getOrderById:           USE_MOCK ? mockGetOrderById          : realGetOrderById,
  resolvePurchaseOrder:   USE_MOCK ? mockResolvePurchaseOrder  : realResolvePurchaseOrder,
  transformOrder:         USE_MOCK ? mockTransformOrder        : realTransformOrder,
  getDownloadUrl:         USE_MOCK ? mockGetDownloadUrl        : realGetDownloadUrl,

  // Supplier mappings
  getSupplierMappings:    USE_MOCK ? mockGetSupplierMappings   : realGetSupplierMappings,
  deleteSupplierMapping:  USE_MOCK ? mockDeleteSupplierMapping : realDeleteSupplierMapping,
  createSupplierMapping:  USE_MOCK ? mockCreateSupplierMapping  : realCreateSupplierMapping,
  updateSupplierMapping:  USE_MOCK ? mockUpdateSupplierMapping  : realUpdateSupplierMapping,
  importSupplierMappings: USE_MOCK ? mockImportSupplierMappings : realImportSupplierMappings,

  // Supplier profiles (legacy admin)
  getSupplierProfiles:    USE_MOCK ? mockGetSupplierProfiles   : realGetSupplierProfiles,
  getSupplierProfile:     USE_MOCK ? mockGetSupplierProfile    : realGetSupplierProfile,
  createSupplierProfile:  USE_MOCK ? mockCreateSupplierProfile : realCreateSupplierProfile,
  updateSupplierProfile:  USE_MOCK ? mockUpdateSupplierProfile : realUpdateSupplierProfile,
  deleteSupplierProfile:  USE_MOCK ? mockDeleteSupplierProfile : realDeleteSupplierProfile,

  // Audit trail
  getOrderAudit:          USE_MOCK ? mockGetOrderAudit         : realGetOrderAudit,

  // Onboarding + dashboard
  getOnboardingStatus:    USE_MOCK ? mockGetOnboardingStatus   : realGetOnboardingStatus,
  getDashboardStats:      USE_MOCK ? mockGetDashboardStats     : realGetDashboardStats,
};

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
  const res = await fetch(`${API_BASE_URL}/api/buyers`, { headers });
  if (!res.ok) throw new Error(`buyers: ${res.status}`);
  return res.json();
}

export async function createBuyer(name: string, code: string): Promise<import("@/types/procurement").BuyerDto> {
  const headers = await authHeader();
  const res = await fetch(`${API_BASE_URL}/api/buyers`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ name, code }),
  });
  if (!res.ok) throw new Error(`buyers/create: ${res.status}`);
  return res.json();
}

export async function updateBuyer(id: string, name: string, code: string): Promise<import("@/types/procurement").BuyerDto> {
  const headers = await authHeader();
  const res = await fetch(`${API_BASE_URL}/api/buyers/${id}`, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ name, code }),
  });
  if (!res.ok) throw new Error(`buyers/update: ${res.status}`);
  return res.json();
}

export async function deleteBuyer(id: string): Promise<void> {
  const headers = await authHeader();
  const res = await fetch(`${API_BASE_URL}/api/buyers/${id}`, { method: "DELETE", headers });
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
        { id: "e1", ts: new Date(Date.now() - 2*60000).toISOString(), orderId: "008412", poNumber: "PO-2026-008412", buyerName: "Heinrich Industries", supplierName: "Acme Components", format: "PDF", action: "flagged", actorType: "ai", actorName: "Extraction engine", actorInitials: "AI", message: "3 validation errors flagged", payload: null },
        { id: "e2", ts: new Date(Date.now() - 14*60000).toISOString(), orderId: "nrd9981", poNumber: "PO-NRD-9981", buyerName: "Nordmark Logistics", supplierName: "BoltWorks BV", format: "cXML", action: "created", actorType: "system", actorName: "System", actorInitials: "SY", message: "Order created from upload", payload: null },
      ],
      total: 2,
      page: 1,
      pageSize: 50,
    };
  }
  const headers = await authHeader();
  const res = await fetch(`${API_BASE_URL}/api/audit?page=${page}&pageSize=${pageSize}`, { headers });
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
  const res = await fetch(`${API_BASE_URL}/api/rules`, { headers });
  if (!res.ok) throw new Error(`rules: ${res.status}`);
  return res.json();
}

export async function createRule(payload: Omit<RuleDto, "id"|"triggerCount"|"lastTriggered"|"createdAt"> & { enabled: boolean; autoBlock: boolean }): Promise<RuleDto> {
  const headers = await authHeader();
  const res = await fetch(`${API_BASE_URL}/api/rules`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`rules/create: ${res.status}`);
  return res.json();
}

export async function updateRule(id: string, payload: Omit<RuleDto, "id"|"triggerCount"|"lastTriggered"|"createdAt">): Promise<RuleDto> {
  const headers = await authHeader();
  const res = await fetch(`${API_BASE_URL}/api/rules/${id}`, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`rules/update: ${res.status}`);
  return res.json();
}

export async function toggleRule(id: string): Promise<RuleDto> {
  const headers = await authHeader();
  const res = await fetch(`${API_BASE_URL}/api/rules/${id}/toggle`, { method: "PATCH", headers });
  if (!res.ok) throw new Error(`rules/toggle: ${res.status}`);
  return res.json();
}

export async function deleteRule(id: string): Promise<void> {
  const headers = await authHeader();
  const res = await fetch(`${API_BASE_URL}/api/rules/${id}`, { method: "DELETE", headers });
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
  const res = await fetch(`${API_BASE_URL}/api/templates`, { headers });
  if (!res.ok) throw new Error(`templates: ${res.status}`);
  return res.json();
}

export async function createTemplate(payload: Pick<TemplateDto, "name"|"format"|"version"> & { config?: unknown }): Promise<TemplateDto> {
  const headers = await authHeader();
  const res = await fetch(`${API_BASE_URL}/api/templates`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`templates/create: ${res.status}`);
  return res.json();
}

export async function updateTemplate(id: string, payload: Pick<TemplateDto, "name"|"format"|"version"> & { config?: unknown }): Promise<TemplateDto> {
  const headers = await authHeader();
  const res = await fetch(`${API_BASE_URL}/api/templates/${id}`, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`templates/update: ${res.status}`);
  return res.json();
}

export async function deleteTemplate(id: string): Promise<void> {
  const headers = await authHeader();
  const res = await fetch(`${API_BASE_URL}/api/templates/${id}`, { method: "DELETE", headers });
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
    };
  }
  const headers = await authHeader();
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/billing/status`, { headers });
  if (!res.ok) throw new Error(`billing/status: ${res.status}`);
  return res.json();
}

export async function createCheckoutSession(plan: string): Promise<string> {
  const headers = await authHeader();
  const res = await fetch(`${API_BASE_URL}/api/billing/checkout`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ plan }),
  });
  if (!res.ok) throw new Error(`billing/checkout: ${res.status}`);
  const data = await res.json();
  return data.url as string;
}

export async function createPortalSession(): Promise<string> {
  const headers = await authHeader();
  const res = await fetch(`${API_BASE_URL}/api/billing/portal`, {
    method: "POST",
    headers,
  });
  if (!res.ok) throw new Error(`billing/portal: ${res.status}`);
  const data = await res.json();
  return data.url as string;
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
  const res = await fetch(`${API_BASE_URL}/api/settings/email`, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `settings/email: ${res.status}`);
  }

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
  const res = await fetch(`${API_BASE_URL}/api/api-keys`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ label }),
  });
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
  const res = await fetch(`${API_BASE_URL}/api/api-keys/${id}`, {
    method: "DELETE",
    headers,
  });
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
  const res = await fetch(`${API_BASE_URL}/api/integrations`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
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
  const res = await fetch(`${API_BASE_URL}/api/integrations/${id}/toggle`, {
    method: "PATCH",
    headers,
  });
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
  const res = await fetch(`${API_BASE_URL}/api/integrations/${id}`, {
    method: "DELETE",
    headers,
  });
  if (!res.ok && res.status !== 204) throw new Error(`integrations DELETE: ${res.status}`);
}

// AGENT-A2-CONNECTORS-SECTION — replaced by connectors agent
// Placeholder for getSupplierDeliveryConfig and testFireDeliveryConfig functions

// AGENT-D3-INVOICES-SECTION — replaced by invoices agent
// Placeholder for InvoiceDto, getInvoices, uploadInvoice, approveInvoice, downloadInvoice functions

// AGENT-D3-ASN-SECTION — replaced by ASN agent
// Placeholder for AsnDto, getAsns, uploadAsn functions
