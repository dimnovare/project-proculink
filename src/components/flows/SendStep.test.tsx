import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiHttpError } from "@/lib/api/core";
import type { Destination, DocumentRow, Flow, FlowOutput } from "@/lib/api/documents";
import { COPY, documentRefusalMessage } from "@/lib/documentRefusals";
import { documentStatus } from "@/lib/documentStatusManifest";
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
/** Filled buttons (navy, green or blue) in the whole step: the house rule allows exactly one. */
const filled = (c: HTMLElement) => within(c).queryAllByRole("button").filter((b) => /\b(bg-navy|bg-brand-green-btn|bg-brand-blue)\b/.test(b.className));

beforeEach(() => {
  vi.clearAllMocks();
  linked.mockReturnValue({ data: { available: false, accounts: [] } });
  api.getDocument.mockReturnValue(new Promise(() => {}));
  api.listDocumentPage.mockResolvedValue({ items: [row], totalCount: 1, page: 1, pageSize: 20, sampleCount: 0 });
});

describe("SendStep", () => {
  it("offers exactly the kinds the server supports: the common places first, the server kinds one press away", async () => {
    api.listDestinations.mockResolvedValue([]);
    api.listOutputs.mockResolvedValue([csvOutput]);
    linked.mockReturnValue({ data: undefined, isError: true });        // not known: no Google
    const { unmount } = render(<SendStep flow={confirmed} docId="d-1" first />, { wrapper });
    const group = await screen.findByRole("radiogroup", { name: "Where should the file go?" });
    const ids = (g: HTMLElement) => within(g).getAllByRole("radio").map((r) => r.getAttribute("data-testid"));
    expect(ids(group)).toEqual(["send-tile-download", "send-tile-email"]);
    expect(within(group).getByRole("radio", { name: /^Download/ })).toBeChecked();
    const more = screen.getByRole("button", { name: /^A server or another system/ });
    expect(more).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(more);
    expect(more).toHaveAttribute("aria-expanded", "true");
    expect(ids(group)).toEqual(["send-tile-download", "send-tile-email", "send-tile-server", "send-tile-s3", "send-tile-http"]);
    unmount();
    linked.mockReturnValue({ data: { available: true, accounts: [] } });
    api.listDestinations.mockResolvedValue([savedSftp]);
    render(<SendStep flow={confirmed} docId="d-1" first />, { wrapper: freshWrapper() });
    const again = await screen.findByRole("radiogroup", { name: "Where should the file go?" });
    expect(await within(again).findByRole("radio", { name: /^Already set up A place you saved before/ })).toBeInTheDocument();
    expect(ids(again)).toEqual(["send-tile-download", "send-tile-email", "send-tile-google_drive", "send-tile-google_sheets", "send-tile-existing"]);
  });

  it("with Download, Finish is the one filled button and makes the file without a browser download", async () => {
    api.listOutputs.mockResolvedValue([csvOutput]);
    api.listDestinations.mockResolvedValue([]);
    api.publishFlow.mockResolvedValue(confirmed);
    api.sendDocument.mockResolvedValue([{ id: "dl-1", outputName: "CSV file", protocol: "download", status: "stored", attempts: 0, lastError: null, fileName: "invoice.csv", deliveredAt: null }]);
    const { container } = render(<SendStep flow={confirmed} docId="d-1" first />, { wrapper: freshWrapper() });
    const finish = await screen.findByRole("region", { name: "Finish" });
    expect(screen.getByText("Nothing to set up. Each file waits in Documents, ready to download.")).toBeInTheDocument();
    expect(await within(finish).findByText("Your first file is ready. You will find it in Documents, ready to download.")).toBeInTheDocument();
    expect(within(finish).queryByText(/Finish without/)).toBeNull();
    expect(filled(container).map((b) => b.textContent)).toEqual(["Finish"]);
    fireEvent.click(within(finish).getByRole("button", { name: "Finish" }));
    fireEvent.click(within(finish).getByRole("button", { name: "Finish" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith(`/flows/${confirmed.id}`));
    expect(api.sendDocument).toHaveBeenCalledTimes(1);
    expect(blob.saveBlob).not.toHaveBeenCalled();
  });

  it("fills one button, and only when the choice is ready", async () => {
    api.listOutputs.mockResolvedValue([csvOutput]);
    api.listDestinations.mockResolvedValue([]);
    api.listDocumentPage.mockResolvedValue({ items: [{ ...row, isSample: false, fileName: "po-1.pdf" }], totalCount: 1, page: 1, pageSize: 20, sampleCount: 0 });
    const { container, unmount } = render(<SendStep flow={confirmed} docId="d-1" first />, { wrapper: freshWrapper() });
    const finish = await screen.findByRole("region", { name: "Finish" });
    expect(await within(finish).findByText("Your first file is ready. You will find it in Documents, ready to download.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^A server or another system/ }));
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Where should the file go?" })).getByRole("radio", { name: /^SFTP or FTPS/ }));
    const send = within(finish).getByRole("button", { name: "Send po-1.pdf now" });
    expect(send).toBeDisabled();
    expect(filled(container).map((b) => b.textContent)).toEqual(["Save and send a test"]);   // the form's button is the one
    expect(within(finish).getByText("Send a test first to check the settings. Or finish now and send your document later from Documents.")).toBeInTheDocument();
    expect(readiness({ kind: "new", tile: "server" }, null, false)).toBe("not-ready");
    expect(readiness({ kind: "new", tile: "server" }, { destinationId: "x", ok: false }, false)).toBe("not-ready");
    expect(readiness({ kind: "new", tile: "server" }, { destinationId: "x", ok: true }, false)).toBe("ready");
    expect(readiness({ kind: "existing", destinationId: null }, null, false)).toBe("not-ready");
    expect(readiness({ kind: "download" }, null, null)).toBe("unknown");
    expect(readiness({ kind: "download" }, null, true)).toBe("sample");
    unmount();
    // Our sample with a destination form open: Finish is the one filled button, the form's is outlined.
    api.listDocumentPage.mockResolvedValue({ items: [{ ...row, isSample: true }], totalCount: 1, page: 1, pageSize: 20, sampleCount: 1 });
    const sample = render(<SendStep flow={confirmed} docId="d-1" first />, { wrapper: freshWrapper() }).container;
    fireEvent.click(await within(sample).findByRole("button", { name: /^A server or another system/ }));
    fireEvent.click(await within(sample).findByRole("radio", { name: /^SFTP or FTPS/ }));
    await within(sample).findByText(/^This is our sample invoice/);
    expect(filled(sample).map((b) => b.textContent)).toEqual(["Finish"]);
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

  it("says where later documents go, by the flow's delivery choice", async () => {
    api.listOutputs.mockResolvedValue([{ ...csvOutput, destinationId: "dest-1" }]);
    api.listDestinations.mockResolvedValue([savedSftp]);
    api.updateFlow.mockReturnValue(new Promise(() => {}));
    render(<SendStep flow={confirmed} docId="d-1" first />, { wrapper: freshWrapper() });
    const finish = await screen.findByRole("region", { name: "Finish" });
    expect(await within(finish).findByText("From now on, documents in this flow go to Books server. Each one waits for you to check it first.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: /^Automatic delivery/ }));
    expect(await within(finish).findByText("From now on, documents in this flow go to Books server. They are sent as soon as they are read.")).toBeInTheDocument();
  });

  it("never attaches a new destination that did not pass its test", async () => {
    api.listOutputs.mockResolvedValue([csvOutput]);
    api.listDestinations.mockResolvedValue([]);
    api.createDestination.mockResolvedValue({ ...savedSftp, id: "dest-9", name: "Invoices server" });
    api.testDestination.mockResolvedValue({ success: false, message: "Login refused.", responseCode: null });
    api.publishFlow.mockResolvedValue(confirmed);
    render(<SendStep flow={confirmed} docId="d-1" first />, { wrapper: freshWrapper() });
    const finish = await screen.findByRole("region", { name: "Finish" });
    fireEvent.click(await screen.findByRole("button", { name: /^A server or another system/ }));
    fireEvent.click(screen.getByRole("radio", { name: /^SFTP or FTPS/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save and send a test" }));
    await waitFor(() => expect(api.testDestination).toHaveBeenCalledWith("dest-9"));
    expect(await within(finish).findByText("Invoices server did not pass its test, so it is saved but not used yet. You can fix it on the flow page.")).toBeInTheDocument();
    expect(within(finish).queryByText(/^From now on/)).toBeNull();
    fireEvent.click(within(finish).getByRole("button", { name: "Finish without sending" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith(`/flows/${confirmed.id}`));
    expect(api.updateOutput).not.toHaveBeenCalled();
    expect(api.sendDocument).not.toHaveBeenCalled();
  });

  it("a passed test stops counting once the tested settings change", async () => {
    api.listOutputs.mockResolvedValue([csvOutput]);
    api.listDestinations.mockResolvedValue([]);
    api.createDestination.mockResolvedValue({ ...savedSftp, id: "dest-9", name: "Invoices server" });
    api.testDestination.mockResolvedValue({ success: true, message: null, responseCode: null });
    render(<SendStep flow={confirmed} docId="d-1" first />, { wrapper: freshWrapper() });
    const finish = await screen.findByRole("region", { name: "Finish" });
    fireEvent.click(await screen.findByRole("button", { name: /^A server or another system/ }));
    fireEvent.click(screen.getByRole("radio", { name: /^SFTP or FTPS/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save and send a test" }));
    await waitFor(() => expect(within(finish).getByRole("button", { name: "Send invoice.pdf now" })).toBeEnabled());
    fireEvent.change(screen.getByLabelText("Server"), { target: { value: "other.example.test" } });
    expect(within(finish).getByRole("button", { name: "Send invoice.pdf now" })).toBeDisabled();
    expect(within(finish).queryByText(/^From now on/)).toBeNull();
  });

  it("is never ready while the outputs could not be loaded, and offers to try again", async () => {
    const down = new ApiHttpError("down", 500, null);
    api.listOutputs.mockRejectedValueOnce(down).mockResolvedValue([csvOutput]);
    api.listDestinations.mockResolvedValue([]);
    render(<SendStep flow={confirmed} docId="d-1" first />, { wrapper: freshWrapper() });
    const finish = await screen.findByRole("region", { name: "Finish" });
    expect(await within(finish).findByText(documentRefusalMessage(down))).toBeInTheDocument();
    expect(within(finish).queryByText(/is ready/)).toBeNull();
    expect(within(finish).queryByRole("button", { name: /^(Finish|Send )/ })).toBeNull();
    fireEvent.click(within(finish).getByRole("button", { name: "Try again" }));
    expect(await within(finish).findByText("Your first file is ready. You will find it in Documents, ready to download.")).toBeInTheDocument();
  });

  it("a document that no longer exists says so, with the way back, and offers no finish", async () => {
    api.listOutputs.mockResolvedValue([csvOutput]);
    api.listDestinations.mockResolvedValue([]);
    api.listDocumentPage.mockResolvedValue({ items: [], totalCount: 0, page: 1, pageSize: 20, sampleCount: 0 });
    api.getDocument.mockRejectedValue(new ApiHttpError("x", 404, { error: "document_not_found" }));
    render(<SendStep flow={confirmed} docId="d-gone" first />, { wrapper: freshWrapper() });
    expect(await screen.findByText(COPY.document_not_found)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Start again" })).toHaveAttribute("href", "/flows/new");
    expect(screen.queryByRole("region", { name: "Finish" })).toBeNull();
  });

  it("offers no send for a document that could not be read or is already sent: its status, then Finish", async () => {
    api.listOutputs.mockResolvedValue([csvOutput]);
    api.listDestinations.mockResolvedValue([savedSftp]);
    for (const status of ["read_failed", "sent"] as const) {
      api.getDocument.mockResolvedValue({ summary: { ...row, status }, contentType: "application/pdf", read: null, checks: [], senderLabel: null });
      const { container, unmount } = render(<SendStep flow={confirmed} docId="d-1" first />, { wrapper: freshWrapper() });
      const finish = await screen.findByRole("region", { name: "Finish" });
      expect(await within(finish).findByText(`invoice.pdf: ${documentStatus(status).label}.`)).toBeInTheDocument();
      fireEvent.click(screen.getByRole("radio", { name: /^Already set up/ }));
      expect(within(finish).queryByRole("button", { name: /^(Send |Finish without)/ })).toBeNull();
      expect(filled(container).map((b) => b.textContent)).toEqual(["Finish"]);
      unmount();
    }
  });

  it("sends once on a double press, through the saved destination, keeping the output's stored template", async () => {
    api.listOutputs.mockResolvedValue([csvOutput]);
    api.listDestinations.mockResolvedValue([savedSftp]);
    api.updateOutput.mockResolvedValue({ ...csvOutput, destinationId: "dest-1" });
    api.publishFlow.mockResolvedValue(confirmed);
    api.sendDocument.mockResolvedValue([{ id: "dl-1", outputName: "CSV file", protocol: "sftp", status: "queued", attempts: 0, lastError: null, fileName: null, deliveredAt: null }]);
    render(<SendStep flow={confirmed} docId="d-1" first />, { wrapper: freshWrapper() });
    const finish = await screen.findByRole("region", { name: "Finish" });
    fireEvent.click(await screen.findByRole("radio", { name: /^Already set up/ }));
    expect(await within(finish).findByText("Your document is ready. It goes to Books server as a CSV file.")).toBeInTheDocument();
    const send = within(finish).getByRole("button", { name: "Send invoice.pdf now" });
    fireEvent.click(send);
    fireEvent.click(send);
    await waitFor(() => expect(router.push).toHaveBeenCalledWith(`/flows/${confirmed.id}`));
    expect(api.sendDocument).toHaveBeenCalledTimes(1);
    expect(api.sendDocument).toHaveBeenCalledWith("d-1");
    expect(api.updateOutput).toHaveBeenCalledWith("f-1", "o-1", {
      name: "CSV file", format: "csv", tableKey: null, template: csvOutput.template, sendWhen: null, layout: undefined, destinationId: "dest-1",
    });
    expect(blob.saveBlob).not.toHaveBeenCalled();
  });
});
