import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConfirmProvider } from "@/components/ui/confirm";
import type { OrderSummary } from "@/types/procurement";

// ─────────────────────────────────────────────────────────────────────────────
// Two KPI count queries that never read the auth gate they sit underneath.
//
// BridgeDashboard writes its own rule at the top of the query block: "Gate all data
// queries on auth readiness to prevent the cold-mount 401 race". Four queries —
// suppliers, orders, topology, summary — carry `enabled: queryEnabled` and honour it.
// The two windowed count queries directly beneath them carried `enabled: !isApiMockMode`
// and nothing else.
//
// `!isApiMockMode` LOOKS like the whole condition and is only half of one. It answers
// "is there a real backend to call?" — never "do we have a token to call it with?". So
// on a hard refresh of /bridge the four hero queries waited for Clerk while these two
// fired into an unauthenticated window and took a guaranteed 401; TanStack Query then
// parks a failed query, so the throughput card's received/delivered counts stayed
// wrong for the rest of the mount while every number beside them was correct.
//
// The absence assertion below is worthless on its own — a query that never fires under
// ANY condition would satisfy it. So it is paired with a control that renders the same
// dashboard with auth ready and demands both counts actually go out, and the not-ready
// case additionally proves the component mounted and got as far as painting its cards.
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

// The one knob this file turns. `false` is the cold mount: Clerk's session has not
// resolved yet, so useQueriesEnabled() is still false and NOTHING may go to the API.
let queriesEnabled = true;

vi.mock("@clerk/nextjs", () => ({ useUser: () => ({ user: null, isLoaded: true }) }));
vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => queriesEnabled }));
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
    poNumber: `PO-450000000${seq}`,
    supplierName: "ProcuLink Sample Supplier",
    buyerName: "Example Tyre Co",
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

type OrdersParams = { status?: string; pageSize?: number; dateFrom?: string };

function mockApi() {
  api.getOrders.mockImplementation((params: OrdersParams = {}) => {
    // The count queries ask for pageSize:1 and read only totalCount.
    if (params.pageSize === 1) {
      return Promise.resolve({
        items: [],
        totalCount: params.status === "delivered" ? 3 : 26,
        page: 1,
        pageSize: 1,
      });
    }
    return Promise.resolve({ items: [order()], totalCount: 26, page: 1, pageSize: 25 });
  });
  api.getOrdersSummary.mockResolvedValue({ byStatus: { pending_review: 26 }, total: 26 });
  api.getSuppliers.mockResolvedValue([]);
  api.getDashboardTopology.mockResolvedValue({ buyers: [], suppliers: [], wires: [] });
}

function renderDashboard() {
  mockApi();
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ConfirmProvider>
        <BridgeDashboard />
      </ConfirmProvider>
    </QueryClientProvider>,
  );
}

/** Let every mount effect and query-scheduler tick land before asserting an absence. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Every getOrders call the two windowed count queries would have made. */
function countCalls(): OrdersParams[] {
  return api.getOrders.mock.calls
    .map(([params]) => (params ?? {}) as OrdersParams)
    .filter((params) => params.pageSize === 1);
}

beforeEach(() => {
  seq = 0;
  queriesEnabled = true;
  searchParams = new URLSearchParams();
  Object.values(api).forEach((f) => f.mockReset());
});
afterEach(cleanup);

describe("the windowed KPI count queries wait for auth like every other dashboard query", () => {
  it("fires neither count query on a cold mount, before the session is ready", async () => {
    queriesEnabled = false;
    const { container } = renderDashboard();
    await settle();

    // Anti-vacuity: the dashboard really mounted and painted, so "no calls" below is a
    // decision the query gate made — not the absence of a component.
    expect(
      container.querySelectorAll("[data-stat-card]").length,
      "the dashboard did not render, so this test proves nothing",
    ).toBeGreaterThan(0);

    expect(
      countCalls(),
      "a windowed count query fired before the Clerk session was ready — that call 401s",
    ).toEqual([]);
  });

  it("holds the whole query block, not just the four that already waited", async () => {
    queriesEnabled = false;
    renderDashboard();
    await settle();

    // The gate is the rule for the block. If any of these ever fires cold, the count
    // queries are not the only thing racing auth.
    expect(api.getOrders).not.toHaveBeenCalled();
    expect(api.getSuppliers).not.toHaveBeenCalled();
    expect(api.getDashboardTopology).not.toHaveBeenCalled();
    expect(api.getOrdersSummary).not.toHaveBeenCalled();
  });

  it("fires both count queries once the session is ready", async () => {
    queriesEnabled = true;
    renderDashboard();

    await waitFor(() => expect(countCalls().length).toBeGreaterThanOrEqual(2));

    const calls = countCalls();
    // Received: no status filter. Delivered: status "delivered". Two distinct counts,
    // both of which the not-ready test above claims are withheld.
    expect(calls.some((params) => params.status === undefined)).toBe(true);
    expect(calls.some((params) => params.status === "delivered")).toBe(true);
  });
});
