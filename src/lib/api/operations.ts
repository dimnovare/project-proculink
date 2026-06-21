/**
 * operations.ts — Operator pipeline-health dashboard: ops/health, dead-letter
 * orders, requeue, and the all-orders exception dashboard.
 * Extracted from api-client.ts (behavior-preserving move).
 *
 * All exports from this module are re-exported from @/lib/api-client so
 * existing imports stay unchanged.
 */

import type { OrderException } from "@/types/procurement";
import {
  API_BASE_URL,
  USE_MOCK,
  authHeader,
  fetchWithTimeout,
  delay,
  ApiHttpError,
} from "./core";

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
  /**
   * Orders sitting in `pending_review` awaiting an operator decision. INFORMATIONAL —
   * NOT a system fault and NOT counted in `totalProblemOrders`. Optional because the
   * backend field may not be deployed yet; treat undefined as 0 (forward/backward compatible).
   */
  pendingReview?: number;
  stuckThresholdMinutes: number;
  totalProblemOrders: number;
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
    openExceptions: 2, pendingReview: 3, stuckThresholdMinutes: 30, totalProblemOrders: 2,
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

// ── Dead-letter count (ops view) ──────────────────────────────────────────────

/** Number of orders currently in the terminal delivery_dead_letter state. */
export async function getDeadLetterCount(): Promise<number> {
  if (USE_MOCK) { await delay(120); return 0; }
  const headers = await authHeader();
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/orders/dead-letter-count`, { headers });
  if (!res.ok) throw new Error(`dead-letter-count: ${res.status}`);
  const data = await res.json() as { count: number };
  return data.count;
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

export const getExceptions = USE_MOCK ? mockGetExceptions : realGetExceptions;
export const resolveException = USE_MOCK ? mockResolveException : realResolveException;
export const ignoreException = USE_MOCK ? mockIgnoreException : realIgnoreException;
