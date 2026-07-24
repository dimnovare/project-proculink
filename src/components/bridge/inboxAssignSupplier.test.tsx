import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConfirmProvider } from "@/components/ui/confirm";
import type { OrderSummary } from "@/types/procurement";

// The inbox row for an order parked `unrouted`.
//
// Two separate defects live in the same cell. An unrouted order has NO supplier — the
// backend has nothing to put in `supplierName` — so the "Buyer → Supplier" cell rendered
// the buyer, an arrow, and then NOTHING. The row that most needs an operator was the one
// with a blank where the answer goes, and the inbox offered no way to supply it (the
// only row action is bulk "Send selected", which correctly refuses an unrouted row).
//
// So the empty half of that cell becomes the action: it names the missing thing AND
// routes to the resolver. The assign itself lives on the order page (one implementation
// of the picker + the 409 handling, not two).

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => "/inbox",
  useSearchParams: () => new URLSearchParams(),
}));

const api = {
  getOrders: vi.fn(),
  getOrdersSummary: vi.fn(),
  redeliverOrder: vi.fn(),
};

// isApiMockMode: false — the live path is the one that ships, and the mock row
// generator has no unrouted rows.
vi.mock("@/lib/api-client", () => ({
  isApiMockMode: false,
  apiClient: {
    getOrders: (...a: unknown[]) => api.getOrders(...a),
    getOrdersSummary: (...a: unknown[]) => api.getOrdersSummary(...a),
    redeliverOrder: (...a: unknown[]) => api.redeliverOrder(...a),
  },
}));

vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => true }));
vi.mock("@/hooks/useSampleOrder", () => ({
  useSampleOrder: () => ({ runSample: vi.fn(), isPending: false, error: null }),
}));
vi.mock("@/hooks/useOrderDirection", () => ({
  useOrderDirection: () => ({
    direction: "outbound",
    labels: {
      counterpartyNoun: "Supplier",
      counterpartyPlural: "Suppliers",
      railHeader: "Buyer → Supplier",
      primaryCta: "Send to supplier",
      primaryCtaProgress: "Sending…",
      doneLabel: "Sent to supplier",
      deliveredLabel: "Delivered to supplier",
      unknownBuyer: "Unknown buyer",
    },
  }),
}));

import { InboxView } from "./InboxView";

afterEach(() => {
  cleanup();
  push.mockReset();
  api.getOrders.mockReset();
  api.getOrdersSummary.mockReset();
});

let seq = 0;
function order(over: Partial<OrderSummary> = {}): OrderSummary {
  seq += 1;
  return {
    id: "ord-unrouted",
    poNumber: "PO-55031",
    supplierName: "",
    buyerName: "Heinrich Industries GmbH",
    orderDate: "2026-07-20T09:00:00Z",
    status: "unrouted",
    lineCount: 6,
    unresolvedCount: 0,
    totalValue: 4210,
    currency: "EUR",
    sourceFormat: "pdf",
    createdAt: new Date(Date.now() - seq * 60_000).toISOString(),
    ...over,
  } as OrderSummary;
}

async function renderInbox(items: OrderSummary[]) {
  api.getOrders.mockResolvedValue({ items, totalCount: items.length, page: 1, pageSize: 25 });
  api.getOrdersSummary.mockResolvedValue({ byStatus: {}, total: items.length });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ConfirmProvider>
        <InboxView />
      </ConfirmProvider>
    </QueryClientProvider>,
  );
  await screen.findAllByText("PO-55031");
}

describe("inbox — an unrouted row offers the action it needs", () => {
  it("puts the action where the missing supplier name would be", async () => {
    await renderInbox([order()]);

    // Both breakpoints render under jsdom (the split is CSS-only), and BOTH have to
    // name the action — the mobile card was the half that showed an arrow into nothing.
    expect(screen.getAllByText(/assign supplier/i).length).toBeGreaterThanOrEqual(2);
  });

  it("routes to the order, where the supplier is actually chosen", async () => {
    await renderInbox([order()]);

    fireEvent.click(screen.getAllByRole("button", { name: /assign supplier/i })[0]);

    await waitFor(() => expect(push).toHaveBeenCalledWith("/inbox/ord-unrouted"));
  });

  it("does not offer it on a row that already has a supplier", async () => {
    await renderInbox([order({ id: "ord-routed", status: "pending_review", supplierName: "Nordmark Logistics" })]);

    expect(screen.getAllByText("Nordmark Logistics").length).toBeGreaterThan(0);
    expect(screen.queryByText(/assign supplier/i)).not.toBeInTheDocument();
  });

  it("still keeps the unrouted row out of the bulk send selection", async () => {
    // The action this row needs is assign-supplier; POST /redeliver would 400.
    // Adding a row action must not have quietly made the row selectable.
    await renderInbox([order()]);

    expect(screen.queryAllByRole("checkbox", { name: /^select row$/i })).toHaveLength(0);
    expect(screen.getByRole("checkbox", { name: /can't select/i })).toBeDisabled();
  });
});
