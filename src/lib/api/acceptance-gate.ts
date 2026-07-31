// Typed client for WP-17's supplier acceptance gate.
//
//   GET /api/orders/{id}/acceptance-gate → AcceptanceGateDecision
//
// This is the SAME decision `OrderTransformService.TransformAsync` consults before
// it will transform an order, exposed read-only for the UI ("it mutates nothing and
// persists nothing, so the UI may poll it freely" — OrderAcceptanceGateController).
//
// WHY NOT GET /api/orders/{id}/validation. That endpoint's per-field `blocking`
// flag is the RAW blocking-failure set. The gate's decision is that set MINUS a
// recorded operator override (AcceptanceGate.cs:62-77): an overridden order
// reports Blocked=false while still listing its blockers. A client reading the raw
// flag would refuse a send the server actually allows — over-blocking, which is the
// mirror image of the defect WP-17 exists to close.
//
// NO MOCK-MODE 404 SWALLOW. Unlike the mapper's Phase-2 endpoints, a failure here
// is not "a feature that has not shipped" — it is "we do not know whether this order
// can be sent". The caller must be able to tell that apart from "nothing blocks", so
// this throws and lets the query surface isError. Mock mode returns an explicit
// clear decision.

import type { AcceptanceGateDecision } from "@/lib/api/types";
import { API_BASE_URL, authHeader, fetchWithTimeout, isApiMockMode } from "@/lib/api/core";

/** A decision that blocks nothing — mock mode, and the shape of "all clear". */
export const CLEAR_ACCEPTANCE_GATE: AcceptanceGateDecision = {
  blocked: false,
  reason: null,
  overridden: false,
  overriddenBy: null,
  overrideReason: null,
  blockers: [],
};

export async function getAcceptanceGate(orderId: string): Promise<AcceptanceGateDecision> {
  if (isApiMockMode) return CLEAR_ACCEPTANCE_GATE;

  const res = await fetchWithTimeout(
    `${API_BASE_URL}/api/orders/${orderId}/acceptance-gate`,
    { headers: await authHeader() },
    15000,
  );
  // 404 = no such order for this org. The workshop's own load gate already handles
  // that case; treating it as "clear" here keeps a deleted order from rendering a
  // spurious blocker on top of the not-found screen.
  if (res.status === 404) return CLEAR_ACCEPTANCE_GATE;
  if (!res.ok) throw new Error(`acceptance-gate: ${res.status}`);

  const raw = (await res.json()) as Partial<AcceptanceGateDecision> | null;
  return {
    blocked: raw?.blocked === true,
    reason: raw?.reason ?? null,
    overridden: raw?.overridden === true,
    overriddenBy: raw?.overriddenBy ?? null,
    overrideReason: raw?.overrideReason ?? null,
    blockers: Array.isArray(raw?.blockers) ? raw.blockers : [],
  };
}
