// The "first time setting up delivery?" offer, and the two states it must not appear in.
//
// It rendered unconditionally on the Delivery tab. A supplier with a working, tested delivery
// setup was asked on every visit whether this was their first time — and the wizard behind the
// offer builds a config from scratch rather than carrying the saved values through, so taking it
// up on a configured supplier is how a working setup gets replaced by a blank one.
//
// The fix reads the delivery-config query the Overview summary already runs. That makes the
// offer's condition a fetched fact, which brings the usual obligation with it: the offer may
// appear only for a definite "nothing is configured". Loading is not "nothing configured", and a
// failed request is certainly not — those are the states where the old bug and its opposite both
// live, so both are pinned below.

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { DeliveryConfig } from "@/lib/api/types";

type QueryResult = {
  data: unknown;
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  error: unknown;
  refetch: () => void;
};

const refetch = vi.fn();
const loading = (): QueryResult => ({ data: undefined, isLoading: true, isError: false, isFetching: true, error: null, refetch });
const errored = (): QueryResult => ({ data: undefined, isLoading: false, isError: true, isFetching: false, error: new Error("boom"), refetch });
const resolved = (data: unknown): QueryResult => ({ data, isLoading: false, isError: false, isFetching: false, error: null, refetch });

let QUERIES: Record<string, QueryResult> = {};
const OBSERVED_KEYS = new Set<string>();

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
    const key = String(Array.isArray(queryKey) ? queryKey[0] : queryKey);
    OBSERVED_KEYS.add(key);
    if (key === "suppliers") return resolved([{ id: "sup-1", name: "Nordmark Handel GmbH" }]);
    return QUERIES[key] ?? resolved(undefined);
  },
  useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn(), setQueryData: vi.fn() }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams("tab=delivery"),
}));
vi.mock("@/lib/tab-param-sync", () => ({ useTabParamSync: () => {} }));

vi.mock("@/lib/api-client", () => ({
  apiClient: { getSuppliers: vi.fn(), deleteSupplier: vi.fn(), getOrders: vi.fn() },
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

vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => true, useTenantQueriesEnabled: () => true }));
vi.mock("@/hooks/useOrderDirection", () => ({
  useOrderDirection: () => ({
    labels: { counterpartyNoun: "Supplier", counterpartyPlural: "Suppliers" },
  }),
}));
vi.mock("@/hooks/useOnboardingStatus", () => ({ invalidateOnboardingStatus: vi.fn() }));

vi.mock("./PoMappingEditor", () => ({ PoMappingEditor: () => <div data-testid="po-mapping-editor" /> }));
vi.mock("./DeliveryConfigEditor", () => ({ DeliveryConfigEditor: () => <div data-testid="delivery-config-editor" /> }));
vi.mock("./DeliveryGuidedSetup", () => ({ DeliveryGuidedSetup: () => <div data-testid="delivery-guided-setup" /> }));
vi.mock("./CatalogSourceEditor", () => ({ CatalogSourceEditor: () => <div data-testid="catalog-source-editor" /> }));
vi.mock("./SupplierIdentityCard", () => ({ SupplierIdentityCard: () => <div data-testid="supplier-identity-card" /> }));
vi.mock("@/components/connections/SupplierHistoryTab", () => ({
  SupplierHistoryTab: () => <div data-testid="supplier-history-tab" />,
}));

import { SupplierDockProfile } from "./SupplierDockProfile";

const CONFIGURED: DeliveryConfig = {
  supplierId: "sup-1",
  protocol: "http",
  autoDeliver: true,
  configJson: JSON.stringify({ url: "https://supplier.example/orders", method: "POST", timeoutSeconds: 30 }),
  outputFormat: "cxml",
  hasCredentials: true,
  credentialsDisplay: "********",
  createdAt: "2026-08-01T00:00:00Z",
  updatedAt: "2026-08-01T00:00:00Z",
  cxmlCredentials: null,
};

/** The states this offer has to be told apart from. Read by the floor at the bottom. */
const EXERCISED = new Set<string>();

function renderDeliveryTab(deliveryConfig: QueryResult, state: string) {
  QUERIES = { "supplier-delivery-config": deliveryConfig };
  EXERCISED.add(state);
  render(<SupplierDockProfile id="sup-1" />);
}

const offerShown = () => screen.queryByTestId("delivery-guided-setup") !== null;

beforeEach(() => {
  refetch.mockClear();
  QUERIES = {};
  OBSERVED_KEYS.clear();
});

afterEach(cleanup);

describe("SupplierDockProfile — the guided delivery setup offer", () => {
  it("is offered when the query proves nothing is configured", () => {
    // `null` is the API's real answer for "no delivery config" (it returns 204).
    renderDeliveryTab(resolved(null), "empty");
    expect(offerShown()).toBe(true);
    expect(screen.getByText(/Setting up delivery for this supplier\?/i)).toBeInTheDocument();
  });

  it("is NOT offered to a supplier that already has delivery configured", () => {
    // The defect verbatim: this supplier delivers over HTTP with stored credentials and was
    // still asked whether this was their first time.
    renderDeliveryTab(resolved(CONFIGURED), "populated");
    expect(offerShown()).toBe(false);
  });

  it("is NOT offered while the answer is still loading", () => {
    renderDeliveryTab(loading(), "loading");
    expect(offerShown()).toBe(false);
  });

  it("is NOT offered when the delivery config could not be read", () => {
    // "We could not look" must not render as "you have not set this up yet".
    renderDeliveryTab(errored(), "error");
    expect(offerShown()).toBe(false);
  });

  it("leaves the full editor in place in every one of those states", () => {
    // Anti-vacuity: the offer disappearing must not be the tab disappearing. The editor is the
    // way delivery is actually configured, and it is unconditional.
    for (const state of [resolved(null), resolved(CONFIGURED), loading(), errored()]) {
      QUERIES = { "supplier-delivery-config": state };
      render(<SupplierDockProfile id="sup-1" />);
      expect(screen.queryByTestId("delivery-config-editor")).not.toBeNull();
      cleanup();
    }
  });

  it("asked the delivery-config query at all", () => {
    // The floor that stops this suite passing because the offer was deleted outright or the
    // condition was hard-coded: the decision has to come from a real request.
    renderDeliveryTab(resolved(null), "empty");
    expect(OBSERVED_KEYS.has("supplier-delivery-config")).toBe(true);
    expect(EXERCISED).toEqual(new Set(["empty", "populated", "loading", "error"]));
  });
});
