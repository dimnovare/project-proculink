import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// GET /api/orders/{id}/source — the four documented refusals are STATES, not exceptions.
//
// The endpoint answers 200 with bytes, or one of: 204 (no displayable file — a sample order, an
// unreadable object, or one over the serve cap), 410 (purged on the retention schedule), 404
// (unknown order, or another organisation's — deliberately indistinguishable), 429 (the shared
// download budget). None of the first three is a malfunction, and none is worth retrying, so
// each resolves to a value the screen can put a sentence next to.
//
// The trap this pins is the one the backend's own PR body flagged for the frontend: **204 is a
// 2xx**. `res.ok` is TRUE for it, so a client that branches on `res.ok` and then calls
// `res.blob()` gets a zero-byte Blob and renders it as a corrupt document — the failure looks
// like a broken file rather than an absent one.

const ORDER_ID = "0a2f7f1e-1c2b-4a55-9a70-9f0d1f4bd001";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  // authHeader() polls for window.Clerk for up to 5s; a loaded stub with no session
  // short-circuits it to "no Authorization header".
  (window as unknown as { Clerk: unknown }).Clerk = { loaded: true };
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as unknown as { Clerk?: unknown }).Clerk;
});

function response(
  status: number,
  opts: { body?: string; blob?: Blob; headers?: Record<string, string> } = {},
) {
  const headers = new Headers(opts.headers ?? {});
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    headers,
    text: async () => opts.body ?? "",
    json: async () => JSON.parse(opts.body ?? "null") as unknown,
    blob: async () => opts.blob ?? new Blob([]),
  } as unknown as Response;
}

async function getSource(res: Response) {
  const { apiClient } = await import("./api-client");
  fetchMock.mockResolvedValue(res);
  return apiClient.getOrderSource(ORDER_ID);
}

describe("getOrderSource resolves the documented refusals instead of throwing", () => {
  it("200 keeps the server's content type and the filename it exposed", async () => {
    const state = await getSource(
      response(200, {
        blob: new Blob(["a,b\n1,2"], { type: "text/csv" }),
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'inline; filename="PO-2026-0142.csv"',
        },
      }),
    );
    expect(state.kind).toBe("document");
    if (state.kind !== "document") return;
    // Parameters stripped; the type itself is the server's, never re-derived here.
    expect(state.document.contentType).toBe("text/csv");
    expect(state.document.filename).toBe("PO-2026-0142.csv");
    expect(state.document.blob.size).toBeGreaterThan(0);
  });

  it("204 is 'no document', NOT an empty document — res.ok is true for it", async () => {
    const res = response(204);
    expect(res.ok, "the trap: 204 passes an res.ok check").toBe(true);
    const blobSpy = vi.spyOn(res, "blob");

    const state = await getSource(res);
    expect(state).toEqual({ kind: "none" });
    // Reading the body at all is the defect; a 0-byte blob renders as a corrupt file.
    expect(blobSpy).not.toHaveBeenCalled();
  });

  it("410 carries the server's retention explanation through to the operator", async () => {
    const sentence =
      "This file has been purged per the organisation's data retention policy. "
      + "The order record, content hashes, provenance and audit trail are retained.";
    const state = await getSource(response(410, { body: JSON.stringify({ error: sentence }) }));
    expect(state).toEqual({ kind: "purged", message: sentence });
  });

  it("410 with an unreadable body still explains itself rather than going blank", async () => {
    const state = await getSource(response(410, { body: "<html>gateway</html>" }));
    expect(state.kind).toBe("purged");
    if (state.kind !== "purged") return;
    expect(state.message).toContain("data-retention policy");
    expect(state.message).not.toContain("<html>");
  });

  it("404 is a state, and says nothing about whether the order exists elsewhere", async () => {
    expect(await getSource(response(404))).toEqual({ kind: "missing" });
  });

  it("an empty 200 is treated as no document, not as zero bytes to render", async () => {
    const state = await getSource(
      response(200, { blob: new Blob([]), headers: { "Content-Type": "application/pdf" } }),
    );
    expect(state).toEqual({ kind: "none" });
  });
});

describe("getOrderSource throws only what should be retried", () => {
  it("429 throws with its status and Retry-After, so the shared policy can wait", async () => {
    const { apiClient, ApiHttpError } = await import("./api-client");
    fetchMock.mockResolvedValue(
      response(429, { body: JSON.stringify({ error: "Slow down" }), headers: { "Retry-After": "30" } }),
    );
    const err = await apiClient.getOrderSource(ORDER_ID).then(
      () => { throw new Error("expected getOrderSource to reject on 429"); },
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiHttpError);
    expect((err as InstanceType<typeof ApiHttpError>).status).toBe(429);
    expect((err as InstanceType<typeof ApiHttpError>).retryAfterSeconds).toBe(30);
  });

  it("5xx throws, because a server fault is the one case worth trying again", async () => {
    const { apiClient, ApiHttpError } = await import("./api-client");
    fetchMock.mockResolvedValue(response(503, { body: "" }));
    const err = await apiClient.getOrderSource(ORDER_ID).then(
      () => { throw new Error("expected getOrderSource to reject on 503"); },
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiHttpError);
    expect((err as InstanceType<typeof ApiHttpError>).status).toBe(503);
  });
});

describe("the request itself", () => {
  it("hits the source endpoint for this order", async () => {
    await getSource(response(204));
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(`/api/orders/${ORDER_ID}/source`);
  });
});
