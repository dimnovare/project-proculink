import { describe, it, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConfirmProvider } from "@/components/ui/confirm";
import type { OrderSummary } from "@/types/procurement";

// ─────────────────────────────────────────────────────────────────────────────
// D3 — the inbox filter is the URL.
//
// InboxView held statusFilter/activeChip in useState and never read the query
// string, so every ?status= link in the product (nine health tiles, the review
// backlog card, the paused-delivery card, the sidebar's own nav entries) landed
// on an unfiltered inbox. The operator clicked "5 out of retries" and got every
// order in the account.
//
// The fix is derivation, not "also reads": two sources of truth is how these
// links died in the first place.
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
import {
  INBOX_FILTERABLE_STATUSES,
  resolveInboxStatusParam,
  inboxChipIndexFor,
  inboxSortingFor,
} from "./inboxUrlFilter";
import { INBOX_CHIP_LABELS } from "./orderCountContract";

let seq = 0;
function order(over: Partial<OrderSummary> = {}): OrderSummary {
  seq += 1;
  return {
    id: `ord-${seq}`,
    poNumber: `PO-9000${seq}`,
    supplierName: "BoltWorks BV",
    buyerName: "Heinrich Industries",
    orderDate: "2026-07-20T09:00:00Z",
    status: "delivery_dead_letter",
    lineCount: 4,
    unresolvedCount: 0,
    totalValue: 1200,
    currency: "EUR",
    sourceFormat: "csv",
    createdAt: new Date(Date.now() - seq * 60_000).toISOString(),
    ...over,
  } as OrderSummary;
}

async function renderInbox(items: OrderSummary[] = [order()]) {
  api.getOrders.mockResolvedValue({ items, totalCount: items.length, page: 1, pageSize: 25 });
  api.getOrdersSummary.mockResolvedValue({ byStatus: { delivery_dead_letter: items.length }, total: items.length });
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

describe("the inbox derives its server filter from ?status= (D3)", () => {
  it("asks the API for exactly the status the link named", async () => {
    searchParams = new URLSearchParams("status=delivery_dead_letter");
    await renderInbox();
    expect(api.getOrders).toHaveBeenCalledWith(
      expect.objectContaining({ status: "delivery_dead_letter" }),
    );
  });

  it.each([
    "unrouted",
    "parsing",
    "delivering",
    "transform_failed",
    "delivery_failed",
    "delivery_dead_letter",
    "rejected_by_supplier",
    "delivery_unconfirmed",
    "delivery_held",
    "pending_review",
    "ready_to_deliver",
    "delivered",
    "failed",
  ])("honours ?status=%s", async (status) => {
    searchParams = new URLSearchParams(`status=${status}`);
    await renderInbox([order({ status: status as OrderSummary["status"] })]);
    expect(api.getOrders).toHaveBeenCalledWith(expect.objectContaining({ status }));
  });

  it("no ?status= means no server filter — the plain inbox is still the plain inbox", async () => {
    await renderInbox();
    expect(api.getOrders).toHaveBeenCalledWith(expect.objectContaining({ status: undefined }));
  });

  it("a status we don't recognise says so instead of silently showing everything", async () => {
    searchParams = new URLSearchParams("status=not_a_real_status");
    await renderInbox();
    expect(api.getOrders).toHaveBeenCalledWith(expect.objectContaining({ status: undefined }));
    expect(await screen.findByText(/don.t recognise that filter/i)).toBeTruthy();
  });

  it("?sort=oldest really sorts oldest-first", async () => {
    searchParams = new URLSearchParams("sort=oldest");
    await renderInbox();
    expect(inboxSortingFor("oldest")).toEqual([{ id: "ageMin", desc: true }]);
    expect(inboxSortingFor(null)).toEqual([{ id: "ageMin", desc: false }]);
  });

  it("clicking a chip writes the filter into the URL, so back/forward and sharing work", async () => {
    await renderInbox();
    const chip = await screen.findByRole("button", { name: /Needs review/i });
    chip.click();
    await waitFor(() => expect(replace).toHaveBeenCalled());
    const target = String(replace.mock.calls[0][0]);
    expect(target).toContain("status=pending_review");
  });
});

describe("the filter table itself", () => {
  test("every status the health page and sidebar can name is filterable", () => {
    for (const s of [
      "parsing", "unrouted", "pending_review", "ready_to_deliver", "delivering",
      "delivered", "failed", "transform_failed", "delivery_failed",
      "delivery_dead_letter", "rejected_by_supplier", "delivery_unconfirmed",
      "delivery_held",
    ]) {
      expect(INBOX_FILTERABLE_STATUSES.has(s), s).toBe(true);
    }
  });

  test("an unknown status resolves to no filter, flagged as unknown", () => {
    expect(resolveInboxStatusParam("nonsense")).toEqual({ status: undefined, known: false });
    expect(resolveInboxStatusParam(null)).toEqual({ status: undefined, known: true });
    expect(resolveInboxStatusParam("failed")).toEqual({ status: "failed", known: true });
  });

  test("a status with its own chip selects that chip; the rest fall back to All", () => {
    // Asserted against the chip ORDER rather than against literal indices. The literals
    // this used to carry (failed → 4) went stale the moment WP-29 inserted the "Ready to
    // send" chip at position 2 — which is precisely the drift that made
    // inboxChipIndexFor derive its answer instead of looking it up in a hand-written map.
    const at = (label: string) => INBOX_CHIP_LABELS.indexOf(label);
    expect(inboxChipIndexFor("pending_review")).toBe(at("Needs review"));
    expect(inboxChipIndexFor("ready")).toBe(at("Ready to send"));
    expect(inboxChipIndexFor("ready_to_deliver")).toBe(at("Queued to send"));
    expect(inboxChipIndexFor("failed")).toBe(at("Failed"));
    expect(inboxChipIndexFor("delivery_dead_letter")).toBe(at("Failed")); // inside the failure bucket
    expect(inboxChipIndexFor(null)).toBe(0);
    expect(inboxChipIndexFor("nonsense")).toBe(0);
  });
});
