import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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

});
