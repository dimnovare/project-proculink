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
  getFlow: vi.fn(), saveFlowFields: vi.fn(),
  listOutputs: vi.fn(), listDestinations: vi.fn(), listDeliveries: vi.fn(),
}));
vi.mock("@/lib/api/documents", () => api);

const field = (value: string) => ({
  key: "invoice_no", label: "Invoice number", value, type: "text", meaning: null, confidence: 0.92,
  location: { page: 2, box: null, address: null }, notOnPage: false, listed: true, edited: false,
});
const detail = (value: string, source = "upload", sourceRef: string | null = null) => ({
  summary: {
    id: "d", flowId: "f", flowName: "Receipts", fileName: "a.csv", status: "needs_review", statusReason: null,
    pageCount: null, billingUnits: 1, failedChecks: 0, createdAt: "", source, sourceRef,
  },
  contentType: "text/csv",
  read: { kindLabel: null, fields: [field(value)], tables: [], truncated: false },
  checks: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  api.getDocument.mockResolvedValue(detail("INV-1"));
  api.getDocumentHistory.mockResolvedValue([]);
  api.getFlow.mockResolvedValue({ id: "f", fieldsConfirmed: false });
  api.listOutputs.mockResolvedValue([]);
  api.listDestinations.mockResolvedValue([]);
  api.listDeliveries.mockResolvedValue([]);
  api.fetchDocumentSource.mockRejectedValue(new Error("no source"));
});

const renderScreen = (qc = new QueryClient()) =>
  render(<QueryClientProvider client={qc}><DocumentScreen flowId="f" documentId="d" /></QueryClientProvider>);

describe("DocumentScreen", () => {
  it("says how the document arrived, and prints an unknown source as it is", async () => {
    api.getDocument.mockResolvedValue(detail("INV-1", "email", "ap@example.test"));
    const first = renderScreen();
    expect(await screen.findByText("Arrived by email from ap@example.test")).toBeTruthy();
    first.unmount();
    api.getDocument.mockResolvedValue(detail("INV-1", "carrier-pigeon"));
    renderScreen();
    expect(await screen.findByText("Arrived by carrier-pigeon")).toBeTruthy();
  });

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

  it("offers to read a duplicate file anyway", async () => {
    const dup = detail("");
    api.getDocument.mockResolvedValue({
      ...dup, summary: { ...dup.summary, statusReason: "duplicate_file", failedChecks: 1 },
      read: { ...dup.read, fields: [] },
      checks: [{ code: "duplicate", passed: false, fieldKey: null, message: "This file was already uploaded to this flow." }],
    });
    api.retryDocumentRead.mockResolvedValue({});
    renderScreen();
    expect(await screen.findByText("This file was already uploaded to this flow.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Read it anyway" }));
    await waitFor(() => expect(api.retryDocumentRead).toHaveBeenCalledWith("d"));
  });

  it("refreshes deliveries and history when the status changes under it", async () => {
    const reading = detail("INV-1");
    api.getDocument.mockResolvedValueOnce({ ...reading, summary: { ...reading.summary, status: "reading" } }).mockResolvedValue(detail("INV-1"));
    const qc = new QueryClient();
    renderScreen(qc);
    await waitFor(() => expect(api.listDeliveries).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(api.getDocumentHistory).toHaveBeenCalledTimes(1));
    await qc.invalidateQueries({ queryKey: ["document", "d"] });
    await waitFor(() => expect(api.listDeliveries).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(api.getDocumentHistory).toHaveBeenCalledTimes(2));
  });

  it("offers a field the read noticed and adds it to the flow in one click", async () => {
    const fld = (key: string, label: string) => ({ ...field("x"), key, label });
    const d = detail("x");
    d.read.fields = [fld("po", "po"), fld("total", "total")];
    api.getDocument.mockResolvedValue(d);
    const own = { key: "po", label: "po", type: "text", meaning: null, required: false };
    const flow = { id: "f", fieldsConfirmed: true, fields: { fields: [own], tables: [] } };
    api.getFlow.mockResolvedValue(flow);
    api.saveFlowFields.mockResolvedValue({ ...flow, fields: { fields: [own, { ...own, key: "total", label: "total" }], tables: [] } });
    renderScreen();
    expect(await screen.findByText("New fields we noticed")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add po to the flow" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add total to the flow" }));
    await waitFor(() => expect(api.saveFlowFields).toHaveBeenCalledWith("f", expect.objectContaining({ fields: [expect.objectContaining({ key: "po" }), expect.objectContaining({ key: "total" })] })));
    await waitFor(() => expect(screen.queryByText("New fields we noticed")).toBeNull());
  });
});
