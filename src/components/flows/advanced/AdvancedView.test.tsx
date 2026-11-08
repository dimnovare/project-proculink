import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiHttpError } from "@/lib/api/core";
import { COPY } from "@/lib/documentRefusals";
import { AdvancedView } from "./AdvancedView";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock("@/hooks/useQueriesEnabled", () => ({ useTenantQueriesEnabled: () => true, useQueriesEnabled: () => true }));

const api = vi.hoisted(() => ({
  getFlow: vi.fn(), listOutputs: vi.fn(), listDocuments: vi.fn(), getDocument: vi.fn(),
  fetchDocumentSource: vi.fn(), updateOutput: vi.fn(), previewOutput: vi.fn(),
}));
vi.mock("@/lib/api/documents", () => api);

const flow = {
  id: "f", name: "Invoices", fieldsConfirmed: true, documentCount: 1, createdAt: "", automation: "review",
  fields: {
    fields: [{ key: "invoiceNumber", label: "Invoice number", type: "text", meaning: null, required: false }],
    tables: [{ key: "lines", label: "Lines", columns: [{ key: "sku", label: "SKU", type: "text", meaning: null, required: false }] }],
  },
};
const output = {
  id: "o", flowId: "f", name: "Acme CSV", format: "csv", tableKey: "lines", destinationId: null, createdAt: "", sendWhen: null,
  template: { format: "csv", root: { name: "root", nodeType: "object", children: [{ name: "Number", nodeType: "field", rule: { outputPath: "Number", canonicalField: "invoiceNumber", fieldManipulators: [] } }] } },
};
const detail = {
  summary: { id: "d", flowId: "f", flowName: "Invoices", fileName: "a.csv", status: "needs_review", statusReason: null, pageCount: null, billingUnits: 1, failedChecks: 0, createdAt: "", source: "upload", sourceRef: null },
  contentType: "text/csv", checks: [],
  read: {
    kindLabel: null, truncated: false, tables: [],
    fields: [{ key: "invoiceNumber", label: "Invoice number", value: "INV-1", type: "text", meaning: null, confidence: 0.9, location: { page: null, box: null, address: null }, notOnPage: false, listed: true, edited: false }],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  api.getFlow.mockResolvedValue(flow);
  api.listOutputs.mockResolvedValue([output]);
  api.listDocuments.mockResolvedValue([detail.summary]);
  api.getDocument.mockResolvedValue(detail);
  api.fetchDocumentSource.mockResolvedValue(new Blob(["Number\nINV-1"], { type: "text/csv" }));
  api.previewOutput.mockResolvedValue({ contentType: "text/csv", fileName: "a.csv", content: "Number\nINV-1", lookupMisses: [] });
});

const renderView = () =>
  render(<QueryClientProvider client={new QueryClient()}><AdvancedView flowId="f" outputId="o" /></QueryClientProvider>);

describe("AdvancedView", () => {
  it("shows the flow's values on the left and no mapping vocabulary", async () => {
    renderView();
    const bench = within(await screen.findByTestId("advanced-workbench"));
    expect((await bench.findAllByText("INV-1")).length).toBeGreaterThan(0);
    expect(bench.getAllByText("What we received").length).toBeGreaterThan(0);
    expect(bench.getByText("Invoice number")).toBeTruthy();
    const root = screen.getByTestId("advanced-workbench");
    const words = /\bmap(s|ped|ping)?\b|unmapped|binding|canonical|manipulator|token|\border\b/i;
    const attrs = [...root.querySelectorAll("[title],[aria-label]")].flatMap((e) => [e.getAttribute("title"), e.getAttribute("aria-label")]);
    expect(root.textContent).not.toMatch(words);
    expect(attrs.filter((t) => t && words.test(t))).toEqual([]);
    expect(bench.queryByRole("button", { name: /add output field/i })).toBeNull();
    expect(bench.queryByRole("button", { name: /has ai suggestion/i })).toBeNull();
  });

  it("a refused save says why, in flow words", async () => {
    api.updateOutput.mockRejectedValue(new ApiHttpError("nope", 422, { error: "lookup" }));
    renderView();
    const bench = within(await screen.findByTestId("advanced-workbench"));
    fireEvent.click((await bench.findAllByRole("button", { name: "Disconnect Number" }))[0]);
    expect(await screen.findByRole("alert")).toHaveTextContent(COPY.lookup);
  });

  it("with no document, the fields still show and the preview says why", async () => {
    api.listDocuments.mockResolvedValue([]);
    renderView();
    const bench = within(await screen.findByTestId("advanced-workbench"));
    expect((await bench.findAllByText("Invoice number")).length).toBeGreaterThan(0);
    expect((await bench.findAllByText("Upload a document to this flow to see a preview.")).length).toBeGreaterThan(0);
  });
});
