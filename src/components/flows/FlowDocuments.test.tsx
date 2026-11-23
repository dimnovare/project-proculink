import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { DocumentRow, Flow } from "@/lib/api/documents";
import { FlowDocuments, StreakBand } from "./FlowDocuments";

vi.mock("@/hooks/useQueriesEnabled", () => ({ useTenantQueriesEnabled: () => true }));
const api = vi.hoisted(() => ({ listDocumentPage: vi.fn(), updateFlow: vi.fn() }));
vi.mock("@/lib/api/documents", () => api);
vi.mock("./UploadQueue", () => ({ useUploadQueue: () => ({ items: [], add: vi.fn(), retry: vi.fn() }), useUploadQueueIfMounted: () => null }));

const flow = {
  id: "flow-1", name: "Supplier invoices", fieldsConfirmed: true, fields: { fields: [], tables: [] }, documentCount: 128,
  createdAt: "", automation: "review", publishedVersion: 1, hasChanges: false, noCorrectionStreak: 8, scansOn: true, formatsOn: true,
} as Flow;
const row = (i: number) => ({
  id: `doc-${i}`, flowId: "flow-1", fileName: `invoice-${i}.pdf`, status: "sent", statusReason: null, createdAt: `2026-05-${10 + i}T09:00:00Z`,
  number: null, sender: null, checks: [], sentAt: null, failedAt: null,
}) as unknown as DocumentRow;

const mount = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

beforeEach(() => {
  vi.clearAllMocks();
  try { localStorage.clear(); } catch { /* no storage */ }
});

describe("FlowDocuments", () => {
  it("newest ten of this flow and the total through pageTotal", async () => {
    let countRefused: Promise<never> | undefined;
    api.listDocumentPage.mockImplementation(async (p: { status?: string[] }) => {
      if (p.status) return (countRefused = Promise.reject(new Error("offline")));
      return { items: Array.from({ length: 10 }, (_, i) => row(i)), totalCount: 128, page: 1, pageSize: 10, sampleCount: 0 };
    });
    mount(<FlowDocuments flow={flow} />);
    expect(await screen.findByText("Showing the newest 10 of 128.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "All documents" })).toHaveAttribute("href", "/documents?show=all");
    expect(api.listDocumentPage).toHaveBeenCalledWith({ flowId: "flow-1", page: 1, pageSize: 10 });
    await waitFor(() => expect(api.listDocumentPage).toHaveBeenCalledWith(expect.objectContaining({ flowId: "flow-1", status: expect.any(Array) })));
    // The count has failed, not merely been asked: what follows is the failed state, not the loading one.
    await act(async () => { await countRefused!.catch(() => {}); });
    expect(screen.getByText("Newest first.")).toBeTruthy();
    expect(screen.queryByText(/needs you|need you/)).toBeNull();
    expect(screen.queryByRole("link", { name: /Review next/ })).toBeNull();
  });

  it("a ready document in this flow has its Make the file button", async () => {
    api.listDocumentPage.mockResolvedValue({ items: [{ ...row(1042), status: "ready", inInbox: false, downloadOnly: true }], totalCount: 1, page: 1, pageSize: 10, sampleCount: 0 });
    mount(<FlowDocuments flow={flow} />);
    expect((await screen.findAllByRole("button", { name: "Make the file invoice-1042.pdf" })).length).toBeGreaterThan(0);
  });

  it("the streak band", async () => {
    api.updateFlow.mockResolvedValue({ ...flow, automation: "auto" });
    const { rerender } = mount(<StreakBand flow={flow} />);
    expect(screen.getByText(/^The last 8 documents were sent without a correction\./)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.queryByText(/without a correction/)).toBeNull();
    expect(localStorage.getItem("plk:streak-dismissed:flow-1")).not.toBeNull();
    const qc = new QueryClient();
    for (const f of [{ ...flow, id: "flow-2", noCorrectionStreak: 4 }, { ...flow, id: "flow-3", automation: "auto" as const }, { ...flow, id: "flow-4", noCorrectionStreak: null }]) {
      rerender(<QueryClientProvider client={qc}><StreakBand flow={f} /></QueryClientProvider>);
      expect(screen.queryByText(/without a correction/)).toBeNull();
    }
  });

  it("the streak band says what its button did, even after the flow leaves review", async () => {
    api.updateFlow.mockResolvedValue({ ...flow, automation: "marked" });
    const qc = new QueryClient();
    const { rerender } = render(<QueryClientProvider client={qc}><StreakBand flow={flow} /></QueryClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Send unmarked documents automatically" }));
    expect(await screen.findByText("Done. Documents with nothing marked now go out by themselves. Change this on You check.")).toBeTruthy();
    rerender(<QueryClientProvider client={qc}><StreakBand flow={{ ...flow, automation: "marked" }} /></QueryClientProvider>);
    expect(screen.getByRole("link", { name: "Open You check" })).toHaveAttribute("href", "/flows/flow-1?tab=check");
    expect(api.updateFlow).toHaveBeenCalledWith("flow-1", { automation: "marked" });
  });

  it("a document that couldn't be sent is counted, never 'Nothing needs you'", async () => {
    api.listDocumentPage.mockImplementation(async (p: { status?: string[] }) =>
      p.status ? { items: [], totalCount: p.status.includes("send_failed") ? 1 : 0, page: 1, pageSize: 1, sampleCount: 0 }
        : { items: [{ ...row(1), status: "send_failed", inInbox: false }], totalCount: 1, page: 1, pageSize: 10, sampleCount: 0 });
    mount(<FlowDocuments flow={flow} />);
    expect(await screen.findByText("1 couldn't be sent. Nothing else needs you. Newest first.")).toBeTruthy();
    expect((await screen.findAllByRole("button", { name: "Send again invoice-1.pdf" })).length).toBeGreaterThan(0);
  });
});
