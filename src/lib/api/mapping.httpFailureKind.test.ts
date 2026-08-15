// A saved-mapping failure must arrive as the failure it WAS.
//
// The throw in `apiFetch` (src/lib/api/mapping.ts) is a bare `Error`, and `classifyApiFailure`
// (src/lib/apiFailure.ts) opens with
// `if (!(err instanceof ApiHttpError)) return { kind: "unreachable", retryable: true }`.
// So every non-OK status off `/suppliers/{id}/po-mapping` classified as a dropped connection: the
// QueryClient in src/app/(app)/layout.tsx retried a plan-gate 403, a 404 and a 409 — three answers
// that are the same the second time — and no consumer branching on a specific `kind` could fire.
//
// THE MESSAGE MUST NOT MOVE. `PoMappingEditor` renders it verbatim in its "Couldn't save — …" line
// (`SaveFeedback`, which also puts it in the `title` attribute). Wrapping the throw runs it through
// `ApiHttpError`'s constructor, which calls `operatorSafeApiMessage` — so the first describe pins
// that the string survives byte-for-byte rather than assuming it.

import { describe, it, expect, vi, afterEach } from "vitest";

// isApiMockMode: false pins the LIVE path — mapping.ts reads it from api-client at module scope.
vi.mock("@/lib/api-client", () => ({ isApiMockMode: false }));
// The REAL `ApiHttpError` class has to survive this mock. `classifyApiFailure` asks
// `err instanceof ApiHttpError`, and vitest keys a module mock on the resolved path — a
// hand-written stub here would hand mapping.ts a DIFFERENT class from the one apiFailure.ts
// imports, and every assertion below would then pass or fail for the wrong reason.
// `importOriginal` keeps exactly one identity; only auth and the base URL are replaced
// (`authHeader` otherwise waits up to 5s for a Clerk that never loads under vitest).
vi.mock("./core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./core")>();
  return {
    ...actual,
    authHeader: async () => ({}),
    API_BASE_URL: "http://api.test",
    USE_MOCK: false,
  };
});

import { ApiHttpError } from "./core";
import { getPoMapping, upsertPoMapping, deletePoMapping } from "./mapping";
import type { PoMappingConfig } from "./types";
import { classifyApiFailure, shouldRetryApiFailure } from "@/lib/apiFailure";
import { operatorSafeApiMessage } from "@/lib/serverText";

/** What a plan gate answers with: `{ error: "<capability>_requires_<plan>", upgradeUrl }`. */
const PLAN_GATE_BODY = JSON.stringify({
  error: "bulk_mapping_requires_operations",
  upgradeUrl: "/settings?tab=billing",
});

const originalFetch = globalThis.fetch;

