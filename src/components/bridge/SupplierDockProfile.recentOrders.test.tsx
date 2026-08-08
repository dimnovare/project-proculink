import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

/**
 * The defect, verbatim, as it shipped:
 *
 *   src/components/bridge/SupplierDockProfile.tsx:1608-1612
 *
 *     ) : (
 *       <p className="px-4 py-5 text-[13px] sm:px-5" style={{ color: MUTED }}>
 *         No deliveries yet for this supplier.
 *       </p>
 *     )}
 *
 * That `else` branch was every non-mock user — i.e. production. The page issued
 * no order query at all, so the sentence was not a wrong reading of an unknown
 * value; there was no value. A supplier with 400 orders was told it had none, on
 * the configuration screen every trial walks through.
 *
 * The contract these tests pin:
 *
 *   The empty sentence may render ONLY when a completed query actually returned
 *   nothing. Loading is not empty. An error is not empty. And the sentence that
 *   used to be unconditional may never come back.
 *
 * The error and populated paths are asserted too, so this file cannot pass by
 * simply never rendering the sentence at all.
 */

// ── Fixtures ────────────────────────────────────────────────────────────────

const EMPTY_SENTENCE = "No orders for this supplier yet.";
const LOADING_COPY = "Checking this supplier's orders…";
const ERROR_HEADLINE = "We couldn't load this supplier's orders";

/** The exact string this whole packet exists to delete. It must never render. */
const SHIPPED_DEFECT = "No deliveries yet for this supplier.";

type QueryResult = {
  data: unknown;
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  refetch: () => void;
};

const refetch = vi.fn();

const ORDER_ROWS = [
  {
    id: "ord-1",
    poNumber: "PO-2026-008412",
    supplierName: "Acme Components",
    orderDate: "2026-08-01",
    status: "delivered",
    lineCount: 4,
    unresolvedCount: 0,
    totalValue: 71240,
    currency: "EUR",
    createdAt: "2026-08-01T09:00:00Z",
  },
  {
    id: "ord-2",
    poNumber: "SH-PO-44120",
    supplierName: "Acme Components",
    orderDate: "2026-08-02",
    status: "delivery_failed",
    lineCount: 2,
    unresolvedCount: 0,
    totalValue: 9418,
    currency: "EUR",
    createdAt: "2026-08-02T09:00:00Z",
  },
];

/** The four query states the empty sentence has to be told apart from. */
const STATE_NAMES = ["loading", "error", "empty", "populated"] as const;
type StateName = (typeof STATE_NAMES)[number];

const FIXTURES = {
  loading: { data: undefined, isLoading: true, isError: false, isFetching: true, refetch },
  error: { data: undefined, isLoading: false, isError: true, isFetching: false, refetch },
  empty: {
    data: { items: [], totalCount: 0, page: 1, pageSize: 6 },
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch,
  },
  populated: {
    data: { items: ORDER_ROWS, totalCount: 412, page: 1, pageSize: 6 },
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch,
  },
  /** Same query state, different population: both rows are practice orders. */
  populatedAllPractice: {
    data: { items: ORDER_ROWS, totalCount: 2, sampleCount: 2, page: 1, pageSize: 6 },
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch,
  },
} satisfies Record<string, QueryResult>;

type FixtureKey = keyof typeof FIXTURES;

/** Which of the four query states each fixture puts the panel in. */
const QUERY_STATE_OF: Record<FixtureKey, StateName> = {
  loading: "loading",
  error: "error",
  empty: "empty",
  populated: "populated",
  populatedAllPractice: "populated",
};

/** Every query state a test actually put on screen. Read by the anti-vacuity floor. */
const EXERCISED = new Set<StateName>();

let recentOrders: QueryResult = FIXTURES.empty;

// ── Module mocks ────────────────────────────────────────────────────────────

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("@/lib/tab-param-sync", () => ({ useTabParamSync: () => {} }));

// Branch useQuery on its queryKey so the recent-orders read is the only one
// under test; every other read degrades to a benign resolved-empty result.
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
    const key = Array.isArray(queryKey) ? queryKey[0] : queryKey;
    if (key === "suppliers") {
      return { data: [{ id: "sup-1", name: "Acme Components" }], isLoading: false, error: null };
    }
    if (key === "connections") {
      return { data: [], isLoading: false, error: null };
    }
    if (key === "supplier-recent-orders") {
      return recentOrders;
    }
    return { data: undefined, isLoading: false, isError: false, isFetching: false, error: null, refetch: vi.fn() };
  },
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

// Hoisted: vi.mock factories run before module-scope consts are initialised.
const { getOrders } = vi.hoisted(() => ({ getOrders: vi.fn() }));

vi.mock("@/lib/api-client", () => ({
  apiClient: { getSuppliers: vi.fn(), deleteSupplier: vi.fn(), getOrders },
  isApiMockMode: false,
  getAcceptanceProfile: vi.fn(),
  saveAcceptanceProfile: vi.fn(),
  activateAcceptanceVersion: vi.fn(),
  applyPoMappingTemplate: vi.fn(),
  getSupplierCatalog: vi.fn(),
  importSupplierCatalog: vi.fn(),
  clearSupplierCatalog: vi.fn(),
  getSupplierRuleBindings: vi.fn(),
  listConnections: vi.fn(),
}));

vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => true }));
vi.mock("@/hooks/useOrderDirection", () => ({
  useOrderDirection: () => ({
    labels: { counterpartyNoun: "Supplier", counterpartyPlural: "Suppliers" },
  }),
}));
vi.mock("@/hooks/useOnboardingStatus", () => ({ invalidateOnboardingStatus: vi.fn() }));

