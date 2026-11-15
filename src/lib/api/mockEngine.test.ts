import { describe, expect, it, vi } from "vitest";

vi.mock("./core", async (importOriginal) => ({ ...(await importOriginal<typeof import("./core")>()), isApiMockMode: true }));

import { listFlows } from "./documents";
import { MOCK_ENGINE_IDS, mockEngineFetch } from "./mockEngine";
import type { DocumentSummary, Flow, Lookup, LookupSummary } from "./documents";
import type { ApiHttpError } from "./core";

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

  it("serves lookups like the server: order, refusals, remembered writes and a delete refused while in use", async () => {
    const list = await mockEngineFetch<LookupSummary[]>("/lookups");
    expect(list.map((l) => [l.name, l.count, l.usedBy?.map((u) => u.flowName)])).toEqual(
      [["Country codes", 4, []], ["Item codes", 120, ["Supplier invoices"]], ["Pallet types", 0, []], ["Units of measure", 2, []]]);
    const refused = (p: Promise<unknown>) => p.then(() => null, (e: ApiHttpError) => [e.status, (e.body as { error: string; detail?: string })]);
    const put = (id: string, body: object) => mockEngineFetch(`/lookups/${id}`, { method: "PUT", body: JSON.stringify(body) });
    expect(await refused(put("lookup-2", { name: "Units", entries: [{ from: "KS-1", to: "a" }, { from: " ks-1 ", to: "b" }] })))
      .toEqual([422, { error: "lookup_invalid", detail: "'ks-1' appears more than once." }]);
    expect(await refused(put("lookup-2", { name: " ", entries: [] }))).toEqual([422, { error: "lookup_invalid", detail: "The name must be 1 to 120 characters." }]);
    await put("lookup-2", { name: "Units", entries: [{ from: " PCS ", to: "EA " }] });
    expect(await mockEngineFetch<Lookup>("/lookups/lookup-2")).toMatchObject({ name: "Units", entries: [{ from: "PCS", to: "EA " }] });
    const made = await mockEngineFetch<Lookup>("/lookups", { method: "POST", body: JSON.stringify({ name: "supplier-codes", entries: [{ from: "KS-100", to: "NT-1" }] }) });
    expect((await mockEngineFetch<LookupSummary[]>("/lookups")).map((l) => l.name)).toContain("supplier-codes");
    expect(await refused(mockEngineFetch(`/lookups/${MOCK_ENGINE_IDS.lookup}`, { method: "DELETE" }))).toEqual([409, { error: "lookup_in_use" }]);
    await mockEngineFetch(`/lookups/${made.id}`, { method: "DELETE" });
    expect(await refused(mockEngineFetch(`/lookups/${made.id}`))).toEqual([404, { error: "lookup_not_found" }]);
    await expect(mockEngineFetch("/lookups?page=1")).rejects.toThrow("takes no parameters");
  });
});
