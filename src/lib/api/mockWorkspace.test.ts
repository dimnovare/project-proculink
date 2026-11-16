import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockEngineFetch } from "./mockEngine";
import { MAX_UPLOAD_BYTES } from "../fileKinds";
import type { DocumentDetail, DocumentPage, DocumentSummary, Flow } from "./documents";

beforeEach(() => {
  sessionStorage.setItem("proculink.mock.workspace", "new");
  sessionStorage.removeItem("proculink.mock.state");
});
afterEach(() => sessionStorage.clear());

describe("empty-workspace mock", () => {
  it("walks an empty workspace from a new flow to a stored file, and keeps it across a reload", async () => {
    expect(await mockEngineFetch("/flows")).toEqual([]);
    const flow = await mockEngineFetch<Flow>("/flows", { method: "POST", body: JSON.stringify({ name: "New flow" }) });
    const first = await mockEngineFetch<DocumentSummary>(`/flows/${flow.id}/documents/sample`, { method: "POST" });
    const again = await mockEngineFetch<DocumentSummary>(`/flows/${flow.id}/documents/sample`, { method: "POST" });
    expect(again.id).toBe(first.id);
    expect((await mockEngineFetch<DocumentDetail>(`/documents/${first.id}`)).summary.status).toBe("reading");
    const read = await mockEngineFetch<DocumentDetail>(`/documents/${first.id}`);
    expect(read.summary.status).toBe("needs_review");
    expect(read.read?.fields).toHaveLength(9);
    const page = await mockEngineFetch<DocumentPage>(`/documents?flowId=${flow.id}&page=1&pageSize=20`);
    expect(page.items.map((r) => [r.id, r.isSample])).toEqual([[first.id, true]]);
    await expect(mockEngineFetch(`/documents?flowId=${flow.id}&bogus=1`)).rejects.toThrow(/does not implement "bogus"/);
    // A reload is a new module state: what was saved is read back from sessionStorage.
    vi.resetModules();
    const fresh = await import("./mockEngine");
    expect((await fresh.mockEngineFetch<Flow[]>("/flows")).map((f) => f.id)).toEqual([flow.id]);
    // With the mode off the default fixtures answer exactly as before.
    sessionStorage.removeItem("proculink.mock.workspace");
    expect((await fresh.mockEngineFetch<Flow[]>("/flows")).map((f) => f.id)).toEqual(["flow-1", "flow-2", "flow-3", "flow-4"]);
    expect((await fresh.mockEngineFetch<DocumentPage>("/documents?page=1&pageSize=50")).totalCount).toBe(7);
  });

  it("refuses like the server: kind, size, the trial limit, the flow cap, and nothing to publish", async () => {
    const flow = await mockEngineFetch<Flow>("/flows", { method: "POST", body: JSON.stringify({ name: "New flow" }) });
    const up = (f: File) => { const b = new FormData(); b.append("file", f); return mockEngineFetch(`/flows/${flow.id}/documents`, { method: "POST", body: b }); };
    await expect(up(new File(["x"], "notes.docx"))).rejects.toMatchObject({ status: 415, body: { error: "unsupported_format" } });
    await expect(up(new File([new Uint8Array(MAX_UPLOAD_BYTES + 1)], "big.pdf"))).rejects.toMatchObject({ status: 413 });
    sessionStorage.setItem("proculink.mock.refuse", "pilot_expired");
    await expect(mockEngineFetch(`/flows/${flow.id}/documents/sample`, { method: "POST" }))
      .rejects.toMatchObject({ status: 429, body: { error: "pilot_expired", plan: "pilot", limit: 20, upgradeUrl: "/settings" } });
    await mockEngineFetch("/flows", { method: "POST", body: JSON.stringify({ name: "Second" }) });
    await expect(mockEngineFetch("/flows", { method: "POST", body: JSON.stringify({ name: "Third" }) }))
      .rejects.toMatchObject({ status: 429, body: { error: "flow_limit_reached" } });
    await mockEngineFetch(`/flows/${flow.id}/publish`, { method: "POST" });
    await expect(mockEngineFetch(`/flows/${flow.id}/publish`, { method: "POST" })).rejects.toMatchObject({ status: 409, body: { error: "nothing_to_publish" } });
  });

  it("answers an empty inbox and fails loudly on the rest", async () => {
    expect(await mockEngineFetch("/inbox")).toMatchObject({ flowId: "ws-inbox", address: null });
    const body = new FormData();
    body.append("file", new File(["x"], "invoice-2292.pdf"));
    await expect(mockEngineFetch("/documents", { method: "POST", body })).rejects.toThrow("the inbox is not implemented");
    await expect(mockEngineFetch("/documents/doc-1/move", { method: "POST", body: "{}" })).rejects.toThrow("the inbox is not implemented");
  });
});
