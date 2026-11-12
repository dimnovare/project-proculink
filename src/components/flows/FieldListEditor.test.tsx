import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Flow, FlowFieldList } from "@/lib/api/documents";
import { FieldListEditor } from "./FieldListEditor";

const api = vi.hoisted(() => ({ saveFlowFields: vi.fn() }));
vi.mock("@/lib/api/documents", () => api);

const f = (key: string, meaning: string | null) => ({ key, label: key, type: "text", meaning, required: false });
const initial: FlowFieldList = {
  fields: [f("no", "document_number"), f("ref", null)],
  tables: [{ key: "lines", label: "Lines", columns: [f("amt", "line_amount")] }],
};
const flow = { id: "f", fields: initial } as Flow;

describe("FieldListEditor meanings", () => {
  it("offers only the right scope, saves the choice, and moves a header meaning off its old holder", async () => {
    api.saveFlowFields.mockResolvedValue(flow);
    render(<QueryClientProvider client={new QueryClient()}><FieldListEditor flow={flow} initial={initial} onSaved={() => {}} /></QueryClientProvider>);
    const pickers = screen.getAllByLabelText("Meaning") as HTMLSelectElement[];
    const options = (s: HTMLSelectElement) => within(s).getAllByRole("option").map((o) => o.textContent);
    expect(options(pickers[0])).toContain("Sender VAT ID");
    expect(options(pickers[0])).not.toContain("Line amount");
    expect(options(pickers[2])).toContain("Line amount");
    expect(options(pickers[2])).not.toContain("Sender VAT ID");

    fireEvent.change(pickers[1], { target: { value: "document_number" } });
    expect(pickers[0].value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Save fields" }));
    await waitFor(() => expect(api.saveFlowFields).toHaveBeenCalledWith("f", expect.objectContaining({
      fields: [expect.objectContaining({ key: "no", meaning: null }), expect.objectContaining({ key: "ref", meaning: "document_number" })],
    })));
  });
});
