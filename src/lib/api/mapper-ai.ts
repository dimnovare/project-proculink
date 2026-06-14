// Typed client for the mapper's AI/enrichment Phase-2 endpoints. Each call degrades
// gracefully: a mock-mode short-circuit returns a safe empty, and a live HTTP 404 is
// treated as "Phase-2 not deployed yet → empty" so the mapper ships and works (manual
// wiring unaffected) before the engine endpoints land. The swap to the real endpoint is
// a no-op in the consumer once Phase 2 is live.
//
// Created by Task 7 (useMapperModel needs getMappingSuggestions); Task 8/9 extend this
// with validation + catalog-hint readers + the GhostWire component.

import type { MappingSuggestion } from "@/lib/api/types";
import { API_BASE_URL, authHeader, fetchWithTimeout, isApiMockMode } from "@/lib/api/core";

/**
 * AI-proposed source→canonical / canonical→target mappings for an order, rendered as
 * accept/reject ghost wires. Mock-fallback returns [] (no ghost wires); a 404 means the
 * Phase-2 suggestion endpoint is not deployed yet — also [].
 */
export async function getMappingSuggestions(orderId: string): Promise<MappingSuggestion[]> {
  if (isApiMockMode) return [];
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/orders/${orderId}/mapping-suggestions`, {
    headers: await authHeader(),
  });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`mapping-suggestions: ${res.status}`);
  return res.json() as Promise<MappingSuggestion[]>;
}