function respondWith(body: string, status: number, headers: Record<string, string> = {}) {
  globalThis.fetch = vi.fn(
    async () => new Response(body, { status, statusText: "", headers }),
  ) as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

/** The thrown value, or a failure if the call resolved — never a silently-passing test. */
async function refusalFrom(call: () => Promise<unknown>): Promise<unknown> {
  try {
    await call();
  } catch (err) {
    return err;
  }
  throw new Error("expected the po-mapping call to reject");
}

const emptyMapping = {} as PoMappingConfig;

describe("mapping apiFetch — the message PoMappingEditor renders is unchanged", () => {
  it("survives ApiHttpError's constructor byte-for-byte", () => {
    // The precondition that makes wrapping safe at all. `operatorSafeApiMessage` runs on every
    // ApiHttpError message; a rewrite here would silently change operator-facing copy.
    const plain = "API error 400: Column names must be unique.";
    expect(operatorSafeApiMessage(plain, 400)).toBe(plain);
    expect(new ApiHttpError(plain, 400).message).toBe(plain);
  });

  it("throws the same sentence a bare Error threw, for an ordinary validation failure", async () => {
    respondWith("Column names must be unique.", 400);

    const err = await refusalFrom(() => upsertPoMapping("sup-1", emptyMapping));

    // The request really went out — otherwise this whole file could pass on an import error.
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect((err as Error).message).toBe("API error 400: Column names must be unique.");
  });

  it("keeps the plan-gate code in the message, where PlanGateNotice reads it", async () => {
    // `serverReason` lifts the body's `error` field, so the code — not the whole JSON — is what
    // lands in the sentence, and `PlanGateNotice` derives "Operations" from its shape.
    respondWith(PLAN_GATE_BODY, 403);

    const err = await refusalFrom(() => upsertPoMapping("sup-1", emptyMapping));

    expect((err as Error).message).toBe("API error 403: bulk_mapping_requires_operations");
  });
});

describe("mapping apiFetch — the rejection carries what the failure WAS", () => {
  it("classifies a plan-gate 403 as a plan gate, not as a dropped connection", async () => {
    respondWith(PLAN_GATE_BODY, 403);

    const err = await refusalFrom(() => upsertPoMapping("sup-1", emptyMapping));

    expect(err).toBeInstanceOf(ApiHttpError);
    expect((err as ApiHttpError).status).toBe(403);

    const failure = classifyApiFailure(err);
    expect(failure.kind).toBe("plan_gate");
    expect(failure.retryable).toBe(false);
    expect(failure.maxRetries).toBe(0);
    // The consequence the QueryClient reads: no retry of a refusal that cannot succeed.
    expect(shouldRetryApiFailure(0, err)).toBe(false);
  });

  it("classifies a 404 as deterministic, so it is not retried pointlessly", async () => {
    // A 204 is how this endpoint says "nothing saved" — a real answer, returned as null. A 404 is
    // a wrong supplier id or a broken route, and asking again gives the same answer.
    respondWith("", 404);

    const err = await refusalFrom(() => getPoMapping("sup-1"));

    expect(err).toBeInstanceOf(ApiHttpError);
    const failure = classifyApiFailure(err);
    expect(failure.kind).toBe("not_found");
    expect(failure.retryable).toBe(false);
    expect(shouldRetryApiFailure(0, err)).toBe(false);
  });

  it("classifies a 409 as a conflict, not as a network fault", async () => {
    respondWith("This mapping was changed by someone else.", 409);

    const err = await refusalFrom(() => deletePoMapping("sup-1"));

    expect(err).toBeInstanceOf(ApiHttpError);
    expect(classifyApiFailure(err).kind).toBe("conflict");
  });

  it("honours a 429's Retry-After instead of retrying into a window that has not moved", async () => {
    respondWith("Too many requests.", 429, { "Retry-After": "30" });

    const err = await refusalFrom(() => upsertPoMapping("sup-1", emptyMapping));

    expect(err).toBeInstanceOf(ApiHttpError);
    const failure = classifyApiFailure(err);
    expect(failure.kind).toBe("rate_limited");
    expect(failure.retryAfterSeconds).toBe(30);
  });

  it("classifies a 500 as a server fault, which waiting plausibly helps", async () => {
    respondWith("Internal error", 500);

    const err = await refusalFrom(() => upsertPoMapping("sup-1", emptyMapping));

    const failure = classifyApiFailure(err);
    expect(failure.kind).toBe("server");
    expect(failure.retryable).toBe(true);
  });

  it("keeps the response body for anything the message dropped", async () => {
    respondWith(PLAN_GATE_BODY, 403);

    const err = await refusalFrom(() => upsertPoMapping("sup-1", emptyMapping));

    // The sentence lost the `upgradeUrl` when `serverReason` lifted the `error` field out of the
    // body. `PlanGateNotice` prefers `ApiHttpError.body` over the message for exactly that reason.
    //
    // It arrives PARSED, not as the literal text this asserted when it was written. That is the
    // convention everywhere else in this layer — api-client.ts feeds its throw sites
    // `parseApiErrorBody(text).body` — and both readers prefer it: `planGateUpgradeUrl` reads
    // `.upgradeUrl` off an object instead of regexing the serialised string, and `retryAfterFrom`
    // can only see a body-carried `retryAfterSeconds` on an object, which is the only wait carrier
    // that survives cross-origin. A non-JSON body is still kept verbatim. See
    // errorBodyCarrier.test.ts.
    expect((err as ApiHttpError).body).toEqual(JSON.parse(PLAN_GATE_BODY));
  });
});
