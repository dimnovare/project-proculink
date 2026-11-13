import type {
  Order,
  OrderSummary,
  OrdersPage,
  GetOrdersParams,
  Supplier,
  TransformResult,
  DownloadUrl,
  CreateSupplierPayload,
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
  retryAfterFrom,
} from "./api/core";
import { mockSourceBytesForKey } from "./api/mockSourceDocument";
import {
  SOURCE_PURGED_FALLBACK_MESSAGE,
  filenameFromDisposition,
  normalizeContentType,
  type SourceDocumentState,
} from "./sourceDocument";
import { isPlanGateError, planGateMessage } from "./planGate";
import { readRefusal } from "./api/refusal";
import { serverReason } from "./serverText";

/**
 * Normalised public API base (no trailing slash). Exported so UI that needs to
 * display a backend URL — e.g. the inbound ingress endpoint on the Settings →
 * API keys tab — reuses the same normalization instead of re-reading the env.
 */
export const apiBaseUrl = API_BASE_URL;

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

// Identity fields are populated on two of the four so mock mode shows BOTH states
// the profile form has: filled in, and not set yet.
const MOCK_SUPPLIERS: Supplier[] = [
  {
    id: "11111111-1111-1111-1111-111111111111",
    name: "FastParts Inc",
    vatNumber: "DE811234567",
    registrationNumber: "HRB 214455",
    ediCode: "4012345000009",
    primaryDomain: "fastparts.example",
  },
  {
    id: "22222222-2222-2222-2222-222222222222",
    name: "ElectroSupply Co",
    vatNumber: null,
    registrationNumber: null,
    ediCode: "5412345000176",
    primaryDomain: "electrosupply.example",
  },
  { id: "33333333-3333-3333-3333-333333333333", name: "GlobalComponents" },
  { id: "44444444-4444-4444-4444-444444444444", name: "PrecisionMfg" },
];

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
      { id: "l-001-1", lineNumber: 1, buyerItemCode: "ACM-BOLT-001",   supplierItemCode: "FP-B001",   description: "Steel Bolt M10x50",   quantity: 500,  unit: "PCS", unitPrice: 0.45, confidence: 1.0, needsReview: false, resolvedVia: "saved_mapping" },
      { id: "l-001-2", lineNumber: 2, buyerItemCode: "ACM-NUT-001",    supplierItemCode: "FP-N001",   description: "Steel Nut M10",       quantity: 500,  unit: "PCS", unitPrice: 0.25, confidence: 1.0, needsReview: false, resolvedVia: "saved_mapping" },
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
    // Ranked candidates, exactly as GET /api/orders/{id} returns them. Advisory only:
    // this order is still `unrouted` and nothing here has routed it. Without these,
    // mock mode could reach the assign flow but never the suggestions on top of it.
    // Scores stay under 0.99 because the backend clamps there — a heuristic does not
    // get to claim certainty.
    supplierSuggestions: [
      {
        id: "sug-004-1",
        supplierId: "22222222-2222-2222-2222-222222222222",
        supplierName: "ElectroSupply Co",
        rank: 1,
        score: 0.78,
        reason: "ElectroSupply Co — the EDI code printed on the document is theirs, and this file's column layout has only ever been used by them.",
        signals: [
          { signal: "identity",           contribution: 0.45, detail: "the EDI code printed on the document is theirs" },
          { signal: "layout_fingerprint", contribution: 0.33, detail: "this file's column layout has only ever been used by them" },
        ],
      },
      {
        id: "sug-004-2",
        supplierId: "11111111-1111-1111-1111-111111111111",
        supplierName: "FastParts Inc",
        rank: 2,
        score: 0.44,
        reason: "FastParts Inc — 1 of 2 item codes is in their catalog.",
        signals: [
          { signal: "catalog_overlap", contribution: 0.44, detail: "1 of 2 item codes is in their catalog" },
        ],
      },
      {
        id: "sug-004-3",
        supplierId: "33333333-3333-3333-3333-333333333333",
        supplierName: "GlobalComponents",
        rank: 3,
        score: 0.21,
        reason: "GlobalComponents — earlier orders from this sender were routed to them.",
        signals: [
          { signal: "sender_domain_history", contribution: 0.21, detail: "earlier orders from this sender were routed to them" },
        ],
      },
    ],
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

// ── Suppliers ─────────────────────────────────────────────────────────────

/** Mutable copy of MOCK_SUPPLIERS — mutated by create/rename/delete mocks. */
const mockSupplierList = [...MOCK_SUPPLIERS];

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

