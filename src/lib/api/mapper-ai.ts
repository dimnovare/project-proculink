// Typed client for the mapper's AI/enrichment Phase-2 endpoints. Each call degrades
// gracefully: a mock-mode short-circuit returns a safe empty, and a live HTTP 404 is
// treated as "Phase-2 not deployed yet → empty" so the mapper ships and works (manual
// wiring unaffected) before the engine endpoints land. The swap to the real endpoint is
// a no-op in the consumer once Phase 2 is live.
//
// Endpoints (assumed shapes — mirror the Phase-2 spec; the mock-fallback absorbs drift):
//   GET  /api/orders/{id}/mapping-suggestions   → MappingSuggestion[]   (Task 8 ghost wires)
//   GET  /api/orders/{id}/validation            → FieldValidationState[] (Task 9 green/amber)
//   GET  /api/orders/{id}/catalog-hints         → CatalogPriceHint[]     (Task 9 price action)
//   POST /api/orders/{id}/ai-suggestion-decisions → void                (V9 calibration learn)
//
// Created by Task 7 (useMapperModel needs getMappingSuggestions); extended by Task 8/9.

import type {
  MappingSuggestion,
  FieldValidationState,
  CatalogPriceHint,
} from "@/lib/api/types";
import { API_BASE_URL, authHeader, fetchWithTimeout, isApiMockMode, delay } from "@/lib/api/core";

/**
 * AI-proposed source→canonical / canonical→target mappings for an order, rendered as
 * accept/reject ghost wires. Mock-fallback returns [] (no ghost wires); a 404 means the
 * Phase-2 suggestion endpoint is not deployed yet — also [].
 */
export async function getMappingSuggestions(orderId: string): Promise<MappingSuggestion[]> {
  if (isApiMockMode) {
    await delay(120); // mock reads simulate latency — see getBillingStatus in api/billing.ts
    return [];
  }
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/orders/${orderId}/mapping-suggestions`, {
    headers: await authHeader(),
  });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`mapping-suggestions: ${res.status}`);
  return res.json() as Promise<MappingSuggestion[]>;
}

/**
 * Per-field validation outcomes (valid / review) surfaced as the green/amber badges on
 * canonical + output rows (Task 9). A `blocking` review gates the Deliver button. Mock /
 * 404 → [] so fields render clean and nothing blocks before Phase 2 lands.
 */
export async function getFieldValidation(orderId: string): Promise<FieldValidationState[]> {
  if (isApiMockMode) {
    await delay(120); // mock reads simulate latency — see getBillingStatus in api/billing.ts
    return [];
  }
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/orders/${orderId}/validation`, {
    headers: await authHeader(),
  });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`validation: ${res.status}`);
  return res.json() as Promise<FieldValidationState[]>;
}

/**
 * Catalog price/code variance hints per resolved line (Task 9). Drives the teal "catalog"
 * chip + the "Use catalog €X (PO €Y, +Z%)" one-click action. The catalog list itself uses
 * the already-shipped getSupplierCatalog; this endpoint is the per-line variance overlay.
 * Mock / 404 → [] so no badges render before Phase 2 lands.
 */
export async function getCatalogHints(orderId: string): Promise<CatalogPriceHint[]> {
  if (isApiMockMode) {
    await delay(120); // mock reads simulate latency — see getBillingStatus in api/billing.ts
    return [];
  }
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/orders/${orderId}/catalog-hints`, {
    headers: await authHeader(),
  });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`catalog-hints: ${res.status}`);
  return res.json() as Promise<CatalogPriceHint[]>;
}

/**
 * Record a user's accept/reject decision on an AI suggestion so the V9 confidence
 * calibration loop sees the empirical accept rate. Best-effort + non-throwing: mock /
 * 404 / any failure → silent no-op (the UI decision already applied locally; this is
 * telemetry, never on the critical path). offer⇔works: if the endpoint isn't there, the
 * ghost-wire accept/reject still functions, it just doesn't feed calibration yet.
 */
export async function recordSuggestionDecision(
  orderId: string,
  // `confidence` is nullable because a saved-mapping suggestion has none. Calibration is about
  // how well SCORES predict acceptance, so send the null and let the backend exclude it —
  // substituting a number here would poison the very loop this feeds.
  decision: { targetKey: string; sourceId: string; accepted: boolean; confidence: number | null },
): Promise<void> {
  if (isApiMockMode) return;
  try {
    await fetchWithTimeout(`${API_BASE_URL}/api/orders/${orderId}/ai-suggestion-decisions`, {
      method: "POST",
      headers: { ...(await authHeader()), "Content-Type": "application/json" },
      body: JSON.stringify(decision),
    });
  } catch {
    // Telemetry only — never surface to the user or block the decision.
  }
}
