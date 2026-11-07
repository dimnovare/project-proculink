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
import { deliveryModeLabel } from "@/lib/deliveryMode";

// The header pill used to be a fixed demo value; it must follow the saved autoDeliver setting.
const config = (autoDeliver: boolean, protocol = "http"): DeliveryConfig => ({
  supplierId: "sup-1", protocol, autoDeliver, configJson: "{}", outputFormat: "cxml",
  hasCredentials: false, credentialsDisplay: null, createdAt: "", updatedAt: "", cxmlCredentials: null,
} as DeliveryConfig);

const pills = () => Array.from(document.querySelectorAll(".pill")).map((p) => p.textContent);

beforeEach(() => { QUERIES = {}; OBSERVED_KEYS.clear(); });
afterEach(cleanup);

describe("SupplierDockProfile — the delivery-mode pill", () => {
  it.each([true, false])("reads the saved autoDeliver value (%s)", (autoDeliver) => {
    QUERIES = { "supplier-delivery-config": resolved(config(autoDeliver)) };
    render(<SupplierDockProfile id="sup-1" />);
    expect(pills()).toContain(deliveryModeLabel(autoDeliver));
    expect(pills()).not.toContain(deliveryModeLabel(!autoDeliver));
  });

  it("shows no pill when nothing is configured or delivery is manual", () => {
    for (const data of [null, config(true, "manual")]) {
      QUERIES = { "supplier-delivery-config": resolved(data) };
      render(<SupplierDockProfile id="sup-1" />);
      expect(pills()).not.toContain(deliveryModeLabel(true));
      expect(pills()).not.toContain(deliveryModeLabel(false));
      cleanup();
    }
  });
});
