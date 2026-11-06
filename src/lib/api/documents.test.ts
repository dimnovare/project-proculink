import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./core")>();
  return { ...actual, authHeader: async () => ({}), API_BASE_URL: "http://api.test", isApiMockMode: false };
});

import { editDocumentValues, uploadDocument } from "./documents";

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
});
