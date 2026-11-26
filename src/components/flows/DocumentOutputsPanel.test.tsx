import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DocumentOutputsPanel } from "./DocumentOutputsPanel";

vi.mock("@/hooks/useQueriesEnabled", () => ({ useTenantQueriesEnabled: () => true }));

const api = vi.hoisted(() => ({
  listOutputs: vi.fn(), listDestinations: vi.fn(), previewOutput: vi.fn(), getFlow: vi.fn(),
  listDeliveries: vi.fn(), downloadDeliveryFile: vi.fn(),
}));
vi.mock("@/lib/api/documents", () => api);

const detail = {
  summary: { id: "d", flowId: "f", flowName: "Receipts", fileName: "a.csv", status: "needs_review", statusReason: null,
    pageCount: null, billingUnits: 1, failedChecks: 1, createdAt: "" },
  contentType: "text/csv", read: { kindLabel: null, fields: [], tables: [], truncated: false }, checks: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  api.listOutputs.mockResolvedValue([{ id: "o", flowId: "f", name: "Totals", format: "csv", tableKey: null, destinationId: null, template: {}, createdAt: "" }]);
  api.listDestinations.mockResolvedValue([]);
  api.getFlow.mockResolvedValue({ id: "f", fields: { fields: [], tables: [] } });
});

const renderPanel = (qc = new QueryClient()) =>
  render(<QueryClientProvider client={qc}><DocumentOutputsPanel flowId="f" document={detail as never} /></QueryClientProvider>);