// ── V9 AI confidence calibration insight ────────────────────────────────────
// GET /api/ai/calibration → the org's empirical reliability curve. Read-only,
// org-scoped. `isActive` is false during cold-start — callers must render the
// honest "not enough history yet" state rather than a misleading empty curve.

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

// ── Resolve ───────────────────────────────────────────────────────────────

/**
 * Both recompute endpoints (`/resolve` and `/accept-ai-suggestions`) answer their failures
 * with a JSON body `{ "error": "<sentence>" }` — WP-23's status guard adds `status` to it.
 * Parse once so callers can surface the sentence and keep the parsed body, instead of
 * dumping a serialised body into the operator's toast.
 */
function parseApiErrorBody(text: string): { body: unknown; error: string | null } {
  if (!text) return { body: null, error: null };
  let body: unknown;
  try { body = JSON.parse(text); } catch { return { body: null, error: null }; } // not JSON → use raw text
  const raw = (body as { error?: unknown } | null)?.error;
  return { body, error: typeof raw === "string" && raw.trim() ? raw : null };
}

// ── Transform ─────────────────────────────────────────────────────────────

type TransformFormat = "xml" | "csv" | "cxml" | "json" | "ubl" | "x12";

async function mockTransformOrder(orderId: string, format: TransformFormat = "xml"): Promise<TransformResult> {
  await delay(300); // simulate fast enqueue
  const idx = mockOrders.findIndex(o => o.id === orderId);
  if (idx === -1) throw new Error("Order not found");
  if (mockOrders[idx].lines.some(l => l.needsReview)) throw new Error("Resolve all lines before transforming.");

  // Set status to "transforming" immediately; simulate the job completing after 3s.
  //
  // WP-27: this used to write "delivered" here — teleporting past ready_to_deliver AND
  // delivering, so in mock mode an order reached the terminal success state without any
  // delivery ever being attempted. That made every mock-mode assertion on "delivered"
  // vacuous. Transform now ends where the real backend ends it, at ready_to_deliver;
  // reaching `delivered` requires an actual dispatch (mockRedeliverOrder).
  const now = new Date().toISOString();
  mockOrders[idx] = { ...mockOrders[idx], status: "transforming", updatedAt: now };

  setTimeout(() => {
    const i = mockOrders.findIndex(o => o.id === orderId);
    if (i === -1) return;
    const artifactId = crypto.randomUUID();
    const at = new Date().toISOString();
    const artifact = { id: artifactId, format, fileKey: `mock/${orderId}/artifacts/${artifactId}.${format}`, createdAt: at };
    mockOrders[i] = { ...mockOrders[i], status: "ready_to_deliver", updatedAt: at, artifacts: [artifact, ...mockOrders[i].artifacts] };
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
  // WP-23's discipline, applied to the surface WP-29 put a button on.
  //
  // Every refusal here answers with `{ "error": "<sentence>" }`: OrdersController.Transform
  // conflicts a non-transformable status with 409 + that shape, the unresolved-lines guard
  // 422s with it, and the plan gate 403s with `{ error: "<capability>_requires_<plan>",
  // upgradeUrl }`. Throwing `res.text()` verbatim put the serialised body in front of the
  // operator — the inbox row's failure line read `Couldn't start PO-… — Transform failed:
  // {"error":"Order is not ready to transform (status 'delivering')…"}`. The sentence is
  // written FOR them; the braces are ours.
  //
  // ApiHttpError, not Error, and the parsed body rides along: a 409 is a temporary hold
  // ("wait for the send to finish"), a 400 is terminal, and a 403's body carries the
  // upgradeUrl a banner needs. Flattening them all to Error throws that away.
  if (!res.ok) {
    const t = await res.text();
    const { body, error } = parseApiErrorBody(t);
    // A plan-gate code is a machine token, never a sentence — CLAUDE.md §11.5 forbids
    // matching it by literal, so isPlanGateError/planGateMessage do the shape match and
    // name the plan the SERVER asked for.
    if (res.status === 403 && isPlanGateError(error ?? t)) {
      throw new ApiHttpError(planGateMessage(error ?? t), 403, body);
    }
    // Rendered verbatim by the review screen and the order workshop, so it is copy:
    // "Transform failed" is the retired engine-stage name for the state whose badge
    // now reads "Couldn't build output" (G4). Structure from WP-29, wording from G4.
    const fallback = res.status === 422 ? "Unresolved lines" : "We couldn't build the output file";
    throw new ApiHttpError(error ?? `${fallback}: ${t || res.statusText}`, res.status, body);
  }
  // 202 Accepted — job enqueued; return a placeholder result
  const body = await res.json() as Record<string, unknown>;
  return { artifactId: "", format: format ?? "xml", createdAt: new Date().toISOString(), ...body } as TransformResult;
}

// ── Retry delivery (operator replay + dead-letter) ────────────────────────

/**
 * The 202 body of POST /api/orders/{id}/retry-delivery.
 *
 * `status` is the status the ROW ACTUALLY HOLDS when the endpoint answers — i.e.
 * still `delivery_failed`. The endpoint deliberately does NOT pre-flip the order to
 * `delivering`: RetryDeliveryAsync's atomic claim rejects a FRESH `delivering`, so
 * an optimistic pre-flip made the job reject the very row the controller had just
 * written, and nothing was dispatched until the row went stale ~30 minutes later.
 * The Worker's job claims the row and flips it to `delivering` within seconds.
 *
 * `retrying` is therefore the ONLY part of this body that says a retry is under way,
 * and it is a fact about the REQUEST (a job is enqueued), not about the row.
 */
export interface RetryDeliveryResult {
  status: string;
  retrying: boolean;
}

async function mockRetryDelivery(orderId: string): Promise<RetryDeliveryResult> {
  await delay(400);
  const idx = mockOrders.findIndex(o => o.id === orderId);
  const status = idx !== -1 ? mockOrders[idx].status : "delivery_failed";

  if (idx !== -1) {
    // Mirror the real Worker's two-step settle instead of teleporting the order to
    // `delivered`. The old mock jumped straight to delivered 2.5s after the POST and
    // reported `{status:"delivering"}` the endpoint never writes — so mock mode was
    // the one place the retry "worked", and it exercised a UI path that does not
    // exist in production. Step 1: the job claims the row (delivery_failed →
    // delivering). Step 2: the dispatch settles it (delivering → delivered).
    setTimeout(() => {
      const i = mockOrders.findIndex(o => o.id === orderId);
      if (i !== -1 && mockOrders[i].status === "delivery_failed") {
        mockOrders[i] = { ...mockOrders[i], status: "delivering", errorMessage: null, updatedAt: new Date().toISOString() };
      }
    }, 1_200);
    setTimeout(() => {
      const i = mockOrders.findIndex(o => o.id === orderId);
      if (i !== -1) mockOrders[i] = { ...mockOrders[i], status: "delivered", updatedAt: new Date().toISOString() };
    }, 3_000);
  }

  // The row is untouched by the POST itself — report what it holds, like the API does.
  return { status, retrying: true };
}

async function realRetryDelivery(orderId: string): Promise<RetryDeliveryResult> {
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
  return res.json() as Promise<RetryDeliveryResult>;
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

// ── The original source document ──────────────────────────────────────────

/**
 * `GET /api/orders/{id}/source` — the file the order arrived as, streamed (backend PR 189).
 *
 * The four documented refusals come back as VALUES, not exceptions, because none of them is a
 * malfunction: 204 = there is no displayable file (a sample order, an object we cannot read, or
 * one over the server's serve cap), 410 = the blob was purged on the retention schedule, 404 =
 * no such order in this workspace. Each has its own sentence on screen, and none is worth
 * retrying, so resolving them keeps the shared retry policy from hammering a settled answer.
 *
 * Everything else — 429, 5xx, a dropped connection — THROWS, so `shouldRetryApiFailure` and
 * `apiRetryDelayMs` get to do their job. The caller turns an exhausted retry into copy.
 *
 * Two things this must not do. It must not branch on `res.ok`: **204 is a 2xx**, so `res.ok` is
 * true and `await res.blob()` would hand back a 0-byte blob that renders as a corrupt document.
 * And it must not derive a type from the key or the filename — `contentType` is the server's
 * content sniff and is the only authority (see `sourceDocument.ts`).
 */
async function realGetOrderSource(orderId: string): Promise<SourceDocumentState> {
  const res = await fetchWithTimeout(
    `${API_BASE_URL}/api/orders/${orderId}/source`,
    { headers: await authHeader() },
    30000,
  );

  if (res.status === 204) return { kind: "none" };
  if (res.status === 404) return { kind: "missing" };
  if (res.status === 410) {
    const { error } = parseApiErrorBody(await res.text().catch(() => ""));
    return { kind: "purged", message: error || SOURCE_PURGED_FALLBACK_MESSAGE };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const { body, error } = parseApiErrorBody(text);
    throw new ApiHttpError(
      error || text || `Source document failed: ${res.statusText}`,
      res.status,
      body,
      retryAfterFrom(res, body),
    );
  }

  const blob = await res.blob();
  // An empty 200 is not a document. The server answers 204 for that, so this is belt-and-braces
  // against a proxy that rewrote the status — still better than rendering zero bytes.
  if (blob.size === 0) return { kind: "none" };
  return {
    kind: "document",
    document: {
      blob,
      contentType: normalizeContentType(res.headers.get("Content-Type")),
      filename: filenameFromDisposition(res.headers.get("Content-Disposition")),
    },
  };
}

async function mockGetOrderSource(orderId: string): Promise<SourceDocumentState> {
  await delay(180);
  const order = mockOrders.find((o) => o.id === orderId);
  if (!order) return { kind: "missing" };
  // The four fixtures cover the four states between them, so every branch of the document view
  // is reachable in demo mode and in the browser suite: ord-001 (.xlsx) has no demo bytes and
  // answers "no document", ord-002 (.pdf) and ord-003 (.csv) serve the two viewers, and ord-004
  // stands in for a blob purged on the retention schedule — it is already the fixture where
  // everything else has gone wrong.
  if (order.id === "ord-004") {
    return { kind: "purged", message: SOURCE_PURGED_FALLBACK_MESSAGE };
  }
  const bytes = mockSourceBytesForKey(order.sourceFileKey);
  if (!bytes) return { kind: "none" };
  return {
    kind: "document",
    document: { blob: bytes.blob, contentType: bytes.contentType, filename: bytes.filename },
  };
}

// ── Supplier product catalog (ground truth for AI suggestions) ───────────────

const _mockCatalog: Record<string, import("@/lib/api/types").SupplierProduct[]> = {};

export async function getSupplierCatalog(
  supplierId: string, q?: string, take = 100,
): Promise<import("@/lib/api/types").SupplierCatalogPage> {
  if (USE_MOCK) {
    await delay(120);
    const all = _mockCatalog[supplierId] ?? [];
    let items = all;
    if (q) { const t = q.toLowerCase(); items = items.filter(p => `${p.code} ${p.name ?? ""} ${p.barcode ?? ""}`.toLowerCase().includes(t)); }
    // `total` is the WHOLE catalog count, matching the API (SuppliersController
    // GetCatalog reads it from CountAsync, which ignores ?q=). Returning the match
    // count here instead made mock mode disagree with production on the one number
    // the pickers use to tell "no catalog yet" apart from "no match".
    return { total: all.length, items: items.slice(0, take) };
  }
  const headers = await authHeader();
  const url = `${API_BASE_URL}/api/suppliers/${supplierId}/catalog?take=${take}${q ? `&q=${encodeURIComponent(q)}` : ""}`;
  const res = await fetchWithTimeout(url, { headers });
  if (!res.ok) throw new Error(`catalog: ${res.status}`);
  return res.json();
}

// ── Supplier CRUD ─────────────────────────────────────────────────────────

async function mockCreateSupplier(payload: CreateSupplierPayload): Promise<Supplier> {
  await delay(400);
  const trimmed = payload.name.trim();
  if (mockSupplierList.some(s => s.name.toLowerCase() === trimmed.toLowerCase()))
    throw new Error(`A supplier named '${trimmed}' already exists.`);
  const s: Supplier = {
    id: crypto.randomUUID(),
    name: trimmed,
    vatNumber: blankToNull(payload.vatNumber),
    registrationNumber: blankToNull(payload.registrationNumber),
    ediCode: blankToNull(payload.ediCode),
    primaryDomain: normalizeDomain(payload.primaryDomain),
  };
  mockSupplierList.push(s);
  return s;
}

/** Mirrors the API's `Trimmed()`: whitespace off, blank becomes null. */
function blankToNull(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

/**
 * Mirrors the API's `NormalizedDomain()` so mock mode shows the same STORED value the
 * live form would show after a save — lowercase, no scheme, no "www.", no trailing slash.
 */
function normalizeDomain(v: string | null | undefined): string | null {
  const t = blankToNull(v);
  if (!t) return null;
  return t
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/+$/, "")
    .replace(/\.$/, "") || null;
}

async function realCreateSupplier(payload: CreateSupplierPayload): Promise<Supplier> {
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/suppliers`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await authHeader() },
    body: JSON.stringify(payload),
  }, 30000);
  if (!res.ok) { const t = await res.text(); throw new Error(serverReason(t, res.statusText || `HTTP ${res.status}`)); }
  return res.json() as Promise<Supplier>;
}

// ── Audit trail ───────────────────────────────────────────────────────────

async function mockRedeliverOrder(orderId: string): Promise<void> {
  await delay(800);

  const idx = mockOrders.findIndex(o => o.id === orderId);
  if (idx === -1) return; // unknown order — nothing to advance (mock parity with a 404)

  // Walk the real ladder: the claim flips the row to `delivering` before the dispatch
  // lands. useSendFlow's poll adopts that state, so skipping it would leave the mock
  // unable to exercise the in-flight CTA at all.
  mockOrders[idx] = { ...mockOrders[idx], status: "delivering", updatedAt: new Date().toISOString() };
  const claimedId = orderId;
  setTimeout(() => {
    const i = mockOrders.findIndex(o => o.id === claimedId);
    if (i === -1) return;
    mockOrders[i] = { ...mockOrders[i], status: "delivered", updatedAt: new Date().toISOString() };
  }, 600);
}

async function mockMarkDelivered(_orderId: string): Promise<void> {
  await delay(800);
  // Mock always succeeds — live wiring verified by manual QA
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

// Valid ONLY from delivery_unconfirmed (backend PR #27) — the operator's other
// resolution for a parked order, alongside redeliverOrder above. 202 on success;
// the body ({ status: "delivered" }) isn't needed here — the caller re-fetches
// the order (invalidating ["order", id] / ["orders"]) to pick up the new status.
async function realMarkDelivered(orderId: string): Promise<void> {
  const res = await fetchWithTimeout(
    `${API_BASE_URL}/api/orders/${orderId}/mark-delivered`,
    { method: "POST", headers: await authHeader() },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as Record<string, unknown>);
    throw new Error(
      (body as { error?: string }).error ?? `Mark delivered failed: ${res.statusText}`,
    );
  }
}

// ── Exported API client ───────────────────────────────────────────────────

export const apiClient = {
  // ─── Support contact ───
  submitSupportRequest:   USE_MOCK ? mockSubmitSupportRequest  : realSubmitSupportRequest,

  // Suppliers — list + CRUD
  getSuppliers:           USE_MOCK ? mockGetSuppliersFn        : realGetSuppliersFn,
  createSupplier:         USE_MOCK ? mockCreateSupplier        : realCreateSupplier,

  // Orders
  getOrders:              USE_MOCK ? mockGetOrders             : realGetOrders,
  getOrderById:           USE_MOCK ? mockGetOrderById          : realGetOrderById,
  transformOrder:         USE_MOCK ? mockTransformOrder        : realTransformOrder,
  retryDelivery:          USE_MOCK ? mockRetryDelivery         : realRetryDelivery,
  getDownloadUrl:         USE_MOCK ? mockGetDownloadUrl        : realGetDownloadUrl,
  getOrderSource:         USE_MOCK ? mockGetOrderSource         : realGetOrderSource,

  // Audit trail
  redeliverOrder:         USE_MOCK ? mockRedeliverOrder        : realRedeliverOrder,
  markDelivered:          USE_MOCK ? mockMarkDelivered         : realMarkDelivered,
};

// ── Per-order mapping override (heart-piece-flex) ────────────────────────────
// Default (no override) leaves the transform byte-identical; these power the
// "Edit mapping manually" power-user editor + live preview.

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

// ── Standalone suppliers export (for components that prefer named imports) ────
export const getSuppliers = USE_MOCK ? mockGetSuppliersFn : realGetSuppliersFn;

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
  ReprocessRequest,
  ReprocessResponse,
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
  throw new ApiHttpError(
    (await planGateBodyText(res)) ?? `Failed to update draft: ${res.statusText}`,
    res.status,
  );
}
export const getConnectionRevision: (connectionId: string, revisionId: string) => Promise<ConnectionRevision | null> =
  USE_MOCK ? mockGetConnectionRevision : realGetConnectionRevision;
export const updateConnectionDraft: (connectionId: string, revisionId: string, bundle: ConnectionRevisionBundle) => Promise<void> =
  USE_MOCK ? mockUpdateConnectionDraft : realUpdateConnectionDraft;

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
  ReprocessRequest,
  ReprocessResponse,
};
