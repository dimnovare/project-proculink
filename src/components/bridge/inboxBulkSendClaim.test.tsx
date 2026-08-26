import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConfirmProvider } from "@/components/ui/confirm";
import type { OrderSummary } from "@/types/procurement";

// ─────────────────────────────────────────────────────────────────────────────
// THE DEFECT, exactly.
//
// Select three rows, press "Send selected", and the bar printed a green
// "✓ 3 orders sent". No supplier had been contacted.
//
// POST /api/orders/{id}/redeliver answers **202 Accepted**: OrdersController
// enqueues DeliverOrderJob.EnqueueRedeliver and returns { status: "delivering" }.
// apiClient.redeliverOrder resolves on `res.ok` — and 202 IS ok — so the handler's
// `.then(() => ({ id, ok: true }))` counted an enqueue as a delivery. Every one of
// those three orders could still land in delivery_failed or delivery_unconfirmed,
// and the operator had already been told they went out.
//
// The honest version lived one handler down in the same file the whole time —
// rowSendStartedCopy: "Started {po} — building the output. This order's status
// updates as it goes." — under a comment reading "The success line does not claim
// delivery."
//
// The control below is driven by an ACTUAL 202 (see accepted202), not by a bare
// resolved promise, so the fixture cannot drift away from what the backend sends.
// ─────────────────────────────────────────────────────────────────────────────

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
import { formatBulkSendResult, bulkSendQueuedCopy } from "./inboxSend";

/**
 * The backend's real answer, put through apiClient.redeliverOrder's real check.
 *
 * `Accepted(new { status = "delivering" })` is 202. realRedeliverOrder throws only
 * when `!res.ok`, and `Response(…, { status: 202 }).ok` is true — so this resolves,
 * exactly as it did when the bar claimed delivery. Writing the fixture this way
 * means the premise ("202 reads as success") is asserted, not assumed.
 */
async function accepted202(): Promise<void> {
  const res = new Response(JSON.stringify({ status: "delivering" }), { status: 202 });
  if (!res.ok) throw new Error(`Redeliver failed: ${res.statusText}`);
}

afterEach(() => {
  cleanup();
  Object.values(api).forEach((fn) => fn.mockReset());
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
    createdAt: new Date(Date.now() - seq * 60_000).toISOString(),
  };
}

/** Three bulk-selectable rows — the reported case is "3 orders sent". */
const THREE = () => [
  order("ord-a", "PO-9001", "ready_to_deliver"),
  order("ord-b", "PO-9002", "ready_to_deliver"),
  order("ord-c", "PO-9003", "delivery_failed"),
];

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
  await screen.findAllByText(items[0].poNumber);
}

function selectAllAndSend() {
  fireEvent.click(screen.getByLabelText("Select all sendable orders"));
  fireEvent.click(screen.getByRole("button", { name: "Send selected" }));
}

/** What the operator can actually read. */
function pageText(): string {
  return document.body.textContent ?? "";
}

