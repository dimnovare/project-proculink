import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiHttpError } from "@/lib/api/core";
import { DocumentScreen } from "./DocumentScreen";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("@/hooks/useQueriesEnabled", () => ({ useTenantQueriesEnabled: () => true }));

const api = vi.hoisted(() => ({
  getDocument: vi.fn(), editDocumentValues: vi.fn(), getDocumentHistory: vi.fn(),
  retryDocumentRead: vi.fn(), fetchDocumentSource: vi.fn(),
  listOutputs: vi.fn(), listDestinations: vi.fn(), listDeliveries: vi.fn(),
}));
vi.mock("@/lib/api/documents", () => api);

const field = (value: string) => ({
  key: "invoice_no", label: "Invoice number", value, type: "text", meaning: null, confidence: 0.92,
  location: { page: 2, box: null, address: null }, notOnPage: false, listed: true, edited: false,
});
const detail = (value: string) => ({
  summary: {
    id: "d", flowId: "f", flowName: "Receipts", fileName: "a.csv", status: "needs_review", statusReason: null,
    pageCount: null, billingUnits: 1, failedChecks: 0, createdAt: "",
  },
  contentType: "text/csv",
  read: { kindLabel: null, fields: [field(value)], tables: [], truncated: false },
  checks: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  api.getDocument.mockResolvedValue(detail("INV-1"));
  api.getDocumentHistory.mockResolvedValue([]);
  api.listOutputs.mockResolvedValue([]);
  api.listDestinations.mockResolvedValue([]);
  api.listDeliveries.mockResolvedValue([]);
  api.fetchDocumentSource.mockRejectedValue(new Error("no source"));
});

const renderScreen = () =>
  render(<QueryClientProvider client={new QueryClient()}><DocumentScreen flowId="f" documentId="d" /></QueryClientProvider>);

describe("DocumentScreen", () => {
  it("saves an edited field and shows the value the server returns", async () => {
    api.editDocumentValues.mockResolvedValue(detail("INV-2-saved"));
    renderScreen();
    const input = await screen.findByLabelText("Invoice number");
    fireEvent.change(input, { target: { value: "INV-2" } });
    fireEvent.blur(input);
    await waitFor(() => expect(api.editDocumentValues).toHaveBeenCalledWith("d", { fields: [{ key: "invoice_no", value: "INV-2" }] }));
    expect(await screen.findByDisplayValue("INV-2-saved")).toBeTruthy();
  });

  it("says so and reloads when the document was already sent", async () => {
    api.editDocumentValues.mockRejectedValue(new ApiHttpError("nope", 409, { error: "document_sent" }));
    renderScreen();
    const input = await screen.findByLabelText("Invoice number");
    fireEvent.change(input, { target: { value: "INV-2" } });
    fireEvent.blur(input);
    expect((await screen.findByRole("alert")).textContent).toBe("This document was already sent, so its values can't change.");
    await waitFor(() => expect(api.getDocument).toHaveBeenCalledTimes(2));
    expect((screen.getByLabelText("Invoice number") as HTMLInputElement).value).toBe("INV-1");
  });

  it("says the original is unavailable when the file is empty", async () => {
    api.fetchDocumentSource.mockResolvedValue(new Blob([]));
    renderScreen();
    expect(await screen.findByText("The original isn't available right now.")).toBeTruthy();
  });
});
