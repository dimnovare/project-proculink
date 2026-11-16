import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./core")>();
  return { ...actual, authHeader: async () => ({}), API_BASE_URL: "http://api.test", isApiMockMode: false };
});

import { addDocument, createSampleDocument, downloadDocument, editDocumentValues, getDocument, getFlow, getInbox, getSortFlows, listActivity, listDocumentPage, moveDocument, newInboxAddress, sendDocument, setUpDocument, updateLookup, uploadDocument } from "./documents";
import { ApiHttpError } from "./core";

const fetchMock = vi.fn();
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

beforeEach(() => vi.stubGlobal("fetch", fetchMock));
afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe("documents api", () => {
  it("uploadDocument posts FormData to the flow without a JSON content type", async () => {
    fetchMock.mockResolvedValue(json({ id: "d1", fileName: "a.csv" }));
    const file = new File(["x"], "a.csv", { type: "text/csv" });

    await uploadDocument("f1", file);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/flows\/f1\/documents$/);
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get("file")).toBeInstanceOf(File);
    expect(Object.keys(init.headers ?? {}).map((h) => h.toLowerCase())).not.toContain("content-type");
  });

  it("asks the inbox routes with the server's verbs and bodies", async () => {
    fetchMock.mockImplementation(async () => json({}));
    await getInbox();
    await newInboxAddress();
    await addDocument(new File(["x"], "invoice-2292.pdf"));
    await moveDocument("doc-1", "flow-1");
    await setUpDocument("doc-1");
    await downloadDocument("doc-1", "csv");
    await getSortFlows("doc-1");
    const calls = fetchMock.mock.calls.map(([url, init]) => [
      init?.method ?? "GET", new URL(String(url)).pathname, init?.body instanceof FormData ? "FormData" : init?.body,
    ]);
    expect(calls).toEqual([
      ["GET", "/api/inbox", undefined], ["POST", "/api/inbox/new-address", undefined], ["POST", "/api/documents", "FormData"],
      ["POST", "/api/documents/doc-1/move", '{"flowId":"flow-1"}'], ["POST", "/api/documents/doc-1/set-up", "{}"],
      ["POST", "/api/documents/doc-1/download", '{"format":"csv"}'], ["GET", "/api/documents/doc-1/sort-flows", undefined],
    ]);
  });

  it("createSampleDocument posts to the flow's sample path with no body", async () => {
    fetchMock.mockResolvedValue(json({ id: "d1", fileName: "invoice-2250.pdf" }));

    const out = await createSampleDocument("f1");

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/flows\/f1\/documents\/sample$/);
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
    expect(out.fileName).toBe("invoice-2250.pdf");
  });

  it("editDocumentValues PATCHes the edit body and returns the detail", async () => {
    const detail = { summary: { id: "d1" }, contentType: "text/csv", read: {}, checks: [] };
    fetchMock.mockResolvedValue(json(detail));
    const edits = { fields: [{ key: "total", value: "10" }] };

    const out = await editDocumentValues("d1", edits);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/documents\/d1\/values$/);
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual(edits);
    expect(out).toEqual(detail);
  });

  it("sendDocument posts to send", async () => {
    fetchMock.mockResolvedValue(json([]));

    await sendDocument("d1");

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/documents\/d1\/send$/);
    expect(init.method).toBe("POST");
  });

  it("listDocumentPage asks for one page with a comma-joined status list", async () => {
    fetchMock.mockResolvedValue(json({ items: [], totalCount: 0, page: 2, pageSize: 50 }));
    await listDocumentPage({ status: ["needs_review", "ready"], sentFrom: "2026-06-01T00:00:00.000Z", page: 2, pageSize: 50 });
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toBe("/api/documents");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      status: "needs_review,ready", sentFrom: "2026-06-01T00:00:00.000Z", page: "2", pageSize: "50",
    });
  });

  it("sends the search term with the page, and nothing for it when it is not given", async () => {
    fetchMock.mockImplementation(async () => json({ items: [], totalCount: 0, page: 1, pageSize: 5 }));
    await listDocumentPage({ q: "INV-1", page: 1, pageSize: 5 });
    expect(new URL(String(fetchMock.mock.calls[0][0])).search).toBe("?q=INV-1&page=1&pageSize=5");
    await listDocumentPage({ page: 1, pageSize: 5 });
    expect(new URL(String(fetchMock.mock.calls[1][0])).searchParams.has("q")).toBe(false);
  });

  it("encodes path segments and refuses dot segments", async () => {
    fetchMock.mockResolvedValue(json({}));
    await getFlow("a/b");
    expect(String(fetchMock.mock.calls[0][0])).toContain("/flows/a%2Fb");
    await expect((async () => getDocument(".."))()).rejects.toThrow("Invalid id");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("updateLookup PUTs the whole table", async () => {
    fetchMock.mockResolvedValue(json({ id: "L1" }));
    const body = { name: "Item codes", entries: [{ from: "BLT-10", to: "A-7" }] };

    await updateLookup("L1", body);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/lookups\/L1$/);
    expect(init.method).toBe("PUT");
    expect(init.body).toBe('{"name":"Item codes","entries":[{"from":"BLT-10","to":"A-7"}]}');
  });

  it("a 503 carries the Retry-After header's wait, which a ProblemDetails body does not", async () => {
    // The new-org / transient-DB 503 sends the wait in the header only (exposed by CORS).
    const problem = { type: "about:blank", title: "Service Unavailable", status: 503 };
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(problem), { status: 503, headers: { "Retry-After": "2" } }),
    );

    const err = await getFlow("f1").catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiHttpError);
    expect((err as ApiHttpError).retryAfterSeconds).toBe(2);
  });

  it("listActivity sends the server's parameters", async () => {
    const body = { events: [], total: 0, page: 2, pageSize: 50 };
    fetchMock.mockResolvedValue(json(body));

    const out = await listActivity({ page: 2, pageSize: 50, actions: ["document.delivered", "flow.published"], q: "inv 1" });

    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "http://api.test/api/audit?page=2&pageSize=50&actions=document.delivered&actions=flow.published&q=inv+1",
    );
    expect(out).toEqual(body);
  });
});
