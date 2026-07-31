import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConfirmProvider } from "@/components/ui/confirm";
import type { OrderStatus, OrderSummary } from "@/types/procurement";

// ─────────────────────────────────────────────────────────────────────────────
// WP-29 — one label, one number, everywhere.
//
// At 478b809 the dashboard printed "Ready to send" over `ready + ready_to_deliver`
// (BridgeDashboard.tsx:947 reading :643) while the inbox badged only `ready` with
// those words (UnifiedStatusBadge.tsx:99) and offered no chip for it at all. The
// operator read a number on one screen and could not find it on the other. Neither
// computation was wrong on its own — that is the point. Two independent derivations
// of one label IS the defect.
//
// THIS TEST IS THE PACKET'S REAL DELIVERABLE, and it is deliberately GENERAL: it
// walks ORDER_COUNT_CONTRACT rather than naming "Ready to send". A future count that
// diverges fails here without anyone writing a new test — which is the only kind of
// guard that survives the next packet.
//
// Both surfaces tag every contract count with data-count-label / data-count-value.
// The tag is not an escape hatch: REQUIRED_ON_* below asserts which labels each
// surface must carry, so deleting a tag fails just as loudly as printing a wrong
// number.
// ─────────────────────────────────────────────────────────────────────────────

let searchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/inbox",
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

// DashboardContextLine reads Clerk's useUser() for the operator's first name; the
// dashboard is not mounted inside a ClerkProvider here.
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

import { InboxView, FILTER_CHIPS } from "./InboxView";
import { BridgeDashboard } from "./BridgeDashboard";
import {
  ORDER_COUNT_CONTRACT,
  INBOX_CHIP_LABELS,
  countFor,
  chipIndexForStatus,
} from "./orderCountContract";

// ── ONE fixture, rendered into both screens ──────────────────────────────────
// Every status carries a DIFFERENT count, and no two contract labels sum to the
// same number, so a wrong status set can never coincidentally print the right
// figure. `ready` (5) and `ready_to_deliver` (7) matter most: the old dashboard
// summed them to 12, a number that must now appear nowhere.
const BY_STATUS: Partial<Record<OrderStatus, number>> = {
  parsing: 1,
  unrouted: 3,
  pending_review: 9,
  ready: 5,
  ready_to_deliver: 7,
  transforming: 1,
  delivering: 2,
  delivered: 11,
  delivery_held: 1,
  delivery_unconfirmed: 1,
  failed: 2,
  transform_failed: 1,
  delivery_failed: 4,
  delivery_dead_letter: 6,
  rejected_by_supplier: 8,
};
const TOTAL = Object.values(BY_STATUS).reduce((a, b) => a + b, 0); // 62

