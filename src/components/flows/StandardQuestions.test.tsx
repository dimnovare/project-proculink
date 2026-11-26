import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Flow } from "@/lib/api/documents";
import { FIELD_MEANINGS } from "@/lib/fieldMeanings";
import { StandardQuestions } from "./StandardQuestions";

const api = vi.hoisted(() => ({ saveFlowFields: vi.fn() }));
vi.mock("@/lib/api/documents", () => api);

describe("StandardQuestions", () => {
  it("offers a need no field can answer as a new field, then says how to fill it", async () => {
    const [held, need] = ["sender_vat_id", "receiver_vat_id"] as const;
    const fields = [{ key: "vat", label: "VAT", type: "text", meaning: held, required: false }];
    const flow = { id: "f-1", fields: { fields, tables: [] } } as unknown as Flow;
    api.saveFlowFields.mockResolvedValue(flow);
    render(
      <QueryClientProvider client={new QueryClient()}>
        <StandardQuestions flow={flow} needs={[held, need]} tableKey={null} name="KSeF invoice" />
      </QueryClientProvider>,
    );

    const label = FIELD_MEANINGS[need].label;
    expect(screen.getByText(`${label} isn't read from your documents yet.`)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add it as a field" }));
    expect(await screen.findByText("Open a document and type it, or point to it on the original.")).toBeTruthy();
    expect(api.saveFlowFields).toHaveBeenCalledWith("f-1", {
      fields: [...fields, { key: need, label, type: "text", meaning: need, required: false }], tables: [],
    });
  });
});
