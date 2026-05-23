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
} from "@/types/procurement";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5223";
// Default to mock mode unless explicitly set to false (handles missing env vars and Lovable preview)
const USE_MOCK = import.meta.env.VITE_USE_MOCK !== "false";

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
let mockOrders: Order[] = [
  {
    id: "ord-001",
    poNumber: "PO-2024-001234",
    supplierId: "11111111-1111-1111-1111-111111111111",
    supplierName: "FastParts Inc",
    orderDate: "2024-01-10",
    currency: "USD",
    status: "ready",
    sourceFileKey: null,
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
    orderDate: "2024-01-12",
    currency: "EUR",
    status: "pending_review",
    sourceFileKey: null,
    createdAt: "2024-01-12T09:15:00Z",
    updatedAt: "2024-01-12T09:15:00Z",
    lines: [
      { id: "l-002-1", lineNumber: 1, buyerItemCode: "TB-CAP-100", supplierItemCode: "ES-CAP-100UF", description: "Capacitor 100µF",     quantity: 200, unit: "PCS", unitPrice: 0.35,  confidence: 1.0, needsReview: false },
      { id: "l-002-2", lineNumber: 2, buyerItemCode: "TB-RES-220", supplierItemCode: null,            description: "Resistor 220Ω",       quantity: 500, unit: "PCS", unitPrice: 0.02,  confidence: 0.0, needsReview: true  },
      { id: "l-002-3", lineNumber: 3, buyerItemCode: "TB-LED-RED", supplierItemCode: "ES-LED-R5MM",   description: "LED Red 5mm",         quantity: 100, unit: "PCS", unitPrice: 0.15,  confidence: 1.0, needsReview: false },
      { id: "l-002-4", lineNumber: 4, buyerItemCode: "TB-WIRE-22", supplierItemCode: null,            description: "Wire 22AWG Black 100m", quantity: 5, unit: "M",   unitPrice: 12.50, confidence: 0.0, needsReview: true  },
    ],
    artifacts: [],
  },
  {
    id: "ord-003",
    poNumber: "PO-2024-009012",
    supplierId: "11111111-1111-1111-1111-111111111111",
    supplierName: "FastParts Inc",
    orderDate: "2024-01-14",
    currency: "USD",
    status: "delivered",
    sourceFileKey: null,
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
    { id: crypto.randomUUID(), lineNumber: 1, buyerItemCode: "ITEM-001", supplierItemCode: null,      description: "Sample Part A", quantity: 100, unit: "PCS", unitPrice: 25.00, confidence: 0.0, needsReview: true  },
    { id: crypto.randomUUID(), lineNumber: 2, buyerItemCode: "ITEM-002", supplierItemCode: "SUP-002", description: "Sample Part B", quantity: 50,  unit: "PCS", unitPrice: 15.50, confidence: 1.0, needsReview: false },
    { id: crypto.randomUUID(), lineNumber: 3, buyerItemCode: "ITEM-003", supplierItemCode: null,      description: "Sample Part C", quantity: 200, unit: "PCS", unitPrice: 8.25,  confidence: 0.0, needsReview: true  },
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
  if (!res.ok) { const t = await res.text(); throw new Error(`Upload failed: ${t || res.statusText}`); }
  return res.json() as Promise<UploadResult>;
}

// ── Order list / detail ───────────────────────────────────────────────────

async function mockGetOrders(): Promise<OrderSummary[]> {
  await delay(300);
  return mockOrders.map(o => ({
    id: o.id, poNumber: o.poNumber, supplierName: o.supplierName,
    orderDate: o.orderDate, status: o.status,
    lineCount: o.lines.length,
    unresolvedCount: o.lines.filter(l => l.needsReview).length,
    createdAt: o.createdAt,
  }));
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
    if (li !== -1) order.lines[li] = { ...order.lines[li], supplierItemCode: res.supplierItemCode, needsReview: false, confidence: 1.0 };
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

let mockSupplierProfiles: import("@/types/procurement").SupplierProfile[] = [
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

  // Supplier profiles (legacy admin)
  getSupplierProfiles:    USE_MOCK ? mockGetSupplierProfiles   : realGetSupplierProfiles,
  getSupplierProfile:     USE_MOCK ? mockGetSupplierProfile    : realGetSupplierProfile,
  createSupplierProfile:  USE_MOCK ? mockCreateSupplierProfile : realCreateSupplierProfile,
  updateSupplierProfile:  USE_MOCK ? mockUpdateSupplierProfile : realUpdateSupplierProfile,
  deleteSupplierProfile:  USE_MOCK ? mockDeleteSupplierProfile : realDeleteSupplierProfile,
};
