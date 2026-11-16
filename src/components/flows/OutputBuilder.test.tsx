import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { OutputNode, OutputNodeTemplate } from "@/lib/api/types";
import { OutputBuilder } from "./OutputBuilder";

vi.mock("@/hooks/useQueriesEnabled", () => ({ useTenantQueriesEnabled: () => true }));
const api = vi.hoisted(() => ({
  listDestinations: vi.fn(), listLookups: vi.fn(), updateOutput: vi.fn(), createOutput: vi.fn(), previewOutput: vi.fn(), outputFromSample: vi.fn(),
  outputFromDocumentation: vi.fn(),
}));
vi.mock("@/lib/api/documents", () => api);

const flow = { id: "f", name: "Supplier invoices", fields: { fields: [{ key: "ship_address", label: "Ship address" }], tables: [] } };
const invoiceFlow = {
  ...flow, docsOutputsOn: true,
  fields: {
    fields: [{ key: "invoice_no", label: "Invoice number" }, { key: "due", label: "Due date" }],
    tables: [{ key: "lines", label: "Lines", columns: [{ key: "sku", label: "Item" }, { key: "qty", label: "Quantity" }] }],
  },
};
const template = {
  format: "csv",
  root: { name: "document", nodeType: "object", children: [
    { name: "Ship to", nodeType: "field", children: [], rule: { outputPath: "Ship to", fixedValue: "" } },
  ] },
};
const made = { id: "o", flowId: "f", name: "Supplier invoices CSV", format: "csv", tableKey: "lines", destinationId: null, template, createdAt: "", sendWhen: null };
const leafNames = (t: OutputNodeTemplate) => {
  const walk = (n: OutputNode): string[] => (n.nodeType === "field" ? [n.name] : (n.children ?? []).flatMap(walk));
  return walk(t.root);
};
const renderBuilder = ({ flow: f = flow, onCreated = vi.fn() }: { flow?: unknown; onCreated?: () => void } = {}) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const r = render(
    <QueryClientProvider client={client}>
      <OutputBuilder flow={f as never} kind={null} onDone={() => {}} onCreated={onCreated} />
    </QueryClientProvider>);
  return { ...r, invalidate };
};

beforeEach(() => {
  vi.clearAllMocks();
  api.listDestinations.mockResolvedValue([]);
  api.listLookups.mockResolvedValue([]);
  api.outputFromSample.mockResolvedValue({
    name: "Sample", format: "csv", tableKey: null, template, notes: [],
    leaves: [{ path: "Ship to", fieldKey: null, by: "ai", confidence: 0.8 }],
  });
  api.createOutput.mockResolvedValue({ id: "o", flowId: "f", name: "Sample", format: "csv", tableKey: null, destinationId: null, template, createdAt: "", sendWhen: null });
});

describe("OutputBuilder", () => {
  it("opens straight on a CSV with every value ticked, and Create sends what is ticked", async () => {
    api.createOutput.mockResolvedValue(made);
    const onCreated = vi.fn();
    renderBuilder({ flow: invoiceFlow, onCreated });
    expect(screen.getByRole("heading", { name: "Make another file" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveProperty("value", "Supplier invoices CSV");
    expect(screen.getByRole("combobox", { name: "File type" })).toHaveProperty("value", "csv");
    expect(screen.getByText("In the file (4)")).toBeTruthy();
    expect(screen.queryByRole("tablist")).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "Put Due date in the file" }));
    expect(screen.getByText("In the file (3)")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(made));
    expect(api.createOutput).toHaveBeenCalledTimes(1);
    expect(api.createOutput.mock.calls[0][1]).toMatchObject({ name: "Supplier invoices CSV", format: "csv", destinationId: null, tableKey: "lines" });
    const names = leafNames(api.createOutput.mock.calls[0][1].template);
    expect(names).toEqual(["Invoice number", "Item", "Quantity"]);
  });

  it("a set layout is one press away, with a way back", () => {
    renderBuilder({ flow: { ...invoiceFlow, docsOutputsOn: false } });
    expect(screen.queryByRole("button", { name: "From documentation" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Match a sample file" }));
    expect(screen.getByText("Upload an example of the file the receiving system expects: CSV, Excel, JSON or XML.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Make another file" }));
    expect(screen.getByText(/^In the file \(/)).toBeTruthy();
  });

  it("a sample becomes a reviewed file", async () => {
    const { container, invalidate } = renderBuilder();
    fireEvent.click(screen.getByRole("button", { name: "Match a sample file" }));
    const input = container.querySelector('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [new File(["a,b"], "sample.csv")] } });
    expect(await screen.findByText("AI · 80%")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Value for Ship to"), { target: { value: "ship_address" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(api.createOutput).toHaveBeenCalled());
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["outputs", "f"] }));
    const body = api.createOutput.mock.calls[0][1];
    expect(body.template.root.children[0].rule.canonicalField).toBe("ship_address");
    expect(body.template.root.children[0].rule.fixedValue).toBeUndefined();
  });

  it("a standard is created at once and handed back", async () => {
    const saved = { id: "o", flowId: "f", name: "cXML", format: "xml", standard: "cxml-1-2", tableKey: null, destinationId: null, template, createdAt: "", sendWhen: null };
    api.createOutput.mockResolvedValue(saved);
    const onCreated = vi.fn();
    renderBuilder({ onCreated });
    fireEvent.click(screen.getByRole("button", { name: "A standard format" }));
    fireEvent.click(screen.getByRole("button", { name: "Use cXML" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(saved));
    expect(api.createOutput).toHaveBeenCalledWith("f", expect.objectContaining({ name: "cXML", format: "", standard: "cxml-1-2" }));
  });

  it("offers the Peppol standards only when the flag is on", () => {
    const open = (f: unknown) => {
      const r = renderBuilder({ flow: f });
      fireEvent.click(screen.getByRole("button", { name: "A standard format" }));
      return r;
    };
    open(flow).unmount();
    expect(screen.queryByRole("button", { name: /Peppol/ })).toBeNull();
    open({ ...flow, peppolOn: true });
    expect(screen.getAllByRole("button", { name: /Use Peppol BIS Billing/ })).toHaveLength(2);
  });
});
