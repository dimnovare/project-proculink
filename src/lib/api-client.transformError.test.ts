import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// POST /api/orders/{id}/transform — a refusal reads as a sentence, not as a response body.
//
// WP-29 put a button on this endpoint in the inbox row, and the row's failure line is
// `Couldn't start ${po} — ${err.message}`. The client threw `res.text()` verbatim, so the
// operator read:
//
//   Couldn't start PO-2026-0341 — Transform failed: {"error":"Order is not ready to
//   transform (status 'delivering'). A transform can start from a ready order, one whose
//   last transform failed, or one the supplier rejected; re-resolve its lines to return it
//   to 'ready'."}
//
// The sentence inside is written FOR the operator and tells them what to do; the braces and
// the quoted key are ours. This is the defect WP-23 (831fad1) fixed on /resolve and
// /accept-ai-suggestions, and it added `parseApiErrorBody` for exactly this — WP-29 branched
// before that landed and did not route through it.
//
// Three refusals, three different obligations:
//   409 — TEMPORARY hold ("wait for the send to finish"). Status must survive, so a caller
//         can offer retry rather than a dead end.
//   422 — unresolved lines. Terminal until the order is corrected on the review screen.
//   403 — a PLAN GATE, whose body is a machine token `<capability>_requires_<plan>`, never a
//         sentence. CLAUDE.md §11.5 forbids matching it by literal (the plan segment is
//         derived server-side from the gate table), so it goes through isPlanGateError /
//         planGateMessage and the upgradeUrl rides along on `.body`.

const ORDER_ID = "0a2f7f1e-1c2b-4a55-9a70-9f0d1f4bd001";

/** The backend's own words (OrderStatusMachine's non-transformable message). */
const DELIVERING_SENTENCE =
  "Order is not ready to transform (status 'delivering'). A transform can start from a ready "
  + "order, one whose last transform failed, or one the supplier rejected; re-resolve its lines "
  + "to return it to 'ready'.";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  // authHeader() polls for window.Clerk for up to 5s before giving up; a loaded stub with
  // no session short-circuits it to "no Authorization header".
  (window as unknown as { Clerk: unknown }).Clerk = { loaded: true };
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as unknown as { Clerk?: unknown }).Clerk;
});

/** The endpoint reads its failure body with res.text(), not res.json(). */
function textResponse(status: number, body: string) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    text: async () => body,
    json: async () => JSON.parse(body) as unknown,
  } as unknown as Response;
}

async function transformError(res: Response) {
  const { apiClient } = await import("./api-client");
  fetchMock.mockResolvedValue(res);
  return apiClient.transformOrder(ORDER_ID).then(
    () => { throw new Error("expected transformOrder to reject"); },
    (e: unknown) => e as Error & { status?: number; body?: unknown },
  );
}

describe("transformOrder surfaces the backend's sentence, never the raw body", () => {
  it("409 — the sentence only, with the status kept for a retryable hold", async () => {
    const err = await transformError(
      textResponse(409, JSON.stringify({ error: DELIVERING_SENTENCE, status: "delivering" })),
    );
    expect(err.message).toBe(DELIVERING_SENTENCE);
    // The three tells of a leaked response body.
    expect(err.message).not.toContain("{");
    expect(err.message).not.toContain('"error"');
    expect(err.message).not.toContain("Transform failed:");
    // 409 is temporary; 400 would be terminal. Flattening both to Error loses that.
    expect(err.status).toBe(409);
    expect((err.body as { status?: string })?.status).toBe("delivering");
  });

  it("422 — the unresolved-lines sentence, not `Unresolved lines: {…}`", async () => {
    const sentence = "3 line(s) still need a supplier item code. Resolve them, then send again.";
    const err = await transformError(textResponse(422, JSON.stringify({ error: sentence })));
    expect(err.message).toBe(sentence);
    expect(err.message).not.toContain("Unresolved lines:");
    expect(err.status).toBe(422);
  });

  it("403 — a plan-gate CODE becomes a sentence naming the plan the server asked for", async () => {
    const err = await transformError(
      textResponse(403, JSON.stringify({ error: "transform_requires_growth", upgradeUrl: "/settings?tab=billing" })),
    );
    // Never the snake_case token in front of a customer.
    expect(err.message).not.toContain("transform_requires_growth");
    expect(err.message).toContain("Growth");
    expect(err.status).toBe(403);
    // The upgradeUrl the SERVER named survives on the body, so a banner links where that
    // particular gate is lifted instead of at a hardcoded guess.
    expect((err.body as { upgradeUrl?: string })?.upgradeUrl).toBe("/settings?tab=billing");
  });

  it("a plan gate for a DIFFERENT tier names that tier — never a hardcoded literal", async () => {
    // CLAUDE.md §11.5: the plan segment is derived server-side, so a client that matched
    // the code by full literal would silently stop matching the day a feature is re-tiered.
    // Two codes, two plans, one code path. Sequential on purpose — one shared fetch mock.
    for (const [code, plan] of [
      ["transform_requires_operations", "Operations"],
      ["transform_requires_distributor", "Distributor"],
    ]) {
      const err = await transformError(textResponse(403, JSON.stringify({ error: code })));
      expect(err.message, code).toContain(plan);
      expect(err.message, code).not.toContain(code);
    }
  });

  it("a non-JSON body still produces a readable line rather than an empty message", async () => {
    const err = await transformError(textResponse(502, "<html>Bad Gateway</html>"));
    // The fallback is COPY — rendered verbatim by the review screen and the order
    // workshop. It said "Transform failed", the retired engine-stage name for the
    // state whose badge now reads "Couldn't build output" (G4). The assertion moved
    // with the wording; what it pins is unchanged — a non-JSON body must still yield
    // a readable sentence, not an empty message and not the raw body alone.
    expect(err.message).toContain("couldn't build the output file");
    expect(err.message).not.toContain("Transform failed");
    expect(err.message).toContain("Bad Gateway");
    expect(err.status).toBe(502);
  });

  it("a 403 that is NOT a plan gate keeps its own sentence", async () => {
    const sentence = "You do not have access to this order.";
    const err = await transformError(textResponse(403, JSON.stringify({ error: sentence })));
    expect(err.message).toBe(sentence);
  });
});
