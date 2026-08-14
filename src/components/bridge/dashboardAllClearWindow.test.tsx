import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConfirmProvider } from "@/components/ui/confirm";
import type { OrderStatus, OrderSummary } from "@/types/procurement";

// ─────────────────────────────────────────────────────────────────────────────
// "All clear", computed over 100 orders, directly above a count that contradicts it.
// (Audit 2026-08-13 v3, P0-9.)
//
// `DashboardContextLine` rendered "All clear" from a filter over `ordersPage?.items ?? []`,
// and that page is fetched at `pageSize: 100`. The amber attention strip a couple of inches
// below prints `openExceptionsAll`, which on a signed-in org comes from the SUMMARY endpoint
// — the whole population. So an account with more than a hundred orders could render
//
//     "All clear"                       ← over the newest 100
//     "137 orders need your attention"  ← over all of them
//
// in one viewport, with both numbers individually correct.
//
// TWO HALVES, and the second is the one this codebase keeps re-growing: `?? []` turns a
// FAILED fetch into an empty array, and an empty array reads as "all clear". The producer
// already guarded that (`!ordersError`) and nothing pinned it, so it is pinned here.
//
// The fix is the CLAIM, not the page size. Fetching more pages would make a wrong predicate
// right by accident and would still be wrong at page 101.
//
// These tests assert the RENDERED SENTENCES, both of them, from one render — a unit test of
// the predicate cannot see that the two claims share a viewport.
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

vi.mock("@clerk/nextjs", () => ({ useUser: () => ({ user: { firstName: "Dim" }, isLoaded: true }) }));
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

import { BridgeDashboard } from "./BridgeDashboard";

let seq = 0;
function order(over: Partial<OrderSummary> = {}): OrderSummary {
  seq += 1;
  return {
    id: `ord-${seq}`,
    poNumber: `PO-45000000${seq}`,
    supplierName: "Nordmark",
    buyerName: "Example Tyre Co",
    orderDate: "2026-08-01T09:00:00Z",
    status: "delivered",
    lineCount: 4,
    unresolvedCount: 0,
    totalValue: 1200,
    currency: "EUR",
    sourceFormat: "csv",
    createdAt: new Date(Date.now() - seq * 60_000).toISOString(),
    ...over,
  } as OrderSummary;
}

/** The newest page: 100 clean orders. Nothing in it needs a human. */
const CLEAN_PAGE = () => Array.from({ length: 100 }, () => order());

/**
 * The org's true histogram: 137 orders the exceptions page would list, none of which are
 * on the newest page. This is the shape the audit describes.
 */
const BY_STATUS: Partial<Record<OrderStatus, number>> = { pending_review: 137, delivered: 100 };

function mockApi(opts: { ordersFail?: boolean } = {}) {
  api.getOrders.mockImplementation((params: { status?: string; dateFrom?: string } = {}) => {
    if (opts.ordersFail && !params.dateFrom) return Promise.reject(new Error("network"));
    if (params.dateFrom) {
      return Promise.resolve({ items: [], totalCount: 237, page: 1, pageSize: 1 });
    }
    return Promise.resolve({
      items: CLEAN_PAGE(),
      // The account holds far more than the page returned — the truncation the verdict
      // was silently speaking for.
      totalCount: 237,
      page: 1,
      pageSize: 100,
    });
  });
  api.getOrdersSummary.mockResolvedValue({ byStatus: BY_STATUS, total: 237 });
  api.getSuppliers.mockResolvedValue([]);
  api.getDashboardTopology.mockResolvedValue({ buyers: [], suppliers: [], wires: [] });
}

async function renderDashboard(opts: { ordersFail?: boolean } = {}) {
  mockApi(opts);
  const { container } = render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ConfirmProvider>
        <BridgeDashboard />
      </ConfirmProvider>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(api.getOrdersSummary).toHaveBeenCalled());
  return container;
}

const flat = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ");

beforeEach(() => {
  seq = 0;
  searchParams = new URLSearchParams();
  Object.values(api).forEach((f) => f.mockReset());
});
afterEach(cleanup);

describe("the dashboard verdict and the count beside it describe one population (P0-9)", () => {
  it("still prints the full-population attention count — the number is not the defect", async () => {
    const container = await renderDashboard();
    await waitFor(() =>
      expect(flat(container)).toMatch(/137 orders need your attention/),
    );
  });

  it("does not say All clear above it", async () => {
    const container = await renderDashboard();
    await waitFor(() =>
      expect(flat(container)).toMatch(/137 orders need your attention/),
    );
    // The exact contradiction the audit describes, in one viewport.
    expect(flat(container)).not.toMatch(/All clear/);
  });

  it("says which window the verdict actually covered", async () => {
    const container = await renderDashboard();
    await waitFor(() =>
      expect(flat(container)).toMatch(/No blockers in the newest 100 orders/),
    );
  });

  it("a failed orders fetch renders no verdict at all — an empty array is not All clear", async () => {
    const container = await renderDashboard({ ordersFail: true });
    // Wait for the failure to land somewhere visible, so this is not asserting on an
    // unfinished render: the "Needs you" section swaps to its own retry state.
    await waitFor(() =>
      expect(flat(container)).toMatch(/Couldn.t load orders that need you/),
    );
    const text = flat(container);
    expect(text).not.toMatch(/All clear/);
    expect(text).not.toMatch(/No blockers in the newest/);
    expect(text).not.toMatch(/\d+ blockers? needs? you first/);
  });
});
