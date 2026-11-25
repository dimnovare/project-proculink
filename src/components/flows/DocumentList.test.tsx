import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiHttpError } from "@/lib/api/core";
import type { DocumentRow } from "@/lib/api/documents";
import { DocumentList, rowNeed } from "./DocumentList";
import { WaitingList } from "./WaitingList";

const { sendDocument, deleteDocument } = vi.hoisted(() => ({ sendDocument: vi.fn(), deleteDocument: vi.fn() }));
vi.mock("@/lib/api/documents", () => ({ sendDocument, deleteDocument }));
const confirm = vi.hoisted(() => vi.fn());
vi.mock("@/components/ui/confirm", () => ({ useConfirm: () => confirm }));

const row = (over: Partial<DocumentRow> = {}): DocumentRow => ({
  id: "d1", flowId: "f1", flowName: "Supplier invoices", fileName: "invoice-2291.pdf", status: "needs_review", statusReason: null,
  pageCount: null, billingUnits: 1, failedChecks: 0, createdAt: "2026-11-01T10:00:00Z", source: "upload", sourceRef: null,
  number: null, sender: null, checks: [], sentAt: null, failedAt: null, stop: null, isSample: false, inInbox: false, ...over,
});

const tree = (qc: QueryClient, status = "ready") => (
  <QueryClientProvider client={qc}>
    <DocumentList label="Documents: Needs you" showFlow sendable
      documents={[row({ id: "a", fileName: "PO-48213.pdf", status }), row({ id: "b" })]} />
  </QueryClientProvider>
);
const renderList = (qc = new QueryClient()) => {
  const { rerender } = render(tree(qc));
  return { table: within(screen.getByRole("table", { name: "Documents: Needs you" })), rerender };
};

beforeEach(() => vi.clearAllMocks());

