import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { OutputEditor } from "./OutputEditor";

vi.mock("@/hooks/useQueriesEnabled", () => ({ useTenantQueriesEnabled: () => true }));

const api = vi.hoisted(() => ({
  listDestinations: vi.fn(), listLookups: vi.fn(), updateOutput: vi.fn(), createOutput: vi.fn(), previewOutput: vi.fn(),
}));
vi.mock("@/lib/api/documents", () => api);

const flow = { id: "f", fields: { fields: [{ key: "supplier", label: "Supplier" }], tables: [] } };
const output = {
  id: "o", flowId: "f", name: "Totals", format: "csv", tableKey: null, destinationId: null, createdAt: "", sendWhen: null,
  template: { root: { name: "document", nodeType: "object", children: [
    { name: "Supplier", nodeType: "field", children: [], rule: { outputPath: "Supplier", canonicalField: "supplier", fieldManipulators: [] } },
  ] } },
};

beforeEach(() => {
  vi.clearAllMocks();
  api.listDestinations.mockResolvedValue([]);
  api.listLookups.mockResolvedValue([{ id: "L1", name: "Item codes", count: 2, updatedAt: "" }]);
  api.updateOutput.mockResolvedValue(output);
});

const renderEditor = () =>
  render(<QueryClientProvider client={new QueryClient()}>
    <OutputEditor flow={flow as never} output={output as never} previewDocumentId="d" onSaved={() => {}} onCancel={() => {}} />
  </QueryClientProvider>);

describe("OutputEditor", () => {
  it("saves send-when and a lookup on a row", async () => {
    renderEditor();
    fireEvent.change(screen.getByLabelText("Send when"), { target: { value: "only" } });
    fireEvent.change(screen.getByLabelText("Field"), { target: { value: "supplier" } });
    fireEvent.change(screen.getByLabelText("Condition"), { target: { value: "is" } });
    fireEvent.change(screen.getByLabelText("Matches"), { target: { value: "Acme" } });
    await screen.findByRole("option", { name: "Item codes" });
    fireEvent.change(screen.getByLabelText("Swap with lookup"), { target: { value: "L1" } });
    fireEvent.change(screen.getByLabelText("If it's not in the lookup"), { target: { value: "blank" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.updateOutput).toHaveBeenCalled());
    const body = api.updateOutput.mock.calls[0][2];
    expect(body.sendWhen).toEqual({ field: "supplier", op: "is", value: "Acme" });
    expect(body.template.root.children[0].rule.fieldManipulators).toEqual([{ type: "Lookup", params: ["L1", "blank"] }]);
  });

  it("lists values the lookup did not have in the preview", async () => {
    api.previewOutput.mockResolvedValue({ contentType: "text/csv", fileName: "a.csv", content: "x", lookupMisses: [{ lookupId: "L1", value: "NUT-4" }] });
    renderEditor();
    await screen.findByRole("option", { name: "Item codes" });
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(await screen.findByText("Not in “Item codes”: NUT-4.")).toBeTruthy();
  });
});
