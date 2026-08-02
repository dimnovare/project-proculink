import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Order } from "@/types/procurement";
import { ConfirmProvider } from "@/components/ui/confirm";

/**
 * The panel must ACTUALLY route the supplier's body through supplierReasonText.
 *
 * The unit tests next door pin the function. They do not pin that anything calls it — bypassing the
 * call in OrderProblemPanel left all of them green, which is the exact defect class this repo keeps
 * finding. This file renders the panel and asserts on what reaches the screen, so deleting the call
 * turns it red.
 *
 * Source: `docs/qa/2026-08-01-wp-39-authenticated-production-pass.md` §4.4 — a live 404 whose body
 * was an HTML error page was shown to the operator as the reason their order failed.
 */

const api = {
  getOrderPassport: vi.fn(),
  redeliverOrder: vi.fn(),
  markDelivered: vi.fn(),
  transformOrder: vi.fn(),
  retryDelivery: vi.fn(),
  getOrderById: vi.fn(),
  requeueDelivery: vi.fn(),
};

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    redeliverOrder: (...a: unknown[]) => api.redeliverOrder(...a),
    markDelivered: (...a: unknown[]) => api.markDelivered(...a),
    transformOrder: (...a: unknown[]) => api.transformOrder(...a),
    retryDelivery: (...a: unknown[]) => api.retryDelivery(...a),
    getOrderById: (...a: unknown[]) => api.getOrderById(...a),
    getOrderPassport: (...a: unknown[]) => api.getOrderPassport(...a),
  },
  requeueDelivery: (...a: unknown[]) => api.requeueDelivery(...a),
  getOpsHealth: vi.fn().mockResolvedValue({ workerHealthy: true }),
}));

vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => true }));

import { OrderProblemPanel } from "../OrderProblemPanel";

const REJECTED = {
  id: "ord-rej-1",
  poNumber: "PO-90210",
  status: "rejected_by_supplier",
  supplierId: "sup-9",
  supplierName: "Nordmark",
  currency: "EUR",
  orderDate: "2026-08-01",
  lines: [],
  artifacts: [],
  errorMessage: null,
} as unknown as Order;

function renderWithReason(rejectionReason: string) {
  api.getOrderPassport.mockResolvedValue({ supplierResponse: { outcome: "rejected", rejectionReason } });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ConfirmProvider>
        <OrderProblemPanel order={REJECTED} />
      </ConfirmProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.getOrderPassport.mockResolvedValue(null);
});

describe("the panel does not show the operator a supplier's markup", () => {
  it("renders the readable text from an HTML error page, never the tags", async () => {
    renderWithReason(
      "<!DOCTYPE html><html><head><title>404 Not Found</title></head>" +
        "<body><h1>Not Found</h1><p>The requested URL was not found on this server.</p></body></html>",
    );

    // The sentence inside survives.
    expect(await screen.findByText(/requested URL was not found/i)).toBeTruthy();

    // The markup does not. document.body.textContent is what a human actually reads.
    const shown = document.body.textContent ?? "";
    expect(shown).not.toContain("<html");
    expect(shown).not.toContain("DOCTYPE");
    expect(shown).not.toContain("<p>");
  });

  it("passes a supplier's plain sentence through unchanged", async () => {
    renderWithReason("Rejected: PO number already received on 2026-07-14.");
    expect(await screen.findByText(/already received on 2026-07-14/i)).toBeTruthy();
  });
});