describe("DocumentList", () => {
  it("names the first document from an email address, never as a value to check, and a repeated number wins", () => {
    expect(rowNeed(row({ failedChecks: 1, checks: ["new_sender"] }))).toEqual({ text: "Check the sender", tone: "amber" });
    expect(rowNeed(row({ failedChecks: 2, checks: ["new_sender", "duplicate"] })).text).toBe("Same number as an earlier document");
  });

  it("says what each row needs, from what is known about it", () => {
    expect(rowNeed(row({ status: "ready" }))).toEqual({ text: "Ready to send", tone: "amber" });
    // Our sample is never sent, so its row never says it is ready to send.
    expect(rowNeed(row({ status: "ready", isSample: true }))).toEqual({ text: "Nothing to send", tone: "amber" });
    expect(rowNeed(row({ failedChecks: 2, checks: ["low_confidence", "required_missing"] }))).toEqual({ text: "2 values to check", tone: "amber" });
    expect(rowNeed(row({ failedChecks: 1, checks: ["type_invalid"] })).text).toBe("1 value to check");
    expect(rowNeed(row({ failedChecks: 3, checks: ["low_confidence", "duplicate"] })).text).toBe("Same number as an earlier document");
    expect(rowNeed(row({ statusReason: "duplicate_file", failedChecks: 1, checks: ["duplicate"], inInbox: false }))).toEqual({ text: "Already added", tone: "amber" });
    expect([true, undefined].map((inInbox) => rowNeed(row({ statusReason: "duplicate_file", inInbox })).text)).toEqual(["Already added", "Already added"]);
    expect(rowNeed(row({ status: "ready", downloadOnly: true })).text).toBe("Nothing to check");
    expect(rowNeed(row({ status: "sent", files: [{ deliveryId: "v", fileName: "invoice-2291.csv", delivered: false, destination: null }] })).text).toBe("File ready");
    expect(rowNeed(row({ failedChecks: 1, checks: ["text_truncated"] })).text).toBe("Needs review");
    expect(rowNeed(row({ status: "read_failed" }))).toEqual({ text: "Not read", tone: "danger" });
    expect(rowNeed(row({ status: "reading" }))).toEqual({ text: "Reading", tone: "blue" });
    expect(rowNeed(row({ status: "sent" }))).toEqual({ text: "Sent", tone: "green" });
    expect(rowNeed(row({ status: "on_hold" })).text).toBe("on_hold"); // a newer server's status is shown, never as sent
    const { checks: _checks, number: _number, ...bare } = row({ failedChecks: 2 }); // a summary from the bare list
    expect(rowNeed(bare).text).toBe("Needs review");
  });

  it("offers Send only on a ready row, sends once, and the row then says Sending", async () => {
    sendDocument.mockResolvedValue([]);
    const qc = new QueryClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { table, rerender } = renderList(qc);
    expect(table.getAllByRole("button")).toHaveLength(1);
    fireEvent.click(table.getByRole("button", { name: "Send PO-48213.pdf" }));
    await waitFor(() => expect(table.getByRole("row", { name: /PO-48213\.pdf/ })).toHaveTextContent("Sending"));
    expect(sendDocument.mock.calls).toEqual([["a"]]);
    expect(table.queryByRole("button")).toBeNull();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["documents"] });
    rerender(tree(qc, "send_failed")); // the server's state replaces the row's own "Sending"
    const sentRow = table.getByRole("row", { name: /PO-48213\.pdf/ });
    expect(sentRow).toHaveTextContent("Couldn't send");
    expect(sentRow).not.toHaveTextContent("Sending");
    rerender(<QueryClientProvider client={qc}><DocumentList label="Documents: Needs you" showFlow sendable documents={[row({ id: "b" })]} /></QueryClientProvider>);
    expect(table.queryByRole("row", { name: /PO-48213\.pdf/ })).toBeNull();   // the server stopped listing it: the row goes
  });

  it("never offers Send for our sample, which the server would refuse", () => {
    render(<QueryClientProvider client={new QueryClient()}><DocumentList label="Documents: All" showFlow sendable documents={[row({ status: "ready", isSample: true })]} /></QueryClientProvider>);
    expect(within(screen.getByRole("table", { name: "Documents: All" })).queryByRole("button", { name: /^Send/ })).toBeNull();
  });

  it("says what each document is, and a downloaded one is not sent", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <DocumentList label="Documents: All" showFlow sendable documents={[
          row({ id: "i", fileName: "invoice-2292.pdf", kind: "Invoice", sender: "Example Supplier Ltd", number: "2292", inInbox: false }),
          row({ id: "n", fileName: "statement.pdf", flowId: "inbox", flowName: "New documents", statusReason: "new_kind", kind: null, inInbox: true, createdAt: "2026-11-02T10:00:00Z" }),
          row({ id: "d", fileName: "remittance.pdf", status: "sent", statusReason: "downloaded", inInbox: true, createdAt: "2026-10-30T10:00:00Z" }),
          row({ id: "r", fileName: "price-list.xlsx", status: "ready", inInbox: true, createdAt: "2026-10-29T10:00:00Z" }),
          row({ id: "u", fileName: "unplaced.pdf", status: "ready", inInbox: undefined, createdAt: "2026-10-28T10:00:00Z" }),
          row({ id: "c", fileName: "delivery-note-70.pdf", status: "ready", statusReason: "check_sort", inInbox: false, createdAt: "2026-10-27T10:00:00Z" }),
        ]} />
      </QueryClientProvider>,
    );
    const table = within(screen.getByRole("table", { name: "Documents: All" }));
    const invoice = table.getByRole("row", { name: /invoice-2292\.pdf/ });
    expect(within(invoice).getByText("An invoice from Example Supplier Ltd")).toBeInTheDocument();
    const inbox = within(table.getByRole("row", { name: /statement\.pdf/ })).getAllByRole("cell");
    expect(inbox[1]).toHaveTextContent(/^New documents$/);
    expect(inbox[2]).toHaveTextContent("First of its kind");
    expect(within(inbox[2]).getByTitle("First of its kind")).toBeInTheDocument(); // a pill that must cut keeps its words on hover
    expect(inbox[5]).toHaveTextContent(/^Review$/);
    expect(table.queryByRole("button", { name: "Send price-list.xlsx" })).toBeNull(); // a ready inbox document is never sent from a row
    // Not known to be with a flow: not sent from the row either, and "Review" is the way on.
    expect(within(table.getByRole("row", { name: /unplaced\.pdf/ })).getAllByRole("cell")[5]).toHaveTextContent(/^Review$/);
    // A sort we were not sure of is never sent from a row: its notice is on the review screen.
    expect(within(table.getByRole("row", { name: /delivery-note-70\.pdf/ })).getAllByRole("cell")[5]).toHaveTextContent(/^Review$/);
    const downloaded = within(table.getByRole("row", { name: /remittance\.pdf/ })).getAllByRole("cell");
    expect(downloaded[2]).toHaveTextContent("Downloaded");
    expect(downloaded.filter((c) => /\bSent\b/.test(c.textContent ?? ""))).toEqual([]);
    const phone = within(screen.getByTestId("documents-phone-list"));
    const phoneInvoice = within(phone.getByRole("link", { name: /invoice-2292\.pdf/ }));
    expect(phoneInvoice.getByText("An invoice from Example Supplier Ltd")).toBeInTheDocument();
    expect(phoneInvoice.queryByText("Supplier invoices")).toBeNull();
  });

  it("the waiting list says what a document is, or who it is from, before its flow", () => {
    const items = [row({ id: "s", fileName: "scan.pdf", sender: "Example Supplier Ltd", kind: null })];
    render(<WaitingList queue={{ items, totalCount: 1, page: 1, pageSize: 20, sampleCount: 0 }} currentId="x" />);
    expect(within(screen.getByRole("link", { name: /scan\.pdf/ })).getByText(/^From Example Supplier Ltd/)).toBeInTheDocument();
  });

  it("selecting, a click on the row (not the box) ticks it and opens nothing, on both layouts, an inbox row too", () => {
    const toggle = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <DocumentList label="Documents" showFlow documents={[row({ id: "a", fileName: "PO-48213.pdf", statusReason: "new_kind", inInbox: true, canRemove: true })]} selection={{ ids: new Set(), toggle, all: vi.fn() }} />
      </QueryClientProvider>,
    );
    expect(screen.queryByRole("link", { name: /PO-48213\.pdf/ })).toBeNull();
    // A new kind waits in the inbox, and can still be removed with others at once.
    expect(within(screen.getByRole("table", { name: "Documents" })).getByRole("checkbox", { name: "Select PO-48213.pdf" })).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("table", { name: "Documents" })).getByText("PO-48213.pdf"));
    fireEvent.click(within(screen.getByTestId("documents-phone-list")).getByTestId("document-name"));
    expect(toggle.mock.calls).toEqual([["a"], ["a"]]);
    // The bar acts on the ticked rows: a row draws no button of its own while selecting.
    expect(within(screen.getByRole("table", { name: "Documents" })).queryByRole("button")).toBeNull();
  });

  it("after a removal the list keeps focus and says what was removed", async () => {
    deleteDocument.mockResolvedValue(undefined);
    confirm.mockResolvedValue(true);
    render(
      <QueryClientProvider client={new QueryClient()}>
        <DocumentList label="Documents" showFlow documents={[row({ id: "a", fileName: "PO-48213.pdf", statusReason: "duplicate_file", canRemove: true }), row({ id: "b" })]} />
      </QueryClientProvider>,
    );
    const table = screen.getByRole("table", { name: "Documents" });
    within(table).getByRole("button", { name: "Remove PO-48213.pdf" }).focus();
    fireEvent.click(within(table).getByRole("button", { name: "Remove PO-48213.pdf" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("PO-48213.pdf removed."));
    await waitFor(() => expect(document.activeElement).toBe(table));
    expect(within(table).queryByText("PO-48213.pdf")).toBeNull();
  });

  it("a refused send says why on the row and keeps Send", async () => {
    sendDocument.mockRejectedValue(new ApiHttpError("no", 409, { error: "not_ready" }));
    const { table } = renderList();
    fireEvent.click(table.getByRole("button", { name: "Send PO-48213.pdf" }));
    expect(await table.findByRole("alert")).toHaveTextContent("This document can't be sent right now. Reload to see its latest state.");
    expect(table.getByRole("button", { name: "Send PO-48213.pdf" })).toBeEnabled();
  });
});
