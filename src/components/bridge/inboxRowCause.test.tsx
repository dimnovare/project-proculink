import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConfirmProvider } from "@/components/ui/confirm";
import type { OrderSummary } from "@/types/procurement";

// ─────────────────────────────────────────────────────────────────────────────
// P3 — the inbox row says what is WRONG, not how big the order is.
//
// Three defects, one screen, all of them about a row that had nine columns and
// still could not answer "what do I do with this?":
//
//   1  Every "Needs review" row — the most common exception state in the product
//      — printed "14 lines · 3 to review". A count is not a cause: "14 lines" is
//      equally true of a delivered order, a parsing order, and one that has been
//      waiting on a person for three days. The dashboard's six-row preview had
//      the right sentence ("3 item codes to confirm") the whole time.
//
//   2  A failed fetch replaced the entire screen, taking the filter chips and the
//      search box with it, so the one thing that might have worked — a different
//      filter — was the thing the error removed. And an empty `pagedRows` after a
//      failed request fell into the "Your inbox is clear" branch: a confident,
//      favourable, wrong claim about data nobody managed to read.
//
//   3  Column sort is client-side over ONE server page (GetOrdersParams carries no
//      sort field), so "sort by Value descending" over a 200-order queue silently
//      answered with the largest order on page one.
//
// These render the real InboxView against a mocked api-client, because all three
// are properties of what the operator SEES, and all three passed unit tests on
// the helpers underneath them while the screen was still wrong.
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

let seq = 0;
function order(over: Partial<OrderSummary> = {}): OrderSummary {
  seq += 1;
  return {
    id: `ord-${seq}`,
    poNumber: `PO-9000${seq}`,
    supplierName: "BoltWorks BV",
    buyerName: "Heinrich Industries",
    orderDate: "2026-07-20T09:00:00Z",
    status: "pending_review",
    lineCount: 14,
    unresolvedCount: 3,
    totalValue: 1200,
    currency: "EUR",
    sourceFormat: "csv",
    createdAt: new Date(Date.now() - seq * 60_000).toISOString(),
    ...over,
  } as OrderSummary;
}

