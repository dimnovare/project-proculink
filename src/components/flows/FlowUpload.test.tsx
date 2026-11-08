import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FlowUpload } from "./FlowUpload";

vi.mock("@/hooks/useQueriesEnabled", () => ({ useTenantQueriesEnabled: () => true }));
const api = vi.hoisted(() => ({ getFlow: vi.fn(), uploadDocument: vi.fn() }));
vi.mock("@/lib/api/documents", () => api);

const flow = { id: "f", name: "Receipts", fieldsConfirmed: true, fields: { fields: [], tables: [] }, documentCount: 0, createdAt: "", automation: "review" };

const drop = async (scansOn?: boolean) => {
  api.getFlow.mockResolvedValue({ ...flow, scansOn });
  const client = new QueryClient();
  const { container } = render(<QueryClientProvider client={client}><FlowUpload flowId="f" onUploaded={vi.fn()} /></QueryClientProvider>);
  await waitFor(() => expect(client.getQueryData(["flow", "f"])).toBeTruthy());
  const file = new File(["x"], "IMG_0001.JPG", { type: "image/jpeg" });
  fireEvent.drop(container.firstElementChild!.firstElementChild!, { dataTransfer: { files: [file] } });
};

beforeEach(() => { vi.clearAllMocks(); api.uploadDocument.mockResolvedValue({ id: "d" }); });

describe("FlowUpload", () => {
  it("upload accepts a phone photo when scans are on", async () => {
    await drop(true);
    expect(screen.getByText("Drop a PDF, CSV, Excel file or photo (PNG, JPG) here")).toBeTruthy();
    await waitFor(() => expect(api.uploadDocument).toHaveBeenCalled());
  });
  it("refuses the same photo when scans are off", async () => {
    await drop(undefined);
    expect(screen.getByText("Drop a PDF, CSV or Excel file here")).toBeTruthy();
    expect(await screen.findByText("This file type can't be read. Use PDF, CSV or Excel (.xlsx).")).toBeTruthy();
    expect(api.uploadDocument).not.toHaveBeenCalled();
  });
});
