import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const push = vi.fn();
const getAuditLog = vi.fn();

vi.mock("@/lib/api-client", () => ({
  getAuditLog: (...a: unknown[]) => getAuditLog(...a),
  isApiMockMode: false,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(),
}));

import { CrossingsLog } from "./CrossingsLog";

const BASE = {
  ts: "2026-08-06T09:15:00.000Z",
  orderId: null,
  poNumber: null,
  buyerName: null,
  supplierName: null,
  format: null,
  actorType: "system" as const,
  actorName: "System",
  actorInitials: "SY",
  payload: null,
};

function open(text: string) {
  const row = screen.getByText(text);
  ((row.closest('[role="button"]') ?? row.parentElement!) as HTMLElement).click();
}

afterEach(cleanup);

describe("CrossingsLog — document rows", () => {
  it("shows the document's name and links to it; a deleted document gets no link", async () => {
    getAuditLog.mockResolvedValue({
      events: [
        { ...BASE, id: "e1", action: "document.sent", message: "Sent · Invoice-1.pdf", documentId: "d1", flowId: "f1", documentName: "Invoice-1.pdf" },
      ],
      total: 1, page: 1, pageSize: 50,
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><CrossingsLog /></QueryClientProvider>);

    expect(await screen.findByText("Invoice-1.pdf")).toBeInTheDocument();
    open("Invoice-1.pdf");
    (await screen.findByRole("button", { name: /View document/ })).click();
    expect(push).toHaveBeenCalledWith("/flows/f1/documents/d1");

    cleanup();
    getAuditLog.mockResolvedValue({
      events: [{ ...BASE, id: "e2", poNumber: "PO-9", orderId: "o9", action: "document.sent", message: "Sent · Gone.pdf", documentId: null, flowId: null, documentName: null }],
      total: 1, page: 1, pageSize: 50,
    });
    render(<QueryClientProvider client={qc}><CrossingsLog /></QueryClientProvider>);
    await screen.findByText("PO-9");
    open("PO-9");
    await screen.findByRole("button", { name: /View order/ });
    expect(screen.queryByRole("button", { name: /View document/ })).toBeNull();
  });
});
