import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ApiHttpError } from "@/lib/api/core";
import type { DocumentSummary } from "@/lib/api/documents";
import { refusalToken } from "@/lib/documentRefusals";
import type { HeldRecord, HeldStore } from "@/lib/pwa/heldUploads";
import { canRetryUpload, INBOX_TARGET, uploadRefusalMessage, UploadQueueProvider, useUploadQueue } from "./UploadQueue";

const { uploadDocument, addDocument } = vi.hoisted(() => ({
  uploadDocument: vi.fn<(flowId: string, file: File) => Promise<DocumentSummary>>(), addDocument: vi.fn<(file: File) => Promise<DocumentSummary>>(),
}));
vi.mock("@/lib/api/documents", () => ({ uploadDocument, addDocument }));
const who = { owner: null as { userId: string; orgId: string } | null };

const FLOW = { id: "f1", name: "Supplier invoices", scansOn: true, formatsOn: false };
const file = (name: string, size = 1) => new File([new Uint8Array(size)], name);
const summary = (id: string, name: string): DocumentSummary => ({
  id, flowId: FLOW.id, flowName: FLOW.name, fileName: name, status: "received", statusReason: null, pageCount: null,
  billingUnits: 1, failedChecks: 0, createdAt: "2026-05-20T09:00:00Z", source: "upload", sourceRef: null,
});
const mount = (opts: { store?: HeldStore | null } = {}) => {
  const qc = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}><UploadQueueProvider owner={who.owner} {...opts}>{children}</UploadQueueProvider></QueryClientProvider>
  );
  return { ...renderHook(() => useUploadQueue(), { wrapper }), qc };
};

/** An in-memory device store: `claim` grants each key once until released. */
function fakeStore(records: HeldRecord[] = []) {
  const map = new Map(records.map((r) => [r.key, r]));
  const owned = new Set<string>();
  const releases = new Map<string, ReturnType<typeof vi.fn>>();
  return {
    map,
    all: vi.fn(async () => [...map.values()]),
    put: vi.fn(async (r: HeldRecord) => { map.set(r.key, r); }),
    remove: vi.fn(async (key: string) => { map.delete(key); }),
    clear: vi.fn(async () => map.clear()),
    claim: vi.fn(async (key: string) => {
      if (owned.has(key) || !map.has(key)) return null;
      owned.add(key);
      const release = vi.fn(() => { owned.delete(key); });
      releases.set(key, release);
      return release;
    }),
    claimedElsewhere: (key: string) => owned.add(key),
    released: (key: string) => releases.get(key)!.mock.invocationCallOrder[0],
  };
}
const record = (key: string, f: { userId: string; orgId: string; name?: string }): HeldRecord => ({
  key, userId: f.userId, orgId: f.orgId, flowId: FLOW.id, flowName: FLOW.name, file: file(f.name ?? `${key}.pdf`), heldAt: "2026-05-20T09:00:00Z",
});

let onLine: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  uploadDocument.mockReset();
  addDocument.mockReset();
  localStorage.clear();
  who.owner = { userId: "u-alex", orgId: "o-1" };
  onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
});
afterEach(() => onLine.mockRestore());

