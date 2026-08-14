import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConfirmProvider } from "@/components/ui/confirm";
import type { OrderStatus, OrderSummary } from "@/types/procurement";

// ─────────────────────────────────────────────────────────────────────────────
// "Healthy" — a verdict about a connection, decided over the first 100 orders.
//
// THE DEFECT THIS PINS. Click a wire on /bridge and the drawer printed, twice:
//
//     const HEALTH_LABEL = { ok: "Healthy", risk: "At risk", down: "Down" };
//
// `lane.health` comes from BridgeDashboard's deriveTopology:
//
//     const health: Wire["health"] = w.failed > 0 ? "down" : w.exceptions > 0 ? "risk" : "ok";
//
// over `allOrders` — `apiClient.getOrders({ pageSize: 100 })`, ONE PAGE. The file's own
// comment already named the cap ("client-derived (capped at working set)"), and the label
// on top of it still said "Healthy" without qualification. An account past a hundred
// orders got a green all-clear on a connection whose failures were simply not loaded.
//
// The fix is the CLAIM, not the page size: fetching more pages would make a wrong
// predicate right by accident, and the next cap would reintroduce it. Same answer, and the
// same `complete` flag, that `readBlockers` reached for the dashboard context line.
//
// TWO PATHS reach the drawer and only one is wrong. `GET /api/dashboard/topology`
// aggregates server-side over the org's orders, and it wins at
// `endpointHasData ? endpoint : derived`. Its verdict covers the connection, so it must
// keep saying "Healthy" — which is why the endpoint control below is not optional. A fix
// that retired the word outright would satisfy the defect half on its own while making the
// screen vaguer than it needs to be.
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

import { BridgeDashboard } from "./BridgeDashboard";
import { PARTIAL_OK_LABEL, laneHealthLabel, laneHealthScopeNote } from "./LaneDrawer";

// ── The two strings under test, as a reader sees them ────────────────────────

/** The verdict that was being produced without the evidence for it. */
const HEALTHY = "healthy";
/** What the truncated working set is allowed to say instead. Derived, not retyped. */
const PARTIAL = PARTIAL_OK_LABEL.toLowerCase();
/** The opening of the scope sentence, which must name a number of orders. */
const SCOPE_OPENER = "based on the";

const BUYER = "Northwind Fasteners";
const SUPPLIER = "Baltic Valve Co";

/** One clean page. Nothing here is failed and nothing carries an unresolved line. */
const WORKING_SET = 100;
/** What the account really holds. Bigger than the page, which is the whole point. */
const TRUNCATED_TOTAL = 250;

// ── Anti-vacuity floor ───────────────────────────────────────────────────────
//
// Every assertion below is a `toContain` / `not.toContain` over page text, and page text is
// a string that can go empty for a hundred reasons that have nothing to do with this fix.
// Thrown at module load so vitest collects nothing rather than reporting a vacuous pass.

function floor(): void {
  const fail = (why: string): never => {
    throw new Error(`laneHealthScope anti-vacuity floor: ${why}`);
  };
  if (PARTIAL === HEALTHY) fail("the scoped label and the verdict are the same string — no assertion here can distinguish them");
  if (PARTIAL.length === 0) fail("PARTIAL_OK_LABEL is empty");
  if (TRUNCATED_TOTAL <= WORKING_SET) fail("the fixture account fits inside one page, so the cap it exists to demonstrate never binds");
  // The helpers must actually disagree across the two bases, or the render assertions are
  // testing one branch twice.
  if (laneHealthLabel("ok", { complete: true, scanned: WORKING_SET }) === laneHealthLabel("ok", { complete: false, scanned: WORKING_SET })) {
    fail("laneHealthLabel returns the same word complete and incomplete");
  }
  if (laneHealthScopeNote({ complete: true, scanned: WORKING_SET }) !== null) {
    fail("a complete basis still produces a scope note, so the note proves nothing about truncation");
  }
}

floor();

// ── Fixtures ─────────────────────────────────────────────────────────────────

let seq = 0;
function order(over: Partial<OrderSummary> = {}): OrderSummary {
  seq += 1;
  return {
    id: `ord-${seq}`,
    poNumber: `PO-5500${seq}`,
    supplierName: SUPPLIER,
    buyerName: BUYER,
    orderDate: "2026-08-01T09:00:00Z",
    status: "delivered" as OrderStatus,
    lineCount: 4,
    unresolvedCount: 0,
    totalValue: 900,
    currency: "EUR",
    sourceFormat: "csv",
    createdAt: new Date(Date.now() - seq * 60_000).toISOString(),
    ...over,
  } as OrderSummary;
}

/** The server aggregation's own answer — one clean connection, health "ok". */
function serverTopology() {
  return {
    buyers: [{ id: "buy-1", name: BUYER, code: "NWF", volume: "250 ord" }],
    suppliers: [{ id: "sup-1", name: SUPPLIER, code: "BVC", volume: "250 ord", health: 100 }],
    wires: [{ buyerId: "buy-1", supplierId: "sup-1", weight: 4, health: "ok" as const }],
  };
}

/**
 * @param loaded   how many orders the working-set query returns
 * @param total    how many the account really has (`totalCount`)
 * @param endpoint whether GET /api/dashboard/topology answers with rows
 */
