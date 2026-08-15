// A failed auto-map call must fail, not quietly answer with a different scorer.
//
// `realSuggestMappingFields` used to catch a network error, a 404, any non-OK status, an
// unparseable body and an empty payload, and answer all five with `heuristicSuggestFields` —
// a second, independently written alias table living in this file. The two are not the same
// matcher wearing two coats. They disagree on the accept floor (backend 0.45, this file 0.5),
// on the substring rule (backend requires the alias be >= 4 chars and appear INSIDE the column;
// this file also accepts the column inside the alias, with no length floor), on negative tokens
// (backend excludes "price"/"cost"/"net" from Unit; this file has no such concept), and on the
// alias tables themselves, which were written independently and are disjoint in both directions.
//
// So the swap does not merely restate the same answer at a different percentage. It changes
// WHICH columns map:
//
//   "EAN"  → backend maps it to BuyerItemCode; this file has no "ean" alias and leaves it unmapped.
//   "ID"   → backend leaves it unmapped; this file matches it inside "lineid" and maps LineNumber.
//   "PO-Nr"→ backend scores 0.633; this file scores 0.95.
//
// The operator sees `MATCH · nn%` either way (DSPrimitives.tsx) and has no way to tell which
// scorer produced it. They then save that mapping. A supplier connection ends up wrong because
// the API was slow — and the wrongness is invisible.
//
// Same reasoning as PR #210 on the format detector: a number may not be printed without the
// caller being able to say what produced it. Here the honest answer on failure is to fail, and
// let the editor offer a retry and manual mapping, which it already fully supports.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// isApiMockMode: false pins the LIVE path — the mock path legitimately keeps the local scorer.
vi.mock("@/lib/api-client", () => ({ isApiMockMode: false }));
// The REAL ApiHttpError — the whole point of the retry assertions below is that the rejection is
// one, so `classifyApiFailure` can tell a 429 from a 404 from a dropped connection.
vi.mock("./core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./core")>()),
  authHeader: async () => ({}),
  API_BASE_URL: "http://api.test",
  USE_MOCK: false,
}));

import { ApiHttpError } from "./core";
import { classifyApiFailure } from "../apiFailure";
import { suggestMappingFields, heuristicSuggestFields } from "./mapping";

const COLUMNS = ["po_number", "item_code", "qty", "unit_price"];

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("suggestMappingFields — a failed call fails", () => {
  it("rejects when the request never completes, instead of answering with the local scorer", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(suggestMappingFields("sup-1", COLUMNS)).rejects.toThrow();
  });

  it("rejects on a non-OK status, instead of answering with the local scorer", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 500));

    await expect(suggestMappingFields("sup-1", COLUMNS)).rejects.toThrow(/500/);
  });

  it("rejects on 404 rather than treating the endpoint as not yet deployed", async () => {
    // This arm was written when suggest-fields did not exist. It does:
    // ProcuLink.Api/Controllers/MappingSuggestionsController.cs:51. A 404 today means a wrong
    // supplier id or a broken route — both worth showing, neither worth guessing around.
    fetchMock.mockResolvedValue(jsonResponse({}, 404));

    await expect(suggestMappingFields("sup-1", COLUMNS)).rejects.toThrow(/404/);
  });

  it("rejects when the body cannot be parsed, instead of answering with the local scorer", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token < in JSON at position 0");
      },
    } as unknown as Response);

    await expect(suggestMappingFields("sup-1", COLUMNS)).rejects.toThrow();
  });
});

