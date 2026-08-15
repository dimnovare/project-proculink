// The organisation-admin refusal on a delivery config must arrive as an `ApiHttpError`.
//
// `apiFetch` in delivery.ts threw a bare `Error` for this one case, and `classifyApiFailure`
// opens with `if (!(err instanceof ApiHttpError)) return { kind: "unreachable", retryable: true }`.
// So a 403 that can never change its mind classified as a dropped connection: the QueryClient in
// src/app/(app)/layout.tsx retried a delivery-config PUT/DELETE that is refused by role, and every
// consumer branching on `kind === "forbidden"` was unreachable for the two mutations that redirect
// where a supplier's future orders are sent.
//
// The sentence itself must not move. It is written for the reader and thrown ALONE — no
// `API error 403:` prefix, no `serverReason` — so the first test below pins the one thing wrapping
// could have broken: `ApiHttpError`'s constructor runs `operatorSafeApiMessage`, which returns
// plain non-markup prose byte-for-byte.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The REAL `ApiHttpError` class has to survive this mock. `classifyApiFailure` asks
// `err instanceof ApiHttpError`, and vitest keys a module mock on the resolved path — a
// hand-written stub here would hand delivery.ts a DIFFERENT class from the one apiFailure.ts
// imports, and every assertion below would then pass or fail for the wrong reason.
// `importOriginal` keeps exactly one identity; only auth and the base URL are replaced
// (`authHeader` otherwise waits up to 5s for a Clerk that never loads under vitest).
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
import { upsertDeliveryConfig, deleteDeliveryConfig } from "./delivery";
import type { UpsertDeliveryConfigRequest } from "./types";
import { classifyApiFailure, shouldRetryApiFailure } from "@/lib/apiFailure";
import { orgAdminMessage } from "@/lib/planGate";
import { operatorSafeApiMessage } from "@/lib/serverText";

/** What `RequireOrgAdminAttribute` answers with: the machine code plus its own sentence. */
const ORG_ADMIN_BODY = {
  error: "requires_org_admin",
  message: "Only an organisation administrator can change delivery configuration.",
};

const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = vi.fn(
    async () =>
      new Response(JSON.stringify(ORG_ADMIN_BODY), {
        status: 403,
        statusText: "Forbidden",
        headers: { "Content-Type": "application/json" },
      }),
  ) as unknown as typeof fetch;
});

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
  throw new Error("expected the delivery-config call to reject on a 403");
}

describe("delivery config — organisation-admin refusal", () => {
  it("survives ApiHttpError's constructor byte-for-byte", () => {
    // The precondition that makes wrapping safe at all. `operatorSafeApiMessage` runs on every
    // ApiHttpError message; a rewrite here would silently change operator-facing copy.
    expect(operatorSafeApiMessage(orgAdminMessage(), 403)).toBe(orgAdminMessage());
    expect(new ApiHttpError(orgAdminMessage(), 403).message).toBe(orgAdminMessage());
  });

  it("classifies a refused PUT as forbidden, not as a dropped connection", async () => {
    const err = await refusalFrom(() =>
      upsertDeliveryConfig("sup-1", {} as UpsertDeliveryConfigRequest),
    );

    // The request really went out — otherwise this whole file could pass on an import error.
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    expect(err).toBeInstanceOf(ApiHttpError);
    expect((err as ApiHttpError).status).toBe(403);
    expect((err as Error).message).toBe(orgAdminMessage());

    const failure = classifyApiFailure(err);
    expect(failure.kind).toBe("forbidden");
    expect(failure.retryable).toBe(false);
    expect(failure.maxRetries).toBe(0);
    // The consequence the QueryClient reads: no retry of a refusal that cannot succeed.
    expect(shouldRetryApiFailure(0, err)).toBe(false);
  });

  it("classifies a refused DELETE as forbidden, not as a dropped connection", async () => {
    const err = await refusalFrom(() => deleteDeliveryConfig("sup-1"));

    expect(err).toBeInstanceOf(ApiHttpError);
    expect((err as ApiHttpError).status).toBe(403);
    expect((err as Error).message).toBe(orgAdminMessage());

    const failure = classifyApiFailure(err);
    expect(failure.kind).toBe("forbidden");
    expect(failure.retryable).toBe(false);
    expect(failure.maxRetries).toBe(0);
    expect(shouldRetryApiFailure(0, err)).toBe(false);
  });
});
