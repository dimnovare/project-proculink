import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiHttpError } from "@/lib/api/core";
import { DocumentScreen } from "./DocumentScreen";

const replace = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push: vi.fn() }) }));
vi.mock("@/hooks/useQueriesEnabled", () => ({ useTenantQueriesEnabled: () => true }));

const api = vi.hoisted(() => ({
  getDocument: vi.fn(), editDocumentValues: vi.fn(), getDocumentHistory: vi.fn(),
  retryDocumentRead: vi.fn(), fetchDocumentSource: vi.fn(),
  getFlow: vi.fn(), saveFlowFields: vi.fn(),
  listOutputs: vi.fn(), listDestinations: vi.fn(), listDeliveries: vi.fn(),
  sendDocument: vi.fn(), listDocumentPage: vi.fn(),
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

type Value = [key: string, value: string | null, confidence: number, edited: boolean];
const withValues = (values: Value[], checks: unknown[] = []) => {
  const d = detail("");
  return {
    ...d, checks,
    read: { ...d.read, fields: values.map(([key, value, confidence, edited]) => ({ ...field(""), key, label: key, value, confidence, edited })) },
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  api.getDocument.mockResolvedValue(detail("INV-1"));
  api.getDocumentHistory.mockResolvedValue([]);
  api.getFlow.mockResolvedValue({ id: "f", fieldsConfirmed: false });
  api.listOutputs.mockResolvedValue([]);
  api.listDestinations.mockResolvedValue([]);
  api.listDeliveries.mockResolvedValue([]);
  api.fetchDocumentSource.mockRejectedValue(new Error("no source"));
  api.listDocumentPage.mockResolvedValue({ items: ["a", "d", "c"].map((id) => ({ id, flowId: "f" })), totalCount: 3, page: 1, pageSize: 50 });
});

const renderScreen = (qc = new QueryClient()) =>
  render(<QueryClientProvider client={qc}><DocumentScreen flowId="f" documentId="d" /></QueryClientProvider>);

describe("DocumentScreen", () => {
  it("names the page after the file, with the way back to Documents and a link to its flow", async () => {
    renderScreen();
    expect(screen.getByRole("heading", { level: 1, name: "Document" })).toBeInTheDocument(); // still loading
    expect(await screen.findByRole("heading", { level: 1, name: "a.csv" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Documents" })).toHaveAttribute("href", "/documents");
    expect(screen.getByRole("link", { name: "Receipts" })).toHaveAttribute("href", "/flows/f");
  });

  it("says how the document arrived, and prints an unknown source as it is", async () => {
    api.getDocument.mockResolvedValue(detail("INV-1", "email", "ap@example.test"));
    const first = renderScreen();
    expect(await screen.findByTestId("review-sub")).toHaveTextContent(/^Receipts, arrived by email from ap@example\.test$/);
    first.unmount();
    api.getDocument.mockResolvedValue(detail("INV-1", "carrier-pigeon"));
    renderScreen();
    expect(await screen.findByTestId("review-sub")).toHaveTextContent(/^Receipts, arrived by carrier-pigeon$/);
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
    fireEvent.click(await screen.findByRole("button", { name: "Something missing or in the wrong place?" }));
    expect(await screen.findByText("New fields we noticed")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add to flow: po" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add to flow: total" }));
    await waitFor(() => expect(api.saveFlowFields).toHaveBeenCalledWith("f", expect.objectContaining({ fields: [expect.objectContaining({ key: "po" }), expect.objectContaining({ key: "total" })] })));
    await waitFor(() => expect(screen.queryByText("New fields we noticed")).toBeNull());
  });

  it("marks a value that needs a look first and says why", async () => {
    api.getDocument.mockResolvedValue(withValues([
      ["invoice_no", "INV-1", 0.97, false], ["supplier", null, 0, false], ["total", "12.00", 1, true],
    ], [{ code: "required_missing", passed: false, fieldKey: "supplier", message: "Supplier is required but was not found." }]));
    renderScreen();
    const read = within(await screen.findByRole("region", { name: "What we read" }));
    expect(read.getByText("1 value needs a look. The rest were read clearly.")).toBeInTheDocument();
    const boxes = read.getAllByRole("textbox");
    expect(boxes[0]).toHaveAccessibleName("supplier");                                       // marked first
    expect(boxes[0]).toHaveAccessibleDescription("Not found on the page. Type it.");
    expect(read.getByRole("heading", { name: "Read clearly" })).toBeInTheDocument();
    expect(read.getByText("Edited")).toBeInTheDocument();
    expect(read.queryByText(/%/)).toBeNull();                                                 // no percentage on a value read clearly
  });
  it("Send and open next saves first, sends once, and opens the next document", async () => {
    const order: string[] = [];
    api.editDocumentValues.mockImplementation(async () => { order.push("save"); return detail("INV-2"); });
    api.sendDocument.mockImplementation(async () => { order.push("send"); return []; });
    const qc = new QueryClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    renderScreen(qc);
    const header = within(await screen.findByTestId("review-header-actions"));
    expect(header.getByText("2 of 3 that need you")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Invoice number"), { target: { value: "INV-2" } });
    const send = header.getByRole("button", { name: "Send and open next" });
    fireEvent.click(send);
    fireEvent.click(send);                                                     // pressed twice
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/flows/f/documents/c"));
    expect(order).toEqual(["save", "send"]);
    expect(api.sendDocument.mock.calls).toEqual([["d"]]);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["documents"] });
  });

  it("a refused send is said under the header and nothing moves; the last one goes back to Documents", async () => {
    api.sendDocument.mockRejectedValueOnce(new ApiHttpError("no", 409, { error: "no_outputs" }));
    renderScreen();
    const header = within(await screen.findByTestId("review-header-actions"));
    fireEvent.click(header.getByRole("button", { name: "Send and open next" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Add an output to this flow before sending.");
    expect(replace).not.toHaveBeenCalled();
    expect(header.getByRole("button", { name: "Send and open next" })).toBeEnabled();
    api.listDocumentPage.mockResolvedValue({ items: [], totalCount: 0, page: 1, pageSize: 50 });   // after this send, nothing needs you
    api.sendDocument.mockResolvedValueOnce([]);
    fireEvent.click(header.getByRole("button", { name: "Send and open next" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/documents?show=needs-you"));
  });

  it("sends nothing while the last change is not saved", async () => {
    api.editDocumentValues.mockRejectedValue(new Error("offline"));
    renderScreen();
    const header = within(await screen.findByTestId("review-header-actions"));
    fireEvent.change(screen.getByLabelText("Invoice number"), { target: { value: "INV-2" } });
    fireEvent.click(header.getByRole("button", { name: "Send and open next" }));
    expect(await screen.findByText("Nothing was sent: your last change isn't saved yet.")).toBeInTheDocument();
    expect(api.sendDocument).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it("Skip saves what was typed once and the next document starts clean", async () => {
    api.getDocument.mockImplementation(async (id: string) => {
      const d = detail(id === "d" ? "INV-1" : "INV-9");
      return { ...d, summary: { ...d.summary, id } };
    });
    api.editDocumentValues.mockResolvedValue(detail("INV-2"));
    const qc = new QueryClient();
    const view = render(<QueryClientProvider client={qc}><DocumentScreen flowId="f" documentId="d" /></QueryClientProvider>);
    const header = within(await screen.findByTestId("review-header-actions"));
    fireEvent.change(screen.getByLabelText("Invoice number"), { target: { value: "INV-2" } });
    fireEvent.click(header.getByRole("button", { name: "Skip" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/flows/f/documents/c"));
    view.rerender(<QueryClientProvider client={qc}><DocumentScreen flowId="f" documentId="c" /></QueryClientProvider>);
    expect(await screen.findByDisplayValue("INV-9")).toBeInTheDocument();
    expect(api.editDocumentValues.mock.calls).toEqual([["d", { fields: [{ key: "invoice_no", value: "INV-2" }] }]]);
    // Leaving without Skip (a link, Back) while a value waits: it goes out once, for its own document.
    fireEvent.change(screen.getByLabelText("Invoice number"), { target: { value: "INV-10" } });
    view.rerender(<QueryClientProvider client={qc}><DocumentScreen flowId="f" documentId="d" /></QueryClientProvider>);
    await waitFor(() => expect(api.editDocumentValues).toHaveBeenCalledTimes(2));
    expect(api.editDocumentValues).toHaveBeenLastCalledWith("c", { fields: [{ key: "invoice_no", value: "INV-10" }] });
    expect(screen.queryByDisplayValue("INV-10")).toBeNull();
  });
});