let seq = 0;
function order(over: Partial<OrderSummary> = {}): OrderSummary {
  seq += 1;
  return {
    id: `ord-${seq}`,
    poNumber: `PO-7000${seq}`,
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

const ROWS: OrderSummary[] = [
  order({ status: "ready" }),
  order({ status: "ready_to_deliver" }),
  order({ status: "pending_review", unresolvedCount: 2 }),
  order({ status: "delivered" }),
  order({ status: "delivery_failed" }),
];

function mockApi() {
  api.getOrders.mockResolvedValue({
    items: ROWS,
    totalCount: TOTAL,
    page: 1,
    pageSize: 25,
  });
  api.getOrdersSummary.mockResolvedValue({ byStatus: BY_STATUS, total: TOTAL });
  api.getSuppliers.mockResolvedValue([]);
  api.getDashboardTopology.mockResolvedValue({ buyers: [], suppliers: [], wires: [] });
}

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

/** Every contract count a surface printed, as {label → number}. */
function printedCounts(container: HTMLElement): Map<string, number> {
  const found = new Map<string, number>();
  for (const el of Array.from(container.querySelectorAll<HTMLElement>("[data-count-label]"))) {
    const label = el.dataset.countLabel!;
    const raw = el.dataset.countValue;
    expect(raw, `[data-count-label="${label}"] must also carry data-count-value`).toBeDefined();
    const value = Number(raw);
    expect(Number.isFinite(value), `data-count-value for "${label}" must be a number`).toBe(true);
    const prev = found.get(label);
    if (prev !== undefined) {
      // The SAME label twice on ONE screen must also agree (the dashboard prints
      // several of these in both the stat row and the proportion-bar legend).
      expect(value, `"${label}" printed twice on one screen with different numbers`).toBe(prev);
    }
    found.set(label, value);
  }
  return found;
}

async function renderInbox() {
  mockApi();
  const { container } = render(
    <QueryClientProvider client={newClient()}>
      <ConfirmProvider>
        <InboxView />
      </ConfirmProvider>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(api.getOrdersSummary).toHaveBeenCalled());
  await waitFor(() =>
    expect(container.querySelector('[data-count-label="All orders"]')).toBeTruthy(),
  );
  return container;
}

async function renderDashboard() {
  mockApi();
  const { container } = render(
    <QueryClientProvider client={newClient()}>
      <ConfirmProvider>
        <BridgeDashboard />
      </ConfirmProvider>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(api.getOrdersSummary).toHaveBeenCalled());
  await waitFor(() =>
    expect(container.querySelectorAll("[data-count-label]").length).toBeGreaterThan(0),
  );
  return container;
}

/** Labels each surface MUST print — the guard against a silently-untagged count. */
const REQUIRED_ON_INBOX = [
  "All orders",
  "Needs review",
  "Ready to send",
  "Queued to send",
  "Delivered",
  "Failed",
];
const REQUIRED_ON_DASHBOARD = [
  "Received",
  "Needs review",
  "Ready to send",
  "Queued to send",
  "Delivered",
  "Failed",
];

beforeEach(() => {
  searchParams = new URLSearchParams();
  Object.values(api).forEach((fn) => fn.mockReset());
});
afterEach(cleanup);

describe("cross-screen count parity — one label, one number", () => {
  it("every count the inbox prints equals the contract's number for that label", async () => {
    const container = await renderInbox();
    const printed = printedCounts(container);
    for (const [label, value] of printed) {
      expect(value, `inbox printed "${label}"`).toBe(countFor(label, BY_STATUS, TOTAL));
    }
  });

  it("every count the dashboard prints equals the contract's number for that label", async () => {
    const container = await renderDashboard();
    const printed = printedCounts(container);
    for (const [label, value] of printed) {
      expect(value, `dashboard printed "${label}"`).toBe(countFor(label, BY_STATUS, TOTAL));
    }
  });

  it("a label on BOTH screens prints the SAME number for the same fixture", async () => {
    const inbox = printedCounts(await renderInbox());
    cleanup();
    const dashboard = printedCounts(await renderDashboard());

    const shared = [...inbox.keys()].filter((l) => dashboard.has(l));
    // Not a vacuous intersection: these five labels are the whole reason the test exists.
    expect(shared.sort()).toEqual(
      ["Delivered", "Failed", "Needs review", "Queued to send", "Ready to send"].sort(),
    );
    for (const label of shared) {
      expect(
        dashboard.get(label),
        `"${label}" — inbox says ${inbox.get(label)}, dashboard says ${dashboard.get(label)}`,
      ).toBe(inbox.get(label));
    }
  });

  it('"Ready to send" means `ready` only — not `ready + ready_to_deliver`', async () => {
    // The exact regression. 5 is `ready`; 12 is the old sum. If 12 ever comes back,
    // the dashboard is summing two statuses under one label again.
    const inbox = printedCounts(await renderInbox());
    cleanup();
    const dashboard = printedCounts(await renderDashboard());
    for (const surface of [inbox, dashboard]) {
      expect(surface.get("Ready to send")).toBe(5);
      expect(surface.get("Ready to send")).not.toBe(12);
      expect(surface.get("Queued to send")).toBe(7);
    }
  });

  it("neither surface silently drops a contract count", async () => {
    const inbox = printedCounts(await renderInbox());
    for (const label of REQUIRED_ON_INBOX) {
      expect(inbox.has(label), `inbox must print "${label}"`).toBe(true);
    }
    cleanup();
    const dashboard = printedCounts(await renderDashboard());
    for (const label of REQUIRED_ON_DASHBOARD) {
      expect(dashboard.has(label), `dashboard must print "${label}"`).toBe(true);
    }
  });

  it("every printed label is a contract label (nothing computes counts beside the markup)", async () => {
    const known = new Set(ORDER_COUNT_CONTRACT.map((r) => r.label));
    const inbox = printedCounts(await renderInbox());
    cleanup();
    const dashboard = printedCounts(await renderDashboard());
    for (const label of [...inbox.keys(), ...dashboard.keys()]) {
      expect(known.has(label), `"${label}" is tagged as a count but is not in ORDER_COUNT_CONTRACT`).toBe(true);
    }
  });
});

describe("the chip table is derived, not hand-written", () => {
  it("InboxView's FILTER_CHIPS renders exactly INBOX_CHIP_LABELS, in order", () => {
    expect(FILTER_CHIPS.map((c) => c.label)).toEqual([...INBOX_CHIP_LABELS]);
  });

  it("each chip's summary keys are the contract's statuses for its own label", () => {
    for (const chip of FILTER_CHIPS) {
      const expected = ORDER_COUNT_CONTRACT.find((r) => r.label === chip.label)?.statuses;
      // `null` (the account total) is carried as an absent summaryKeys.
      expect(chip.summaryKeys ?? null, `chip "${chip.label}"`).toEqual(expected ?? null);
    }
  });

  it("chip highlight indices are derived from the chip order, so inserting a chip can't mis-light another", () => {
    expect(chipIndexForStatus("pending_review")).toBe(INBOX_CHIP_LABELS.indexOf("Needs review"));
    expect(chipIndexForStatus("ready")).toBe(INBOX_CHIP_LABELS.indexOf("Ready to send"));
    expect(chipIndexForStatus("ready_to_deliver")).toBe(INBOX_CHIP_LABELS.indexOf("Queued to send"));
    expect(chipIndexForStatus("delivered")).toBe(INBOX_CHIP_LABELS.indexOf("Delivered"));
    for (const s of ["failed", "transform_failed", "delivery_failed", "delivery_dead_letter", "rejected_by_supplier"]) {
      expect(chipIndexForStatus(s), s).toBe(INBOX_CHIP_LABELS.indexOf("Failed"));
    }
    // No chip of their own — they stay deep-linkable and fall back to "All orders".
    for (const s of ["unrouted", "parsing", "delivering", "delivery_held", "delivery_unconfirmed"]) {
      expect(chipIndexForStatus(s), s).toBe(0);
    }
    expect(chipIndexForStatus(null)).toBe(0);
    expect(chipIndexForStatus("nonsense")).toBe(0);
  });

  it("the `ready` deep link lights the Ready to send chip, not All orders", async () => {
    // C6: INBOX_FILTERABLE_STATUSES accepted ?status=ready, so the server filter ran,
    // but CHIP_FOR_STATUS had no entry — the view showed only `ready` orders while the
    // toolbar claimed "All orders" was selected.
    searchParams = new URLSearchParams("status=ready");
    const container = await renderInbox();
    // Queried through the count tag, not by accessible name: the mobile card is itself
    // a <button> whose name contains its status badge, so /Ready to send/ matches both.
    const chip = (label: string) =>
      container.querySelector(`[data-count-label="${label}"]`)!.closest("button")!;
    expect(chip("Ready to send").getAttribute("aria-pressed")).toBe("true");
    expect(chip("All orders").getAttribute("aria-pressed")).toBe("false");
  });
});
