import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConfirmProvider } from "@/components/ui/confirm";
import type { OrderSummary } from "@/types/procurement";

// Inbox bulk "Send selected" — the duplicate guard for parked rows.
//
// `delivery_unconfirmed` IS redeliverable (the park exists so a HUMAN can accept the
// duplicate risk), so parked rows are selectable and sweep into "Send selected" like
// any other sendable row — including via the header select-all. On the channels the
// park exists for (ERP connections, email) nothing de-duplicates, so one click on a
// select-all could hand N suppliers a second copy of a PO they may already have.
//
// The workshop panel (DeliveryUnconfirmedPanel) already gates the IDENTICAL
// redeliverOrder call on the IDENTICAL status behind a confirm. The bulk path must not
// be a loophole around that single-order guard — these tests are what stop it becoming
// one again.
//
// The real ConfirmProvider is wrapped here (as in deliveryUnconfirmed.test.tsx) rather
// than mocking useConfirm: a mocked confirm would prove nothing about the shared dialog
// actually appearing, and "the dialog appears before the request" is the whole claim.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/inbox",
  useSearchParams: () => new URLSearchParams(),
}));

const api = {
  getOrders: vi.fn(),
  getOrdersSummary: vi.fn(),
  redeliverOrder: vi.fn(),
};

// isApiMockMode: false — the live path is the one that ships, and the mock row
// generator has no parked rows to select.
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
  api.getOrders.mockReset();
  api.getOrdersSummary.mockReset();
  api.redeliverOrder.mockReset();
});

let seq = 0;
function order(id: string, po: string, status: string): OrderSummary {
  seq += 1;
  return {
    id,
    poNumber: po,
    supplierName: "Nordmark",
    buyerName: "Heinrich Industries GmbH",
    orderDate: "2026-07-01T09:00:00Z",
    status: status as OrderSummary["status"],
    lineCount: 3,
    unresolvedCount: 0,
    totalValue: 1200,
    currency: "EUR",
    sourceFormat: "pdf",
    // Distinct ages keep the default (ageMin asc) sort deterministic.
    createdAt: new Date(Date.now() - seq * 60_000).toISOString(),
  };
}

const PARKED = () => order("ord-parked", "PO-9001", "delivery_unconfirmed");
const READY = () => order("ord-ready", "PO-9002", "ready_to_deliver");
const FAILED = () => order("ord-failed", "PO-9003", "delivery_failed");

async function renderInbox(items: OrderSummary[]) {
  api.getOrders.mockResolvedValue({ items, totalCount: items.length, page: 1, pageSize: 25 });
  api.getOrdersSummary.mockResolvedValue({ byStatus: {}, total: items.length });
  api.redeliverOrder.mockResolvedValue(undefined);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ConfirmProvider>
        <InboxView />
      </ConfirmProvider>
    </QueryClientProvider>,
  );
  // Wait for the live page to land before touching selection. InboxView renders the
  // desktop table AND the mobile card list into the same DOM (CSS decides which is
  // visible), so every row string legitimately matches more than once — hence findAll.
  await screen.findAllByText(items[0].poNumber);
}

// Select-all lives on the desktop table header only, so this one is unique.
function selectAll() {
  fireEvent.click(screen.getByLabelText("Select all sendable orders"));
}

function sendSelected() {
  fireEvent.click(screen.getByRole("button", { name: "Send selected" }));
}

describe("bulk Send selected — a parked row in the selection confirms first", () => {
  it("select-all + Send selected shows the duplicate warning and sends NOTHING yet", async () => {
    await renderInbox([PARKED(), READY(), FAILED()]);
    selectAll();
    sendSelected();

    // The dialog states the risk BEFORE any request goes out — this is the bug:
    // previously all three were already dispatched by now, with no warning at all.
    expect(await screen.findByText("Send 3 orders again?")).toBeInTheDocument();
    expect(
      screen.getByText("If the supplier already received them, sending again may give them duplicates."),
    ).toBeInTheDocument();
    expect(api.redeliverOrder).not.toHaveBeenCalled();
  });

  it("Cancel sends NOTHING — not even the non-parked rows in the same selection", async () => {
    await renderInbox([PARKED(), READY(), FAILED()]);
    selectAll();
    sendSelected();
    expect(await screen.findByText("Send 3 orders again?")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(screen.queryByText("Send 3 orders again?")).not.toBeInTheDocument(),
    );
    expect(api.redeliverOrder).not.toHaveBeenCalled();
  });

  it("confirming sends every selected order, parked one included", async () => {
    await renderInbox([PARKED(), READY(), FAILED()]);
    selectAll();
    sendSelected();
    expect(await screen.findByText("Send 3 orders again?")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Send again" }));

    await waitFor(() => expect(api.redeliverOrder).toHaveBeenCalledTimes(3));
    expect(api.redeliverOrder).toHaveBeenCalledWith("ord-parked");
    expect(api.redeliverOrder).toHaveBeenCalledWith("ord-ready");
    expect(api.redeliverOrder).toHaveBeenCalledWith("ord-failed");
  });

  it("a single parked order mirrors the workshop panel's pinned wording", async () => {
    await renderInbox([PARKED()]);
    selectAll();
    sendSelected();

    expect(await screen.findByText("Send this order again?")).toBeInTheDocument();
    expect(
      screen.getByText("If the supplier already received this order, sending again may give them a duplicate."),
    ).toBeInTheDocument();
    expect(api.redeliverOrder).not.toHaveBeenCalled();
  });
});

describe("bulk Send selected — a selection with no parked row is unchanged", () => {
  it("sends straight through with no dialog (existing statuses keep their flow)", async () => {
    await renderInbox([READY(), FAILED()]);
    selectAll();
    sendSelected();

    await waitFor(() => expect(api.redeliverOrder).toHaveBeenCalledTimes(2));
    expect(api.redeliverOrder).toHaveBeenCalledWith("ord-ready");
    expect(api.redeliverOrder).toHaveBeenCalledWith("ord-failed");
    expect(screen.queryByText(/again\?$/)).not.toBeInTheDocument();
  });
});

describe("bulk Send selected — parked rows are visible in the selection", () => {
  it("the select-all tooltip names Delivery unknown alongside the other sendable statuses", async () => {
    await renderInbox([PARKED(), READY(), FAILED()]);
    const selectAllBox = screen.getByLabelText("Select all sendable orders");
    // The operator cannot judge a select-all they can't see the contents of: the
    // tooltip used to name only "Ready to send or Failed delivery" while quietly
    // sweeping in parked rows too.
    expect(selectAllBox).toHaveAttribute(
      "title",
      expect.stringContaining("Delivery unknown"),
    );
  });
});
