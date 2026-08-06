import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConfirmProvider } from "@/components/ui/confirm";
import type { OrderStatus, OrderSummary } from "@/types/procurement";

// ─────────────────────────────────────────────────────────────────────────────
// Three delivery numbers, one viewport, no way to reconcile them.
//
// Authenticated production pass, 2026-08-06. /bridge printed, all at once:
//
//   Throughput card    "3 orders received · last 30 days"   "0 delivered · last 30 days"
//   Delivery card      "60% success rate"                   "2 failed"      ← no window at all
//   {noun} health      "Delivery success rate, last 30 days"  one supplier at 33%
//
// The API's own numbers: byStatus {delivery_dead_letter: 2, pending_review: 21, delivered: 3},
// total 26 — and all three deliveries happened on 2026-07-02, 35 days earlier. So "0 delivered
// · last 30 days" was RIGHT, and the unlabelled 60% was an all-time figure (3 delivered of 5
// terminal attempts) sitting between two cards that both say "last 30 days".
//
// Every number was correct. The screen was not: an unlabelled rate inherits the label of its
// neighbours. So this file asserts the LABEL, not the arithmetic — a card that declares the
// window its numbers cover must print that window where a person can read it.
// ─────────────────────────────────────────────────────────────────────────────

let searchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/bridge",
  useSearchParams: () => searchParams,
}));

const api = {
  getOrders: vi.fn(),
  getOrdersSummary: vi.fn(),
  getSuppliers: vi.fn(),
  getDashboardTopology: vi.fn(),
  redeliverOrder: vi.fn(),
  transformOrder: vi.fn(),
};

vi.mock("@/lib/api-client", () => ({
  isApiMockMode: false,
  apiClient: {
    getOrders: (...a: unknown[]) => api.getOrders(...a),
    getOrdersSummary: (...a: unknown[]) => api.getOrdersSummary(...a),
    getSuppliers: (...a: unknown[]) => api.getSuppliers(...a),
    getDashboardTopology: (...a: unknown[]) => api.getDashboardTopology(...a),
    redeliverOrder: (...a: unknown[]) => api.redeliverOrder(...a),
    transformOrder: (...a: unknown[]) => api.transformOrder(...a),
  },
}));