describe("suggestMappingFields — the rejection carries what the failure WAS", () => {
  // Dropping the fallback made this path throw for the first time, which hands it to the shared
  // retry policy in src/lib/apiFailure.ts. That policy branches on `ApiHttpError.status`; anything
  // else classifies as "unreachable" — retryable, one attempt, no server-named wait honoured.
  //
  // This endpoint carries [EnableRateLimiting("ai")] (MappingSuggestionsController), so a 429 is a
  // condition it really produces, and it is the one failure here guaranteed to clear on its own IF
  // the wait is respected. Throwing a plain Error would retry it immediately against a window that
  // has not moved — the exact defect WP-19 removed for every other query.

  it("rejects a rate limit as a 429 that honours the server's wait", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 429, { "retry-after": "30" }));

    const err = await suggestMappingFields("sup-1", COLUMNS).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiHttpError);
    const failure = classifyApiFailure(err);
    expect(failure.kind).toBe("rate_limited");
    expect(failure.retryAfterSeconds).toBe(30);
  });

  it("honours a wait carried in the body when the header is unreadable", async () => {
    // `retryAfterFrom` reads the wait from TWO places, and only one of them survives here. The
    // `Retry-After` header is the standard, but it is not CORS-safelisted and the app and the API
    // are different origins in every deployed environment, so script can read it only while the
    // API explicitly exposes it. The body field always survives — but ONLY if the body reaches
    // `ApiHttpError` as an object. Handing the constructor the raw response TEXT loses it in
    // silence: `"retryAfterSeconds" in body` is simply false for a string, no error, no warning.
    //
    // This endpoint carries [EnableRateLimiting("ai")] (MappingSuggestionsController), so it is
    // the one place in the app where a 429 is routinely produced and the wait matters most.
    fetchMock.mockResolvedValue(jsonResponse({ error: "slow down", retryAfterSeconds: 17 }, 429));

    const err = await suggestMappingFields("sup-1", COLUMNS).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiHttpError);
    expect(classifyApiFailure(err).retryAfterSeconds).toBe(17);
  });

  it("rejects a 404 as deterministic, so it is not retried pointlessly", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 404));

    const err = await suggestMappingFields("sup-1", COLUMNS).catch((e: unknown) => e);

    const failure = classifyApiFailure(err);
    expect(failure.kind).toBe("not_found");
    expect(failure.retryable).toBe(false);
  });

  it("rejects a 500 as a server fault, which waiting plausibly helps", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 500));

    const err = await suggestMappingFields("sup-1", COLUMNS).catch((e: unknown) => e);

    expect(classifyApiFailure(err).kind).toBe("server");
  });
});

describe("suggestMappingFields — an empty answer is an answer", () => {
  it("returns the backend's empty list rather than substituting local matches for it", async () => {
    // "nothing in this file matched a canonical field" is a real, useful verdict. Answering it
    // with a second scorer's guesses turns a considered 'no' into an unattributed 'maybe'.
    fetchMock.mockResolvedValue(jsonResponse([], 200));

    const result = await suggestMappingFields("sup-1", COLUMNS);

    expect(result).toEqual([]);
    expect(result).not.toEqual(heuristicSuggestFields(COLUMNS));
  });
});

describe("suggestMappingFields — an unscored suggestion stays unscored", () => {
  it("keeps a null confidence null rather than coercing it to 0", async () => {
    // `Number(null) || 0` is 0, and PoMappingEditor renders that as "0%" — on the same ramp
    // where 0% reads as "certainly wrong" rather than "nothing scored this". PR #210 names this
    // exact failure on the detector side ("a louder lie than the 95% this fix removed").
    fetchMock.mockResolvedValue(
      jsonResponse(
        [
          {
            canonicalField: "PoNumber",
            suggestedColumn: "po_number",
            confidence: null,
            reason: "saved supplier mapping",
            source: "heuristic",
          },
        ],
        200,
      ),
    );

    const [suggestion] = await suggestMappingFields("sup-1", COLUMNS);

    expect(suggestion.confidence).toBeNull();
  });

  it("keeps a missing confidence null rather than coercing it to 0", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        [
          {
            canonicalField: "Quantity",
            suggestedColumn: "qty",
            reason: "known alias",
            source: "heuristic",
          },
        ],
        200,
      ),
    );

    const [suggestion] = await suggestMappingFields("sup-1", COLUMNS);

    expect(suggestion.confidence).toBeNull();
  });

  it("still carries a real score through unchanged", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        [
          {
            canonicalField: "Quantity",
            suggestedColumn: "qty",
            confidence: 0.97,
            reason: "known alias",
            source: "heuristic",
          },
        ],
        200,
      ),
    );

    const [suggestion] = await suggestMappingFields("sup-1", COLUMNS);

    expect(suggestion.confidence).toBe(0.97);
  });
});

describe("heuristicSuggestFields — retained for the mock path only", () => {
  it("reports no match as null, not as a 0% score", async () => {
    const [suggestion] = heuristicSuggestFields(["totally_unrelated_column"]);

    expect(suggestion.suggestedColumn).toBeNull();
    expect(suggestion.confidence).toBeNull();
  });
});
