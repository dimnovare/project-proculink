import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MutationObserver, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiHttpError } from "@/lib/api/core";
import { DocumentOutputsPanel } from "./DocumentOutputsPanel";

vi.mock("@/hooks/useQueriesEnabled", () => ({ useTenantQueriesEnabled: () => true }));

const api = vi.hoisted(() => ({
  listOutputs: vi.fn(), listDestinations: vi.fn(), previewOutput: vi.fn(),
  sendDocument: vi.fn(), listDeliveries: vi.fn(), downloadDeliveryFile: vi.fn(),
}));
vi.mock("@/lib/api/documents", () => api);

const detail = {
  summary: { id: "d", flowId: "f", flowName: "Receipts", fileName: "a.csv", status: "needs_review", statusReason: null,
    pageCount: null, billingUnits: 1, failedChecks: 1, createdAt: "" },
  contentType: "text/csv", read: { kindLabel: null, fields: [], tables: [], truncated: false }, checks: [],
};
const stored = { id: "x", outputName: "Totals", protocol: "", status: "stored", attempts: 0, lastError: null, fileName: "totals.csv", deliveredAt: null };

beforeEach(() => {
  vi.clearAllMocks();
  api.listOutputs.mockResolvedValue([{ id: "o", flowId: "f", name: "Totals", format: "csv", tableKey: null, destinationId: null, template: {}, createdAt: "" }]);
  api.listDestinations.mockResolvedValue([]);
});

const renderPanel = (qc = new QueryClient()) =>
  render(<QueryClientProvider client={qc}><DocumentOutputsPanel flowId="f" document={detail as never} /></QueryClientProvider>);

describe("DocumentOutputsPanel", () => {
  it("sends and then lists the delivery as ready to download", async () => {
    api.listDeliveries.mockResolvedValueOnce([]).mockResolvedValue([stored]);
    api.sendDocument.mockResolvedValue([stored]);
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Send" }));
    expect(await screen.findByText(/Ready to download/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Download" })).toBeTruthy();
    expect(screen.queryByText(/attempt/)).toBeNull();
  });

  it("shows the refusal when there is no output to send to", async () => {
    api.listDeliveries.mockResolvedValue([]);
    api.sendDocument.mockRejectedValue(new ApiHttpError("no", 409, { error: "no_outputs" }));
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Send" }));
    expect(await screen.findByText("Add an output to this flow before sending.")).toBeTruthy();
  });

  it("holds Send while a value edit is still saving", async () => {
    api.listDeliveries.mockResolvedValue([]);
    const qc = new QueryClient();
    void new MutationObserver(qc, { mutationKey: ["edit-values", "d"], mutationFn: () => new Promise(() => {}) }).mutate();
    renderPanel(qc);
    const send = await screen.findByRole("button", { name: "Send" });
    expect((send as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(send);
    expect(api.sendDocument).not.toHaveBeenCalled();
  });
});
