import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiHttpError } from "@/lib/api/core";
import type { Destination, DocumentRow, Flow, FlowOutput } from "@/lib/api/documents";
import { COPY } from "@/lib/documentRefusals";
import { readiness, SendStep } from "./SendStep";

const api = vi.hoisted(() => ({
  listDestinations: vi.fn(), listOutputs: vi.fn(), getDocument: vi.fn(), listDocumentPage: vi.fn(), updateFlow: vi.fn(), updateOutput: vi.fn(),
  publishFlow: vi.fn(), sendDocument: vi.fn(), downloadDeliveryFile: vi.fn(), previewOutput: vi.fn(),
  createDestination: vi.fn(), updateDestination: vi.fn(), testDestination: vi.fn(),
}));
const linked = vi.hoisted(() => vi.fn());
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
const analytics = vi.hoisted(() => ({ capture: vi.fn() }));
const blob = vi.hoisted(() => ({ saveBlob: vi.fn() }));
vi.mock("@/lib/api/documents", () => api);
vi.mock("./GoogleTargetFields", () => ({ useLinkedAccounts: linked, GoogleTargetFields: () => null }));
vi.mock("@/lib/analytics", () => analytics);
vi.mock("@/lib/saveBlob", () => blob);
vi.mock("@/hooks/useQueriesEnabled", () => ({ useTenantQueriesEnabled: () => true }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const confirmed: Flow = {
  id: "f-1", name: "Invoices", fieldsConfirmed: true, documentCount: 1, createdAt: "2026-11-15T09:00:00Z", automation: "review", scansOn: true, formatsOn: false,
  fields: { fields: [{ key: "total", label: "Total", type: "number", meaning: null, required: false }], tables: [] },
};
const csvOutput = {
  id: "o-1", flowId: "f-1", name: "CSV file", format: "csv", tableKey: null, destinationId: null, createdAt: "2026-11-15T09:00:00Z", sendWhen: null,
  template: { format: "csv", root: { name: "document", nodeType: "object", children: [] } },
} as FlowOutput;
const savedSftp: Destination = {
  id: "dest-1", name: "Books server", protocol: "sftp", config: {}, hasCredentials: true, createdAt: "2026-11-15T09:00:00Z", usedBy: [], lastSend: null,
};
const row: DocumentRow = {
  id: "d-1", flowId: "f-1", flowName: "Invoices", fileName: "invoice.pdf", status: "needs_review", statusReason: null, pageCount: 1,
  billingUnits: 1, failedChecks: 0, createdAt: "2026-11-15T09:00:00Z", source: "upload", sourceRef: null,
  number: null, sender: null, checks: [], sentAt: null, failedAt: null, stop: null, isSample: false,
};
const freshWrapper = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};
const wrapper = freshWrapper();

beforeEach(() => {
  vi.clearAllMocks();
  linked.mockReturnValue({ data: { available: false, accounts: [] } });
  api.getDocument.mockReturnValue(new Promise(() => {}));
  api.listDocumentPage.mockResolvedValue({ items: [row], totalCount: 1, page: 1, pageSize: 20, sampleCount: 0 });
});

describe("SendStep", () => {
  it("offers exactly the kinds the server supports", async () => {
    api.listDestinations.mockResolvedValue([]);
    api.listOutputs.mockResolvedValue([csvOutput]);
    linked.mockReturnValue({ data: undefined, isError: true });        // not known: no Google
    const { unmount } = render(<SendStep flow={confirmed} docId="d-1" first />, { wrapper });
    const group = await screen.findByRole("radiogroup", { name: "Where should the file go?" });
    const names = () => within(group).getAllByRole("radio").map((r) => r.getAttribute("aria-label") ?? r.textContent);
    expect(names()).toEqual([
      expect.stringMatching(/^Download/), expect.stringMatching(/^Email/), expect.stringMatching(/^SFTP or FTPS/),
      expect.stringMatching(/^S3 bucket/), expect.stringMatching(/^Web address/),
    ]);
    expect(within(group).getByRole("radio", { name: /^Download/ })).toBeChecked();
    unmount();
    linked.mockReturnValue({ data: { available: true, accounts: [] } });
    api.listDestinations.mockResolvedValue([savedSftp]);
    render(<SendStep flow={confirmed} docId="d-1" first />, { wrapper: freshWrapper() });
    const again = await screen.findByRole("radiogroup", { name: "Where should the file go?" });
    expect(within(again).getByRole("radio", { name: /^Google Drive/ })).toBeInTheDocument();
    expect(within(again).getByRole("radio", { name: /^Google Sheets/ })).toBeInTheDocument();
    expect(await within(again).findByRole("radio", { name: /^Already set up/ })).toBeInTheDocument();
  });

  it("fills one button, and only when the choice is ready", async () => {
    api.listOutputs.mockResolvedValue([csvOutput]);
    api.listDestinations.mockResolvedValue([]);
    api.listDocumentPage.mockResolvedValue({ items: [{ ...row, isSample: false, fileName: "po-1.pdf" }], totalCount: 1, page: 1, pageSize: 20, sampleCount: 0 });
    render(<SendStep flow={confirmed} docId="d-1" first />, { wrapper: freshWrapper() });
    const finish = await screen.findByRole("region", { name: "Finish" });
    expect(await within(finish).findByText("Your document is ready. You download it as a CSV file.")).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Where should the file go?" })).getByRole("radio", { name: /^SFTP or FTPS/ }));
    const send = within(finish).getByRole("button", { name: "Send po-1.pdf now" });
    expect(send).toBeDisabled();
    expect(within(finish).getByText("Send a test first to check the settings. Or finish now and send your document later from Documents.")).toBeInTheDocument();
    expect(readiness({ kind: "new", tile: "server" }, null, false)).toBe("not-ready");
    expect(readiness({ kind: "new", tile: "server" }, { destinationId: "x", ok: false }, false)).toBe("not-ready");
    expect(readiness({ kind: "new", tile: "server" }, { destinationId: "x", ok: true }, false)).toBe("ready");
    expect(readiness({ kind: "existing", destinationId: null }, null, false)).toBe("not-ready");
    expect(readiness({ kind: "download" }, null, null)).toBe("unknown");
    expect(readiness({ kind: "download" }, null, true)).toBe("sample");
  });

  it("never sends our sample, and says so; a refused finish says why and how to go on", async () => {
    api.listOutputs.mockResolvedValue([csvOutput]);
    api.listDestinations.mockResolvedValue([savedSftp]);
    api.listDocumentPage.mockResolvedValue({ items: [{ ...row, id: "d-s", isSample: true }], totalCount: 1, page: 1, pageSize: 20, sampleCount: 1 });
    api.previewOutput.mockResolvedValue({ contentType: "text/csv", fileName: "invoice-2250.csv", content: "a,b\n", lookupMisses: [] });
    api.publishFlow.mockRejectedValueOnce(new ApiHttpError("x", 429, { error: "processing_paused" })).mockResolvedValueOnce(confirmed);
    render(<SendStep flow={confirmed} docId="d-s" first />, { wrapper: freshWrapper() });
    const finish = await screen.findByRole("region", { name: "Finish" });
    expect(await within(finish).findByText(/^This is our sample invoice, so we never send it\./)).toBeInTheDocument();
    fireEvent.click(within(finish).getByRole("button", { name: "Download the sample's CSV file" }));
    await waitFor(() => expect(blob.saveBlob).toHaveBeenCalledWith(expect.any(Blob), "invoice-2250.csv"));
    expect(router.push).not.toHaveBeenCalled();
    fireEvent.click(within(finish).getByRole("button", { name: "Finish" }));
    expect(await within(finish).findByText(COPY.processing_paused)).toBeInTheDocument();
    expect(within(finish).getByRole("link", { name: "Open Plan & billing" })).toHaveAttribute("href", "/settings?tab=billing");
    fireEvent.click(within(finish).getByRole("button", { name: "Finish" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith(`/flows/${confirmed.id}`));
    expect(api.sendDocument).not.toHaveBeenCalled();
    expect(analytics.capture).toHaveBeenCalledWith("wizard_step_completed", { step: 3, step_name: "send", first: true });
  });
});
