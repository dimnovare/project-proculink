import type {
  Order,
  OrderSummary,
  OrdersPage,
  GetOrdersParams,
  DownloadUrl,
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
import { isPlanGateError } from "./planGate";
import { readRefusal } from "./api/refusal";
import { serverReason } from "./serverText";

// Re-export the shared primitives so every existing `@/lib/api-client` import
// (incl. ApiHttpError, isApiMockMode) keeps working unchanged.
export { ApiHttpError, isApiMockMode };

/**
 * A plan-gate 403 carries its whole meaning in the BODY — `{ error:
 * "<capability>_requires_<plan>", upgradeUrl }` — while the status line says nothing. Calls
 * that summarise a failure as `\`audit: ${res.status}\`` or `res.statusText` therefore threw
 * the gate away before any UI could react to it.
 *
 * Returns the raw body VERBATIM (not just the code) when it is a plan gate, so both the code
 * and the upgradeUrl survive on the Error message — several catch sites keep nothing but that
 * string. Any other failure returns null and keeps its existing message.
 *
 * Consumes the response body, so call it at most once per response.
 */
async function planGateBodyText(res: Response): Promise<string | null> {
  if (res.status !== 403) return null;
  try {
    return planGateText(res.status, await res.text());
  } catch {
    return null;
  }
}

/**
 * The same test, for a caller that has already read the body and cannot read it twice.
 *
 * A 403 now has TWO possible meanings — this one, and `requires_org_admin` (see
 * `src/lib/api/refusal.ts`) — so any site that reads the body once must ask both questions of
 * the same string rather than letting whichever it asks first swallow the other.
 */
function planGateText(status: number, raw: string): string | null {
  if (status !== 403) return null;
  const trimmed = raw.trim();
  return isPlanGateError(trimmed) ? trimmed : null;
}

// ─── Support contact ───
// Placed near the top of api-client.ts so the support form chip doesn't
// merge-conflict with the concurrent runSampleOrder chip landing at the bottom.
export interface SupportContactPayload {
  category: "general" | "bug" | "billing" | "security" | "demo";
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
  {
    // Parked `unrouted`: arrived on a content-routed channel (SFTP/S3/IMAP) with no
    // resolvable supplier, so it parsed and stopped. Lines exist and have no
    // supplierItemCode — with no supplier there is nothing to resolve them against.
    // Without this row, mock mode had no way to reach the assign-supplier flow at all.
    id: "ord-004",
    poNumber: "PO-2024-011145",
    supplierId: null,
    supplierName: "",
    buyerName: "Acme Manufacturing",
    orderDate: "2024-01-16",
    currency: "EUR",
    status: "unrouted",
    sourceFileKey: "orgs/demo/orders/po-011145.pdf",
    createdAt: "2024-01-16T08:05:00Z",
    updatedAt: "2024-01-16T08:06:00Z",
    lines: [
      { id: "l-004-1", lineNumber: 1, buyerItemCode: "MM-VALVE-D12", description: "Ball valve DN12",       quantity: 8,  unit: "PCS", unitPrice: 41.20, confidence: 0.0, needsReview: true },
      { id: "l-004-2", lineNumber: 2, buyerItemCode: "MM-GASKET-40", description: "Flange gasket 40mm",    quantity: 24, unit: "PCS", unitPrice: 3.15,  confidence: 0.0, needsReview: true },
    ],
    artifacts: [],
  },
  {
    // An invoice held with one open problem: invoices reuse the order model, so it has the
    // same statuses; the problem is an `invoice_check` exception (see mockGetOrderExceptions).
    id: "ord-005",
    poNumber: "INV-2024-0042",
    supplierId: "11111111-1111-1111-1111-111111111111",
    supplierName: "Example Supplies GmbH",
    buyerName: "Sample Buyer AG",
    orderDate: "2024-01-18",
    currency: "EUR",
    status: "pending_review",
    documentType: "invoice",
    dueDate: "2024-02-17",
    sellerTaxId: "DE123456789",
    paymentIban: "DE89370400440532013000",
    paymentReference: "INV-2024-0042",
    // Lines add up to the net (48.00 + 124.00); net plus 19% VAT is 204.68, the invoice states 214.68.
    subTotal: 172.0,
    taxTotal: 32.68,
    grandTotal: 214.68,
    sourceFileKey: "orgs/demo/orders/inv-0042.pdf",
    createdAt: "2024-01-18T10:00:00Z",
    updatedAt: "2024-01-18T10:00:00Z",
    lines: [
      { id: "l-005-1", lineNumber: 1, buyerItemCode: "EX-PAPER-A4", supplierItemCode: "EX-PAPER-A4", description: "Copy paper A4, 500 sheets", quantity: 10, unit: "PCS", unitPrice: 4.8,  confidence: 1.0, needsReview: false },
      { id: "l-005-2", lineNumber: 2, buyerItemCode: "EX-TONER-01", supplierItemCode: "EX-TONER-01", description: "Toner cartridge black",     quantity: 2,  unit: "PCS", unitPrice: 62.0, confidence: 1.0, needsReview: false },
    ],
    artifacts: [],
  },
];

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
    throw new Error(serverReason(text, `submitSupportRequest failed: ${res.status}`));
  }
  return res.json() as Promise<{ ok: true; delivered: boolean; contactEmail: string }>;
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
    documentType: o.documentType ?? null,
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

