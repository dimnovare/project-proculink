import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Flow, FlowOutput } from "@/lib/api/documents";
import { ApiHttpError } from "@/lib/api/core";
import { COPY } from "@/lib/documentRefusals";
import { WAITING_LINE } from "./ChooseFile";
import { FirstFile } from "./FirstFile";

const api = vi.hoisted(() => ({
  getFlow: vi.fn(), listOutputs: vi.fn(), getDocument: vi.fn(), previewOutput: vi.fn(), listDeliveries: vi.fn(),
  downloadDeliveryFile: vi.fn(), updateOutput: vi.fn(), publishFlow: vi.fn(),
}));
const files = vi.hoisted(() => ({ saveBlob: vi.fn(), savePreview: vi.fn() }));
vi.mock("@/lib/api/documents", () => api);
vi.mock("@/lib/saveBlob", () => files);
vi.mock("@/hooks/useQueriesEnabled", () => ({ useTenantQueriesEnabled: () => true }));

const flow = {
  id: "flow-1", name: "Invoices", fieldsConfirmed: true, documentCount: 1, createdAt: "", automation: "review", publishedVersion: 1, hasChanges: false,
  docsOutputsOn: false, fields: { fields: [{ key: "invoice_number", label: "Invoice number", type: "text", meaning: null, required: false }], tables: [{ key: "lines", label: "Lines", columns: [{ key: "sku", label: "SKU", type: "text", meaning: null, required: false }] }] },
} as Flow;
const csv = {
  id: "out-1", flowId: "flow-1", name: "invoices CSV", format: "csv", tableKey: null, destinationId: null, createdAt: "", sendWhen: null,
  template: { format: "csv", root: { name: "document", nodeType: "object", children: [] } },
} as FlowOutput;
const preview = (ext: string) => ({ contentType: "text/plain", fileName: `invoice-1042.${ext}`, content: `made as ${ext}`, lookupMisses: [] });

beforeEach(() => {
  vi.clearAllMocks();
  api.getFlow.mockResolvedValue(flow);
  api.listOutputs.mockResolvedValue([csv]);
  api.getDocument.mockResolvedValue({ summary: { id: "doc-1", fileName: "invoice-1042.pdf" } });
  api.previewOutput.mockResolvedValueOnce(preview("csv")).mockResolvedValue(preview("xml"));
  api.publishFlow.mockResolvedValue(flow);
  api.updateOutput.mockImplementation(async (_f: string, id: string, b: object) => ({ ...csv, ...b, id }));
});

const mount = (f: Flow = flow) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><FirstFile flow={f} docId="doc-1" /></QueryClientProvider>);

describe("FirstFile", () => {
  it("shows the made file, and Download saves it", async () => {
    mount();
    expect(await screen.findByRole("heading", { name: "Your first file is ready" })).toBeInTheDocument();
    expect(await screen.findByText("We read invoice-1042.pdf and made this file from it.")).toBeInTheDocument();
    expect(await screen.findByText("invoice-1042.csv")).toBeInTheDocument();
    expect(screen.getByText("A CSV spreadsheet file, with the 2 values we read")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    await waitFor(() => expect(files.savePreview).toHaveBeenCalledWith(expect.objectContaining({ fileName: "invoice-1042.csv" })));
    expect(api.downloadDeliveryFile).not.toHaveBeenCalled();
  });

  it("one tap changes the flow's file and the preview, and Download saves the new type", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "XML" }));
    await waitFor(() => expect(api.updateOutput).toHaveBeenCalledWith("flow-1", "out-1", expect.objectContaining({ replace: true, format: "xml" })));
    await waitFor(() => expect(api.previewOutput).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("invoice-1042.xml")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    await waitFor(() => expect(files.savePreview).toHaveBeenCalledWith(expect.objectContaining({ fileName: "invoice-1042.xml" })));
    expect(api.downloadDeliveryFile).not.toHaveBeenCalled();
  });

  it("a refused publish, then a retry that only joins the waiting change, says the change isn't in use", async () => {
    mount({ ...flow, fields: { fields: flow.fields.fields, tables: [] } });
    expect(await screen.findByText("A CSV spreadsheet file, with the 1 value we read")).toBeInTheDocument();
    api.publishFlow.mockRejectedValueOnce(new ApiHttpError("x", 429, { error: "processing_paused" }));
    fireEvent.click(screen.getByRole("button", { name: "XML" }));
    expect(await screen.findByText(COPY.processing_paused)).toBeInTheDocument();
    api.getFlow.mockResolvedValue({ ...flow, hasChanges: true });
    fireEvent.click(screen.getByRole("button", { name: "XML" }));
    expect(await screen.findByText(WAITING_LINE)).toBeInTheDocument();
  });

  it("its own format: sample and standard open the change screen; documentation only when switched on", async () => {
    mount();
    expect(await screen.findByRole("link", { name: "Show us a sample file" })).toHaveAttribute("href", expect.stringContaining("/flows/flow-1/change-file?output=out-1&document=doc-1&way=sample"));
    expect(screen.getByRole("link", { name: "Pick a standard" })).toHaveAttribute("href", expect.stringContaining("way=standard"));
    expect(screen.queryByRole("link", { name: "Give us its documentation" })).toBeNull();
  });
});
