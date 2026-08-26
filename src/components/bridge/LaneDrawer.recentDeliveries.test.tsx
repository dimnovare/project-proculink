import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ─────────────────────────────────────────────────────────────────────────────
// "No recent deliveries on this connection yet." — an absence asserted over a
// question that was never asked.
//
// THE DEFECT THIS PINS. The drawer's orders query was
//
//     enabled: liveEnabled && !!supplierId
//
// and `supplierId` was resolved by an exact normalised NAME match against
// `GET /api/suppliers`:
//
//     suppliers.find(s => s.name.trim().toLowerCase() === want)?.id
//
// Rename a supplier — or let the suppliers fetch fail — and the match returns
// undefined, the orders query never runs, and a query that never ran reports
// `isLoading: false` with `data: undefined`. `recentOrders.length === 0` was then
// read as "this connection has had no deliveries", which the panel printed with
// full confidence. `isError` was unbranched on both queries, so a failed fetch
// rendered the same sentence.
//
// THREE NOTHINGS, THREE SENTENCES, and the order matters: failure is read before
// absence, so a broken lookup can never fall through to the flattering answer.
//
// jsdom applies no Tailwind, so every breakpoint tree mounts — every assertion here
// is scoped to the recent-deliveries panel by testid, and the control below proves
// the scoping actually bites.
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/bridge",
  useSearchParams: () => new URLSearchParams(),
}));

const api = {
  getSuppliers: vi.fn(),
  getOrders: vi.fn(),
};

vi.mock("@/lib/api-client", () => ({
  isApiMockMode: false,
  apiClient: {
    getSuppliers: (...a: unknown[]) => api.getSuppliers(...a),
    getOrders: (...a: unknown[]) => api.getOrders(...a),
  },
}));

vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => true, useTenantQueriesEnabled: () => true }));
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

import { LaneDrawer, readRecentDeliveries, type Lane } from "./LaneDrawer";

const SUPPLIER_ID = "11111111-2222-3333-4444-555555555555";

const LANE: Lane = {
  buyerName: "Heinrich Industries",
  buyerCode: "HEI",
  supplierName: "Acme Components",
  supplierCode: "ACM",
  supplierId: SUPPLIER_ID,
  health: "ok",
  healthBasis: { complete: true, scanned: 12 },
  volume: "12 ord",
};

/** The three sentences, as a reader sees them. */
const EMPTY = "No recent deliveries on this connection yet.";
const NEVER_ASKED = "We haven't checked recent deliveries for this connection.";
const FAILED = "We couldn't load recent deliveries for this connection.";

function renderDrawer(lane: Lane = LANE) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <LaneDrawer lane={lane} onClose={() => {}} />
    </QueryClientProvider>,
  );
}

/** Everything asserted below lives inside this panel, never the whole document. */
const panel = () => within(screen.getByTestId("lane-drawer-recent"));

beforeEach(() => {
  api.getSuppliers.mockReset();
  api.getOrders.mockReset();
});
afterEach(cleanup);

describe("readRecentDeliveries — the four answers, and which one wins", () => {
  const base = {
    queriesEnabled: true,
    suppliersFailed: false,
    suppliersLoaded: true,
    supplierId: SUPPLIER_ID as string | undefined,
    ordersFailed: false,
    ordersLoading: false,
    orderCount: 0,
  };

  it("an answered query with no orders is 'empty'", () => {
    expect(readRecentDeliveries(base)).toEqual({ state: "empty" });
  });

  it("orders present is 'orders', with the count", () => {
    expect(readRecentDeliveries({ ...base, orderCount: 3 })).toEqual({ state: "orders", count: 3 });
  });

  it("no resolved supplier is 'unlinked', NOT empty", () => {
    expect(readRecentDeliveries({ ...base, supplierId: undefined })).toEqual({ state: "unlinked" });
  });

  it("either query failing is 'unavailable', NOT empty", () => {
    expect(readRecentDeliveries({ ...base, suppliersFailed: true })).toEqual({ state: "unavailable" });
    expect(readRecentDeliveries({ ...base, ordersFailed: true })).toEqual({ state: "unavailable" });
  });

  it("failure outranks 'never asked' — a failed lookup is not a missing link", () => {
    // Both true at once is the real live shape: the suppliers fetch 500s, so there
    // is no id either. Answering "unlinked" would send the operator to fix a
    // supplier record over a network fault.
    expect(
      readRecentDeliveries({ ...base, suppliersFailed: true, supplierId: undefined }),
    ).toEqual({ state: "unavailable" });
  });

  it("queries that have not been allowed to start are 'loading', not 'unlinked'", () => {
    expect(
      readRecentDeliveries({ ...base, queriesEnabled: false, supplierId: undefined, suppliersLoaded: false }),
    ).toEqual({ state: "loading" });
  });
});

