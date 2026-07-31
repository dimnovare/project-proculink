import { describe, test, expect } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { ApiHttpError, retryAfterFrom } from "./api/core";
import {
  AUTH_RACE_RETRIES,
  AUTH_RETRY_DELAY_MS,
  MAX_HONOURED_WAIT_SECONDS,
  apiRetryDelayMs,
  classifyApiFailure,
  isRequestTimeout,
  isSignedOutFailure,
  shouldRetryApiFailure,
} from "./apiFailure";

// ─────────────────────────────────────────────────────────────────────────────
// WP-19 — 401, 404 and 429 stop being the same failure.
//
// The whole app ran `retry: 1`. One policy, so the three codes that need
// different treatment all got the same wrong one: 404 and 403 bought a pointless
// round trip before showing the same answer, 401 got one attempt to ride out a
// race that needs three, and 429 was retried instantly against a window that had
// not moved — making the one self-clearing failure look permanent.
//
// The last test runs the policy through a REAL QueryClient rather than asserting
// on the predicate alone, because the substantive risk is not the branch table:
// it is whether `failureCount` is 0-based, which it IS — and that is not what the
// predicate was first written against. It shipped as `<= maxRetries`, ran a 401
// five times instead of four, and only the QueryClient test could see it.
// ─────────────────────────────────────────────────────────────────────────────

/** An ApiHttpError as the api layer throws it. */
function httpError(status: number, body: unknown = null, retryAfter: number | null = null) {
  return new ApiHttpError(`request failed: ${status}`, status, body, retryAfter);
}

describe("every status gets the treatment its cause deserves", () => {
  test.each([
    [401, "auth_expired", true, AUTH_RACE_RETRIES],
    [403, "forbidden", false, 0],
    [404, "not_found", false, 0],
    [408, "unreachable", true, 1],
    [409, "conflict", false, 0],
    [422, "invalid", false, 0],
    [429, "rate_limited", true, 2],
    [500, "server", true, 1],
    [503, "server", true, 1],
  ] as const)("%i → %s (retryable=%s, retries=%i)", (status, kind, retryable, maxRetries) => {
    const f = classifyApiFailure(httpError(status));
    expect(f.kind).toBe(kind);
    expect(f.retryable).toBe(retryable);
    expect(f.maxRetries).toBe(maxRetries);
    expect(f.status).toBe(status);
  });

  test("a 403 carrying a plan-gate code is an upsell, not a permission wall", () => {
    const gated = httpError(403, { error: "cxml_requires_operations", upgradeUrl: "/settings" });
    expect(classifyApiFailure(gated).kind).toBe("plan_gate");
    // Still not retryable — the plan does not change between two round trips.
    expect(classifyApiFailure(gated).retryable).toBe(false);
    // …and a bare 403 must NOT be mislabelled as one.
    expect(classifyApiFailure(httpError(403, { error: "Forbidden" })).kind).toBe("forbidden");
  });

  test("anything that never reached the API is retryable, not permanent", () => {
    for (const err of [
      new Error("Failed to fetch"),
      new Error("Request timed out after 8000ms"),
      undefined,
      null,
      "a string nobody typed on purpose",
    ]) {
      const f = classifyApiFailure(err);
      expect(f.kind).toBe("unreachable");
      expect(f.retryable).toBe(true);
      expect(f.status).toBeNull();
    }
  });

  test("a timeout is distinguishable from an offline browser, even sharing a policy", () => {
    expect(isRequestTimeout(new Error("Request timed out after 8000ms"))).toBe(true);
    expect(isRequestTimeout(new Error("Failed to fetch"))).toBe(false);
    expect(isRequestTimeout(httpError(500))).toBe(false);
  });

  test("only a real 401 says the person is signed out", () => {
    expect(isSignedOutFailure(httpError(401))).toBe(true);
    expect(isSignedOutFailure(httpError(403))).toBe(false);
    expect(isSignedOutFailure(new Error("Failed to fetch"))).toBe(false);
  });
});

describe("the wait is read from wherever the server put it", () => {
  test("a numeric Retry-After header", () => {
    const res = { headers: new Headers({ "Retry-After": "42" }) } as Response;
    expect(retryAfterFrom(res, null)).toBe(42);
  });

  test("an HTTP-date Retry-After header", () => {
    const at = new Date(Date.now() + 30_000).toUTCString();
    const res = { headers: new Headers({ "Retry-After": at }) } as Response;
    const seconds = retryAfterFrom(res, null);
    expect(seconds).toBeGreaterThanOrEqual(28);
    expect(seconds).toBeLessThanOrEqual(31);
  });

  test("the body field, which is what survives a cross-origin fetch", () => {
    // Retry-After is not CORS-safelisted. The app and the API are different
    // origins in every deployed environment, so the body is the reliable carrier.
    expect(retryAfterFrom(null, { error: "Rate limit exceeded.", retryAfterSeconds: 17 })).toBe(17);
  });

  test("absent or nonsense reads as UNKNOWN, never as zero", () => {
    expect(retryAfterFrom(null, null)).toBeNull();
    expect(retryAfterFrom(null, { error: "no wait here" })).toBeNull();
    expect(retryAfterFrom({ headers: new Headers() } as Response, null)).toBeNull();
    expect(retryAfterFrom({ headers: new Headers({ "Retry-After": "soon" }) } as Response, null)).toBeNull();
    // The distinction that matters: unknown must not become an instant retry.
    expect(apiRetryDelayMs(0, httpError(429))).toBeGreaterThan(0);
  });

  test("ApiHttpError picks the wait out of its own body when not given one", () => {
    const err = httpError(429, { retryAfterSeconds: 9 });
    expect(err.retryAfterSeconds).toBe(9);
    expect(classifyApiFailure(err).retryAfterSeconds).toBe(9);
  });
});

