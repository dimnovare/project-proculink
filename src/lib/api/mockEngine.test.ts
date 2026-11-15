import { describe, expect, it, vi } from "vitest";

vi.mock("./core", async (importOriginal) => ({ ...(await importOriginal<typeof import("./core")>()), isApiMockMode: true }));

import { listFlows } from "./documents";
import { MOCK_ENGINE_IDS, mockEngineFetch } from "./mockEngine";
import type { ActivityResult, DocumentSummary, Flow } from "./documents";

describe("mock engine", () => {
  it("serves the flows and filters documents by flow", async () => {
    const flows = await mockEngineFetch<Flow[]>("/flows");
    expect(flows.map((f) => f.id)).toEqual(expect.arrayContaining([MOCK_ENGINE_IDS.flow, MOCK_ENGINE_IDS.setupFlow]));
    const docs = await mockEngineFetch<DocumentSummary[]>(`/documents?flowId=${MOCK_ENGINE_IDS.flow}`);
    expect(docs.length).toBeGreaterThan(0);
    expect(docs.every((d) => d.flowId === MOCK_ENGINE_IDS.flow)).toBe(true);
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

  it("/audit is served like the server", async () => {
    const audit = (query: string) => mockEngineFetch<ActivityResult>(`/audit?${query}`);
    const all = await audit("page=1&pageSize=50");
    expect([all.total, all.events.length]).toEqual([61, 50]);
    expect(all.events[0].ts >= all.events[1].ts).toBe(true);
    const exact = await audit("page=1&pageSize=50&actions=InvoiceDestinationChanged");
    const lower = await audit("page=1&pageSize=50&actions=invoicedestinationchanged");
    expect([exact.total, lower.total]).toEqual([1, 0]);
    const found = await audit("page=1&pageSize=50&q=invoice-1003");
    expect(found.events.length).toBeGreaterThan(0);
    expect(found.events.some((e) => e.action === "flow.published")).toBe(false);
    const beyond = await audit("page=9&pageSize=50");
    expect([beyond.events, beyond.total]).toEqual([[], 61]);
    await expect(audit("orderId=x")).rejects.toThrow('mock engine: GET /audit does not implement "orderId"');
    const all200 = (await audit("page=1&pageSize=200")).events;
    const failed = all200.find((e) => e.action === "document.delivery_failed" && e.documentId === "doc-4")!;
    const send = all200.find((e) => e.action === "document.sent" && e.documentId === "doc-4")!;
    expect([failed.actorId, failed.startedAt]).toEqual(["user_member_a", send.ts]);
    const admin = all200.find((e) => e.action.startsWith("admin."))!;
    expect(admin.payload).not.toHaveProperty("by");
  });
});
