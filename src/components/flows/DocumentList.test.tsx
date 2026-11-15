import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiHttpError } from "@/lib/api/core";
import type { DocumentRow } from "@/lib/api/documents";
import { DocumentList, rowNeed } from "./DocumentList";

const { sendDocument } = vi.hoisted(() => ({ sendDocument: vi.fn() }));
vi.mock("@/lib/api/documents", () => ({ sendDocument }));

const row = (over: Partial<DocumentRow> = {}): DocumentRow => ({
  id: "d1", flowId: "f1", flowName: "Supplier invoices", fileName: "invoice-2291.pdf", status: "needs_review", statusReason: null,
  pageCount: null, billingUnits: 1, failedChecks: 0, createdAt: "2026-11-01T10:00:00Z", source: "upload", sourceRef: null,
  number: null, sender: null, checks: [], sentAt: null, failedAt: null, stop: null, isSample: false, ...over,
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
  it("says what each row needs, from what is known about it", () => {
    expect(rowNeed(row({ status: "ready" }))).toEqual({ text: "Ready to send", tone: "green" });
    expect(rowNeed(row({ failedChecks: 2, checks: ["low_confidence", "required_missing"] }))).toEqual({ text: "2 values to check", tone: "amber" });
    expect(rowNeed(row({ failedChecks: 1, checks: ["type_invalid"] })).text).toBe("1 value to check");
    expect(rowNeed(row({ failedChecks: 3, checks: ["low_confidence", "duplicate"] })).text).toBe("Same number as an earlier document");
    expect(rowNeed(row({ statusReason: "duplicate_file", failedChecks: 1, checks: ["duplicate"] }))).toEqual({ text: "Already uploaded to this flow", tone: "amber" });
    expect(rowNeed(row({ failedChecks: 1, checks: ["text_truncated"] })).text).toBe("Needs review");
    expect(rowNeed(row({ status: "read_failed" }))).toEqual({ text: "Couldn't read", tone: "danger" });
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

  it("a refused send says why on the row and keeps Send", async () => {
    sendDocument.mockRejectedValue(new ApiHttpError("no", 409, { error: "not_ready" }));
    const { table } = renderList();
    fireEvent.click(table.getByRole("button", { name: "Send PO-48213.pdf" }));
    expect(await table.findByRole("alert")).toHaveTextContent("This document can't be sent right now. Reload to see its latest state.");
    expect(table.getByRole("button", { name: "Send PO-48213.pdf" })).toBeEnabled();
  });
});