async function renderInbox(items: OrderSummary[] = [order()], totalCount?: number) {
  api.getOrders.mockResolvedValue({
    items,
    totalCount: totalCount ?? items.length,
    page: 1,
    pageSize: 25,
  });
  api.getOrdersSummary.mockResolvedValue({
    byStatus: { pending_review: items.length },
    total: totalCount ?? items.length,
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ConfirmProvider>
        <InboxView />
      </ConfirmProvider>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(api.getOrders).toHaveBeenCalled());
}

beforeEach(() => {
  searchParams = new URLSearchParams();
  replace.mockReset();
  api.getOrders.mockReset();
  api.getOrdersSummary.mockReset();
});
afterEach(cleanup);

describe("a blocked row names its cause, without a hover or a click", () => {
  it("a Needs review row says what has to be confirmed, not how many lines it has", async () => {
    await renderInbox([order({ status: "pending_review", lineCount: 14, unresolvedCount: 3 })]);
    // The row-level assertion the helper test underneath cannot make: the words
    // reach the screen. Both viewports render from the same array, hence >= 1.
    await waitFor(() =>
      expect(screen.getAllByText("3 item codes to confirm").length).toBeGreaterThan(0),
    );
    // And the count-as-cause line is gone from the screen entirely. "14 lines"
    // survives as an order FACT in the Order column; "3 to review" was the thing
    // pretending to be the next step, and it is what the cause replaces.
    expect(screen.queryByText(/3 to review/)).toBeNull();
  });

  it("a failed delivery names its next step, and a delivered order needs nothing", async () => {
    await renderInbox([
      order({ id: "a", poNumber: "PO-A", status: "delivery_failed", unresolvedCount: 0 }),
      order({ id: "b", poNumber: "PO-B", status: "delivered", unresolvedCount: 0 }),
    ]);
    await waitFor(() =>
      expect(screen.getAllByText("Retrying automatically").length).toBeGreaterThan(0),
    );
    // A moving order renders NO need text. Not an em-dash, not "OK" — this repo's
    // recurring defect is an absent value rendering as a confident favourable claim,
    // and a dash under "What's needed" is exactly that shape.
    const needs = document.querySelectorAll("[data-row-need]");
    const texts = [...needs].map((n) => n.textContent);
    expect(texts).toContain("Retrying automatically");
    expect(texts.some((t) => t === "—" || t === "-" || t === "OK")).toBe(false);
  });

  it("the singular is not '1 item codes'", async () => {
    await renderInbox([order({ status: "pending_review", unresolvedCount: 1 })]);
    await waitFor(() =>
      expect(screen.getAllByText("1 item code to confirm").length).toBeGreaterThan(0),
    );
  });

  it("a review row whose count the server did not send degrades, and never invents a number", async () => {
    // unresolvedCount absent entirely — the shape that produced "0 item codes to
    // confirm" or a fabricated count on other surfaces in this codebase.
    const o = order({ status: "pending_review" });
    delete (o as Partial<OrderSummary>).unresolvedCount;
    await renderInbox([o]);
    await waitFor(() =>
      expect(screen.getAllByText("Review before sending").length).toBeGreaterThan(0),
    );
    expect(screen.queryByText(/0 item codes/)).toBeNull();
  });
});

describe("one row, one status encoding", () => {
  it("status and its stage track are one cell, so there is no second status column", async () => {
    await renderInbox();
    const headers = [...document.querySelectorAll("thead th")].map((th) =>
      (th.textContent || "").replace(/[⇅↑↓]/g, "").trim(),
    );
    // "Pipeline" and "Status" were two adjacent columns restating one variable in
    // two vocabularies — 308px of a 1238px row. One column now carries both.
    expect(headers).toContain("Status");
    expect(headers).not.toContain("Pipeline");
    expect(headers.filter((h) => h === "Status")).toHaveLength(1);
    // The stage track survives inside it — it is a locked signature of this design
    // and it says the one thing the pill cannot: WHERE in the run the order stopped.
    expect(document.querySelectorAll("[data-pipeline]").length).toBeGreaterThan(0);
  });

  it("the row carries a What's needed column at all", async () => {
    await renderInbox();
    const headers = [...document.querySelectorAll("thead th")].map((th) =>
      (th.textContent || "").replace(/[⇅↑↓]/g, "").trim(),
    );
    expect(headers).toContain("What's needed");
  });
});

describe("a failed fetch is a state of the list, not of the page", () => {
  beforeEach(() => {
    api.getOrders.mockRejectedValue(new Error("network down"));
    api.getOrdersSummary.mockResolvedValue({ byStatus: {}, total: 0 });
  });

  async function renderFailed() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <ConfirmProvider>
          <InboxView />
        </ConfirmProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(document.querySelector("[data-queue-load-error]")).not.toBeNull());
  }

  it("keeps the filter chips and the search box mounted", async () => {
    await renderFailed();
    // The whole point: the operator whose "Failed" view timed out can still try a
    // different filter. The old early return removed every one of these.
    expect(screen.getByLabelText("Search orders")).toBeTruthy();
    expect(screen.getAllByText("All orders").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Needs review").length).toBeGreaterThan(0);
  });

  it("never says the inbox is clear about orders it could not read", async () => {
    await renderFailed();
    expect(screen.queryByText("Your inbox is clear")).toBeNull();
    expect(screen.queryByText("No matching orders")).toBeNull();
  });

  it("says it is a loading problem and offers a retry", async () => {
    await renderFailed();
    const panel = document.querySelector("[data-queue-load-error]")!;
    expect(panel.getAttribute("role")).toBe("alert");
    expect(panel.textContent).toContain("Couldn't load your orders");
    expect(screen.getAllByText("↻ Try again").length).toBeGreaterThan(0);
  });
});

describe("the sort control says which set it can reach", () => {
  it("admits it reorders one page when the queue spans more than one", async () => {
    // 60 orders, 25 a page. The server takes no sort parameter, so the client can
    // only ever reorder the 25 it was handed.
    await renderInbox([order({ status: "pending_review" })], 60);
    await waitFor(() => expect(document.querySelector("[data-sort-scope-note]")).not.toBeNull());
    expect(document.querySelector("[data-sort-scope-note]")!.textContent).toContain(
      "reorders this page only",
    );
    // And the control itself, for anyone who never reads the footer.
    expect(screen.getByLabelText("Sort this page by Value")).toBeTruthy();
    expect(screen.queryByLabelText("Sort by Value")).toBeNull();
  });

  it("makes no such claim when the page IS the queue", async () => {
    // Not inverted: on a single page the sort really is queue-wide, and hedging a
    // control that works is its own kind of lie.
    await renderInbox([order({ status: "pending_review" })], 3);
    await waitFor(() => expect(screen.getAllByText(/PO-9000/).length).toBeGreaterThan(0));
    expect(document.querySelector("[data-sort-scope-note]")).toBeNull();
    expect(screen.getByLabelText("Sort by Value")).toBeTruthy();
  });
});