describe("the delay honours the server, within reason", () => {
  test("a named wait wins over the backoff curve", () => {
    expect(apiRetryDelayMs(0, httpError(429, null, 30))).toBe(30_000);
    // …and it wins even on a later attempt, where backoff alone would be shorter.
    expect(apiRetryDelayMs(3, httpError(429, null, 5))).toBe(5_000);
  });

  test("an unreasonable wait is capped so the UI never becomes a long spinner", () => {
    expect(apiRetryDelayMs(0, httpError(429, null, 3600))).toBe(MAX_HONOURED_WAIT_SECONDS * 1000);
  });

  test("with no named wait it is the exponential backoff we already had", () => {
    expect(apiRetryDelayMs(0, httpError(500))).toBe(1000);
    expect(apiRetryDelayMs(1, httpError(500))).toBe(2000);
    expect(apiRetryDelayMs(2, httpError(500))).toBe(4000);
    expect(apiRetryDelayMs(20, httpError(500))).toBe(30_000);
  });

  test("a 401 polls quickly instead of backing off — it is waiting for a token", () => {
    // Exponential backoff over three attempts would make a genuinely signed-out
    // person wait ~7s to be told to sign in. The token either arrives at once or
    // never, so the curve is flat and short.
    expect(apiRetryDelayMs(0, httpError(401))).toBe(AUTH_RETRY_DELAY_MS);
    expect(apiRetryDelayMs(2, httpError(401))).toBe(AUTH_RETRY_DELAY_MS);
    const worstCase = AUTH_RACE_RETRIES * AUTH_RETRY_DELAY_MS;
    expect(worstCase).toBeLessThan(2000);
  });
});

describe("the retry predicate counts the way TanStack Query counts", () => {
  // failureCount is the number of retries ALREADY made — 0 on the first ask.
  // This was assumed to be 1-based and it is not; the QueryClient test below is
  // what proved it, after the predicate quietly ran a 401 five times.
  test("a 401 is allowed exactly three retries, then stops", () => {
    expect(shouldRetryApiFailure(0, httpError(401))).toBe(true);
    expect(shouldRetryApiFailure(2, httpError(401))).toBe(true);
    expect(shouldRetryApiFailure(3, httpError(401))).toBe(false);
  });

  test("a 404 is never retried — the second answer is the first answer", () => {
    expect(shouldRetryApiFailure(0, httpError(404))).toBe(false);
  });

  test("a 403 is never retried", () => {
    expect(shouldRetryApiFailure(0, httpError(403))).toBe(false);
  });

  test("a 500 keeps the single retry the app has always had", () => {
    expect(shouldRetryApiFailure(0, httpError(500))).toBe(true);
    expect(shouldRetryApiFailure(1, httpError(500))).toBe(false);
  });
});

describe("driven by a real QueryClient, not just asserted about", () => {
  /** Run a query that always fails with `err` and report how many times it ran. */
  async function attemptsFor(err: unknown): Promise<number> {
    let calls = 0;
    const qc = new QueryClient({
      defaultOptions: {
        queries: {
          retry: shouldRetryApiFailure,
          // Keep the SHAPE of the real wiring but collapse the wait, so the test
          // measures attempt counting rather than wall-clock backoff.
          retryDelay: () => 0,
        },
      },
    });
    try {
      await qc.fetchQuery({
        queryKey: ["apiFailure-probe", String(calls), Math.random()],
        queryFn: async () => {
          calls += 1;
          throw err;
        },
      });
    } catch {
      /* expected — every probe fails */
    } finally {
      qc.clear();
    }
    return calls;
  }

  test("404 runs once; 401 runs four times; 500 runs twice", async () => {
    expect(await attemptsFor(httpError(404))).toBe(1);
    expect(await attemptsFor(httpError(403))).toBe(1);
    expect(await attemptsFor(httpError(401))).toBe(1 + AUTH_RACE_RETRIES);
    expect(await attemptsFor(httpError(500))).toBe(2);
    expect(await attemptsFor(httpError(429, null, 0))).toBe(3);
  });

  test("the old flat policy would have given every one of them exactly two", async () => {
    // The control that makes the numbers above mean something: under `retry: 1`
    // all five collapse to 2, which is the defect stated as a measurement.
    const flat = async (err: unknown) => {
      let calls = 0;
      const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, retryDelay: () => 0 } } });
      try {
        await qc.fetchQuery({
          queryKey: ["flat-probe", Math.random()],
          queryFn: async () => {
            calls += 1;
            throw err;
          },
        });
      } catch {
        /* expected */
      } finally {
        qc.clear();
      }
      return calls;
    };
    for (const status of [401, 403, 404, 429, 500]) {
      expect(await flat(httpError(status))).toBe(2);
    }
  });
});
