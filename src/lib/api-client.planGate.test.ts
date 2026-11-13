import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isPlanGateError } from "./planGate";
import { getAuditLog } from "./api-client";

// WP-11 follow-through, api layer.
//
// A plan-gate 403 is only actionable if the CODE survives the throw. These four calls used
// to discard the response body — `throw new Error("audit: 403")`,
// `Failed to update draft: ${res.statusText}` — so `advanced_audit_requires_operations`
// never reached the UI and no amount of wiring in the component could have matched it.
// The gate lives in the body; these tests pin that the body text (code AND upgradeUrl)
// reaches the caller for the paths WP-11 newly gates.

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

  it("falls back to the status text when a failure has no body at all", async () => {
    respondWith("", 500);

    // Re-anchored 2026-11-13 from updateConnectionDraft (deleted with /api/connections).
    const err = await getAuditLog().catch((e: Error) => e);

    expect((err as Error).message).toBe("audit: 500");
  });
});