vi.mock("@clerk/nextjs", () => ({ useUser: () => ({ user: null, isLoaded: true }) }));
vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => true }));
vi.mock("@/hooks/useSampleOrder", () => ({
  useSampleOrder: () => ({ runSample: vi.fn(), isPending: false, error: null }),
}));
vi.mock("@/hooks/useOnboardingStatus", () => ({
  ONBOARDING_STATUS_QUERY_KEY: ["onboarding-status"],
  useOnboardingStatus: () => ({
    data: { hasSupplier: true, hasUpload: true, hasResolvedMapping: true, hasDelivery: true },
  }),
  invalidateOnboardingStatus: vi.fn(),
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

import { BridgeDashboard, STAT_WINDOW_TEXT, type StatWindow } from "./BridgeDashboard";

/** Production's own histogram, byte for byte. */
const BY_STATUS: Partial<Record<OrderStatus, number>> = {
  delivery_dead_letter: 2,
  pending_review: 21,
  delivered: 3,
};
const TOTAL = 26;

let seq = 0;
function order(over: Partial<OrderSummary> = {}): OrderSummary {
  seq += 1;
  return {
    id: `ord-${seq}`,
    poNumber: `PO-409167864${seq}`,
    supplierName: "ProcuLink Sample Supplier",
    buyerName: "Michelin",
    orderDate: "2026-08-01T09:00:00Z",
    status: "pending_review",
    lineCount: 4,
    unresolvedCount: 0,
    totalValue: 1200,
    currency: "EUR",
    sourceFormat: "pdf",
    createdAt: new Date(Date.now() - seq * 60_000).toISOString(),
    ...over,
  } as OrderSummary;
}

function topology(supplierCount: number) {
  return {
    buyers: [{ id: "buy-1", name: "Michelin", code: "MIC", volume: "26 ord" }],
    suppliers: Array.from({ length: supplierCount }, (_, i) => ({
      id: `sup-${i + 1}`,
      name: i === 0 ? "ProcuLink Sample Supplier" : `Supplier ${i + 1}`,
      code: "PSS",
      volume: "3 ord",
      health: 33,
    })),
    wires: Array.from({ length: supplierCount }, (_, i) => ({
      buyerId: "buy-1",
      supplierId: `sup-${i + 1}`,
      weight: 2,
      health: "down" as const,
    })),
  };
}

function mockApi(supplierCount = 1, serverTopology = true) {
  // The windowed count queries pass `dateFrom`; the unwindowed working-set query does not.
  api.getOrders.mockImplementation((params: { status?: string; dateFrom?: string } = {}) => {
    if (params.dateFrom && params.status === "delivered") {
      return Promise.resolve({ items: [], totalCount: 0, page: 1, pageSize: 1 });
    }
    if (params.dateFrom) {
      return Promise.resolve({ items: [], totalCount: 3, page: 1, pageSize: 1 });
    }
    return Promise.resolve({
      items: [order(), order({ status: "delivery_dead_letter" })],
      totalCount: TOTAL,
      page: 1,
      pageSize: 25,
    });
  });
  api.getOrdersSummary.mockResolvedValue({ byStatus: BY_STATUS, total: TOTAL });
  api.getSuppliers.mockResolvedValue([]);
  api.getDashboardTopology.mockResolvedValue(
    serverTopology ? topology(supplierCount) : { buyers: [], suppliers: [], wires: [] },
  );
}

async function renderDashboard(supplierCount = 1, serverTopology = true) {
  mockApi(supplierCount, serverTopology);
  const { container } = render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ConfirmProvider>
        <BridgeDashboard />
      </ConfirmProvider>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(api.getDashboardTopology).toHaveBeenCalled());
  await waitFor(() =>
    expect(container.querySelectorAll("[data-stat-window]").length).toBeGreaterThan(0),
  );
  return container;
}

const flat = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ").toLowerCase();

beforeEach(() => {
  seq = 0;
  searchParams = new URLSearchParams();
  Object.values(api).forEach((f) => f.mockReset());
});
afterEach(cleanup);

describe("every stat card names the window its numbers actually cover", () => {
  it("declares a window on all three delivery-number cards", async () => {
    const container = await renderDashboard();
    const cards = Array.from(container.querySelectorAll<HTMLElement>("[data-stat-window]"));

    // An anti-vacuity floor: the assertion below is free if nothing is tagged. Three cards
    // print delivery numbers in one viewport — throughput, delivery, and supplier health.
    expect(cards.length).toBeGreaterThanOrEqual(3);
    expect(new Set(cards.map((c) => c.dataset.statCard))).toEqual(
      new Set(["throughput", "delivery", "supplier-health"]),
    );
  });

  it("prints the declared window where a person can read it", async () => {
    const container = await renderDashboard();
    for (const card of Array.from(container.querySelectorAll<HTMLElement>("[data-stat-window]"))) {
      const window = card.dataset.statWindow as StatWindow;
      expect(STAT_WINDOW_TEXT[window], `unknown window "${window}"`).toBeDefined();
      expect(
        flat(card),
        `the "${card.dataset.statCard}" card declares window "${window}" but never says so`,
      ).toContain(STAT_WINDOW_TEXT[window]);
    }
  });

  it("labels the success rate as all-time, because /api/orders/summary has no date filter", async () => {
    const container = await renderDashboard();
    const delivery = container.querySelector<HTMLElement>('[data-stat-card="delivery"]')!;

    expect(flat(delivery)).toContain("60%");
    expect(flat(delivery)).toContain("success rate");
    expect(delivery.dataset.statWindow).toBe("all");
    // The specific misreading this fixes: an unlabelled rate between two 30-day cards.
    expect(flat(delivery)).not.toContain("last 30 days");
    expect(flat(delivery)).toContain("all time");
  });

  it("says 'all time' on supplier health when the figure is client-derived", async () => {
    // The two paths cover different windows. GetTopology filters supplier rows on
    // `CreatedAt >= UtcNow.AddDays(-30)`; deriveTopology has no cutoff at all. The fallback
    // used to print NO window rather than saying which one it was on, which is the same
    // unlabelled-rate defect one branch away — and every other test here renders the server
    // path, so without this the branch is unguarded.
    const container = await renderDashboard(1, false);
    const card = container.querySelector<HTMLElement>('[data-stat-card="supplier-health"]')!;

    expect(card.dataset.statWindow).toBe("all");
    expect(flat(card)).toContain("all time");
    expect(flat(card)).not.toContain("last 30 days");
  });

  it("keeps the throughput card on the selected window", async () => {
    const container = await renderDashboard();
    const throughput = container.querySelector<HTMLElement>('[data-stat-card="throughput"]')!;
    expect(throughput.dataset.statWindow).toBe("30d"); // the default selection
    expect(flat(throughput)).toContain("last 30 days");
  });
});

describe("the counterparty count agrees with itself", () => {
  it("says '1 active supplier', not '1 active suppliers'", async () => {
    const container = await renderDashboard(1);
    const text = flat(container);
    expect(text).toContain("1 active supplier");
    expect(text).not.toContain("1 active suppliers");
  });

  it("still pluralises for more than one", async () => {
    const container = await renderDashboard(2);
    expect(flat(container)).toContain("2 active suppliers");
  });

  it("pluralises connections the same way", async () => {
    // Already correct before this change — pinned so the two counts cannot drift apart again.
    const one = flat(await renderDashboard(1));
    expect(one).toContain("1 connection");
    expect(one).not.toContain("1 connections");
    cleanup();
    expect(flat(await renderDashboard(2))).toContain("2 connections");
  });
});
