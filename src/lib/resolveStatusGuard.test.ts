import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The resolve status guard — the client half of WP-23 (backend PR dimnovare/ProcuLink#99).
//
// POST /api/orders/{id}/resolve and POST /api/orders/{id}/accept-ai-suggestions END with
// the SAME status recompute (`Status = Lines.Any(NeedsReview) ? pending_review : ready`),
// so the backend now refuses BOTH with 409 from a status that recompute would destroy:
//
//   unrouted   → the recompute lifts the order out of the routing hold with SupplierId
//                still null, and assign-supplier claims atomically on `Status == Unrouted`
//                — so the order becomes permanently unroutable.
//   delivering → the recompute writes straight over a live dispatch claim.
//
// Body: { error: "<plain-language sentence>", status: "<status>" }.
//
// 409 is NOT 400 here, and the difference is load-bearing. 400 is the TERMINAL refusal
// ("there is nothing here to correct; upload a corrected file as a new order"); 409 is
// TEMPORARY ("wait for the step to finish, then retry"). The client must therefore keep
// the status code — a plain Error flattens a retryable hold into a dead end — and must
// unwrap the sentence, because the pre-WP-23 client unwrapped `{ error }` only on 400 and
// dumped the raw JSON body straight into the operator's toast on anything else.

const ORDER_ID = "0a2f7f1e-1c2b-4a55-9a70-9f0d1f4bd001";

// The backend's own words (OrderStatusMachine.ResolveHoldMessage).
const UNROUTED_SENTENCE =
  "This order is still waiting to be routed. Route it first, then make your corrections — "
  + "correcting it now would take it out of the routing queue while it still has nowhere to go.";
const DELIVERING_SENTENCE =
  "This order is being sent right now, so it cannot be corrected mid-send. "
  + "Wait for the send to finish, then correct it and send it again.";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  // authHeader() polls for window.Clerk for up to 5s before giving up; a loaded
  // stub with no session short-circuits it to "no Authorization header".
  (window as unknown as { Clerk: unknown }).Clerk = { loaded: true };
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as unknown as { Clerk?: unknown }).Clerk;
});

/** Both endpoints read the failure body with res.text(), not res.json(). */
function textResponse(status: number, body: string) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    text: async () => body,
    json: async () => JSON.parse(body) as unknown,
  } as unknown as Response;
}

/** The exact shape WP-23 returns: the sentence plus the machine-readable status token. */
function holdResponse(status: string, sentence: string) {
  return textResponse(409, JSON.stringify({ error: sentence, status }));
}

describe("resolvePurchaseOrder — a 409 hold reads as a sentence, not as JSON", () => {
  it("surfaces the backend's sentence for an unrouted order and never the raw body", async () => {
    const { apiClient } = await import("./api-client");
    fetchMock.mockResolvedValue(holdResponse("unrouted", UNROUTED_SENTENCE));

    const err = await apiClient
      .resolvePurchaseOrder(ORDER_ID, { lineResolutions: [], saveMappings: true })
      .catch((e: unknown) => e);

    expect((err as Error).message).toBe(UNROUTED_SENTENCE);
    // The pre-WP-23 failure mode, frozen: `Resolution failed: {"error":"…","status":"unrouted"}`.
    expect((err as Error).message).not.toMatch(/[{}]/);
    expect((err as Error).message).not.toContain('"error"');
    expect((err as Error).message).not.toContain("Resolution failed");
  });

  it("keeps the 409 so the UI can tell a temporary hold from a terminal refusal", async () => {
    const { apiClient, ApiHttpError } = await import("./api-client");
    fetchMock.mockResolvedValue(holdResponse("delivering", DELIVERING_SENTENCE));

    const err = await apiClient
      .resolvePurchaseOrder(ORDER_ID, { lineResolutions: [], saveMappings: true })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiHttpError);
    expect((err as InstanceType<typeof ApiHttpError>).status).toBe(409);
    expect((err as Error).message).toBe(DELIVERING_SENTENCE);
  });

  it("carries the parsed body so a caller can branch on which status is holding it", async () => {
    const { apiClient, ApiHttpError } = await import("./api-client");
    fetchMock.mockResolvedValue(holdResponse("unrouted", UNROUTED_SENTENCE));

    const err = await apiClient
      .resolvePurchaseOrder(ORDER_ID, { lineResolutions: [], saveMappings: true })
      .catch((e: unknown) => e);

    // `unrouted` is the one hold with a real next action (route it), so the token has
    // to survive the transport for the UI to offer that action rather than "try later".
    expect((err as InstanceType<typeof ApiHttpError>).body).toMatchObject({ status: "unrouted" });
  });

  it("still unwraps a 400 validation sentence, unchanged", async () => {
    const { apiClient } = await import("./api-client");
    fetchMock.mockResolvedValue(
      textResponse(400, JSON.stringify({ error: "At least one line resolution or header correction is required." })),
    );

    const err = await apiClient
      .resolvePurchaseOrder(ORDER_ID, { lineResolutions: [], saveMappings: true })
      .catch((e: unknown) => e);

    expect((err as Error).message).toBe("At least one line resolution or header correction is required.");
  });

  it("falls back to the raw text on a status that carries no JSON error body", async () => {
    const { apiClient } = await import("./api-client");
    fetchMock.mockResolvedValue(textResponse(500, "Internal Server Error"));

    const err = await apiClient
      .resolvePurchaseOrder(ORDER_ID, { lineResolutions: [], saveMappings: true })
      .catch((e: unknown) => e);

    expect((err as Error).message).toContain("Internal Server Error");
  });

  it("does not choke on a 409 whose body is not JSON", async () => {
    const { apiClient, ApiHttpError } = await import("./api-client");
    fetchMock.mockResolvedValue(textResponse(409, ""));

    const err = await apiClient
      .resolvePurchaseOrder(ORDER_ID, { lineResolutions: [], saveMappings: true })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiHttpError);
    expect((err as InstanceType<typeof ApiHttpError>).status).toBe(409);
  });
});

describe("acceptAiSuggestions — the same hold, through the other door", () => {
  it("surfaces the sentence rather than the raw body", async () => {
    const { apiClient } = await import("./api-client");
    fetchMock.mockResolvedValue(holdResponse("unrouted", UNROUTED_SENTENCE));

    const err = await apiClient.acceptAiSuggestions(ORDER_ID, 0).catch((e: unknown) => e);

    expect((err as Error).message).toBe(UNROUTED_SENTENCE);
    expect((err as Error).message).not.toMatch(/[{}]/);
    expect((err as Error).message).not.toContain("accept-ai-suggestions failed");
  });

  it("keeps the 409 and the status token", async () => {
    const { apiClient, ApiHttpError } = await import("./api-client");
    fetchMock.mockResolvedValue(holdResponse("delivering", DELIVERING_SENTENCE));

    const err = await apiClient.acceptAiSuggestions(ORDER_ID, 0).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiHttpError);
    expect((err as InstanceType<typeof ApiHttpError>).status).toBe(409);
    expect((err as InstanceType<typeof ApiHttpError>).body).toMatchObject({ status: "delivering" });
  });

  it("still reports a non-JSON failure body", async () => {
    const { apiClient, ApiHttpError } = await import("./api-client");
    fetchMock.mockResolvedValue(textResponse(500, "Internal Server Error"));

    const err = await apiClient.acceptAiSuggestions(ORDER_ID, 0).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiHttpError);
    expect((err as Error).message).toContain("Internal Server Error");
  });
});
