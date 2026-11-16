import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Flow, FlowFieldList } from "@/lib/api/documents";
import { FlowDraftProvider } from "./flowDraft";
import { FlowValues } from "./FlowValues";

vi.mock("@/hooks/useQueriesEnabled", () => ({ useTenantQueriesEnabled: () => true }));
const api = vi.hoisted(() => ({ listDocuments: vi.fn(), getDocument: vi.fn(), saveFlowFields: vi.fn() }));
vi.mock("@/lib/api/documents", () => api);
const queue = vi.hoisted(() => ({ add: vi.fn() }));
vi.mock("./UploadQueue", () => ({ useUploadQueue: () => queue }));

const field = (key: string, label: string) => ({ key, label, type: "text", meaning: null, required: false });
const fields: FlowFieldList = {
  fields: [field("invoice_number", "Invoice number"), field("vat", "VAT"), field("due_date", "Due date")],
  tables: [{ key: "lines", label: "Lines", columns: [field("item", "Item")] }],
};
const flow = {
  id: "flow-1", name: "Supplier invoices", fieldsConfirmed: true, fields, documentCount: 1,
  createdAt: "", automation: "review", publishedVersion: 1, hasChanges: false, noCorrectionStreak: null,
} as Flow;

const readField = (key: string, label: string, value: string) => ({
  key, label, value, type: "text", meaning: null, confidence: 0.99, location: null, notOnPage: false, listed: true, edited: false,
});
const detail = {
  summary: { id: "doc-1", flowId: "flow-1", fileName: "invoice-1001.csv", status: "needs_review", statusReason: null, createdAt: "2026-11-01T10:00:00Z" },
  contentType: "text/csv", checks: [],
  read: {
    kindLabel: null, truncated: false,
    fields: [readField("invoice_number", "Invoice number", "1001"), readField("vat", "VAT", "24.00")],
    tables: [{ key: "lines", label: "Lines", listed: true, columns: [{ key: "item", label: "Item", type: "text", meaning: null }], rows: [] }],
  },
};

const mount = (f: Flow) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <FlowDraftProvider flowId={f.id}><FlowValues flow={f} /></FlowDraftProvider>
    </QueryClientProvider>,
  );

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  api.listDocuments.mockResolvedValue([detail.summary]);
  api.getDocument.mockResolvedValue(detail);
  api.saveFlowFields.mockImplementation(async (_id: string, list: FlowFieldList) => ({ ...flow, fields: list }));
});
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

describe("FlowValues", () => {
  it("a confirmed flow saves a change on its own, and says nothing once it is saved", async () => {
    mount({ ...flow, publishedVersion: null });
    fireEvent.click(screen.getByRole("checkbox", { name: "Read VAT" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    await waitFor(() => expect(api.saveFlowFields).toHaveBeenCalledTimes(1));
    const [id, list] = api.saveFlowFields.mock.calls[0] as [string, FlowFieldList];
    expect(id).toBe("flow-1");
    expect(list.fields.map((f) => f.key)).toEqual(["invoice_number", "due_date"]);
    await waitFor(() => expect(screen.queryByText("Saving…")).toBeNull());
    expect(screen.queryByText("Saved")).toBeNull();
  });

  it("an unconfirmed flow does not save until kept", async () => {
    mount({ ...flow, fieldsConfirmed: false, fields: { fields: [], tables: [] } });
    fireEvent.click(await screen.findByRole("checkbox", { name: "Read VAT" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(api.saveFlowFields).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Keep these values" }));
    await waitFor(() => expect(api.saveFlowFields).toHaveBeenCalledTimes(1));
    expect((api.saveFlowFields.mock.calls[0][1] as FlowFieldList).fields.map((f) => f.key)).toEqual(["invoice_number"]);
  });

  it("the example column names its file and says what is missing", async () => {
    mount(flow);
    expect(await screen.findByRole("columnheader", { name: "Example from invoice-1001.csv" })).toBeTruthy();
    const row = (name: string) => screen.getByRole("textbox", { name: `Name for ${name}` }).closest("tr")!;
    expect(row("Due date").textContent).toContain("Not found on this document");
    expect(row("Invoice number").textContent).toContain("1001");
    expect(row("Invoice number").textContent).not.toContain("Not found on this document");
  });

  it("a value row shows tick, name, example and More; Required sits inside More", async () => {
    mount(flow);
    await screen.findByRole("columnheader", { name: "Example from invoice-1001.csv" });
    const row = screen.getByRole("textbox", { name: "Name for Invoice number" }).closest("tr")!;
    expect(within(row).queryByRole("checkbox", { name: "Invoice number is required" })).toBeNull();
    fireEvent.click(within(row).getByRole("button", { name: "More for Invoice number" }));
    expect(document.activeElement).toBe(screen.getByRole("checkbox", { name: "Invoice number is required" }));
    expect(screen.getByText("We mark the value when it is missing from a document.")).toBeTruthy();
    expect(screen.queryByText(/Required means we mark|save as a draft/)).toBeNull();
  });

  it("a More opened by a problem stays open while the person fixes it, with focus in the control", async () => {
    mount({ ...flow, fields: { ...fields, fields: [{ ...field("invoice_number", "Invoice number"), type: "barcode" }] } });
    const type = (await screen.findAllByRole("combobox", { name: "Type" }))[0];
    expect(screen.queryByRole("button", { name: "More for Invoice number" })).toBeNull(); // held open: no More to press
    type.focus();
    fireEvent.change(type, { target: { value: "text" } });
    expect(type).toBeInTheDocument();
    expect(document.activeElement).toBe(type);
    expect(screen.getByRole("button", { name: "More for Invoice number" })).toHaveAttribute("aria-expanded", "true");
  });

  it("before the first document, a drop zone adds one to this flow", async () => {
    api.listDocuments.mockResolvedValue([]);
    const first = { ...flow, fieldsConfirmed: false, fields: { fields: [], tables: [] } };
    mount(first);
    expect(await screen.findByText("Drop one document like the ones this flow will get.")).toBeTruthy();
    const file = new File(["x"], "invoice-2292.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByLabelText("Choose a file"), { target: { files: [file] } });
    expect(queue.add).toHaveBeenCalledWith([file], first);
  });

  it("a first document being read says so in place of the drop zone; a failed read links to it and offers the drop zone", async () => {
    const first = { ...flow, fieldsConfirmed: false, fields: { fields: [], tables: [] } };
    const pending = { ...detail.summary, id: "doc-2", fileName: "invoice-2292.pdf", status: "reading" };
    api.listDocuments.mockResolvedValue([pending]);
    const { unmount } = mount(first);
    expect(await screen.findByText("We are reading invoice-2292.pdf. Its values appear here in a moment.")).toBeTruthy();
    expect(screen.queryByText("Drop one document like the ones this flow will get.")).toBeNull();
    unmount();
    api.listDocuments.mockResolvedValue([{ ...pending, status: "read_failed" }]);
    mount(first);
    expect(await screen.findByText("We couldn't read invoice-2292.pdf.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open it" })).toHaveAttribute("href", "/flows/flow-1/documents/doc-2");
    expect(screen.getByText("Drop one document like the ones this flow will get.")).toBeTruthy();
  });
});