describe("bulk Send selected does not claim an outcome nobody observed", () => {
  it("a 202 for every order reads as QUEUED, never as sent", async () => {
    api.redeliverOrder.mockImplementation(accepted202);
    await renderInbox(THREE());
    selectAllAndSend();

    await waitFor(() => expect(api.redeliverOrder).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(pageText()).toMatch(/queued to send/i));

    const text = pageText();
    // The literal defect string.
    expect(text, "the reported defect").not.toContain("3 orders sent");
    // And the claim in any form. No inbox filter chip or status badge on these rows
    // prints the word, so a page-wide assertion is the honest place to make it —
    // the chips are "All orders / Needs review / Ready to send / Queued to send /
    // Delivered / Failed".
    expect(text, "nothing has been sent").not.toMatch(/\bsent\b/i);
    expect(text).toContain("3 orders queued to send");
    // Points at the thing that carries the real answer, which is why the handler
    // invalidates ["orders"].
    expect(text).toMatch(/each row's status updates as it goes/);
  });

  it("the headline beside it agrees — 'Queued', not 'Sent'", async () => {
    // Two words for one outcome is how the honest line gets read as the optimistic
    // one. The headline is what survives after a full success clears the selection.
    api.redeliverOrder.mockImplementation(accepted202);
    await renderInbox(THREE());
    selectAllAndSend();

    await waitFor(() => expect(screen.getByText("Queued")).toBeInTheDocument());
    expect(screen.queryByText("Sent")).toBeNull();
  });

  it("a single order is not pluralised into a claim either", async () => {
    api.redeliverOrder.mockImplementation(accepted202);
    await renderInbox([order("ord-solo", "PO-7000", "ready_to_deliver")]);
    selectAllAndSend();

    await waitFor(() => expect(pageText()).toMatch(/1 order queued to send/));
    expect(pageText()).not.toMatch(/\bsent\b/i);
  });

  it("PARTIAL failure: the accepted ones are queued, not sent", async () => {
    // The other arm that counted successes. It read "2 sent · 1 failed", which is the
    // same false claim about two orders with a true one bolted on beside it.
    api.redeliverOrder.mockImplementation(async (id: string) => {
      if (id === "ord-c") throw new Error("Supplier endpoint rejected the request");
      return accepted202();
    });
    await renderInbox(THREE());
    selectAllAndSend();

    await waitFor(() => expect(pageText()).toMatch(/2 queued · 1 failed/));
    const text = pageText();
    expect(text).not.toMatch(/\bsent\b/i);
    // The per-order reason survives — that half was already right.
    expect(text).toContain("PO-9003 — Supplier endpoint rejected the request");
  });

  it("ALL failed: asserts a non-event, which needs no softening", async () => {
    // Kept as "Couldn't send": a refused request really did send nothing and queue
    // nothing, so this arm was never part of the defect. Pinned so a later pass does
    // not "harmonise" it into something weaker than the truth.
    api.redeliverOrder.mockRejectedValue(new Error("Order is not in a deliverable state"));
    await renderInbox(THREE());
    selectAllAndSend();

    await waitFor(() => expect(pageText()).toMatch(/Couldn't send 3 orders/));
    // Failed rows stay selected so a retry cannot re-queue the ones that worked, so
    // the headline is still the selection count here.
    expect(screen.getByText("3 selected")).toBeInTheDocument();

    // Scoped to the live region: "Queued to send" is also a filter-chip label and a
    // status badge, and neither is a claim about this action.
    const announced = screen
      .getAllByRole("status")
      .map((n) => n.textContent ?? "")
      .join(" ");
    expect(announced, "nothing was queued").not.toMatch(/\bqueued\b/i);
    expect(announced).toContain("Couldn't send 3 orders");
  });
});

describe("the copy helpers themselves", () => {
  it("bulkSendQueuedCopy never says sent, in either number", () => {
    for (const n of [1, 2, 3, 25]) {
      const copy = bulkSendQueuedCopy(n);
      expect(copy).not.toMatch(/\bsent\b/i);
      expect(copy).toMatch(/queued to send/);
      expect(copy, "must point at where the real answer appears").toMatch(/status updates/);
    }
  });

  it("formatBulkSendResult's success and partial arms both say queued", () => {
    expect(formatBulkSendResult(3, []).text).toBe(bulkSendQueuedCopy(3));
    expect(formatBulkSendResult(2, [{ po: "PO-1", reason: "nope" }]).text).toMatch(
      /^2 queued · 1 failed: /,
    );
  });

  it("ok:true still means the API accepted it — the flag is not the claim", () => {
    // The styling flag stays true on success (green ✓); what changed is the sentence
    // beside it. Pinned so a later pass does not "fix" the claim by flipping the flag
    // and turning a normal outcome into a warning.
    expect(formatBulkSendResult(3, []).ok).toBe(true);
  });
});
