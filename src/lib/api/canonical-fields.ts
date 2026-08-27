// Typed client for Tier-2 user-defined canonical fields (Phase-2 `CanonicalFieldDef` CRUD).
//
// Phase-3 DEPENDS on a Phase-2 backend that may not be deployed yet, so every call
// degrades gracefully:
//   • isApiMockMode  → an in-memory MOCK list (dev mocks; no network).
//   • HTTP 404       → treated as "Phase-2 not deployed" → empty list / optimistic no-op,
//                      so the lane still renders and the existing system spine is unaffected.
//   • other non-2xx  → throws (a real, deployed-but-broken endpoint should surface).
//
// ASSUMED endpoint shape (mirrors the connection-scoped Phase-2 contract; confirm when
// Phase 2 lands — the mock-fallback absorbs drift):
//   GET    /api/connections/{scopeId}/canonical-fields            → CanonicalFieldDef[]
//   POST   /api/connections/{scopeId}/canonical-fields            → CanonicalFieldDef  (body = def)
//   DELETE /api/connections/{scopeId}/canonical-fields/{key}      → 204 (soft-delete)
//
// `scopeId` is the connectionId (connection mapper) or orderId (inbox mapper); the route
// is identical from the client's side — the backend resolves the org/connection scope.

import type { CanonicalFieldDef } from "@/lib/api/types";
import { API_BASE_URL, authHeader, fetchWithTimeout, isApiMockMode, delay } from "@/lib/api/core";

/**
 * In-memory store for mock mode (dev only). Keyed by scopeId so two open scopes don't
 * cross-pollinate. NEVER used in production (isApiMockMode is false there).
 */
const MOCK = new Map<string, CanonicalFieldDef[]>();

function mockList(scopeId: string): CanonicalFieldDef[] {
  let list = MOCK.get(scopeId);
  if (!list) {
    list = [];
    MOCK.set(scopeId, list);
  }
  return list;
}

/** List the Tier-2 custom canonical fields for a scope. Empty list when Phase-2 is absent. */
export async function getCanonicalFields(scopeId: string): Promise<CanonicalFieldDef[]> {
  if (isApiMockMode) {
    await delay(120); // mock reads simulate latency — see getBillingStatus in api/billing.ts
    return [...mockList(scopeId)];
  }
  const res = await fetchWithTimeout(
    `${API_BASE_URL}/api/connections/${encodeURIComponent(scopeId)}/canonical-fields`,
    { headers: await authHeader() },
  );
  if (res.status === 404) return []; // Phase-2 not deployed yet → graceful empty
  if (!res.ok) throw new Error(`canonical-fields: ${res.status}`);
  return (await res.json()) as CanonicalFieldDef[];
}

/**
 * Add a custom canonical field. The new field is always `system: false` (only built-in
 * spine fields are system). In mock mode it is pushed to the in-memory store and echoed
 * back; against a live (but not-yet-deployed) endpoint a 404 is treated as an optimistic
 * no-op so the UI's optimistic insert is not rolled back.
 */
export async function addCanonicalField(
  scopeId: string,
  def: Omit<CanonicalFieldDef, "system">,
): Promise<CanonicalFieldDef> {
  const created: CanonicalFieldDef = { ...def, system: false };
  if (isApiMockMode) {
    mockList(scopeId).push(created);
    return created;
  }
  const res = await fetchWithTimeout(
    `${API_BASE_URL}/api/connections/${encodeURIComponent(scopeId)}/canonical-fields`,
    {
      method: "POST",
      headers: { ...(await authHeader()), "Content-Type": "application/json" },
      body: JSON.stringify(def),
    },
  );
  if (res.status === 404) return created; // Phase-2 not deployed → optimistic echo
  if (!res.ok) throw new Error(`add canonical-field: ${res.status}`);
  return (await res.json()) as CanonicalFieldDef;
}

/** Remove (soft-delete) a custom canonical field by key. 404 is a no-op (already gone / Phase-2 absent). */
export async function removeCanonicalField(scopeId: string, key: string): Promise<void> {
  if (isApiMockMode) {
    const list = mockList(scopeId);
    const i = list.findIndex((d) => d.key === key);
    if (i >= 0) list.splice(i, 1);
    return;
  }
  const res = await fetchWithTimeout(
    `${API_BASE_URL}/api/connections/${encodeURIComponent(scopeId)}/canonical-fields/${encodeURIComponent(key)}`,
    { method: "DELETE", headers: await authHeader() },
  );
  if (!res.ok && res.status !== 404) throw new Error(`remove canonical-field: ${res.status}`);
}

/** Test-only: clear the mock store between cases. No-op outside mock mode. */
export function __resetCanonicalFieldsMock() {
  MOCK.clear();
}
