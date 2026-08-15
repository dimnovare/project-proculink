// The error body must reach `ApiHttpError` as an OBJECT, not as the raw response text.
//
// #204 made all three `apiFetch` helpers throw `ApiHttpError` and passed the raw text as `.body`.
// That closes the classification defect — a 404 is a 404 — but it silently drops the two FIELDS
// that consumers read off the body, because both readers were written to accept either form and
// the string form is the weaker branch:
//
//   • `retryAfterFrom` (src/lib/api/core.ts) reads `retryAfterSeconds` off the body, and
//     `"retryAfterSeconds" in body` is false for a string — no error, no warning, just null. Its
//     own comment is why this matters: the `Retry-After` header "is not CORS-safelisted — the app
//     and the API are different origins in every deployed environment", so the BODY is the carrier
//     that survives in production. Passing text honours a 429's wait in a test and nowhere else.
//   • `planGateUpgradeUrl` (src/lib/planGate.ts:181) reads `.upgradeUrl` off an object and falls
//     back to a regex over the serialised string. The object branch is the one it prefers.
//
// So these tests do not re-check what #204 already pins (status → kind, and the exact message
// strings — see *.httpFailureKind.test.ts). They pin the carrier: same fix, all three modules.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PoMappingConfig } from "./types";
import type { UpsertDeliveryConfigRequest } from "./types";

// mapping.ts reads isApiMockMode from api-client; stub it so the whole client is not pulled in.
vi.mock("@/lib/api-client", () => ({ isApiMockMode: false }));
// The REAL `ApiHttpError` and the REAL `retryAfterFrom` — this file asserts what the constructor
// derived, so a hand-written stub would be asserting itself. `importOriginal` keeps one class
// identity; only auth, the base URL and the mock flags are replaced (`authHeader` otherwise waits
// up to 5s for a Clerk that never loads under vitest).
vi.mock("./core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./core")>()),
  authHeader: async () => ({}),
  API_BASE_URL: "http://api.test",
  USE_MOCK: false,
  isApiMockMode: false,
}));

import { ApiHttpError } from "./core";
import { classifyApiFailure } from "@/lib/apiFailure";
import { planGateUpgradeUrl } from "@/lib/planGate";
import { listConnectorManifests } from "./connectors";
import { upsertDeliveryConfig } from "./delivery";
import { upsertPoMapping } from "./mapping";

/** One entry per `apiFetch` helper. All three share the throw site under test. */
const MODULES: Array<{ name: string; call: () => Promise<unknown> }> = [
  { name: "connectors", call: () => listConnectorManifests() },
  { name: "delivery", call: () => upsertDeliveryConfig("sup-1", {} as UpsertDeliveryConfigRequest) },
  { name: "mapping", call: () => upsertPoMapping("sup-1", {} as PoMappingConfig) },
];

const originalFetch = globalThis.fetch;

/** Real `Response`, so `headers.get` behaves exactly as it does in the browser. */
function respondWith(status: number, body: string, headers: Record<string, string> = {}): void {
  globalThis.fetch = vi.fn(
    async () => new Response(body, { status, headers: { "Content-Type": "application/json", ...headers } }),
  ) as unknown as typeof fetch;
}

/** The thrown value, or a failure if the call resolved — never a silently-passing test. */
async function rejectionFrom(call: () => Promise<unknown>): Promise<unknown> {
  try {
    await call();
  } catch (err) {
    return err;
  }
  throw new Error("expected the call to reject");
}

beforeEach(() => {
  globalThis.fetch = vi.fn() as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe.each(MODULES)("$name apiFetch — the error body reaches ApiHttpError as an object", ({ call }) => {
  it("honours a 429's wait carried in the body when no header is readable", async () => {
    // No `Retry-After` header at all — the deployed cross-origin case, where script cannot read it
    // even when the server sent one. Before the parse this was null, and a 429 fell back to
    // generic exponential backoff into a window that had not moved.
    respondWith(429, JSON.stringify({ error: "slow down", retryAfterSeconds: 17 }));

    const err = await rejectionFrom(call);

    expect(err).toBeInstanceOf(ApiHttpError);
    expect((err as ApiHttpError).retryAfterSeconds).toBe(17);
    expect(classifyApiFailure(err).retryAfterSeconds).toBe(17);
  });

  it("still honours the header when it IS readable, and does not lose it to the body", async () => {
    // The control for the test above: the header path must keep working, and a body with no wait
    // in it must not overwrite a header that has one.
    respondWith(429, JSON.stringify({ error: "slow down" }), { "Retry-After": "30" });

    const err = await rejectionFrom(call);

    expect(classifyApiFailure(err).retryAfterSeconds).toBe(30);
  });

  it("hands planGateUpgradeUrl the object branch rather than its regex fallback", async () => {
    // `serverReason` lifts a plan gate's `error` field and drops the `upgradeUrl` beside it, so
    // the message alone cannot answer this — the body has to carry it, in the shape the reader
    // prefers (src/lib/planGate.ts:182).
    respondWith(
      403,
      JSON.stringify({
        error: "webhook_delivery_requires_growth",
        upgradeUrl: "/settings?tab=billing",
      }),
    );

    const err = await rejectionFrom(call);
    const body = (err as ApiHttpError).body;

    expect(typeof body).toBe("object");
    expect((body as { error?: unknown }).error).toBe("webhook_delivery_requires_growth");
    expect(planGateUpgradeUrl(body)).toBe("/settings?tab=billing");
    // And the classification the gate copy branches on still lands.
    expect(classifyApiFailure(err).kind).toBe("plan_gate");
  });

  it("keeps a non-JSON body exactly as it arrived", async () => {
    // A gateway answers with a page, not JSON. `jsonBodyOrNull` returns null for it and the raw
    // text is kept, so nothing that reads `.body` for the literal response loses anything. (The
    // MESSAGE is sanitised separately, by `serverReason` at the throw site — see #204's tests.)
    const html = "<!DOCTYPE html><html><head><title>502</title></head><body>Bad gateway</body></html>";
    respondWith(502, html, { "Content-Type": "text/html" });

    const err = await rejectionFrom(call);

    expect((err as ApiHttpError).body).toBe(html);
    expect((err as ApiHttpError).retryAfterSeconds).toBeNull();
  });
});
