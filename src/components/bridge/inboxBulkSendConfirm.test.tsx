import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConfirmProvider } from "@/components/ui/confirm";
import type { OrderSummary } from "@/types/procurement";

// Inbox bulk "Send selected" — the parked-row loophole, now closed at the source.
//
// HISTORY, because it explains why these tests inverted. `delivery_unconfirmed` IS
// redeliverable (the park exists so a HUMAN can accept the duplicate risk), so parked
// rows used to be selectable and swept into "Send selected" like any other sendable
// row — including via the header select-all. On the channels the park exists for (ERP
// connections, email) nothing de-duplicates, so one click could hand N suppliers a
// second copy of a PO they may already have. The first fix was a confirm dialog in
// front of the bulk send, which is what this file originally pinned.
//
// WP-24 replaced that with the real fix: a parked row is NOT bulk-selectable at all
// (isBulkSelectable = the backend's ClaimableForRetryFrom = {ready_to_deliver,
// delivery_failed}). A boolean dialog cannot answer the question that decides this
// case — "did the supplier actually receive it?" — so the decision moved to the
// per-order resolver on the order screen, which asks exactly that.
//
// What remains here: the unselectable-row contract, the honest tooltips, and the
// duplicate confirm on its ONE still-reachable path — a selection that outlived the
// page it was made on, whose statuses we can no longer prove.
//
// The real ConfirmProvider is wrapped here rather than mocking useConfirm: a mocked
// confirm would prove nothing about the shared dialog actually appearing.

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

vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => true, useTenantQueriesEnabled: () => true }));
vi.mock("@/hooks/useSampleOrder", () => ({
  useSampleOrder: () => ({ runSample: vi.fn(), isPending: false, error: null }),
  usePracticeOrderEmail: () => "",
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
import { bulkSendConfirmCopy, bulkSendNeedsDuplicateConfirm, isBulkSelectable } from "./inboxSend";

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

describe("bulk Send selected — a parked row can no longer be swept in at all", () => {
  it("leaves the parked row unselectable while its neighbours stay selectable", async () => {
    await renderInbox([PARKED(), READY(), FAILED()]);

    // Two selectable rows (ready + failed), and the parked one disabled with a reason
    // the operator can actually read — not a silent absence.
    const parkedBoxes = screen.getAllByLabelText("Delivery unknown — open the order to resolve it safely");
    expect(parkedBoxes.length).toBeGreaterThan(0);
    for (const box of parkedBoxes) expect(box).toBeDisabled();

    selectAll();
    sendSelected();

    // No dialog: nothing in the selection carries duplicate risk any more.
    await waitFor(() => expect(api.redeliverOrder).toHaveBeenCalledTimes(2));
    expect(api.redeliverOrder).toHaveBeenCalledWith("ord-ready");
    expect(api.redeliverOrder).toHaveBeenCalledWith("ord-failed");
    expect(api.redeliverOrder).not.toHaveBeenCalledWith("ord-parked");
  });

  it("a view of only parked rows offers no select-all to mis-click", async () => {
    await renderInbox([PARKED()]);
    expect(screen.queryByLabelText("Select all sendable orders")).not.toBeInTheDocument();
    expect(screen.getByLabelText("No sendable orders on this view")).toBeDisabled();
    expect(api.redeliverOrder).not.toHaveBeenCalled();
  });

  it("the select-all tooltip describes exactly the set it selects", async () => {
    await renderInbox([PARKED(), READY(), FAILED()]);
    const selectAllBox = screen.getByLabelText("Select all sendable orders");
    // The operator cannot judge a select-all whose contents they can't see. It used
    // to name only "Ready to send or Failed delivery" while quietly sweeping in
    // parked rows; now the sentence and the set are the same thing.
    //
    // WP-29 changed the WORDS, not the set: this checkbox selects
    // {ready_to_deliver, delivery_failed}, and `ready_to_deliver` has been labelled
    // "Queued to send" everywhere since WP-25 — this sentence was the one place still
    // calling it "ready to send". That reading became actively wrong once a real
    // "Ready to send" chip existed for the DIFFERENT status `ready`, whose rows are
    // deliberately not bulk-selectable (they carry their own row button instead).
    expect(selectAllBox).toHaveAttribute(
      "title",
      "Selects orders that are queued to send or had a delivery failure.",
    );
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

describe("bulk Send selected — the duplicate confirm still guards the one open path", () => {
  it("an id whose status we can no longer prove still confirms first", () => {
    // Paging does not clear the selection, so a row selected on page 1 stays selected
    // while page 2 is loaded and its status is out of hand. We cannot prove such a row
    // isn't parked — an unnecessary dialog costs a click, a missed one costs the
    // supplier a duplicate order.
    expect(bulkSendNeedsDuplicateConfirm(["ord-off-page"], new Map())).toBe(true);
    expect(
      bulkSendNeedsDuplicateConfirm(["ord-ready"], new Map([["ord-ready", "ready_to_deliver"]])),
    ).toBe(false);
  });

  it("and its copy still mirrors the order screen's pinned wording", () => {
    expect(bulkSendConfirmCopy(1).description).toBe(
      "If the supplier already received this order, sending again may give them a duplicate.",
    );
    expect(bulkSendConfirmCopy(3).title).toBe("Send 3 orders again?");
  });

  it("the selectable set is exactly the backend's retry-claimable set", () => {
    expect(isBulkSelectable("ready_to_deliver")).toBe(true);
    expect(isBulkSelectable("delivery_failed")).toBe(true);
    expect(isBulkSelectable("delivery_unconfirmed")).toBe(false);
  });
});
