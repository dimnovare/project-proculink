// A delivery-config failure must arrive as the failure it WAS.
//
// The generic throw in `apiFetch` (src/lib/api/delivery.ts) is a bare `Error`, and
// `classifyApiFailure` (src/lib/apiFailure.ts) opens with
// `if (!(err instanceof ApiHttpError)) return { kind: "unreachable", retryable: true }`.
// So every non-OK status off this endpoint classified as a dropped connection: the QueryClient in
// src/app/(app)/layout.tsx retried a plan-gate 403, a 404 and a 409 — three answers that are the
// same the second time — and no consumer branching on a specific `kind` could ever fire.
//
// THE MESSAGE MUST NOT MOVE. `DeliveryConfigEditor` renders it (`setError(err.message)`), and
// `PlanGateNotice` reads the `<capability>_requires_<plan>` code back out of that text. Wrapping
// the throw runs it through `ApiHttpError`'s constructor, which calls `operatorSafeApiMessage` —
// so the first describe pins that the string survives byte-for-byte rather than assuming it.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The REAL `ApiHttpError` class has to survive this mock. `classifyApiFailure` asks
// `err instanceof ApiHttpError`, and vitest keys a module mock on the resolved path — a
// hand-written stub here would hand delivery.ts a DIFFERENT class from the one apiFailure.ts
// imports, and every assertion below would then pass or fail for the wrong reason.
// `importOriginal` keeps exactly one identity; only auth, the base URL and the mock flag are
// replaced (`authHeader` otherwise waits up to 5s for a Clerk that never loads under vitest, and
// `isApiMockMode` would short-circuit `getDeliveryConfig` to null before any request went out).
vi.mock("./core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./core")>();
  return {
    ...actual,
    authHeader: async () => ({}),
    API_BASE_URL: "http://api.test",
    isApiMockMode: false,
  };
});

import { ApiHttpError } from "./core";
import {
  getDeliveryConfig,
  upsertDeliveryConfig,
  deleteDeliveryConfig,
  testFireDelivery,
} from "./delivery";
import type { UpsertDeliveryConfigRequest } from "./types";
import { classifyApiFailure, shouldRetryApiFailure } from "@/lib/apiFailure";
import { operatorSafeApiMessage } from "@/lib/serverText";

/** What a plan gate answers with: `{ error: "<capability>_requires_<plan>", upgradeUrl }`. */
const PLAN_GATE_BODY = JSON.stringify({
  error: "webhook_delivery_requires_growth",
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
  throw new Error("expected the delivery-config call to reject");
}

const emptyConfig = {} as UpsertDeliveryConfigRequest;

describe("delivery apiFetch — the message the editor renders is unchanged", () => {
  it("survives ApiHttpError's constructor byte-for-byte", () => {
    // The precondition that makes wrapping safe at all. `operatorSafeApiMessage` runs on every
    // ApiHttpError message; a rewrite here would silently change operator-facing copy.
    const plain = "API error 400: Host is required.";
    expect(operatorSafeApiMessage(plain, 400)).toBe(plain);
    expect(new ApiHttpError(plain, 400).message).toBe(plain);
  });

  it("throws the same sentence a bare Error threw, for an ordinary validation failure", async () => {
    respondWith("Host is required.", 400);

    const err = await refusalFrom(() => upsertDeliveryConfig("sup-1", emptyConfig));

    // The request really went out — otherwise this whole file could pass on an import error.
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect((err as Error).message).toBe("API error 400: Host is required.");
  });

  it("keeps the plan-gate code in the message, where DeliveryConfigEditor reads it", async () => {
    // `serverReason` lifts the body's `error` field, so the code — not the whole JSON — is what
    // lands in the sentence. `PlanGateNotice` matches the `_requires_<plan>` shape on this text
    // and derives "Growth" from it; a reworded message would print the raw token at the customer.
    respondWith(PLAN_GATE_BODY, 403);

    const err = await refusalFrom(() => upsertDeliveryConfig("sup-1", emptyConfig));

    expect((err as Error).message).toBe("API error 403: webhook_delivery_requires_growth");
  });
});

describe("delivery apiFetch — the rejection carries what the failure WAS", () => {
  it("classifies a plan-gate 403 as a plan gate, not as a dropped connection", async () => {
    respondWith(PLAN_GATE_BODY, 403);

    const err = await refusalFrom(() => upsertDeliveryConfig("sup-1", emptyConfig));

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
    respondWith("", 404);

    const err = await refusalFrom(() => getDeliveryConfig("sup-1"));

    expect(err).toBeInstanceOf(ApiHttpError);
    const failure = classifyApiFailure(err);
    expect(failure.kind).toBe("not_found");
    expect(failure.retryable).toBe(false);
    expect(shouldRetryApiFailure(0, err)).toBe(false);
  });

  it("classifies a 409 as a conflict, not as a network fault", async () => {
    respondWith("Delivery config was changed by someone else.", 409);

    const err = await refusalFrom(() => deleteDeliveryConfig("sup-1"));

    expect(err).toBeInstanceOf(ApiHttpError);
    const failure = classifyApiFailure(err);
    expect(failure.kind).toBe("conflict");
    expect(failure.retryable).toBe(false);
  });

  it("honours a 429's Retry-After instead of retrying into a window that has not moved", async () => {
    // The one failure here that clears by itself — IF the wait is respected. A bare Error carried
    // no status and no wait, so the retry was spent immediately against the closed window.
    respondWith("Too many requests.", 429, { "Retry-After": "30" });

    const err = await refusalFrom(() => testFireDelivery("sup-1"));

    expect(err).toBeInstanceOf(ApiHttpError);
    const failure = classifyApiFailure(err);
    expect(failure.kind).toBe("rate_limited");
    expect(failure.retryAfterSeconds).toBe(30);
  });

  it("classifies a 500 as a server fault, which waiting plausibly helps", async () => {
    respondWith("Internal error", 500);

    const err = await refusalFrom(() => upsertDeliveryConfig("sup-1", emptyConfig));

    const failure = classifyApiFailure(err);
    expect(failure.kind).toBe("server");
    expect(failure.retryable).toBe(true);
  });

  it("keeps the literal response body for anything that needs exactly what came back", async () => {
    respondWith(PLAN_GATE_BODY, 403);

    const err = await refusalFrom(() => upsertDeliveryConfig("sup-1", emptyConfig));

    // The sentence lost the `upgradeUrl` when `serverReason` lifted the `error` field out of the
    // body. `PlanGateNotice` prefers `ApiHttpError.body` over the message for exactly that reason.
    expect((err as ApiHttpError).body).toBe(PLAN_GATE_BODY);
  });
});
