import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ChooseFile } from "./ChooseFile";

const nav = vi.hoisted(() => ({ search: "", push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push, replace: vi.fn() }), useSearchParams: () => new URLSearchParams(nav.search) }));
vi.mock("@/hooks/useQueriesEnabled", () => ({ useTenantQueriesEnabled: () => true, useQueriesEnabled: () => true }));
const api = vi.hoisted(() => ({
  getFlow: vi.fn(), listOutputs: vi.fn(), listDestinations: vi.fn(), listDocuments: vi.fn(), getDocument: vi.fn(),
  previewOutput: vi.fn(), updateOutput: vi.fn(), publishFlow: vi.fn(), outputFromSample: vi.fn(), outputFromDocumentation: vi.fn(),
}));
vi.mock("@/lib/api/documents", () => api);

const flow = {
  id: "flow-1", name: "Invoices", fieldsConfirmed: true, documentCount: 1, createdAt: "", automation: "review", publishedVersion: 1, hasChanges: false,
  docsOutputsOn: true, peppolOn: false,
  fields: { fields: [{ key: "invoice_number", label: "Invoice number", type: "text", meaning: null, required: false }], tables: [] },
};
const leaf = (name: string, field: string) => ({ name, nodeType: "field", children: [], rule: { outputPath: name, canonicalField: field, fieldManipulators: [] } });
const out = (id: string, name: string, format: string, destinationId: string | null) => ({
  id, flowId: "flow-1", name, format, tableKey: null, destinationId, createdAt: "", sendWhen: null,
  template: { format, root: { name: "document", nodeType: "object", children: [leaf("Invoice", "invoice_number")] } },
});
const summary = { id: "doc-1", flowId: "flow-1", flowName: "Invoices", fileName: "invoice-1042.pdf", status: "needs_review", statusReason: null, createdAt: "2026-01-01", source: "upload" };

// jsdom draws the desktop row and the phone bar both; the bar is the one every screen size shares in the test.
const bar = () => within(screen.getByTestId("action-bar"));
const setSearch = (s: string) => { nav.search = s; };
const mount = (f: Partial<typeof flow> = {}) => {
  api.getFlow.mockResolvedValue({ ...flow, ...f });
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ChooseFile flowId="flow-1" /></QueryClientProvider>,
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  setSearch("");
  api.listOutputs.mockResolvedValue([out("out-1", "Invoices CSV", "csv", "dest-1"), out("out-2", "Invoices JSON", "json", null)]);
  api.listDestinations.mockResolvedValue([{ id: "dest-1", name: "Accounting server", protocol: "sftp", config: {}, hasCredentials: true, usedBy: [], lastSend: null, createdAt: "" }]);
  api.listDocuments.mockResolvedValue([summary]);
  api.getDocument.mockResolvedValue({ summary, contentType: "application/pdf", checks: [], read: { kindLabel: "Invoice", fields: [], tables: [], truncated: false } });
  api.previewOutput.mockResolvedValue({ contentType: "text/csv", fileName: "invoice-1042.csv", content: "Invoice\nINV-1042", lookupMisses: [] });
  api.updateOutput.mockImplementation(async (_f: string, id: string, b: object) => ({ ...out(id, "x", "csv", null), ...b }));
  api.publishFlow.mockResolvedValue(flow);
});

describe("ChooseFile", () => {
  it("picks XML, previews it as XML, and Use this file replaces only the named file", async () => {
    setSearch("output=out-2&from=%2Fflows%2Fflow-1");
    mount();
    // The type in use is tagged, never drawn as picked while Use this file waits for a pick.
    expect(await screen.findByRole("button", { name: /^JSON\W+Current$/ })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(await screen.findByRole("button", { name: "XML" }));
    await waitFor(() => expect(api.previewOutput).toHaveBeenLastCalledWith("doc-1", "out-2", { as: expect.objectContaining({ format: "xml", standard: null }) }));
    expect(screen.getByRole("button", { name: "XML" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(bar().getByRole("button", { name: "Use this file" }));
    await waitFor(() => expect(api.updateOutput).toHaveBeenCalledWith("flow-1", "out-2", expect.objectContaining({ replace: true, format: "xml" })));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/flows/flow-1"));
  });

  it("an invoice flow with the e-invoice switch off is offered the Factur-X invoice, and the disabled Use this file says why (B-13, B-23)", async () => {
    setSearch("way=docs");
    mount({ docsOutputsOn: false });
    expect(await screen.findByText("ZUGFeRD / Factur-X. We fill the standard in from what each value means.")).toBeInTheDocument();
    expect(screen.getByText("Pick a file type, a sample or a standard above.")).toBeInTheDocument();
    expect(screen.getByText("Building from documentation isn't on for this workspace yet.")).toBeInTheDocument();
    expect(bar().getByRole("button", { name: "Use this file" })).toBeDisabled();
  });

  it("Cancel after a preview changes nothing", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "JSON" }));
    expect(bar().getByRole("link", { name: "Cancel" })).toHaveAttribute("href", "/flows/flow-1?tab=send&output=out-1");
    fireEvent.click(bar().getByRole("link", { name: "Cancel" }));
    expect(api.updateOutput).not.toHaveBeenCalled();
    expect(api.publishFlow).not.toHaveBeenCalled();
  });

  it("a Sheets destination takes only CSV, and documentation is offered only when switched on", async () => {
    api.listDestinations.mockResolvedValue([{ id: "dest-1", name: "Team sheet", protocol: "google_sheets", config: {}, hasCredentials: true, usedBy: [], lastSend: null, createdAt: "" }]);
    mount({ docsOutputsOn: false });
    fireEvent.click(await screen.findByRole("button", { name: "PDF" }));
    expect(await screen.findByText("Google Sheets takes only a CSV file. Choose CSV, or change where this file goes first.")).toBeInTheDocument();
    expect(bar().getByRole("button", { name: "Use this file" })).toBeDisabled();
    expect(screen.queryByRole("heading", { name: "From your system’s documentation" })).toBeNull();
  });
});
