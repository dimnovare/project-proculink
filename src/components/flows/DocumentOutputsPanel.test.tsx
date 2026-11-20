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
    api.listDeliveries.mockResolvedValue([{ id: "x", outputName: "Totals", protocol: "", status: "stored", attempts: 0, lastError: null, fileName: "invoice-1043.csv", deliveredAt: new Date().toISOString() }]);
    expect(await within(renderPanel().container).findByText("invoice-1043.csv was made just now. It waits here and in Documents until you download it.")).toBeInTheDocument();
  });

  it("does not promise a send on a document that can no longer be sent", async () => {
    api.listDeliveries.mockResolvedValue([]);
    const panel = within(render(<QueryClientProvider client={new QueryClient()}>
      <DocumentOutputsPanel flowId="f" document={{ ...detail, summary: { ...detail.summary, status: "read_failed" } } as never} />
    </QueryClientProvider>).container);
    expect(await panel.findByText("Nothing has been sent yet.")).toBeInTheDocument();
  });
});