// Neighbouring overview cards are out of scope; stub so this file isolates the
// recent-orders panel.
vi.mock("./SupplierIdentityCard", () => ({
  SupplierIdentityCard: () => <div data-testid="supplier-identity-card" />,
}));
vi.mock("@/components/connections/SupplierHistoryTab", () => ({
  SupplierHistoryTab: () => <div data-testid="supplier-history-tab" />,
}));

import { SupplierDockProfile } from "./SupplierDockProfile";
// Status wording is derived from the canonical map, never re-typed here: a
// hard-coded label would keep passing after the vocabulary moved underneath it.
import { statusLabel } from "./UnifiedStatusBadge";
// Same reason: the practice-order wording is owned by orderCountContract.
import { practiceOrderNote } from "./orderCountContract";

// ── Helpers ─────────────────────────────────────────────────────────────────

function renderState(fixture: FixtureKey) {
  recentOrders = FIXTURES[fixture];
  EXERCISED.add(QUERY_STATE_OF[fixture]);
  render(<SupplierDockProfile id="sup-1" />);
}

/**
 * ANTI-VACUITY FLOOR (per test).
 *
 * Every "the sentence is absent" assertion below is worthless if the sentence
 * cannot render at all — deleting the <p> outright would turn this whole file
 * green. So each negative test first proves, in the same process and against
 * the same component, that the empty fixture DOES produce the sentence, and
 * only then asserts its absence for the state under test.
 *
 * This throws before any negative assertion runs.
 */
function floorSentenceIsRenderable() {
  renderState("empty");
  expect(screen.getByText(EMPTY_SENTENCE)).toBeInTheDocument();
  cleanup();
}

beforeEach(() => {
  refetch.mockClear();
  getOrders.mockClear();
  recentOrders = FIXTURES.empty;
});
afterEach(cleanup);

// ── Tests ───────────────────────────────────────────────────────────────────

describe("SupplierDockProfile — recent orders panel", () => {
  it("renders the empty sentence when a completed query really returned nothing", () => {
    renderState("empty");
    expect(screen.getByText(EMPTY_SENTENCE)).toBeInTheDocument();
    // Not the loading or error surface.
    expect(screen.queryByText(LOADING_COPY)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does not claim emptiness while the query is still loading", () => {
    floorSentenceIsRenderable();

    renderState("loading");
    // The contract assertion comes FIRST on purpose. Asserting the loading copy
    // first would make that the assertion a regression trips on, and "the
    // loading copy vanished" is a weaker report than "the panel claimed
    // emptiness it had not established".
    expect(screen.queryByText(EMPTY_SENTENCE)).toBeNull();
    expect(screen.getByText(LOADING_COPY)).toBeInTheDocument();
  });

  it("does not render an error as emptiness", () => {
    floorSentenceIsRenderable();

    renderState("error");
    expect(screen.queryByText(EMPTY_SENTENCE)).toBeNull();
    const alert = screen.getByRole("alert");
    expect(screen.getByText(ERROR_HEADLINE)).toBeInTheDocument();
    // The error copy says out loud that this is not "none".
    expect(alert.textContent).toMatch(/not the same as/i);
  });

  it("offers a retry on the error path and wires it to refetch", () => {
    renderState("error");
    const retry = screen.getByRole("button", { name: /try again/i });
    fireEvent.click(retry);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("lists the returned orders, with their real status, instead of the sentence", () => {
    floorSentenceIsRenderable();

    renderState("populated");
    expect(screen.queryByText(EMPTY_SENTENCE)).toBeNull();
    expect(screen.getByText("PO-2026-008412")).toBeInTheDocument();
    expect(screen.getByText("SH-PO-44120")).toBeInTheDocument();
    // Each row carries its own real status: the delivered order and the failed
    // one are distinguishable, so "has anything gone out" and "has anything
    // failed" are both answerable from this panel.
    const deliveredLabel = statusLabel("delivered");
    const failedLabel = statusLabel("delivery_failed");
    expect(deliveredLabel).not.toBe(failedLabel);
    expect(screen.getByText(deliveredLabel)).toBeInTheDocument();
    expect(screen.getByText(failedLabel)).toBeInTheDocument();
  });

  it("reports the real total returned by the query, not the page size", () => {
    renderState("populated");
    expect(screen.getByText("412 total")).toBeInTheDocument();
  });

  it("prints the metered population and states the practice split beside the rows", () => {
    // Both rows are practice orders: the metered count is 0, so no count is
    // printed next to two visible rows, and the note says why.
    renderState("populatedAllPractice");
    expect(screen.getByText("PO-2026-008412")).toBeInTheDocument();
    expect(screen.queryByText(/\btotal\b/)).toBeNull();
    expect(
      screen.getByText(practiceOrderNote(2) as string),
    ).toBeInTheDocument();
  });

  it("never renders a count while loading or on error", () => {
    renderState("loading");
    expect(screen.queryByText(/\btotal\b/)).toBeNull();
    cleanup();

    renderState("error");
    expect(screen.queryByText(/\btotal\b/)).toBeNull();
  });

  it("never renders the sentence that shipped unconditionally, in any state", () => {
    floorSentenceIsRenderable();

    for (const state of STATE_NAMES) {
      renderState(state);
      expect(screen.queryByText(SHIPPED_DEFECT)).toBeNull();
      cleanup();
    }
  });

  it("anti-vacuity floor: all four query states were actually put on screen", () => {
    // Runs last: by now every test above has rendered. If a negative assertion
    // above passed because its state was never exercised, this fails.
    expect(EXERCISED.size).toBeGreaterThan(0);
    expect(EXERCISED.size).toBe(4);
    expect([...EXERCISED].sort()).toEqual([...STATE_NAMES].sort());
  });
});
