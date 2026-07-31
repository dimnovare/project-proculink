import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConfirmProvider } from "@/components/ui/confirm";
import type { OrderSummary } from "@/types/procurement";

// ─────────────────────────────────────────────────────────────────────────────
// WP-29 — the product's economic premise, made visible and actionable.
//
// A recurring PO that auto-resolves every line lands on `ready`: every check
// passed, no output built, nothing sent — the human's turn. At 478b809 it had no
// filter chip and no action. It was the most valuable state and the least
// actionable row.
//
// The action posts to /orders/{id}/transform, NOT /redeliver. That is not an
// implementation detail, it is the WP-24 D2 discipline: a control may only be
// offered where the backend's guard set accepts it. `ready` is in
// OrderStatusMachine.TransformableFrom; it is NOT in RedeliverableFrom, so a bulk
// "Send selected" over `ready` rows could only ever 400.
// ─────────────────────────────────────────────────────────────────────────────

let searchParams = new URLSearchParams();
const replace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace }),
  usePathname: () => "/inbox",
  useSearchParams: () => searchParams,
}));

const api = {
  getOrders: vi.fn(),
  getOrdersSummary: vi.fn(),
  redeliverOrder: vi.fn(),
  transformOrder: vi.fn(),
};

vi.mock("@/lib/api-client", () => ({
  isApiMockMode: false,
  apiClient: {
    getOrders: (...a: unknown[]) => api.getOrders(...a),
    getOrdersSummary: (...a: unknown[]) => api.getOrdersSummary(...a),
    redeliverOrder: (...a: unknown[]) => api.redeliverOrder(...a),
    transformOrder: (...a: unknown[]) => api.transformOrder(...a),
  },
}));

vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => true }));
vi.mock("@/hooks/useSampleOrder", () => ({
  useSampleOrder: () => ({ runSample: vi.fn(), isPending: false, error: null }),
}));

let direction: "outbound" | "inbound" = "outbound";
vi.mock("@/hooks/useOrderDirection", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useOrderDirection")>(
    "@/hooks/useOrderDirection",
  );
  return {
    ...actual,
    useOrderDirection: () => ({ direction, labels: actual.partyLabels(direction) }),
  };
});

import { InboxView, FILTER_CHIPS } from "./InboxView";
import { isBulkSelectable, isRedeliverable, isRowSendable } from "./inboxSend";
import { partyLabels } from "@/hooks/useOrderDirection";

let seq = 0;
function order(over: Partial<OrderSummary> = {}): OrderSummary {
  seq += 1;
  return {
    id: `ord-${seq}`,
    poNumber: `PO-8800${seq}`,
    supplierName: "BoltWorks BV",
    buyerName: "Heinrich Industries",
    orderDate: "2026-07-20T09:00:00Z",
    status: "ready",
    lineCount: 4,
    unresolvedCount: 0,
    totalValue: 1200,
    currency: "EUR",
    sourceFormat: "csv",
    createdAt: new Date(Date.now() - seq * 60_000).toISOString(),
    ...over,
  } as OrderSummary;
}

