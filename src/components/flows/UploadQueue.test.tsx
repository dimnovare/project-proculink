import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ApiHttpError } from "@/lib/api/core";
import type { DocumentSummary } from "@/lib/api/documents";
import { refusalToken } from "@/lib/documentRefusals";
import { readLastFlow } from "@/lib/lastFlow";
import { canRetryUpload, uploadRefusalMessage, UploadQueueProvider, useUploadQueue } from "./UploadQueue";

const { uploadDocument } = vi.hoisted(() => ({ uploadDocument: vi.fn<(flowId: string, file: File) => Promise<DocumentSummary>>() }));
vi.mock("@/lib/api/documents", () => ({ uploadDocument }));

const FLOW = { id: "f1", name: "Supplier invoices", scansOn: true, formatsOn: false };
const file = (name: string, size = 1) => new File([new Uint8Array(size)], name);
const summary = (id: string, name: string): DocumentSummary => ({
  id, flowId: FLOW.id, flowName: FLOW.name, fileName: name, status: "received", statusReason: null, pageCount: null,
  billingUnits: 1, failedChecks: 0, createdAt: "2026-05-20T09:00:00Z", source: "upload", sourceRef: null,
});
const mount = () => {
  const qc = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}><UploadQueueProvider>{children}</UploadQueueProvider></QueryClientProvider>
  );
  return { ...renderHook(() => useUploadQueue(), { wrapper }), qc };
};

beforeEach(() => { uploadDocument.mockReset(); localStorage.clear(); });

describe("upload queue", () => {
  it("uploads one file at a time, refuses a wrong kind or an oversize file without asking the server, and refreshes every documents list", async () => {
    const answers: Array<(d: DocumentSummary) => void> = [];
    uploadDocument.mockImplementation(() => new Promise((resolve) => answers.push(resolve)));
    const { result, qc } = mount();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    act(() => result.current.add([file("a.pdf"), file("notes.zip"), file("big.pdf", 10 * 1024 * 1024 + 1), file("b.csv")], FLOW));
    const item = (name: string) => result.current.items.find((i) => i.file.name === name)!;
    expect(result.current.items.map((i) => i.file.name)).toEqual(["b.csv", "big.pdf", "notes.zip", "a.pdf"]);
    expect(uploadRefusalMessage(item("notes.zip").error)).toBe("This file type can't be read in this flow.");
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
    expect(readLastFlow()).toBe("f1");
  });

  it("after a plan refusal the files still waiting are not sent; a passing problem can be tried again, once", async () => {
    uploadDocument
      .mockRejectedValueOnce(new ApiHttpError("slow", 429, { error: "Rate limit exceeded. Please slow down and retry shortly." }))
      .mockRejectedValueOnce(new ApiHttpError("ended", 429, { error: "pilot_expired", plan: "pilot", limit: 20, upgradeUrl: "/settings" }));
    const { result } = mount();
    const item = (name: string) => result.current.items.find((i) => i.file.name === name)!;
    act(() => result.current.add([file("a.pdf")], FLOW));
    await waitFor(() => expect(item("a.pdf").state).toBe("refused"));
    expect(uploadRefusalMessage(item("a.pdf").error)).toBe("Too many files at once. Wait a minute, then try this one again.");
    expect(canRetryUpload(item("a.pdf").error)).toBe(true);
    act(() => result.current.add([file("b.pdf"), file("c.pdf")], FLOW));
    await waitFor(() => expect(item("c.pdf").state).toBe("refused"));
    expect(uploadDocument).toHaveBeenCalledTimes(2);                        // c.pdf cost no request
    expect(refusalToken(item("c.pdf").error)).toBe("pilot_expired");
    expect(canRetryUpload(item("b.pdf").error)).toBe(false);
    uploadDocument.mockResolvedValue(summary("d-a", "a.pdf"));
    act(() => { result.current.retry(item("a.pdf").key); result.current.retry(item("a.pdf").key); });
    await waitFor(() => expect(item("a.pdf").state).toBe("done"));
    expect(uploadDocument).toHaveBeenCalledTimes(3);
    act(() => result.current.retry(item("b.pdf").key));
    expect(item("b.pdf").state).toBe("refused");
  });
});