describe("upload queue", () => {
  it("uploads one file at a time, refuses a wrong kind or an oversize file without asking the server, and refreshes every documents list", async () => {
    const answers: Array<(d: DocumentSummary) => void> = [];
    uploadDocument.mockImplementation(() => new Promise((resolve) => answers.push(resolve)));
    const { result, qc } = mount();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    act(() => result.current.add([file("a.pdf"), file("notes.zip"), file("big.pdf", 10 * 1024 * 1024 + 1), file("b.csv")], FLOW));
    const item = (name: string) => result.current.items.find((i) => i.file.name === name)!;
    expect(result.current.items.map((i) => i.file.name)).toEqual(["b.csv", "big.pdf", "notes.zip", "a.pdf"]);
    expect(uploadRefusalMessage(item("notes.zip").error)).toBe("This file type can't be read.");
    expect(uploadRefusalMessage(item("big.pdf").error)).toBe("This file is too large.");
    await waitFor(() => expect(item("a.pdf").state).toBe("uploading"));
    expect(item("b.csv").state).toBe("waiting");
    expect(uploadDocument).toHaveBeenCalledTimes(1);
    await act(async () => answers[0](summary("d-a", "a.pdf")));
    await waitFor(() => expect(uploadDocument).toHaveBeenCalledTimes(2));
    expect(uploadDocument.mock.calls.map(([flowId, f]) => [flowId, f.name])).toEqual([["f1", "a.pdf"], ["f1", "b.csv"]]);
    expect(item("a.pdf")).toMatchObject({ state: "done", document: { id: "d-a" } });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["documents"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["flows"] });
  });

  it("a file with no flow goes to the workspace, and a file for a flow still goes to that flow", async () => {
    addDocument.mockResolvedValue(summary("d-in", "statement-0412.pdf"));
    uploadDocument.mockResolvedValue(summary("d-f", "invoice-2292.pdf"));
    const { result } = mount();
    act(() => { result.current.add([file("statement-0412.pdf")], INBOX_TARGET({})); result.current.add([file("invoice-2292.pdf")], FLOW); });
    await waitFor(() => expect(result.current.items.every((i) => i.state === "done")).toBe(true));
    expect(addDocument.mock.calls.map(([f]) => f.name)).toEqual(["statement-0412.pdf"]);
    expect(uploadDocument.mock.calls.map(([flowId, f]) => [flowId, f.name])).toEqual([["f1", "invoice-2292.pdf"]]);
    expect(addDocument.mock.invocationCallOrder[0]).toBeLessThan(uploadDocument.mock.invocationCallOrder[0]);
  });

  it("after a plan refusal the files still waiting are not sent; a passing problem can be tried again, once", async () => {
    uploadDocument
      .mockRejectedValueOnce(new ApiHttpError("slow", 429, { error: "Rate limit exceeded. Please slow down and retry shortly." }))
      .mockRejectedValueOnce(new ApiHttpError("too large", 413, { error: "file_too_large" }))
      .mockResolvedValueOnce(summary("d-e", "e.pdf"))
      .mockRejectedValueOnce(new ApiHttpError("ended", 429, { error: "pilot_expired", plan: "pilot", limit: 20, upgradeUrl: "/settings" }));
    const { result } = mount();
    const item = (name: string) => result.current.items.find((i) => i.file.name === name)!;
    act(() => result.current.add([file("a.pdf"), file("d.pdf"), file("e.pdf")], FLOW));
    await waitFor(() => expect(item("e.pdf").state).toBe("done"));        // a refusal about one file leaves the others going
    expect(uploadRefusalMessage(item("d.pdf").error)).toBe("This file is too large.");
    expect(uploadRefusalMessage(item("a.pdf").error)).toBe("Too many files at once. Wait a minute, then try this one again.");
    expect(canRetryUpload(item("a.pdf").error)).toBe(true);
    act(() => result.current.add([file("b.pdf"), file("c.pdf")], FLOW));
    await waitFor(() => expect(item("c.pdf").state).toBe("refused"));
    expect(uploadDocument).toHaveBeenCalledTimes(4);                        // c.pdf cost no request
    expect(refusalToken(item("c.pdf").error)).toBe("pilot_expired");
    expect(canRetryUpload(item("b.pdf").error)).toBe(false);
    act(() => result.current.add([file("f.pdf")], FLOW));
    expect(refusalToken(item("f.pdf").error)).toBe("pilot_expired");       // after a stop, a new file costs no request either
    expect(uploadDocument).toHaveBeenCalledTimes(4);
    uploadDocument.mockResolvedValue(summary("d-a", "a.pdf"));
    act(() => { result.current.retry(item("a.pdf").key); result.current.retry(item("a.pdf").key); });
    await waitFor(() => expect(item("a.pdf").state).toBe("done"));
    expect(uploadDocument).toHaveBeenCalledTimes(5);
    act(() => result.current.retry(item("b.pdf").key));
    expect(item("b.pdf").state).toBe("refused");
  });

  it("holds a file while offline and sends it once when the connection returns", async () => {
    const store = fakeStore();
    onLine.mockReturnValue(false);
    const { result } = mount({ store });
    act(() => { result.current.add([file("delivery-note-78.jpg")], FLOW); });
    await waitFor(() => expect(result.current.items[0].state).toBe("held"));
    expect(uploadDocument).not.toHaveBeenCalled();
    expect([...store.map.values()]).toMatchObject([{ userId: "u-alex", orgId: "o-1", flowId: FLOW.id, flowName: FLOW.name }]);
    uploadDocument.mockResolvedValue(summary("d1", "delivery-note-78.jpg"));
    onLine.mockReturnValue(true);
    act(() => { window.dispatchEvent(new Event("online")); window.dispatchEvent(new Event("online")); });
    await waitFor(() => expect(result.current.items[0].state).toBe("done"));
    expect(uploadDocument).toHaveBeenCalledTimes(1);
    expect(uploadDocument).toHaveBeenCalledWith(FLOW.id, expect.any(File));
    expect(store.map.size).toBe(0);
    // no store on this browser: refused in words, never held in memory
    const { result: r2 } = mount({ store: null });
    onLine.mockReturnValue(false);
    act(() => { r2.current.add([file("b.pdf")], FLOW); });
    await waitFor(() => expect(r2.current.items[0].state).toBe("refused"));
    expect(uploadRefusalMessage(r2.current.items[0].error)).toBe("You're offline, and this browser can't keep the file until you're back. Add it again when you're online.");
    expect(canRetryUpload(r2.current.items[0].error)).toBe(true);
  });

  it("never sends another person's or another workspace's held file, and leaves a file another tab owns", async () => {
    const store = fakeStore([
      record("k-sam", { userId: "u-sam", orgId: "o-1" }), record("k-other-ws", { userId: "u-alex", orgId: "o-2" }),
      record("k-busy", { userId: "u-alex", orgId: "o-1" }), record("k-mine", { userId: "u-alex", orgId: "o-1" }),
    ]);
    store.claimedElsewhere("k-busy");
    uploadDocument.mockResolvedValue(summary("d1", "mine.pdf"));
    const { result, unmount } = mount({ store });
    await waitFor(() => expect(uploadDocument).toHaveBeenCalledTimes(1));
    expect(store.map.has("k-sam")).toBe(false);        // deleted, not sent
    expect(store.map.has("k-other-ws")).toBe(true);    // waits for its own workspace
    expect(store.map.has("k-busy")).toBe(true);        // another tab is sending it
    expect(result.current.items.map((i) => i.key)).toEqual(["k-mine"]);
    unmount();
    who.owner = null;                                  // signed out: nothing is sent
    const signedOut = fakeStore([record("k-later", { userId: "u-alex", orgId: "o-1" })]);
    mount({ store: signedOut });
    await act(async () => { window.dispatchEvent(new Event("online")); });
    await act(async () => {});
    expect(uploadDocument).toHaveBeenCalledTimes(1);
    expect(signedOut.map.has("k-later")).toBe(true);
  });

  it("a held file refused on arrival says why on its row, in the server's words, and leaves the device", async () => {
    const store = fakeStore([record("k-1", { userId: "u-alex", orgId: "o-1", name: "empty.pdf" })]);
    uploadDocument.mockRejectedValue(new ApiHttpError("unprocessable", 422, { error: "unreadable_file" }));
    const { result } = mount({ store });
    await waitFor(() => expect(result.current.items[0]?.state).toBe("refused"));
    expect(uploadRefusalMessage(result.current.items[0].error)).toBe("This file couldn't be opened. It may be password-protected or damaged.");
    expect(store.map.size).toBe(0);
    expect(store.remove.mock.invocationCallOrder[0]).toBeLessThan(store.released("k-1"));
  });

  it("a held file the server could not take right now goes up on Try again", async () => {
    const store = fakeStore([record("k-1", { userId: "u-alex", orgId: "o-1", name: "scan.jpg" })]);
    uploadDocument.mockRejectedValueOnce(new ApiHttpError("unavailable", 503, null)).mockResolvedValueOnce(summary("d1", "scan.jpg"));
    const { result } = mount({ store });
    await waitFor(() => expect(result.current.items[0]?.state).toBe("refused"));
    expect(store.map.size).toBe(0);                    // any server answer takes it off the device
    expect(canRetryUpload(result.current.items[0].error)).toBe(true);
    act(() => result.current.retry("k-1"));
    await waitFor(() => expect(result.current.items[0].state).toBe("done"));
    expect(uploadDocument).toHaveBeenCalledTimes(2);
  });
});
