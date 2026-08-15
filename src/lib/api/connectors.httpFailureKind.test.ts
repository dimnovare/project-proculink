// A connector-manifest failure must arrive as the failure it WAS.
//
// Both throws in `apiFetch` (src/lib/api/connectors.ts) are bare `Error`s, and
// `classifyApiFailure` (src/lib/apiFailure.ts) opens with
// `if (!(err instanceof ApiHttpError)) return { kind: "unreachable", retryable: true }`.
// So every failure off `/connector-manifests` classified as a dropped connection — including the
// dedicated 404 arm, whose whole purpose is to say "this key is not a connector we know". The
// QueryClient in src/app/(app)/layout.tsx retried it, and no consumer branching on a specific
// `kind` could fire.
//
// THE MESSAGES MUST NOT MOVE. `ConnectorRequirementsPanel` and `DeliveryConfigEditor` render them,
// and the plan-gate path carries a `<capability>_requires_<plan>` code that `PlanGateNotice`
// matches on. Wrapping the throws runs them through `ApiHttpError`'s constructor, which calls
// `operatorSafeApiMessage` — so the first describe pins that both strings survive byte-for-byte.

import { describe, it, expect, vi, afterEach } from "vitest";

// The REAL `ApiHttpError` class has to survive this mock. `classifyApiFailure` asks
// `err instanceof ApiHttpError`, and vitest keys a module mock on the resolved path — a
// hand-written stub here would hand connectors.ts a DIFFERENT class from the one apiFailure.ts
// imports, and every assertion below would then pass or fail for the wrong reason.
// `importOriginal` keeps exactly one identity; only auth, the base URL and USE_MOCK are replaced
// (`authHeader` otherwise waits up to 5s for a Clerk that never loads under vitest, and USE_MOCK
// would bind the exports below to their mock twins, which never make a request at all).
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
import {
  listConnectorManifests,
  getConnectorManifest,
  validateConnectorConfig,
} from "./connectors";
import { classifyApiFailure, shouldRetryApiFailure } from "@/lib/apiFailure";
import { operatorSafeApiMessage } from "@/lib/serverText";

/** What a plan gate answers with: `{ error: "<capability>_requires_<plan>", upgradeUrl }`. */
const PLAN_GATE_BODY = JSON.stringify({
  error: "erp_delivery_requires_enterprise",
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
  throw new Error("expected the connector-manifest call to reject");
}

describe("connectors apiFetch — the messages the panels render are unchanged", () => {
  it("survives ApiHttpError's constructor byte-for-byte", () => {
    // The precondition that makes wrapping safe at all. `operatorSafeApiMessage` runs on every
    // ApiHttpError message; a rewrite here would silently change operator-facing copy.
    const notFound = "Not found: /connector-manifests/http";
    const generic = "API error 400: Unknown protocol key.";
    expect(operatorSafeApiMessage(notFound, 404)).toBe(notFound);
    expect(operatorSafeApiMessage(generic, 400)).toBe(generic);
    expect(new ApiHttpError(notFound, 404).message).toBe(notFound);
    expect(new ApiHttpError(generic, 400).message).toBe(generic);
  });

  it("throws the same not-found sentence a bare Error threw, naming the path", async () => {
    respondWith("", 404);

    const err = await refusalFrom(() => getConnectorManifest("http"));

    // The request really went out — otherwise this whole file could pass on an import error.
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect((err as Error).message).toBe("Not found: /connector-manifests/http");
  });

  it("throws the same generic sentence a bare Error threw, for any other failure", async () => {
    respondWith("Unknown protocol key.", 400);

    const err = await refusalFrom(() => validateConnectorConfig("http", {}));

    expect((err as Error).message).toBe("API error 400: Unknown protocol key.");
  });
});

describe("connectors apiFetch — the rejection carries what the failure WAS", () => {
  it("classifies the 404 arm as deterministic, so it is not retried pointlessly", async () => {
    // This arm exists to say "no connector answers to that key". Asking again cannot change it.
    respondWith("", 404);

    const err = await refusalFrom(() => getConnectorManifest("http"));

    expect(err).toBeInstanceOf(ApiHttpError);
    expect((err as ApiHttpError).status).toBe(404);

    const failure = classifyApiFailure(err);
    expect(failure.kind).toBe("not_found");
    expect(failure.retryable).toBe(false);
    expect(shouldRetryApiFailure(0, err)).toBe(false);
  });

  it("classifies a plan-gate 403 as a plan gate, not as a dropped connection", async () => {
    respondWith(PLAN_GATE_BODY, 403);

    const err = await refusalFrom(() => listConnectorManifests());

    expect(err).toBeInstanceOf(ApiHttpError);
    expect((err as ApiHttpError).status).toBe(403);

    const failure = classifyApiFailure(err);
    expect(failure.kind).toBe("plan_gate");
    expect(failure.retryable).toBe(false);
    expect(failure.maxRetries).toBe(0);
    expect(shouldRetryApiFailure(0, err)).toBe(false);
  });

  it("classifies a 409 as a conflict, not as a network fault", async () => {
    respondWith("This connector was changed by someone else.", 409);

    const err = await refusalFrom(() => validateConnectorConfig("http", {}));

    expect(err).toBeInstanceOf(ApiHttpError);
    expect(classifyApiFailure(err).kind).toBe("conflict");
  });

  it("honours a 429's Retry-After instead of retrying into a window that has not moved", async () => {
    respondWith("Too many requests.", 429, { "Retry-After": "30" });

    const err = await refusalFrom(() => listConnectorManifests());

    expect(err).toBeInstanceOf(ApiHttpError);
    const failure = classifyApiFailure(err);
    expect(failure.kind).toBe("rate_limited");
    expect(failure.retryAfterSeconds).toBe(30);
  });

  it("classifies a 500 as a server fault, which waiting plausibly helps", async () => {
    respondWith("Internal error", 500);

    const err = await refusalFrom(() => listConnectorManifests());

    const failure = classifyApiFailure(err);
    expect(failure.kind).toBe("server");
    expect(failure.retryable).toBe(true);
  });

  it("keeps the literal response body for anything that needs exactly what came back", async () => {
    respondWith(PLAN_GATE_BODY, 403);

    const err = await refusalFrom(() => listConnectorManifests());

    // The sentence lost the `upgradeUrl` when `serverReason` lifted the `error` field out of the
    // body. `PlanGateNotice` prefers `ApiHttpError.body` over the message for exactly that reason.
    expect((err as ApiHttpError).body).toBe(PLAN_GATE_BODY);
  });
});