function mockApi(loaded: number, total: number, endpoint: boolean): void {
  api.getOrders.mockImplementation((params: { dateFrom?: string; status?: string } = {}) => {
    // The windowed count queries pass dateFrom and read only totalCount.
    if (params.dateFrom) {
      return Promise.resolve({ items: [], totalCount: total, page: 1, pageSize: 1 });
    }
    return Promise.resolve({
      items: Array.from({ length: loaded }, () => order()),
      totalCount: total,
      page: 1,
      pageSize: 100,
    });
  });
  api.getOrdersSummary.mockResolvedValue({ byStatus: { delivered: total }, total });
  api.getSuppliers.mockResolvedValue([]);
  api.getDashboardTopology.mockResolvedValue(
    endpoint ? serverTopology() : { buyers: [], suppliers: [], wires: [] },
  );
}

beforeEach(() => {
  seq = 0;
  searchParams = new URLSearchParams();
  Object.values(api).forEach((f) => f.mockReset());
});
afterEach(cleanup);

/** Everything a person can read, flattened. Rendered text — not props. */
const body = (): string => (document.body.textContent ?? "").replace(/\s+/g, " ").toLowerCase();

/**
 * Render /bridge, open the System map, and click the connection.
 *
 * The wire is reached the way a user reaches it — the `<g>` carrying the click handler in
 * the topology canvas — so the basis the drawer receives is whatever `handleWireClick`
 * really passes, not a value this test hands it.
 */
async function openConnectionDrawer(loaded: number, total: number, endpoint: boolean): Promise<void> {
  mockApi(loaded, total, endpoint);
  const { container } = render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ConfirmProvider>
        <BridgeDashboard />
      </ConfirmProvider>
    </QueryClientProvider>,
  );

  await waitFor(() => expect(api.getDashboardTopology).toHaveBeenCalled());
  fireEvent.click(screen.getByRole("tab", { name: /system map/i }));

  const wire = await waitFor(() => {
    const g = container.querySelector<SVGGElement>(
      'section[aria-label="Order pipeline"] g[style*="cursor"]',
    );
    if (!g) throw new Error("the topology rendered no clickable connection");
    return g;
  });
  fireEvent.click(wire);
  await waitFor(() => expect(screen.getByText("Connection detail")).toBeTruthy());
}

// ═════════════════════════════════════════════════════════════════════════════
// THE DEFECT — the client-derived path, over a working set smaller than the account.
// ═════════════════════════════════════════════════════════════════════════════

describe("a connection judged from one page of orders does not call itself healthy", () => {
  it("says what it saw instead of what the connection is", async () => {
    await openConnectionDrawer(WORKING_SET, TRUNCATED_TOTAL, false);

    expect(
      body(),
      "the drawer printed the account-wide verdict from a 100-order sample",
    ).not.toContain(HEALTHY);
    expect(body()).toContain(PARTIAL);
  });

  it("names the population the verdict was computed over", async () => {
    await openConnectionDrawer(WORKING_SET, TRUNCATED_TOTAL, false);

    expect(body()).toContain(SCOPE_OPENER);
    expect(
      body(),
      "the scope note does not say how many orders were read",
    ).toContain(`${SCOPE_OPENER} ${WORKING_SET}`);
    expect(body()).toContain("not every order on this connection");
  });

  it("retreats in both places the verdict is printed, not just one", async () => {
    // The word renders twice — the eyebrow between the two parties and the Health stat
    // tile — and the two were separate reads of HEALTH_LABEL before this change.
    await openConnectionDrawer(WORKING_SET, TRUNCATED_TOTAL, false);

    const shown = screen.getAllByText(PARTIAL_OK_LABEL);
    expect(shown.length, "only one of the two health labels was scoped").toBeGreaterThanOrEqual(2);
  });

  it("keeps the unfavourable verdicts, which a sample does prove", async () => {
    // Only the FAVOURABLE claim is universal. One failure in the sample is a real failure,
    // so "Down" survives truncation — and a fix that softened everything would be a
    // different lie in the opposite direction.
    const truncated = { complete: false, scanned: WORKING_SET };
    expect(laneHealthLabel("down", truncated)).toBe("Down");
    expect(laneHealthLabel("risk", truncated)).toBe("At risk");
    expect(laneHealthLabel("ok", truncated)).toBe(PARTIAL_OK_LABEL);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// CONTROLS — the two bases that ARE entitled to the verdict keep it, unchanged.
// ═════════════════════════════════════════════════════════════════════════════

describe("a verdict with the evidence behind it is untouched", () => {
  it("the server-aggregated topology still says Healthy, with no scope note", async () => {
    // GET /api/dashboard/topology wins at `endpointHasData ? endpoint : derived` and is not
    // capped by the working set. Breaking this path would be the cost of the fix, not the fix.
    await openConnectionDrawer(WORKING_SET, TRUNCATED_TOTAL, true);

    expect(body(), "the endpoint path lost the verdict it had evidence for").toContain(HEALTHY);
    expect(body()).not.toContain(PARTIAL);
    expect(body(), "a complete verdict grew a scope note it does not need").not.toContain(SCOPE_OPENER);
  });

  it("the client-derived path says Healthy too when the page really is the whole account", async () => {
    // Most orgs. `population <= scanned`, so nothing is missing and nothing is hedged —
    // the note appears only where it is earned.
    await openConnectionDrawer(12, 12, false);

    expect(body(), "a complete working set was hedged anyway").toContain(HEALTHY);
    expect(body()).not.toContain(PARTIAL);
    expect(body()).not.toContain(SCOPE_OPENER);
  });
});
