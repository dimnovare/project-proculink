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
vi.mock("./core", () => ({
  authHeader: async () => ({}),
  API_BASE_URL: "http://api.test",
  USE_MOCK: false,
}));

import { suggestMappingFields, heuristicSuggestFields } from "./mapping";

const COLUMNS = ["po_number", "item_code", "qty", "unit_price"];

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
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
