import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiHttpError } from "@/lib/api/core";
import { COPY } from "@/lib/documentRefusals";
import { ariaOf } from "@/lib/shortcuts";
import { DocumentScreen } from "./DocumentScreen";

const replace = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push: vi.fn() }) }));
vi.mock("@/hooks/useQueriesEnabled", () => ({ useTenantQueriesEnabled: () => true }));

const api = vi.hoisted(() => ({
  getDocument: vi.fn(), editDocumentValues: vi.fn(), getDocumentHistory: vi.fn(),
  retryDocumentRead: vi.fn(), fetchDocumentSource: vi.fn(),
  getFlow: vi.fn(), saveFlowFields: vi.fn(),
  listOutputs: vi.fn(), listDestinations: vi.fn(), listDeliveries: vi.fn(),
  sendDocument: vi.fn(), listDocumentPage: vi.fn(), getInbox: vi.fn(), deleteDocument: vi.fn(), downloadDeliveryFile: vi.fn(),
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
const withValues = (values: Value[], checks: unknown[] = [], contentType = "text/csv", fileName = "a.csv") => {
  const d = detail("");
  return {
    ...d, checks, contentType, summary: { ...d.summary, fileName },
    read: { ...d.read, fields: values.map(([key, value, confidence, edited]) => ({ ...field(""), key, label: key, value, confidence, edited })) },
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  api.getDocument.mockResolvedValue(detail("INV-1"));
  api.getDocumentHistory.mockResolvedValue([]);
  api.getInbox.mockResolvedValue({ flowId: "inbox", address: null, intakeId: null }); // these documents are in flow "f"
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
    fireEvent.click(within(await screen.findByRole("tablist", { name: "Parts of this document" })).getByRole("tab", { name: "Original" }));
    expect(await screen.findByText("The original isn't available right now.")).toBeTruthy();
  });

  it("sends a clearer copy of an unreadable document to its own flow", async () => {
    const bad = detail("");
    api.getDocument.mockResolvedValue({ ...bad, summary: { ...bad.summary, status: "read_failed", statusReason: "unreadable_file" }, read: { ...bad.read, fields: [] } });
    renderScreen();
    const link = await screen.findByRole("link", { name: "Upload a clearer copy" });
    expect(link.getAttribute("href")).toBe("/flows/f?tab=documents");
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

  it("says why the first document from an email address waits", async () => {
    api.getDocument.mockResolvedValue(withValues([["invoice_no", "INV-1", 0.99, false]],
      [{ code: "new_sender", passed: false, fieldKey: null, message: "First document from this email address. Check it before sending." }]));
    renderScreen();
    expect(await screen.findByText("First document from this email address. Check it before sending.")).toBeTruthy();
    expect(screen.getByText("First document from this email address")).toBeTruthy(); // the tag, as on its row
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
    const read = within(await screen.findByRole("tabpanel", { name: "What we read" }));
    expect(read.getByText("1 value needs a look. The rest were read clearly.")).toBeInTheDocument();
    const boxes = read.getAllByRole("textbox");
    expect(boxes[0]).toHaveAccessibleName("supplier");                                       // marked first
    expect(boxes[0]).toHaveAccessibleDescription("Not found on the page. Type it.");
    expect(read.getByRole("heading", { name: "Read clearly" })).toBeInTheDocument();
    expect(read.getByText("Edited")).toBeInTheDocument();
    expect(read.queryByText(/%/)).toBeNull();                                                 // no percentage on a value read clearly
  });
  describe("on a download-only flow", () => {
    const made = (status: string) => ({ id: "v1", outputName: "invoices CSV", protocol: "", status, attempts: 0, lastError: null, fileName: "invoice-1043.csv", deliveredAt: null });
    const arrange = (answer: string) => {
      let sent = false;
      const base = detail("INV-1");
      const doc = () => ({ ...base, canRemove: true, summary: { ...base.summary, fileName: "invoice-1043.pdf", status: sent ? "sent" : "ready" } });
      api.getDocument.mockImplementation(async () => doc());
      api.getFlow.mockResolvedValue({ id: "f", fieldsConfirmed: false, downloadOnly: true });
      api.sendDocument.mockImplementation(async () => { sent = true; api.listDeliveries.mockResolvedValue([made(answer)]); return [made(answer)]; });
    };

    it("makes the file on a download-only flow and stays, with Download as the way on", async () => {
      arrange("stored");
      renderScreen();
      fireEvent.click(within(await screen.findByTestId("review-header-actions")).getByRole("button", { name: "Make the file" }));
      await waitFor(() => expect(within(screen.getByTestId("review-header-actions")).getByText("File ready")).toBeInTheDocument());
      const header = within(screen.getByTestId("review-header-actions"));
      expect(header.getByRole("button", { name: "Remove" })).toBeInTheDocument();
      expect(header.getByRole("link", { name: "Open next" })).toHaveAttribute("href", "/flows/f/documents/c");
      expect(header.getByRole("button", { name: "Download invoice-1043.csv" })).toBeInTheDocument();
      expect(replace).not.toHaveBeenCalled();
    });

    it("a send that went to a destination leaves the screen even on a download-only flow", async () => {
      arrange("delivered");
      renderScreen();
      fireEvent.click(within(await screen.findByTestId("review-header-actions")).getByRole("button", { name: "Make the file" }));
      await waitFor(() => expect(replace).toHaveBeenCalledWith("/flows/f/documents/c"));
    });
  });

  it("Send and open next saves first, sends once, and opens the next document", async () => {
    const order: string[] = [];
    api.editDocumentValues.mockImplementation(async () => { order.push("save"); return detail("INV-2"); });
    api.sendDocument.mockImplementation(async () => { order.push("send"); invalidate.mockClear(); return []; });
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

  it("after Send and open next, the next document's screen says the sent one is on its way, politely", async () => {
    api.sendDocument.mockResolvedValue([]);
    const qc = new QueryClient();
    const { rerender } = renderScreen(qc);
    fireEvent.click(within(await screen.findByTestId("review-header-actions")).getByRole("button", { name: "Send and open next" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/flows/f/documents/c"));
    rerender(<QueryClientProvider client={qc}><DocumentScreen flowId="f" documentId="c" /></QueryClientProvider>);
    const note = await screen.findByText("a.csv is on its way.");
    expect(note.closest("[aria-live='polite']")).not.toBeNull();
    expect(note).not.toHaveFocus();
  });

  it("a refused send is said under the header and nothing moves; the last one goes back to Documents", async () => {
    api.sendDocument.mockRejectedValueOnce(new ApiHttpError("no", 409, { error: "no_outputs" }));
    renderScreen();
    const header = within(await screen.findByTestId("review-header-actions"));
    fireEvent.click(header.getByRole("button", { name: "Send and open next" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(COPY.no_outputs);
    expect(within(screen.getByTestId("review-refusal")).getByRole("link", { name: "Open the flow's files" })).toHaveAttribute("href", "/flows/f?tab=outputs");
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
    const tabs = within(screen.getByRole("tablist", { name: "Parts of this document" }));
    fireEvent.click(tabs.getByRole("tab", { name: "What we'll send" }));
    fireEvent.click(within(screen.getByTestId("review-refusal")).getByRole("button", { name: "Show what we read" }));
    expect(tabs.getByRole("tab", { name: "What we read" })).toHaveAttribute("aria-selected", "true");
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
  it("on a narrow screen one pane shows at a time, and pointing switches to the original", async () => {
    api.getFlow.mockResolvedValue({ id: "f", fieldsConfirmed: true, fields: { fields: [], tables: [] } });
    api.getDocument.mockResolvedValue(withValues([["supplier", null, 0, false]],
      [{ code: "required_missing", passed: false, fieldKey: "supplier", message: "" }], "application/pdf", "a.pdf"));
    renderScreen();
    const tabs = within(await screen.findByRole("tablist", { name: "Parts of this document" }));
    expect(tabs.getByRole("tab", { name: "What we read" })).toHaveAttribute("aria-selected", "true");
    expect(api.fetchDocumentSource).not.toHaveBeenCalled();                    // the original is not mounted while hidden
    fireEvent.click(screen.getByRole("link", { name: "point to it on the original" }));
    expect(tabs.getByRole("tab", { name: "Original" })).toHaveAttribute("aria-selected", "true");
    expect(await within(screen.getByRole("tabpanel", { name: "Original" })).findByText(/supplier/)).toBeInTheDocument(); // the pointing help names the field
    expect(api.fetchDocumentSource).toHaveBeenCalledTimes(1);
  });
  it("a save the server rate-limits keeps what was typed, never reads as saved, and Try again sends it", async () => {
    api.editDocumentValues
      .mockRejectedValueOnce(new ApiHttpError("slow", 429, { error: "Rate limit exceeded. Please slow down and retry shortly." }))
      .mockResolvedValueOnce(detail("INV-2"));
    renderScreen();
    const input = await screen.findByLabelText("Invoice number");
    fireEvent.change(input, { target: { value: "INV-2" } });
    fireEvent.blur(input);
    const read = within(screen.getByRole("tabpanel", { name: "What we read" }));
    expect(await read.findByText("Not saved yet")).toBeInTheDocument();
    expect(input).toHaveValue("INV-2");
    fireEvent.click(read.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(api.editDocumentValues).toHaveBeenCalledTimes(2));
    expect(api.editDocumentValues).toHaveBeenLastCalledWith("d", { fields: [{ key: "invoice_no", value: "INV-2" }] });
    expect(await read.findByText("Saves as you type")).toBeInTheDocument();
  });

  it("a waiting save that is refused sends nothing and says so where Send was pressed", async () => {
    api.editDocumentValues.mockRejectedValue(new ApiHttpError("no", 409, { error: "document_sent" }));
    renderScreen();
    const header = within(await screen.findByTestId("review-header-actions"));
    fireEvent.change(screen.getByLabelText("Invoice number"), { target: { value: "INV-2" } });
    fireEvent.click(header.getByRole("button", { name: "Send and open next" }));
    expect(await screen.findByTestId("review-refusal")).toHaveTextContent(COPY.document_sent);
    expect(api.sendDocument).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it("after a send whose queue refresh failed, the person lands on Needs you", async () => {
    api.sendDocument.mockResolvedValue([]);
    renderScreen(new QueryClient({ defaultOptions: { queries: { retry: false } } }));
    const header = within(await screen.findByTestId("review-header-actions"));
    await header.findByText("2 of 3 that need you");
    api.listDocumentPage.mockRejectedValue(new Error("offline"));
    fireEvent.click(header.getByRole("button", { name: "Send and open next" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/documents?show=needs-you"));
  });
  it("a paused workspace is said with the way to Plan & billing, and the person stays on the document", async () => {
    api.sendDocument.mockRejectedValue(new ApiHttpError("paused", 429, { error: "processing_paused" }));
    renderScreen();
    const header = within(await screen.findByTestId("review-header-actions"));
    fireEvent.click(header.getByRole("button", { name: "Send and open next" }));
    const notice = within(await screen.findByTestId("review-refusal"));
    expect(notice.getByText(COPY.processing_paused)).toBeInTheDocument();
    expect(notice.getByRole("link", { name: "Open Plan & billing" })).toHaveAttribute("href", "/settings?tab=billing");
    expect(replace).not.toHaveBeenCalled();
  });

  it("a document that can no longer be sent offers Review next once per width, and no Skip or Send (R18)", async () => {
    const sent = detail("INV-1");
    api.getDocument.mockResolvedValue({ ...sent, summary: { ...sent.summary, status: "sent" } });
    renderScreen();
    const header = within(await screen.findByTestId("review-header-actions"));
    const bar = within(await screen.findByTestId("action-bar"));
    await waitFor(() => expect(header.getByRole("link", { name: "Review next" })).toHaveAttribute("href", "/flows/f/documents/c"));
    expect(header.getByRole("link", { name: "Review next" })).toHaveClass("hidden", "md:inline-flex");   // the bar draws it on a phone
    expect(bar.getByRole("link", { name: "Review next" })).toHaveAttribute("href", "/flows/f/documents/c");
    expect(screen.queryByRole("button", { name: /^(Skip|Send and open next)$/ })).toBeNull();
  });

  const ctrlEnter = (on: Element, repeat = false) => fireEvent.keyDown(on, { key: "Enter", code: "Enter", ctrlKey: true, repeat });

  it("Ctrl+Enter in a value box saves what was typed, then sends and opens the next", async () => {
    const order: string[] = [];
    api.editDocumentValues.mockImplementation(() => new Promise((ok) => setTimeout(() => { order.push("saved"); ok(detail("INV-2001")); }, 10)));
    api.sendDocument.mockImplementation(async () => { order.push("send"); return []; });
    renderScreen();
    const header = within(await screen.findByTestId("review-header-actions"));
    await waitFor(() => expect(header.getByText("2 of 3 that need you")).toBeInTheDocument());
    expect(header.getByRole("button", { name: "Send and open next" })).toHaveAttribute("aria-keyshortcuts", ariaOf("send-and-next"));
    const box = screen.getByLabelText("Invoice number");
    fireEvent.change(box, { target: { value: "INV-2001" } });
    ctrlEnter(box);                                                              // no blur first
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/flows/f/documents/c"));
    expect(api.editDocumentValues.mock.calls).toEqual([["d", { fields: [{ key: "invoice_no", value: "INV-2001" }] }]]);
    expect(order).toEqual(["saved", "send"]);                                    // sent only after the save came back
  });

  it("holding Ctrl+Enter, or pressing it again while it sends, sends once", async () => {
    let done = (_: unknown) => {};
    api.sendDocument.mockImplementation(() => new Promise((ok) => { done = ok; }));
    renderScreen();
    const header = within(await screen.findByTestId("review-header-actions"));
    await waitFor(() => expect(header.getByText("2 of 3 that need you")).toBeInTheDocument());
    const box = screen.getByLabelText("Invoice number");
    ctrlEnter(box);
    ctrlEnter(box, true);
    ctrlEnter(box, true);
    ctrlEnter(box);                                                              // released and pressed again
    await waitFor(() => expect(api.sendDocument).toHaveBeenCalledTimes(1));
    ctrlEnter(box);
    done([]);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/flows/f/documents/c"));
    expect(api.sendDocument).toHaveBeenCalledTimes(1);
  });

  it("on a document that can no longer be sent, Ctrl+Enter does nothing", async () => {
    const sent = detail("INV-1");
    api.getDocument.mockResolvedValue({ ...sent, summary: { ...sent.summary, status: "sent" } });
    renderScreen();
    const header = within(await screen.findByTestId("review-header-actions"));
    await waitFor(() => expect(header.getByRole("link", { name: "Review next" })).toBeInTheDocument());
    ctrlEnter(document.body);
    await new Promise((r) => setTimeout(r, 20));
    expect(api.sendDocument).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });
});

describe("DocumentScreen values", () => {
  it("folds the empty values behind one line, and says whether the rows add up to the total", async () => {
    const d = withValues([["number", "INV-1", 0.95, false], ["buyer", null, 0, false], ["currency", "", 0, false]]);
    const cell = (value: string) => ({ value, confidence: 0.95, location: null, notOnPage: false, edited: false });
    const read = {
      ...d.read,
      fields: [...d.read.fields, { ...field("30.00"), key: "total", label: "Total", meaning: "total_net" }],
      tables: [{
        key: "lines", label: "Lines", listed: true, columns: [{ key: "amount", label: "Amount", type: "number", meaning: "line_amount" }],
        rows: [{ cells: { amount: cell("10.00") } }, { cells: { amount: cell("20.00") } }],
      }],
    };
    api.getDocument.mockResolvedValue({ ...d, read });
    api.editDocumentValues.mockResolvedValue({ ...d, read });
    renderScreen();
    expect(await screen.findByText("2 values are empty: buyer, currency.")).toBeInTheDocument();
    expect(screen.getByLabelText("buyer").closest("[hidden]")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show them" }));
    expect(screen.getByLabelText("buyer").closest("[hidden]")).toBeNull();
    expect(screen.getByTestId("rows-sum")).toHaveTextContent("The rows add up to 30.00, the same as Total.");
    fireEvent.change(screen.getByLabelText("Lines row 2 Amount"), { target: { value: "25" } });
    expect(screen.getByTestId("rows-sum")).toHaveTextContent("The rows add up to 35.00. Total says 30.00.");
  });
});
