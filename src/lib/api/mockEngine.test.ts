import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./core", async (importOriginal) => ({ ...(await importOriginal<typeof import("./core")>()), isApiMockMode: true }));

import { listFlows } from "./documents";
import { MOCK_ENGINE_IDS, mockEngineFetch, resetMockEngine } from "./mockEngine";
import { pageTotal } from "../pageTotal";
import type { DocumentDelivery, DocumentDetail, DocumentPage, DocumentSummary, Flow } from "./documents";

beforeEach(resetMockEngine);

describe("mock engine", () => {
  it("serves the flows and filters documents by flow", async () => {
    const flows = await mockEngineFetch<Flow[]>("/flows");
    expect(flows.map((f) => f.id)).toEqual(expect.arrayContaining([MOCK_ENGINE_IDS.flow, MOCK_ENGINE_IDS.setupFlow]));
    const docs = await mockEngineFetch<DocumentSummary[]>(`/documents?flowId=${MOCK_ENGINE_IDS.flow}`);
    expect(docs.length).toBeGreaterThan(0);
    expect(docs.every((d) => d.flowId === MOCK_ENGINE_IDS.flow)).toBe(true);
  });

  it("pages documents newest first, by several statuses and by when they were sent; only pages carry row facts", async () => {
    const needs = await mockEngineFetch<DocumentPage>("/documents?status=needs_review,ready&page=1&pageSize=2");
    expect([needs.totalCount, needs.items.length, needs.page, needs.pageSize]).toEqual([3, 2, 1, 2]);
    expect(needs.items.map((d) => d.id)).toEqual(["doc-5", "doc-2"]);
    expect(needs.items.every((d) => Array.isArray(d.checks) && "number" in d && "stop" in d)).toBe(true);
    expect((await mockEngineFetch<DocumentPage>("/documents?status=sent&sentFrom=2026-06-01T00:00:00Z&page=1&pageSize=1")).totalCount).toBe(1);
    expect((await mockEngineFetch<DocumentPage>("/documents?status=received,reading,sending&page=1&pageSize=1")).totalCount).toBe(0);
    const stopped = await mockEngineFetch<DocumentPage>("/documents?status=send_failed&page=1&pageSize=20");
    expect(stopped.items[0].stop).toEqual({ destinationId: "dest-1", destination: "Accounting inbox", error: "The mailbox refused the message." });
    const bare = await mockEngineFetch<DocumentSummary[]>("/documents");
    expect(bare.some((d) => "checks" in d || "stop" in d)).toBe(false);
    expect((await mockEngineFetch<DocumentPage>("/documents?status=&page=1&pageSize=20")).totalCount).toBe(7);
    await expect(mockEngineFetch("/documents?q=x")).rejects.toThrow('does not implement "q"');
  });

  it("remembers edits and sends for the page load, re-checks, and refuses like the server", async () => {
    const patch = (body: unknown) => mockEngineFetch<DocumentDetail>("/documents/doc-1/values", { method: "PATCH", body: JSON.stringify(body) });
    const before = await mockEngineFetch<DocumentDetail>("/documents/doc-1");
    expect(before.checks.filter((c) => !c.passed).map((c) => [c.code, c.fieldKey])).toEqual([["low_confidence", "date"], ["required_missing", "supplier"]]);
    const after = await patch({ fields: [{ key: "supplier", value: "Example Supplier Ltd" }, { key: "date", value: "2026-05-20" }] });
    expect(after.summary.status).toBe("ready");
    expect(after.read.fields.find((f) => f.key === "supplier")).toMatchObject({ value: "Example Supplier Ltd", confidence: 1, edited: true });
    const needs = await mockEngineFetch<DocumentPage>("/documents?status=needs_review,ready&page=1&pageSize=50");
    expect(needs.items.find((d) => d.id === "doc-1")).toMatchObject({ status: "ready", failedChecks: 0, checks: [] });
    await expect(patch({})).rejects.toMatchObject({ status: 400 });
    await expect(patch({ fields: [{ key: "nope", value: "x" }] })).rejects.toMatchObject({ status: 400 });
    await expect(patch({ note: "x" })).rejects.toThrow(/unknown edit key/);
    await expect(mockEngineFetch("/documents/doc-5/send", { method: "POST" })).rejects.toMatchObject({ status: 409, body: { error: "no_outputs" } });
    expect((await mockEngineFetch<DocumentDelivery[]>("/documents/doc-1/send", { method: "POST" }))[0].status).toBe("delivered");
    expect((await mockEngineFetch<DocumentDetail>("/documents/doc-1")).summary.status).toBe("sent");
    expect(pageTotal(await mockEngineFetch<DocumentPage>("/documents?status=needs_review,ready&page=1&pageSize=1"))).toBe(2);
    await expect(patch({ fields: [{ key: "supplier", value: "x" }] })).rejects.toMatchObject({ status: 409, body: { error: "document_sent" } });
    await expect(mockEngineFetch("/documents/doc-1/send", { method: "POST" })).rejects.toMatchObject({ status: 409, body: { error: "not_ready" } });
  });

  it("rejects a path with no fixture instead of returning an empty success", async () => {
    await expect(mockEngineFetch("/nope")).rejects.toThrow("no fixture for GET /nope");
  });

  it("matches the numeric restore-version route", async () => {
    const flow = await mockEngineFetch<Flow>(`/flows/${MOCK_ENGINE_IDS.flow}/versions/1/restore`, { method: "POST" });
    expect(flow.id).toBe(MOCK_ENGINE_IDS.flow);
  });

  it("answers the sample route for a flow, the same document each time, outside the list", async () => {
    const before = (await mockEngineFetch<DocumentSummary[]>("/documents")).length;
    const route = `/flows/${MOCK_ENGINE_IDS.flow}/documents/sample`;
    const doc = await mockEngineFetch<DocumentSummary>(route, { method: "POST" });
    expect([doc.flowId, doc.fileName]).toEqual([MOCK_ENGINE_IDS.flow, "invoice-2250.pdf"]);
    expect(await mockEngineFetch<DocumentSummary>(route, { method: "POST" })).toEqual(doc);
    expect((await mockEngineFetch<DocumentSummary[]>("/documents")).length).toBe(before);
  });

  it("is wired into the documents client in mock mode", async () => {
    const flows = await listFlows();
    expect(flows.map((f) => f.id)).toContain(MOCK_ENGINE_IDS.flow);
  });
});
