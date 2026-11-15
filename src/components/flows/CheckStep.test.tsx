import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { DocumentDetail, DocumentRow, Flow, FlowField, FlowOutput, ReadField } from "@/lib/api/documents";
import { readFailureMessage } from "@/lib/documentRefusals";
import { CheckStep } from "./CheckStep";

const api = vi.hoisted(() => ({
  getDocument: vi.fn(), listDocumentPage: vi.fn(), retryDocumentRead: vi.fn(), editDocumentValues: vi.fn(), fetchDocumentSource: vi.fn(),
  listOutputs: vi.fn(), createOutput: vi.fn(), updateFlow: vi.fn(), saveFlowFields: vi.fn(),
}));
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("@/lib/api/documents", () => api);
vi.mock("@/lib/analytics", () => ({ capture: vi.fn() }));
vi.mock("@/hooks/useQueriesEnabled", () => ({ useTenantQueriesEnabled: () => true }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const unconfirmed: Flow = {
  id: "f-1", name: "New flow", fieldsConfirmed: false, fields: { fields: [], tables: [] }, documentCount: 1, createdAt: "2026-11-15T09:00:00Z",
  automation: "review", scansOn: true, formatsOn: false,
};
const row: DocumentRow = {
  id: "d-1", flowId: "f-1", flowName: "New flow", fileName: "invoice.pdf", status: "needs_review", statusReason: null, pageCount: 1,
  billingUnits: 1, failedChecks: 0, createdAt: "2026-11-15T09:00:00Z", source: "upload", sourceRef: null,
  number: null, sender: null, checks: [], sentAt: null, failedAt: null, stop: null, isSample: false,
};
const value = (label: string, confidence = 0.97): ReadField => ({
  key: label.toLowerCase().replaceAll(" ", "_"), label, value: `${label} value`, type: "text", meaning: null, confidence,
  location: null, notOnPage: false, listed: true, edited: false,
});
const COLUMNS = ["Code", "Item", "Qty", "Price", "Amount"];
const cell = { value: "1", confidence: 0.97, location: null, notOnPage: false, edited: false };
const detail = { summary: row, contentType: "application/pdf", checks: [] } as unknown as DocumentDetail;
const sampleDetail: DocumentDetail = {
  ...detail,
  read: {
    kindLabel: "Invoice", truncated: false,
    fields: [...["Invoice number", "Date", "Supplier", "Supplier address", "Bill to", "Currency", "Total", "Payment terms"].map((l) => value(l)), value("Reference", 0.62)],
    tables: [{
      key: "lines", label: "Lines", listed: true, columns: COLUMNS.map((c) => ({ key: c.toLowerCase(), label: c, type: "text", meaning: null })),
      rows: [0, 1, 2].map(() => ({ cells: Object.fromEntries(COLUMNS.map((c) => [c.toLowerCase(), cell])) })),
    }],
  },
};
const csvOutput = { id: "o-1", flowId: "f-1", name: "CSV file", format: "csv" } as FlowOutput;
const freshWrapper = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};
const wrapper = freshWrapper();

beforeEach(() => {
  vi.clearAllMocks();
  api.fetchDocumentSource.mockReturnValue(new Promise(() => {}));
  // A desk: both panes are shown and each is a region named by its heading.
  window.matchMedia = ((q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) as unknown as typeof window.matchMedia;
});

describe("CheckStep", () => {
  it("keeps the original beside the values, marks an unsure value in words, and saves only once on Next", async () => {
    api.getDocument.mockResolvedValue(sampleDetail);                  // nine values, one table, Reference at 0.62
    api.listDocumentPage.mockResolvedValue({ items: [{ ...row, isSample: true }], totalCount: 1, page: 1, pageSize: 20, sampleCount: 1 });
    api.listOutputs.mockResolvedValue([]);
    api.updateFlow.mockResolvedValue({ ...unconfirmed, name: "Invoices" });
    api.saveFlowFields.mockResolvedValue({ ...unconfirmed, name: "Invoices", fieldsConfirmed: true });
    api.createOutput.mockResolvedValue(csvOutput);
    render(<CheckStep flow={unconfirmed} docId="d-1" first />, { wrapper });
    const found = await screen.findByRole("region", { name: "Here's what we found" });
    expect(within(found).getByText("9 values and 1 table")).toBeInTheDocument();
    expect(within(found).getByLabelText("Flow name")).toHaveValue("Invoices");
    expect(within(screen.getByTestId("check-value-reference")).getByText(/Check this one\. We are 62% sure of it\./)).toBeInTheDocument();
    expect(within(found).getByText("1 value needs a look.")).toBeInTheDocument();
    expect(within(screen.getByTestId("check-table-lines")).getByText("3 rows, 5 columns (Code, Item, Qty, Price, Amount)")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Original" })).toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId("check-value-bill_to")).getByRole("checkbox", { name: "Keep Bill to" }));
    const next = screen.getByRole("button", { name: "Looks right, next" });
    fireEvent.click(next);
    fireEvent.click(next);
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/flows/new?step=send&flow=f-1&doc=d-1"));
    expect(api.saveFlowFields).toHaveBeenCalledTimes(1);
    expect(api.saveFlowFields.mock.calls[0][1].fields.map((f: FlowField) => f.key)).not.toContain("bill_to");
    expect(api.createOutput).toHaveBeenCalledWith("f-1", { name: "CSV file", format: "csv" });
    expect(api.updateFlow).toHaveBeenCalledWith("f-1", { name: "Invoices" });
  });

  it("a document we couldn't read, or with nothing on it, never shows an empty check", async () => {
    api.listDocumentPage.mockResolvedValue({ items: [row], totalCount: 1, page: 1, pageSize: 20, sampleCount: 0 });
    api.getDocument.mockResolvedValue({ ...detail, summary: { ...row, status: "read_failed", statusReason: "unreadable_file" }, read: null });
    const { unmount } = render(<CheckStep flow={unconfirmed} docId="d-1" first />, { wrapper });
    expect(await screen.findByText(readFailureMessage("unreadable_file"))).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Use another file" })).toHaveAttribute("href", "/flows/new?flow=f-1");
    expect(screen.queryByRole("button", { name: "Looks right, next" })).toBeNull();
    unmount();
    api.getDocument.mockResolvedValue({ ...detail, read: { kindLabel: "", fields: [], tables: [], truncated: false } });
    render(<CheckStep flow={unconfirmed} docId="d-1" first />, { wrapper: freshWrapper() });
    expect(await screen.findByText("We couldn't find any values on this document.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Looks right, next" })).toBeNull();
  });
});
