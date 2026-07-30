import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// STRUCT-1 — the supplier page gained a "History" tab that hosts the versioned
// connection view (relocated from /connections). These tests cover the
// SupplierDockProfile branch only:
//   - ?tab=history deep-link selects the tab (via the existing isTab guard),
//   - connectionId present → the relocated SupplierHistoryTab mounts,
//   - connectionId null → an honest empty state instead.
// The tab's INTERNAL behavior is covered by SupplierHistoryTab.test.tsx.

// Drive the initial tab from the URL (?tab=history). useTabParamSync is a no-op
// here — we only need the initial selection.
const searchParams = new URLSearchParams("tab=history");
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => searchParams,
}));
vi.mock("@/lib/tab-param-sync", () => ({ useTabParamSync: () => {} }));

// Branch useQuery on its queryKey so the suppliers + connections reads return
// deterministic data; everything else degrades to undefined.
const connectionsData: Array<{ id: string; supplierId: string }> = [];
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
    const key = Array.isArray(queryKey) ? queryKey[0] : queryKey;
    if (key === "suppliers") {
      return { data: [{ id: "sup-1", name: "Acme Components" }], isLoading: false, error: null };
    }
    if (key === "connections") {
      return { data: connectionsData, isLoading: false, error: null };
    }
    return { data: undefined, isLoading: false, error: null };
  },
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@/lib/api-client", () => ({
  apiClient: { getSuppliers: vi.fn(), deleteSupplier: vi.fn() },
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
  useOrderDirection: () => ({ labels: { counterpartyNoun: "Supplier", counterpartyPlural: "Suppliers" } }),
}));
vi.mock("@/hooks/useOnboardingStatus", () => ({ invalidateOnboardingStatus: vi.fn() }));

// Stub the relocated tab so this test isolates the SupplierDockProfile branch.
vi.mock("@/components/connections/SupplierHistoryTab", () => ({
  SupplierHistoryTab: ({ connectionId }: { connectionId: string }) => (
    <div data-testid="supplier-history-tab" data-connection-id={connectionId} />
  ),
}));

import { SupplierDockProfile } from "./SupplierDockProfile";

beforeEach(() => {
  connectionsData.length = 0;
});
afterEach(cleanup);

describe("SupplierDockProfile — History tab (STRUCT-1)", () => {
  it("mounts SupplierHistoryTab for the resolved connection when ?tab=history", () => {
    connectionsData.push({ id: "conn-1", supplierId: "sup-1" });
    render(<SupplierDockProfile id="sup-1" />);
    const tab = screen.getByTestId("supplier-history-tab");
    expect(tab).toBeInTheDocument();
    expect(tab).toHaveAttribute("data-connection-id", "conn-1");
  });

  it("shows an honest empty state when the supplier has no connection yet", () => {
    // connectionsData empty → connectionId resolves null.
    render(<SupplierDockProfile id="sup-1" />);
    expect(screen.queryByTestId("supplier-history-tab")).toBeNull();
    expect(screen.getByText("No versions yet")).toBeInTheDocument();
  });

  it("registers the setup-changes tab in the tab strip (labelled Changes)", () => {
    render(<SupplierDockProfile id="sup-1" />);
    expect(screen.getByRole("button", { name: "Changes" })).toBeInTheDocument();
  });
});