async function renderInbox(items: OrderSummary[]) {
  api.getOrders.mockResolvedValue({ items, totalCount: items.length, page: 1, pageSize: 25 });
  api.getOrdersSummary.mockResolvedValue({
    byStatus: { ready: 5, ready_to_deliver: 7, pending_review: 9, delivered: 11 },
    total: 32,
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={qc}>
      <ConfirmProvider>
        <InboxView />
      </ConfirmProvider>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(api.getOrders).toHaveBeenCalled());
  return view;
}

beforeEach(() => {
  direction = "outbound";
  searchParams = new URLSearchParams();
  replace.mockReset();
  Object.values(api).forEach((fn) => fn.mockReset());
});
afterEach(cleanup);

describe("`ready` is a first-class filter chip", () => {
  it("the chip exists, and it filters the `ready` status server-side", async () => {
    const chip = FILTER_CHIPS.find((c) => c.label === "Ready to send");
    expect(chip, "FILTER_CHIPS must carry a Ready to send chip").toBeDefined();
    expect(chip!.api).toBe("ready");
    expect(chip!.summaryKeys).toEqual(["ready"]);

    const { container } = await renderInbox([order({ status: "ready" })]);
    // Queried through the count tag, not by accessible name: the mobile card is itself
    // a <button> whose name contains its "Ready to send" status badge.
    const button = await waitFor(() =>
      container.querySelector('[data-count-label="Ready to send"]')!.closest("button")!,
    );
    await act(async () => { fireEvent.click(button); });
    await waitFor(() => expect(replace).toHaveBeenCalled());
    expect(String(replace.mock.calls[0][0])).toContain("status=ready");
  });

  it("its count is `ready`, distinct from the Queued to send chip's `ready_to_deliver`", async () => {
    const { container } = await renderInbox([order({ status: "ready" })]);
    await waitFor(() =>
      expect(container.querySelector('[data-count-label="Ready to send"]')).toBeTruthy(),
    );
    const read = (label: string) =>
      Number(
        container.querySelector<HTMLElement>(`[data-count-label="${label}"]`)?.dataset.countValue,
      );
    expect(read("Ready to send")).toBe(5);
    expect(read("Queued to send")).toBe(7);
  });
});

describe("a `ready` row carries a primary send action", () => {
  it("renders the send button, named through partyLabels — never a hardcoded noun", async () => {
    await renderInbox([order({ status: "ready", poNumber: "PO-READY-1" })]);
    const buttons = await screen.findAllByRole("button", {
      name: new RegExp(`${partyLabels("outbound").primaryCta}.*PO-READY-1`, "i"),
    });
    expect(buttons.length).toBeGreaterThan(0);
  });

  it("says 'Confirm order' for an inbound org — hardcoding 'supplier' deletes that mode", async () => {
    direction = "inbound";
    await renderInbox([order({ status: "ready", poNumber: "PO-READY-2" })]);
    const buttons = await screen.findAllByRole("button", {
      name: new RegExp(`${partyLabels("inbound").primaryCta}.*PO-READY-2`, "i"),
    });
    expect(buttons.length).toBeGreaterThan(0);
    expect(
      screen.queryByRole("button", { name: /Send to supplier.*PO-READY-2/i }),
      "inbound must not say 'supplier'",
    ).toBeNull();
  });

  it("clicking it posts to /transform immediately — no confirm dialog, and never /redeliver", async () => {
    api.transformOrder.mockResolvedValue({});
    await renderInbox([order({ id: "ord-ready", status: "ready", poNumber: "PO-READY-3" })]);
    const button = (
      await screen.findAllByRole("button", { name: /Send to supplier.*PO-READY-3/i })
    )[0];
    await act(async () => { fireEvent.click(button); });

    await waitFor(() => expect(api.transformOrder).toHaveBeenCalledWith("ord-ready"));
    // Nothing has been built or sent yet, so there is no duplicate risk and no dialog.
    // The confirm WP-24 added is for delivery_unconfirmed; reusing it here would train
    // the operator to click past the one that matters.
    expect(screen.queryByRole("dialog")).toBeNull();
    // /redeliver 400s on `ready` — offering it here is exactly WP-24's D2 defect.
    expect(api.redeliverOrder).not.toHaveBeenCalled();
    expect((await screen.findAllByText(/PO-READY-3/)).length).toBeGreaterThan(0);
  });

  it("a failure names the order and the backend's reason, and leaves the button usable", async () => {
    api.transformOrder.mockRejectedValue(new Error("Transform failed: no output layout"));
    await renderInbox([order({ id: "ord-bad", status: "ready", poNumber: "PO-READY-4" })]);
    const button = (
      await screen.findAllByRole("button", { name: /Send to supplier.*PO-READY-4/i })
    )[0];
    await act(async () => { fireEvent.click(button); });

    const notice = await screen.findByText(/Couldn.t start PO-READY-4/i);
    expect(notice.textContent).toMatch(/no output layout/i);
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  });

  it("does not offer the action on a status the transform endpoint would refuse", async () => {
    await renderInbox([
      order({ status: "ready_to_deliver", poNumber: "PO-QUEUED" }),
      order({ status: "pending_review", poNumber: "PO-REVIEW", unresolvedCount: 3 }),
      order({ status: "delivered", poNumber: "PO-DONE" }),
    ]);
    await screen.findAllByText("PO-QUEUED");
    for (const po of ["PO-QUEUED", "PO-REVIEW", "PO-DONE"]) {
      expect(
        screen.queryByRole("button", { name: new RegExp(`Send to supplier.*${po}`, "i") }),
        `${po} must not offer the row send`,
      ).toBeNull();
    }
  });
});

describe("the two send paths stay disjoint", () => {
  it("`ready` is row-sendable but NOT bulk-selectable — different endpoint, different guard set", () => {
    expect(isRowSendable("ready")).toBe(true);
    // BULK_SELECTABLE_STATUSES mirrors the backend's ClaimableForRetryFrom and drives
    // POST /redeliver, whose RedeliverableFrom does not contain `ready`.
    expect(isBulkSelectable("ready")).toBe(false);
    expect(isRedeliverable("ready")).toBe(false);
  });

  it("nothing is in both sets", () => {
    const all = [
      "pending_parse", "parsing", "unrouted", "pending_review", "ready", "transforming",
      "ready_to_deliver", "delivering", "delivered", "delivery_held",
      "delivery_unconfirmed", "failed", "transform_failed", "delivery_failed",
      "delivery_dead_letter", "rejected_by_supplier",
    ];
    for (const s of all) {
      expect(isRowSendable(s) && isBulkSelectable(s), `${s} is in both send paths`).toBe(false);
    }
  });

  it("isRedeliverable still mirrors the backend byte for byte (WP-24 refused to narrow it)", () => {
    // Pinned here because this packet adds a SECOND send path, and the cheap way to
    // wire it would have been to widen this set. It is documented and tested as an
    // exact mirror of OrderStatusMachine.RedeliverableFrom — leave it alone.
    for (const s of ["ready_to_deliver", "delivery_failed", "delivery_unconfirmed"]) {
      expect(isRedeliverable(s), s).toBe(true);
    }
    for (const s of ["ready", "delivery_held", "transform_failed", "delivery_dead_letter"]) {
      expect(isRedeliverable(s), s).toBe(false);
    }
  });
});
