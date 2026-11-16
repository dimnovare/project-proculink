import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./core", async (importOriginal) => ({ ...(await importOriginal<typeof import("./core")>()), isApiMockMode: true }));

import { listFlows } from "./documents";
import { MOCK_DOCUMENT_NUMBER, MOCK_ENGINE_IDS, mockEngineFetch, resetMockEngine } from "./mockEngine";
import { pageTotal } from "../pageTotal";
import type { ActivityResult, Destination, DocumentDelivery, DocumentDetail, DocumentPage, DocumentSummary, Flow, FlowOutput, Lookup, LookupSummary, SetUpResult } from "./documents";
import type { ApiHttpError } from "./core";

beforeEach(resetMockEngine);

const INBOX_FLAG = "proculink.mock.inbox";
/** A fresh mock engine that seeds the inbox states (the flag is read once, when the module loads). The caller removes the flag. */
const withInbox = async () => {
  sessionStorage.setItem(INBOX_FLAG, "on");
  vi.resetModules();
  return (await import("./mockEngine")).mockEngineFetch;
};

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
    await expect(mockEngineFetch("/documents?zzz=x")).rejects.toThrow('does not implement "zzz"');
  });

  it("searches documents by file name or number like the server, and counts the matches", async () => {
    const search = (q: string) => mockEngineFetch<DocumentPage>(`/documents?q=${encodeURIComponent(q)}&page=1&pageSize=5`);
    const byName = await search("INVOICE-1002");
    expect([byName.items.map((d) => d.id), byName.totalCount]).toEqual([["doc-2"], 1]);
    const spaced = MOCK_DOCUMENT_NUMBER.toLowerCase().replace("-", " -");         // "inv -1001": spaces and case ignored, matched on the number only
    expect((await search(spaced)).items.map((d) => d.id)).toEqual(["doc-1"]);
    const blank = await search("  ");
    expect([blank.totalCount, blank.items.map((d) => d.id)]).toEqual([7, ["doc-7", "doc-6", "doc-5", "doc-4", "doc-3"]]);
    expect(await search("nothing-like-this")).toMatchObject({ items: [], totalCount: 0 });
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

  it("answers the sample route for a flow, the same document each time, and lists it as a sample", async () => {
    const route = `/flows/${MOCK_ENGINE_IDS.flow}/documents/sample`;
    const a = await mockEngineFetch<DocumentSummary>(route, { method: "POST" });
    const b = await mockEngineFetch<DocumentSummary>(route, { method: "POST" });
    expect(b.id).toBe(a.id);
    const page = await mockEngineFetch<DocumentPage>(`/documents?flowId=${MOCK_ENGINE_IDS.flow}&page=1&pageSize=50`);
    expect(page.items.filter((r) => r.id === a.id).map((r) => r.isSample)).toEqual([true]);
  });

  it("serves destinations like the server: by name, what uses each, the last send, refusals, and what waits on one", async () => {
    const list = await mockEngineFetch<Destination[]>("/destinations");
    expect(list.map((d) => d.name)).toEqual(["Accounting API", "Accounting inbox", "Accounting server"]);
    expect(list.map((d) => [d.usedBy.length, d.lastSend?.kind ?? null, d.lastSend?.ok ?? null])).toEqual([[0, "test", true], [1, "document", false], [0, null, null]]);
    const saved = await mockEngineFetch<Destination>("/destinations/dest-1", {
      method: "PUT", body: JSON.stringify({ name: "Books", protocol: "email", config: { toAddresses: "books@example.test" }, credentials: { password: "x" } }),
    });
    expect(saved).not.toHaveProperty("credentials");
    expect([saved.name, saved.usedBy.length, saved.hasCredentials]).toEqual(["Books", 1, true]);
    await expect(mockEngineFetch("/destinations/dest-1", { method: "DELETE" })).rejects.toMatchObject({ status: 409, body: { error: "destination_in_use" } });
    await expect(mockEngineFetch("/destinations/nope", { method: "DELETE" })).rejects.toMatchObject({ status: 404 });
    expect(await mockEngineFetch("/destinations/dest-3/test", { method: "POST" })).toEqual({ success: false, message: "The server refused the login.", responseCode: null });
    expect((await mockEngineFetch<Destination[]>("/destinations")).map((d) => [d.name, d.lastSend?.kind ?? null, d.lastSend?.ok ?? null]))
      .toEqual([["Accounting API", "test", true], ["Accounting server", "test", false], ["Books", "document", false]]);
    const waiting = (id: string) => mockEngineFetch<DocumentPage>(`/documents?waitingOnDestination=${id}&page=1&pageSize=50`);
    expect([(await waiting("dest-1")).totalCount, (await waiting("dest-1")).items.map((d) => d.id), (await waiting("dest-2")).totalCount]).toEqual([1, ["doc-4"], 0]);
    await mockEngineFetch("/documents/doc-4/send", { method: "POST" });
    expect((await waiting("dest-1")).totalCount).toBe(0);
    const made = await mockEngineFetch<Destination>("/destinations", {
      method: "POST", body: JSON.stringify({ name: "Archive", protocol: "email", config: { toAddresses: "archive@example.test" }, credentials: null }),
    });
    expect(await mockEngineFetch(`/destinations/${made.id}/test`, { method: "POST" })).toMatchObject({ success: true });
    await mockEngineFetch("/destinations/dest-3", { method: "DELETE" });
    expect((await mockEngineFetch<Destination[]>("/destinations")).map((d) => d.name)).toEqual(["Accounting API", "Archive", "Books"]);
  });

  it("is wired into the documents client in mock mode", async () => {
    const flows = await listFlows();
    expect(flows.map((f) => f.id)).toContain(MOCK_ENGINE_IDS.flow);
  });

  it("answers an upload like the server: a new document that is then read, a held second copy, and the server's refusals", async () => {
    const post = (name: string, content: BlobPart[] = ["x"]) => {
      const body = new FormData();
      body.append("file", new File(content, name));
      return mockEngineFetch<DocumentSummary>(`/flows/${MOCK_ENGINE_IDS.flow}/documents`, { method: "POST", body });
    };
    const doc = await post("invoice-2292.csv");
    expect(doc).toMatchObject({ fileName: "invoice-2292.csv", flowId: MOCK_ENGINE_IDS.flow, flowName: "Supplier invoices", status: "received", source: "upload" });
    expect("checks" in doc).toBe(false);
    expect((await mockEngineFetch<DocumentPage>("/documents?page=1&pageSize=1")).items[0]).toMatchObject({ id: doc.id, status: "reading" });
    expect(await post("invoice-2292.csv")).toMatchObject({ status: "needs_review", statusReason: "duplicate_file" });
    await expect(post("notes.zip")).rejects.toMatchObject({ status: 415, body: { error: "unsupported_format" } });
    await expect(post("empty.pdf", [])).rejects.toMatchObject({ status: 422, body: { error: "unreadable_file" } });
    await expect(post("big.pdf", [new Uint8Array(10 * 1024 * 1024 + 1)])).rejects.toMatchObject({ status: 413, body: { error: "file_too_large" } });
    await new Promise((r) => setTimeout(r, 1600));
    const read = (await mockEngineFetch<DocumentPage>("/documents?page=1&pageSize=20")).items.find((d) => d.id === doc.id);
    expect(read?.status).toBe("ready");
    expect((await mockEngineFetch<Flow[]>("/flows")).every((f) => f.scansOn && f.formatsOn)).toBe(true);
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

it("answers nothing while the browser is offline, as the network would", async () => {
  const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  await expect(mockEngineFetch("/documents")).rejects.toThrow(new TypeError("Failed to fetch"));
  onLine.mockRestore();
});

it("sorts a document added without a flow, and answers move, set-up and download like the server", { timeout: 20_000 }, async () => {
  const add = (name: string) => { const body = new FormData(); body.append("file", new File(["x"], name)); return mockEngineFetch<DocumentSummary>("/documents", { method: "POST", body }); };
  const [inv, note, odd] = [await add("invoice-2301.pdf"), await add("delivery-note-88.pdf"), await add("scan-1.pdf")];
  expect(inv).toMatchObject({ flowId: "flow-inbox", flowName: "New documents", status: "received" });
  await new Promise((r) => setTimeout(r, 1600));
  const rows = (await mockEngineFetch<DocumentPage>("/documents?page=1&pageSize=20")).items;
  const by = (id: string) => rows.find((d) => d.id === id)!;
  expect(by(inv.id)).toMatchObject({ flowId: MOCK_ENGINE_IDS.flow, kind: "Invoice", inInbox: false, status: "needs_review", statusReason: null });
  expect(by(note.id)).toMatchObject({ flowName: "Delivery notes", statusReason: "check_sort", inInbox: false });
  expect(by(odd.id)).toMatchObject({ flowId: "flow-inbox", kind: null, statusReason: "new_kind", inInbox: true });
  await expect(mockEngineFetch(`/documents/${odd.id}/move`, { method: "POST", body: '{"flowId":"flow-inbox"}' })).rejects.toMatchObject({ status: 404, body: { error: "flow_not_found" } });
  await expect(mockEngineFetch(`/documents/${odd.id}/download`, { method: "POST", body: '{"format":"pdf"}' }, "blob")).rejects.toMatchObject({ status: 400, body: { error: "invalid_format" } });
  expect(await mockEngineFetch(`/documents/${odd.id}/download`, { method: "POST", body: '{"format":"csv"}' }, "blob")).toBeInstanceOf(Blob);
  expect(await mockEngineFetch(`/documents/${odd.id}/download`, { method: "POST", body: '{"format":"xlsx"}' }, "blob")).toBeInstanceOf(Blob);
  const history = await mockEngineFetch<{ action: string }[]>(`/documents/${odd.id}/history`);
  expect(history.filter((h) => h.action === "document.downloaded")).toHaveLength(1);
  await expect(mockEngineFetch(`/documents/${odd.id}/set-up`, { method: "POST", body: "{}" })).rejects.toMatchObject({ status: 409, body: { error: "not_movable" } }); // downloaded: sent
  await expect(mockEngineFetch(`/documents/${inv.id}/set-up`, { method: "POST", body: "{}" })).rejects.toMatchObject({ status: 409, body: { error: "not_in_inbox" } });
  await expect(mockEngineFetch("/flows/flow-inbox/outputs")).rejects.toMatchObject({ status: 404 });
  expect((await mockEngineFetch<Flow[]>("/flows")).some((f) => f.id === "flow-inbox")).toBe(false);
  expect(await mockEngineFetch(`/documents/${note.id}/move`, { method: "POST", body: `{"flowId":"${MOCK_ENGINE_IDS.flow}"}` })).toMatchObject({ flowName: "Supplier invoices", status: "received" });

  // The seeded inbox states, behind the session flag (read once per page load).
  const f = await withInbox();
  try {
    const seeded = (await f<DocumentPage>("/documents?page=1&pageSize=50")).items.filter((d) => d.id.startsWith("doc-in-"));
    expect(seeded.map((d) => [d.id, d.status, d.statusReason, d.inInbox])).toEqual([
      ["doc-in-1", "needs_review", "new_kind", true], ["doc-in-2", "needs_review", "choose_flow", true], ["doc-in-3", "needs_review", "check_sort", false],
      ["doc-in-4", "sent", "downloaded", true], ["doc-in-5", "read_failed", "unreadable_file", true], ["doc-in-6", "needs_review", "duplicate_file", true],
      ["doc-in-7", "sent", null, false],
    ]);
    expect(await f("/documents/doc-in-2/sort-flows")).toEqual([{ id: "flow-4", name: "Remittance advices" }, { id: "flow-1", name: "Supplier invoices" }]);
    expect((await f<DocumentDetail>("/documents/doc-in-6")).summary).not.toHaveProperty("inInbox");
    await expect(f("/documents/doc-in-6/set-up", { method: "POST", body: "{}" })).rejects.toMatchObject({ status: 409, body: { error: "not_movable" } });
    expect(await f("/documents/doc-in-2/move", { method: "POST", body: '{"flowId":"flow-4"}' })).toMatchObject({ status: "needs_review", statusReason: "duplicate_file" });
    await expect(f("/documents/doc-in-1/set-up", { method: "POST", body: '{"name":"  "}' })).rejects.toMatchObject({ status: 400, body: { error: "invalid_name" } });
    const made = await f<SetUpResult>("/documents/doc-in-1/set-up", { method: "POST", body: '{"name":"Supplier invoices"}' });
    expect(made).toMatchObject({ flowName: "Supplier invoices 2", document: { flowId: made.flowId, status: "received" } });
    expect((await f<FlowOutput[]>(`/flows/${made.flowId}/outputs`)).map((o) => [o.name, o.format, o.destinationId])).toEqual([["CSV file", "csv", null]]);
    // The next statement from the same sender is sorted, certain, into the flow a person made for the first one.
    const body = new FormData();
    body.append("file", new File(["x"], "statement-0413.pdf"));
    const next = await f<DocumentSummary>("/documents", { method: "POST", body });
    await new Promise((r) => setTimeout(r, 1600));
    expect((await f<DocumentDetail>(`/documents/${next.id}`)).summary).toMatchObject({ flowId: made.flowId, status: "needs_review", statusReason: null });
    expect((await f<DocumentDetail>("/documents/doc-in-1")).summary).toMatchObject({ flowId: made.flowId, status: "needs_review", statusReason: null });
  } finally {
    sessionStorage.removeItem(INBOX_FLAG);
  }
});

it("a person's Send confirms a sort we weren't sure of: accepted, the reason cleared, and no second sort row", { timeout: 20_000 }, async () => {
  const f = await withInbox();
  try {
    const body = new FormData();
    body.append("file", new File(["x"], "delivery-note-61.pdf"));
    const added = await f<DocumentSummary>("/documents", { method: "POST", body });
    await new Promise((r) => setTimeout(r, 1600));
    const sorted = await f<DocumentDetail>(`/documents/${added.id}`);
    expect(sorted.summary).toMatchObject({ flowId: MOCK_ENGINE_IDS.setupFlow, statusReason: "check_sort" });
    // A changed value does not make a sort we were not sure of ready: it waits for the person, as the server does.
    const edited = await f<DocumentDetail>(`/documents/${added.id}/values`, { method: "PATCH", body: JSON.stringify({ fields: [{ key: sorted.read.fields[0].key, value: "Changed" }] }) });
    expect(edited.summary).toMatchObject({ status: "needs_review", statusReason: "check_sort" });
    await f(`/documents/${added.id}/send`, { method: "POST" });
    expect((await f<DocumentDetail>(`/documents/${added.id}`)).summary).toMatchObject({ status: "sent", statusReason: null });
    const history = await f<{ action: string }[]>(`/documents/${added.id}/history`);
    expect(history.filter((h) => h.action === "document.sorted")).toHaveLength(1);
  } finally {
    sessionStorage.removeItem(INBOX_FLAG);
  }
});