describe("LaneDrawer — the panel says which nothing it means", () => {
  it("no orders for a resolved supplier: 'no deliveries yet'", async () => {
    api.getSuppliers.mockResolvedValue([{ id: SUPPLIER_ID, name: "Acme Components" }]);
    api.getOrders.mockResolvedValue({ items: [], total: 0 });
    renderDrawer();

    // The decisive sentence is looked for on the page first, so a build that renders
    // no such sentence at all fails on the SENTENCE and not on a missing testid. The
    // scoped negatives below are what the testid is for.
    await screen.findByText(EMPTY);
    expect(panel().getByText(EMPTY)).toBeTruthy();
    expect(panel().queryByText(NEVER_ASKED)).toBeNull();
    expect(panel().queryByText(FAILED)).toBeNull();
    expect(api.getOrders).toHaveBeenCalled();
  });

  it("supplier renamed since the wire was drawn: still asks, by id", async () => {
    // THE REGRESSION THE `supplierId` FIELD EXISTS FOR. The lane still carries the
    // old display name; only the id survives a rename.
    api.getSuppliers.mockResolvedValue([{ id: SUPPLIER_ID, name: "Acme Components GmbH" }]);
    api.getOrders.mockResolvedValue({
      items: [
        { id: "ord-1", poNumber: "PO-2026-1", status: "delivered", lineCount: 4, totalValue: 100, currency: "EUR" },
      ],
      total: 1,
    });
    renderDrawer();

    await screen.findByText("PO-2026-1");
    expect(api.getOrders).toHaveBeenCalledWith({ supplierId: SUPPLIER_ID, pageSize: 5 });
    expect(panel().getByText("PO-2026-1")).toBeTruthy();
    expect(panel().queryByText(EMPTY)).toBeNull();
  });

  it("nothing in the library matches: says we never checked, and does NOT query", async () => {
    api.getSuppliers.mockResolvedValue([{ id: "some-other-id", name: "BoltWorks BV" }]);
    renderDrawer({ ...LANE, supplierId: undefined });

    await screen.findByText(NEVER_ASKED);
    expect(panel().getByText(NEVER_ASKED)).toBeTruthy();
    expect(panel().queryByText(EMPTY)).toBeNull();
    expect(panel().queryByText(FAILED)).toBeNull();
    // The whole point: no request was made, so no absence may be claimed.
    expect(api.getOrders).not.toHaveBeenCalled();
    // And it names the supplier it could not find, so the sentence is actionable.
    expect(panel().getByText(/Acme Components/)).toBeTruthy();
  });

  it("a synthetic topology id is not trusted as a library record", async () => {
    // deriveTopology mints `sup-<normalised-name>` for a supplier with orders but no
    // library record. Querying orders by an id no supplier has would answer "empty" —
    // the same lie, one layer down.
    api.getSuppliers.mockResolvedValue([{ id: "some-other-id", name: "BoltWorks BV" }]);
    renderDrawer({ ...LANE, supplierId: "sup-acme components" });

    await screen.findByText(NEVER_ASKED);
    expect(panel().getByText(NEVER_ASKED)).toBeTruthy();
    expect(api.getOrders).not.toHaveBeenCalled();
  });

  it("the suppliers fetch fails: says the lookup failed, and offers a retry", async () => {
    api.getSuppliers.mockRejectedValue(new Error("boom"));
    renderDrawer();

    // Both queries carry `retry: 1`, so the error state is one retry + backoff away.
    await screen.findByText(FAILED, undefined, { timeout: 8000 });
    expect(panel().getByText(FAILED)).toBeTruthy();
    expect(panel().queryByText(EMPTY)).toBeNull();
    expect(panel().queryByText(NEVER_ASKED)).toBeNull();
    expect(panel().getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("the orders fetch fails: same, even though the supplier resolved fine", async () => {
    api.getSuppliers.mockResolvedValue([{ id: SUPPLIER_ID, name: "Acme Components" }]);
    api.getOrders.mockRejectedValue(new Error("boom"));
    renderDrawer();

    await screen.findByText(FAILED, undefined, { timeout: 8000 });
    expect(panel().getByText(FAILED)).toBeTruthy();
    expect(panel().queryByText(EMPTY)).toBeNull();
  });

  it("CONTROL — the three sentences are distinct, and the scoping is real", async () => {
    // Anti-vacuity, two ways.
    //
    // 1. Three literals that differ. If a future edit collapsed two of these back
    //    into one sentence, the assertions above would pass while the screen went
    //    back to answering one question with another.
    // 2. The testid scope actually excludes part of the drawer. `getByTestId` on a
    //    wrapper that happened to be the whole document would make every `queryBy…`
    //    negative above meaningless.
    expect(new Set([EMPTY, NEVER_ASKED, FAILED]).size).toBe(3);

    api.getSuppliers.mockResolvedValue([{ id: SUPPLIER_ID, name: "Acme Components" }]);
    api.getOrders.mockResolvedValue({ items: [], total: 0 });
    renderDrawer();

    await screen.findByText(EMPTY);
    // "Connection detail" is the drawer's own heading, OUTSIDE the scoped panel.
    expect(screen.getByText("Connection detail")).toBeTruthy();
    expect(panel().queryByText("Connection detail")).toBeNull();
  });
});
