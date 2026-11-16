import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { OutputNode, OutputNodeTemplate } from "@/lib/api/types";
import { OutputBuilder } from "./OutputBuilder";
import { STANDARD_OUTPUTS, kindGroup, standardFamilies } from "@/lib/standardOutputs";

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
const renderBuilder = ({ flow: f = flow, onCreated = vi.fn(), kind = null }: { flow?: unknown; onCreated?: () => void; kind?: string | null } = {}) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const r = render(
    <QueryClientProvider client={client}>
      <OutputBuilder flow={f as never} kind={kind} onDone={() => {}} onCreated={onCreated} />
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

  it("a set layout is one press away, with a way back that keeps what was chosen", () => {
    renderBuilder({ flow: { ...invoiceFlow, docsOutputsOn: false } });
    expect(screen.queryByRole("button", { name: "From documentation" })).toBeNull();
    fireEvent.change(screen.getByRole("combobox", { name: "File type" }), { target: { value: "xlsx" } });
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveProperty("value", "Supplier invoices Excel");
    expect(screen.getByText("An Excel file with every value we read. Untick what you don't need.")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "Put Due date in the file" }));
    const link = screen.getByRole("button", { name: "Match a sample file" });
    fireEvent.click(link);
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Match a sample file" }));
    expect(screen.getByText("Upload an example of the file the receiving system expects: CSV, Excel, JSON or XML.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to Make another file" }));
    expect(document.activeElement?.textContent).toBe("Match a sample file");
    expect(screen.getByRole("combobox", { name: "File type" })).toHaveProperty("value", "xlsx");
    expect(screen.getByText("In the file (3)")).toBeTruthy();
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
    // two presses before the button turns busy send one request
    api.createOutput.mockClear();
    renderBuilder();
    fireEvent.click(screen.getAllByRole("button", { name: "A standard format" }).at(-1)!);
    const use = screen.getAllByRole("button", { name: "Use UBL Order" }).at(-1)!;
    act(() => { use.click(); use.click(); });
    await waitFor(() => expect(api.createOutput).toHaveBeenCalledTimes(1));
  });

  it("lists one row per family, the fitting ones first, and keeps every standard reachable", () => {
    const r = renderBuilder({ flow: { ...invoiceFlow, peppolOn: true }, kind: "Invoice" });
    fireEvent.click(screen.getByRole("button", { name: "A standard format" }));
    const uses = (el: HTMLElement) => within(el).getAllByRole("button", { name: /^Use / }).map((b) => b.getAttribute("aria-label"));
    const fit = screen.getByRole("heading", { name: "For invoices and credit notes, like the documents in this flow" }).parentElement!;
    expect(uses(fit)).toEqual(["Use Peppol BIS Billing", "Use EN 16931 CII", "Use XRechnung UBL", "Use XRechnung CII"]);
    expect(screen.getByText("The same four, for credit notes.")).toBeTruthy();
    expect(screen.getByText("For orders: cXML, UBL Order, EDIFACT ORDERS and ANSI X12 850.")).toBeTruthy();
    const credit = screen.getByRole("button", { name: "Credit note versions (4)" });
    expect(credit.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: /credit note\)$/ })).toBeNull();
    fireEvent.click(credit);
    expect(credit.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Use Peppol BIS Billing (credit note)");
    fireEvent.click(screen.getByRole("button", { name: "Other standards (4)" }));
    expect(screen.getAllByRole("button", { name: /^Use / })).toHaveLength(STANDARD_OUTPUTS.length);
    const all = [...standardFamilies(true).invoices.flatMap((f) => [f.id, f.creditNote]), ...standardFamilies(true).orders.map((f) => f.id)];
    expect(all.sort()).toEqual([...STANDARD_OUTPUTS].sort());
    r.unmount();
    // an orders flow: the credit-note versions sit inside "Other standards", after the invoice families they belong to
    const o = renderBuilder({ flow: { ...invoiceFlow, peppolOn: true }, kind: "Purchase order" });
    fireEvent.click(screen.getByRole("button", { name: "A standard format" }));
    expect(screen.queryByRole("button", { name: "Credit note versions (4)" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Other standards (4)" }));
    const others = screen.getByRole("button", { name: "Other standards (4)" }).parentElement!.parentElement!;
    expect(uses(others)).toEqual(["Use Peppol BIS Billing", "Use EN 16931 CII", "Use XRechnung UBL", "Use XRechnung CII"]);
    fireEvent.click(within(others).getByRole("button", { name: "Credit note versions (4)" }));
    expect(uses(others)).toHaveLength(8);
    o.unmount();
    // e-invoices off: the fitting group is empty, so no heading and only the order standards
    renderBuilder({ flow: invoiceFlow, kind: "Invoice" });
    fireEvent.click(screen.getByRole("button", { name: "A standard format" }));
    expect(screen.queryByRole("heading", { name: /like the documents in this flow/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Peppol|Credit note|Other standards/ })).toBeNull();
    expect(screen.getAllByRole("button", { name: /^Use / })).toHaveLength(4);
    expect(standardFamilies(false).invoices).toEqual([]);
    expect([kindGroup(null), kindGroup("Credit note"), kindGroup("Purchase order"), kindGroup("Receipt")]).toEqual([null, "invoices", "orders", null]);
  });
});