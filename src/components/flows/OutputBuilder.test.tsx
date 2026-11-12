import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { OutputBuilder } from "./OutputBuilder";

vi.mock("@/hooks/useQueriesEnabled", () => ({ useTenantQueriesEnabled: () => true }));
const api = vi.hoisted(() => ({
  listDestinations: vi.fn(), listLookups: vi.fn(), updateOutput: vi.fn(), createOutput: vi.fn(), previewOutput: vi.fn(), outputFromSample: vi.fn(),
}));
vi.mock("@/lib/api/documents", () => api);

const flow = { id: "f", fields: { fields: [{ key: "ship_address", label: "Ship address" }], tables: [] } };
const template = {
  format: "csv",
  root: { name: "document", nodeType: "object", children: [
    { name: "Ship to", nodeType: "field", children: [], rule: { outputPath: "Ship to", fixedValue: "" } },
  ] },
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
  it("a sample becomes a reviewed output", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { container } = render(
      <QueryClientProvider client={client}>
        <OutputBuilder flow={flow as never} onDone={() => {}} />
      </QueryClientProvider>);
    fireEvent.click(screen.getByRole("tab", { name: "From a sample" }));
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

  it("a standard is created at once and opens in the editor", async () => {
    api.createOutput.mockResolvedValue({ id: "o", flowId: "f", name: "cXML", format: "xml", standard: "cxml-1-2", tableKey: null, destinationId: null, template, createdAt: "", sendWhen: null });
    render(<QueryClientProvider client={new QueryClient()}><OutputBuilder flow={flow as never} onDone={() => {}} /></QueryClientProvider>);
    fireEvent.click(screen.getByRole("tab", { name: "Standards" }));
    fireEvent.click(screen.getByRole("button", { name: "Use cXML" }));
    expect(await screen.findByText("Edit output")).toBeTruthy();
    expect(api.createOutput).toHaveBeenCalledWith("f", expect.objectContaining({ name: "cXML", format: "", standard: "cxml-1-2" }));
  });
});