describe("DocumentOutputsPanel", () => {
  it("keeps each output's preview on screen", async () => {
    const out = (id: string) => ({ id, flowId: "f", name: id, format: "csv", tableKey: null, destinationId: null, template: {}, createdAt: "" });
    api.listOutputs.mockResolvedValue([out("A"), out("B")]);
    api.listDeliveries.mockResolvedValue([]);
    api.previewOutput.mockImplementation(async (_d: string, id: string) => ({ contentType: "text/csv", fileName: id + ".csv", content: "x" }));
    renderPanel();
    const [a, b] = await screen.findAllByRole("button", { name: "Preview" });
    fireEvent.click(a);
    await screen.findByText("A.csv");
    fireEvent.click(b);
    expect(await screen.findByText("B.csv")).toBeTruthy();
    expect(screen.getByText("A.csv")).toBeTruthy();
  });

  it("reads the live version's outputs and previews with it", async () => {
    api.listDeliveries.mockResolvedValue([]);
    api.previewOutput.mockResolvedValue({ contentType: "text/csv", fileName: "t.csv", content: "x" });
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Preview" }));
    await screen.findByText("t.csv");
    expect(api.listOutputs).toHaveBeenCalledWith("f", { published: true });
    expect(api.previewOutput).toHaveBeenCalledWith("d", "o", { published: true });
  });

  it("says what each output makes and where it goes, and that nothing has been sent yet", async () => {
    api.listDeliveries.mockResolvedValue([]);
    api.listDestinations.mockResolvedValue([{ id: "dest-a", name: "Accounting inbox" }]);
    api.listOutputs.mockResolvedValue([
      { id: "o", flowId: "f", name: "Totals", format: "csv", destinationId: "dest-a", sendWhen: null, template: {} },
      { id: "p", flowId: "f", name: "Copy", format: "pdf", destinationId: null, sendWhen: null, template: {} },
    ]);
    const { container } = renderPanel();
    const panel = within(container);
    expect(await panel.findByText("CSV to Accounting inbox")).toBeInTheDocument();
    expect(panel.getByText("PDF, you download it")).toBeInTheDocument();
    expect(panel.getByText("Nothing has been sent yet. Both go out when you send this document.")).toBeInTheDocument();
    expect(panel.getByRole("link", { name: "Make another file" })).toHaveAttribute("href", "/flows/f?tab=outputs");
    expect(panel.queryByRole("heading", { name: "Deliveries" })).toBeNull();
    expect(panel.queryByRole("button", { name: /^Send/ })).toBeNull();
  });
  it("each file has Change the file, back to this document", async () => {
    api.listDeliveries.mockResolvedValue([]);
    const panel = within(renderPanel().container);
    expect(await panel.findByRole("link", { name: "Change the file" })).toHaveAttribute("href",
      "/flows/f/change-file?output=o&document=d&from=%2Fflows%2Ff%2Fdocuments%2Fd");
    expect(panel.getByRole("link", { name: "Make a second file" })).toBeInTheDocument();
  });

  it("lists a stored delivery with its line and Download", async () => {
    api.listDeliveries.mockResolvedValue([{ id: "x", outputName: "Totals", protocol: "", status: "stored", attempts: 0, lastError: null, fileName: "totals.csv", deliveredAt: null }]);
    const panel = within(renderPanel().container);
    expect(await panel.findByRole("heading", { name: "Deliveries" })).toBeInTheDocument();
    expect(panel.getByText("Download, Ready to download")).toBeInTheDocument();
    expect(panel.getByRole("button", { name: "Download" })).toBeInTheDocument();
    expect(panel.queryByText(/Nothing has been sent/)).toBeNull();
  });

  it("says nothing is made yet, then when it was made", async () => {
    api.getFlow.mockResolvedValue({ id: "f", fields: { fields: [], tables: [] }, downloadOnly: true });
    api.listDeliveries.mockResolvedValue([]);
    const first = renderPanel();
    expect(await within(first.container).findByText("Nothing is made yet. When the values are right, press Make the file.")).toBeInTheDocument();
    first.unmount();
    const stored = (deliveredAt: string | null) => [{ id: "x", outputName: "Totals", protocol: "", status: "stored", attempts: 0, lastError: null, fileName: "invoice-1043.csv", deliveredAt }];
    const sent = (status: string) => render(<QueryClientProvider client={new QueryClient()}>
      <DocumentOutputsPanel flowId="f" document={{ ...detail, summary: { ...detail.summary, status } } as never} />
    </QueryClientProvider>);
    api.listDeliveries.mockResolvedValue(stored(new Date().toISOString()));
    const made = sent("sent");
    expect(await within(made.container).findByText("invoice-1043.csv was made just now. It waits here and in Documents until you download it.")).toBeInTheDocument();
    made.unmount();
    // No time known: no time said. A document that did not finish has no made line.
    api.listDeliveries.mockResolvedValue(stored(null));
    const untimed = sent("sent");
    expect(await within(untimed.container).findByText("invoice-1043.csv was made. It waits here and in Documents until you download it.")).toBeInTheDocument();
    untimed.unmount();
    const failed = within(sent("send_failed").container);
    expect(await failed.findByRole("heading", { name: "Deliveries" })).toBeInTheDocument();
    expect(failed.queryByText(/was made/)).toBeNull();
  });

  it("a flow with no file says so once; a stopped delivery says where to fix it; Advanced is a quiet More settings", async () => {
    api.listOutputs.mockResolvedValue([]);
    api.listDeliveries.mockResolvedValue([]);
    const none = renderPanel();
    expect(await within(none.container).findByText("This flow doesn't make a file yet. Set one up, and every document in this flow gets it.")).toBeInTheDocument();
    expect(within(none.container).queryByText(/Nothing (is made|has been sent)/)).toBeNull();
    expect(within(none.container).queryByRole("link")).toBeNull();
    none.unmount();
    api.listOutputs.mockResolvedValue([{ id: "o", flowId: "f", name: "Totals", format: "csv", tableKey: null, destinationId: "dest-1", template: {}, createdAt: "" }]);
    api.listDeliveries.mockResolvedValue([{ id: "x", outputName: "Totals", protocol: "webhook", status: "dead_letter", attempts: 3, lastError: "404", fileName: null, deliveredAt: null }]);
    const panel = within(renderPanel().container);
    expect(await panel.findByRole("link", { name: "Fix the destination" })).toHaveAttribute("href", expect.stringContaining("dest-1"));
    expect(panel.getByRole("link", { name: "More settings" })).toHaveAttribute("href", "/flows/f/outputs/o/advanced?document=d");
    expect(panel.queryByRole("link", { name: "Open in Advanced" })).toBeNull();
  });

  it("while sending a retry is amber, the KSeF number can be copied, one delivered attempt is not counted; once sent, no Change the file", async () => {
    const delivered = { id: "k", outputName: "Totals", protocol: "ksef", status: "delivered", attempts: 1, lastError: null, fileName: "fa.xml", deliveredAt: null, remoteReference: "5265877635-20260601-AB", hasReceipt: true };
    api.listDeliveries.mockResolvedValue([
      delivered,
      { id: "r", outputName: "Copy", protocol: "email", status: "failed", attempts: 2, lastError: "The mailbox didn't answer.", fileName: null, deliveredAt: null },
    ]);
    const as = (status: string) => render(<QueryClientProvider client={new QueryClient()}>
      <DocumentOutputsPanel flowId="f" document={{ ...detail, summary: { ...detail.summary, status } } as never} />
    </QueryClientProvider>);
    const sending = as("sending");
    const panel = within(sending.container);
    expect(await panel.findByText(/Will try again automatically, 2 attempts/)).toHaveClass("text-amber-text");
    expect(panel.getByText("The mailbox didn't answer.")).not.toHaveClass("text-danger");
    expect(panel.queryByText(/1 attempt/)).toBeNull();
    expect(panel.getByRole("button", { name: "Copy KSeF number" })).toBeInTheDocument();
    expect(panel.getByRole("button", { name: "Download UPO receipt" }).parentElement).toBe(panel.getByRole("button", { name: "Download" }).parentElement);
    sending.unmount();
    api.listDeliveries.mockResolvedValue([delivered]);
    const sent = within(as("sent").container);
    expect(await sent.findByRole("button", { name: "Copy KSeF number" })).toBeInTheDocument();
    expect(sent.queryByRole("link", { name: "Change the file" })).toBeNull();
  });

  it("a KSeF delivery KSeF holds shows KSeF's answer and no destination to fix", async () => {
    api.listOutputs.mockResolvedValue([{ id: "o", flowId: "f", name: "Totals", format: "xml", tableKey: null, destinationId: "dest-1", template: {}, createdAt: "" }]);
    api.listDeliveries.mockResolvedValue([{ id: "x", outputName: "Totals", protocol: "ksef", status: "dead_letter", attempts: 1, lastError: "KSeF already has this invoice.", fileName: null, deliveredAt: null, remoteMayHold: true }]);
    const panel = within(renderPanel().container);
    expect(await panel.findByText("KSeF already has this invoice.")).toBeInTheDocument();
    expect(panel.queryByRole("link", { name: "Fix the destination" })).toBeNull();
  });

  it("once sent, shows only what went out: a file the flow makes now is neither listed nor previewed", async () => {
    api.listOutputs.mockResolvedValue([{ id: "o", flowId: "f", name: "Peppol BIS Billing (invoice) file", format: "xml", destinationId: null, template: {} }]);
    api.listDeliveries.mockResolvedValue([{ id: "x", outputName: "ZUGFeRD / Factur-X EN 16931 (invoice) file", protocol: "b2brouter", status: "delivered", attempts: 1, lastError: null, fileName: "a.xml", deliveredAt: null }]);
    localStorage.setItem("plk:review-preview-open", JSON.stringify(["o"]));
    const panel = within(render(<QueryClientProvider client={new QueryClient()}>
      <DocumentOutputsPanel flowId="f" document={{ ...detail, summary: { ...detail.summary, status: "sent" } } as never} />
    </QueryClientProvider>).container);
    expect(await panel.findByText("ZUGFeRD / Factur-X EN 16931 (invoice) file")).toBeInTheDocument();
    expect(panel.queryByText("Peppol BIS Billing (invoice) file")).toBeNull();
    expect(panel.queryByRole("button", { name: "Preview" })).toBeNull();
    expect(api.previewOutput).not.toHaveBeenCalled();
  });

  it("does not promise a send on a document that can no longer be sent", async () => {
    api.listDeliveries.mockResolvedValue([]);
    const panel = within(render(<QueryClientProvider client={new QueryClient()}>
      <DocumentOutputsPanel flowId="f" document={{ ...detail, summary: { ...detail.summary, status: "read_failed" } } as never} />
    </QueryClientProvider>).container);
    expect(await panel.findByText("Nothing has been sent yet.")).toBeInTheDocument();
  });
});
