import { describe, expect, it, vi } from "vitest";

vi.mock("./core", async (importOriginal) => ({ ...(await importOriginal<typeof import("./core")>()), isApiMockMode: true }));

import { listFlows } from "./documents";
import { MOCK_ENGINE_IDS, mockEngineFetch } from "./mockEngine";
import type { DocumentPage, DocumentSummary, Flow } from "./documents";

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

  it("rejects a path with no fixture instead of returning an empty success", async () => {
    await expect(mockEngineFetch("/nope")).rejects.toThrow("no fixture for GET /nope");
  });

  it("matches the numeric restore-version route", async () => {
    const flow = await mockEngineFetch<Flow>(`/flows/${MOCK_ENGINE_IDS.flow}/versions/1/restore`, { method: "POST" });
    expect(flow.id).toBe(MOCK_ENGINE_IDS.flow);
  });

  it("is wired into the documents client in mock mode", async () => {
    const flows = await listFlows();
    expect(flows.map((f) => f.id)).toContain(MOCK_ENGINE_IDS.flow);
  });
});
