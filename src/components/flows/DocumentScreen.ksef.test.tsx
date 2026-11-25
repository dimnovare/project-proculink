import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiHttpError } from "@/lib/api/core";
import { ConfirmProvider } from "@/components/ui/confirm";
import { DocumentScreen } from "./DocumentScreen";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("@/hooks/useQueriesEnabled", () => ({ useTenantQueriesEnabled: () => true }));

const api = vi.hoisted(() => ({
  getDocument: vi.fn(), getDocumentHistory: vi.fn(), fetchDocumentSource: vi.fn(), getFlow: vi.fn(),
  listOutputs: vi.fn(), listDestinations: vi.fn(), listDeliveries: vi.fn(), sendDocument: vi.fn(), listDocumentPage: vi.fn(), getInbox: vi.fn(),
}));
vi.mock("@/lib/api/documents", () => api);

const summary = {
  sellerName: "Przykładowa Spółka Testowa sp. z o.o.", sellerNip: "1111111111", buyerName: "Fikcyjny Odbiorca S.A.", buyerId: "9999999999",
  number: "FV/2026/11/0001", issueDate: "2026-11-25", saleDate: null, currency: "PLN", rates: [{ rate: "23", net: "243.90", vat: "56.10" }],
  gross: "300.00", lines: 1, confirm: "ab12",
};

beforeEach(() => {
  vi.clearAllMocks();
  api.getDocument.mockResolvedValue({
    summary: { id: "d", flowId: "f", flowName: "Invoices", fileName: "fv.pdf", status: "needs_review", statusReason: null,
      pageCount: null, billingUnits: 1, failedChecks: 0, createdAt: "", source: "upload", sourceRef: null },
    contentType: "text/csv", read: { kindLabel: null, fields: [], tables: [], truncated: false }, checks: [],
  });
  api.getDocumentHistory.mockResolvedValue([]);
  api.getInbox.mockResolvedValue({ flowId: "inbox", address: null, intakeId: null });
  api.getFlow.mockResolvedValue({ id: "f", fieldsConfirmed: true });
  api.listOutputs.mockResolvedValue([{ id: "o", flowId: "f", name: "KSeF", format: "", standard: "ksef-fa-3", tableKey: null, destinationId: "k", template: {}, createdAt: "" }]);
  api.listDestinations.mockResolvedValue([]);
  api.listDeliveries.mockResolvedValue([]);
  api.fetchDocumentSource.mockRejectedValue(new Error("no source"));
  api.listDocumentPage.mockResolvedValue({ items: [], totalCount: 0, page: 1, pageSize: 50 });
  api.sendDocument.mockRejectedValue(new ApiHttpError("confirm", 409, { error: "ksef_confirm", summaries: [summary], confirm: "ab12" }));
});

describe("DocumentScreen KSeF", () => {
  it("a KSeF Production send shows what is issued, and only Issue in KSeF sends it with the confirmation", async () => {
    render(<QueryClientProvider client={new QueryClient()}><ConfirmProvider><DocumentScreen flowId="f" documentId="d" /></ConfirmProvider></QueryClientProvider>);
    const sendButton = async () => within(await screen.findByTestId("review-header-actions")).getByRole("button", { name: /^Send/ });
    fireEvent.click(await sendButton());
    const dialog = await screen.findByRole("alertdialog", { name: "Issue this invoice in KSeF?" });
    expect(dialog).toHaveTextContent("in the name of Przykładowa Spółka Testowa sp. z o.o., NIP 1111111111.");
    expect(dialog).toHaveTextContent("FV/2026/11/0001");
    expect(dialog).toHaveTextContent("300.00 PLN");
    expect(screen.queryByTestId("review-refusal")).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Not now" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(api.sendDocument).toHaveBeenCalledTimes(1);

    fireEvent.click(await sendButton());
    await waitFor(() => expect(api.sendDocument).toHaveBeenCalledTimes(2));
    api.sendDocument.mockResolvedValueOnce([]);
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Issue in KSeF" }));
    await waitFor(() => expect(api.sendDocument).toHaveBeenCalledTimes(3));
    expect(api.sendDocument).toHaveBeenLastCalledWith("d", "ab12");
  });
});
