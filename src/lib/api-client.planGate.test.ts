import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isPlanGateError, planGateUpgradeUrl } from "./planGate";
import {
  getAuditLog,
  createConnectionDraft,
  updateConnectionDraft,
  publishConnectionRevision,
} from "./api-client";
import type { ConnectionRevisionBundle } from "./api/types";

// WP-11 follow-through, api layer.
//
// A plan-gate 403 is only actionable if the CODE survives the throw. These four calls used
// to discard the response body — `throw new Error("audit: 403")`,
// `Failed to update draft: ${res.statusText}` — so `advanced_audit_requires_operations`
// never reached the UI and no amount of wiring in the component could have matched it.
// The gate lives in the body; these tests pin that the body text (code AND upgradeUrl)
// reaches the caller for the paths WP-11 newly gates.

const GATE_BODY = JSON.stringify({
  error: "advanced_audit_requires_operations",
  upgradeUrl: "/settings?tab=billing",
});

const BUNDLE: ConnectionRevisionBundle = {
  inputMappingJson: null,
  outputMappingJson: null,
  outputFormat: "cxml",
  deliveryProtocol: "http",
  deliveryConfigJson: null,
  deliveryAutoDeliver: false,
  acceptanceProfileId: null,
  acceptanceVersionNo: null,
  catalogMode: "live",
  itemMappings: null,
};

function respondWith(body: string, status: number) {
  const fetchMock = vi.fn(async () => new Response(body, { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** authHeader() waits up to 5s for Clerk unless it is already loaded — keep the tests fast. */
beforeEach(() => {
  (window as unknown as { Clerk: unknown }).Clerk = { loaded: true, session: null };
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as unknown as { Clerk?: unknown }).Clerk;
});

describe("plan-gate 403s keep the backend's code and upgrade url", () => {
  it("getAuditLog", async () => {
    respondWith(JSON.stringify({ error: "advanced_audit_requires_operations", upgradeUrl: "/settings" }), 403);

    const err = await getAuditLog().catch((e: Error) => e);

    expect(isPlanGateError((err as Error).message)).toBe(true);
  });

  it("createConnectionDraft", async () => {
    respondWith(GATE_BODY, 403);

    const err = await createConnectionDraft("conn-1", { cloneFromActive: true }).catch((e: Error) => e);

    expect(isPlanGateError((err as Error).message)).toBe(true);
    expect(planGateUpgradeUrl((err as Error).message)).toBe("/settings?tab=billing");
  });

  it("updateConnectionDraft — the draft bundle that selects a gated protocol/format", async () => {
    respondWith(JSON.stringify({ error: "cxml_output_requires_operations", upgradeUrl: "/settings" }), 403);

    const err = await updateConnectionDraft("conn-1", "rev-1", BUNDLE).catch((e: Error) => e);

    expect(isPlanGateError((err as Error).message)).toBe(true);
  });

  it("publishConnectionRevision", async () => {
    respondWith(JSON.stringify({ error: "erp_delivery_requires_enterprise", upgradeUrl: "/settings" }), 403);

    const err = await publishConnectionRevision("conn-1", "rev-1").catch((e: Error) => e);

    expect(isPlanGateError((err as Error).message)).toBe(true);
  });

  it("still prefers the backend's own message on the 409s that already read the body", async () => {
    respondWith("Run tests on this revision before publishing.", 409);

    const err = await publishConnectionRevision("conn-1", "rev-1").catch((e: Error) => e);

    expect((err as Error).message).toBe("Run tests on this revision before publishing.");
  });

  it("falls back to the status text when a failure has no body at all", async () => {
    respondWith("", 500);

    const err = await updateConnectionDraft("conn-1", "rev-1", BUNDLE).catch((e: Error) => e);

    expect((err as Error).message).toMatch(/update draft/i);
  });
});