// ── Download ──────────────────────────────────────────────────────────────

async function mockGetDownloadUrl(orderId: string, artifactId: string): Promise<DownloadUrl> {
  await delay(200);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  return { url: `https://example.com/mock-download/${orderId}/${artifactId}`, expiresAt };
}

/**
 * Errors keep their status code (ApiHttpError) because this endpoint's failures are three
 * DIFFERENT stories and the caller cannot tell them apart from a flattened message:
 * 404 = no such artifact for this order · 410 Gone = the blob was purged under the org's
 * data-retention policy (row, hash and audit trail survive) · 429 = signed-URL rate limit.
 */
async function realGetDownloadUrl(orderId: string, artifactId: string): Promise<DownloadUrl> {
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/orders/${orderId}/artifacts/${artifactId}/download`, {
    headers: await authHeader(),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new ApiHttpError(`Download URL failed: ${t || res.statusText}`, res.status);
  }
  return res.json() as Promise<DownloadUrl>;
}

// ── Exported API client ───────────────────────────────────────────────────

export const apiClient = {
  // ─── Support contact ───
  submitSupportRequest:   USE_MOCK ? mockSubmitSupportRequest  : realSubmitSupportRequest,

  // Orders — the read-only archive
  getOrders:              USE_MOCK ? mockGetOrders             : realGetOrders,
  getOrderById:           USE_MOCK ? mockGetOrderById          : realGetOrderById,
  getDownloadUrl:         USE_MOCK ? mockGetDownloadUrl        : realGetDownloadUrl,
};

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
  /** Set together for FlowDocument events; null once the document is deleted. */
  documentId?: string | null;
  flowId?: string | null;
  documentName?: string | null;
}

export interface AuditLogPage {
  events: AuditLogEntry[];
  total: number;
  page: number;
  pageSize: number;
}

export async function getAuditLog(page = 1, pageSize = 50): Promise<AuditLogPage> {
  if (USE_MOCK) {
    await delay(120); // mock reads simulate latency — see getBillingStatus in api/billing.ts
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
  if (!res.ok) throw new ApiHttpError((await planGateBodyText(res)) ?? `audit: ${res.status}`, res.status);
  return res.json();
}

// ── Validation rules + output templates: retired 2026-07-30 ────────────────
//
// The /api/rules and /api/templates clients are gone with the screens that were
// their only callers (see src/lib/retired-routes.ts). Both endpoints described
// work the product never did: no rule from /api/rules was ever consulted while
// parsing, transforming or delivering an order, and the template writers posted
// a `config` key the API binds as `ConfigJson`, so every save was accepted and
// silently discarded.
//
// The checks that really run, and the output format a supplier really receives,
// are per-supplier: getAcceptanceProfile / saveAcceptanceProfile and the
// delivery config, both further down this file.

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
  findAdminOrdersByPo,
  getAdminJobFailures,
  setOrgAccountStatus,
  setOrgRetention,
  eraseOrganisation,
} from "@/lib/api/billing";
export type {
  AdminOverview,
  AdminOrganisation,
  CreateAdminInvoiceLineItem,
  CreateAdminInvoiceRequest,
  CreateAdminInvoiceResult,
  AdminOrderFindMatch,
  AdminOrderFindResult,
  AdminJobFailure,
  AdminJobFailures,
  OrgAccountStatusResult,
  OrgRetentionResult,
  OrgEraseReceipt,
  SetOrgRetentionRequest,
} from "@/lib/api/billing";

// ── Org settings (moved to src/lib/api/settings.ts) ───────────────────────────
export {
  getOrgSettings,
  updateOrgSettings,
} from "@/lib/api/settings";

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
  // Minting a bearer credential with org-wide machine access is organisation-admin-gated.
  // This threw the raw `requires_org_admin` token at whoever pressed the button.
  if (!res.ok) throw await readRefusal(res, `api-keys POST: ${res.status}`);
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
