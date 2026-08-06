import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// The "Item codes" tab renders one confidence chip per saved SKU mapping, and
// `SupplierMapping.confidence` is optional on the DTO. It used to default a
// missing score to 100 — which turned "we never scored this row" into a green
// chip reading "100%", in the one table an operator opens specifically to judge
// mapping quality. Absence of evidence must never render as maximum evidence.
//
// These tests pin both directions:
//   - no confidence  → no percentage, no green chip, an explicit "Not scored",
//   - real confidence → its true value and its true tier (including a genuine
//     100%, so the fix doesn't quietly suppress a real perfect score).

const searchParams = new URLSearchParams("tab=mappings");
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => searchParams,
}));
vi.mock("@/lib/tab-param-sync", () => ({ useTabParamSync: () => {} }));

// Branch useQuery on its queryKey so the supplier read and the mappings read
// both return deterministic data; everything else degrades to undefined.
type TestMapping = {
  id: string;
  buyerItemCode: string;
  supplierItemCode: string;
  confidence?: number;
  source?: string;
};
let mappingsData: TestMapping[] = [];

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
    const key = Array.isArray(queryKey) ? queryKey[0] : queryKey;
    if (key === "suppliers") {
      return { data: [{ id: "sup-1", name: "Acme Components" }], isLoading: false, isError: false, error: null, refetch: vi.fn() };
    }
    if (key === "supplier-mappings") {
      return { data: mappingsData, isLoading: false, isError: false, error: null, refetch: vi.fn() };
    }
    return { data: undefined, isLoading: false, isError: false, error: null, refetch: vi.fn() };
  },
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@/lib/api-client", () => ({
  apiClient: { getSuppliers: vi.fn(), deleteSupplier: vi.fn(), getSupplierMappings: vi.fn() },
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

import { SupplierDockProfile } from "./SupplierDockProfile";

// The tab renders a desktop table AND a mobile card list; in jsdom both are in
// the DOM (they're separated by CSS only), so every row appears twice.
const confidenceChips = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("span.conf"));

beforeEach(() => {
  mappingsData = [];
});
afterEach(cleanup);

describe("SupplierDockProfile — SKU mapping confidence", () => {
  it("renders no percentage and no green chip for a mapping with no confidence", () => {
    mappingsData = [
      { id: "map-1", buyerItemCode: "HX-4412", supplierItemCode: "ACM-FL-08", source: "manual" },
    ];

    const { container } = render(<SupplierDockProfile id="sup-1" />);

    // The row is present…
    expect(screen.getAllByText("HX-4412").length).toBeGreaterThan(0);
    // …but nothing claims a score for it.
    expect(screen.queryByText("100%")).toBeNull();
    expect(container.querySelector(".conf-hi")).toBeNull();
    expect(confidenceChips(container)).toHaveLength(0);
  });

  it("labels an unscored mapping explicitly rather than leaving the cell blank", () => {
    mappingsData = [
      { id: "map-1", buyerItemCode: "HX-4412", supplierItemCode: "ACM-FL-08", source: "manual" },
    ];

    render(<SupplierDockProfile id="sup-1" />);

    expect(screen.getAllByText("Not scored").length).toBeGreaterThan(0);
  });

  it("renders a real low confidence at its true value and danger tier", () => {
    mappingsData = [
      { id: "map-1", buyerItemCode: "HX-5500", supplierItemCode: "ACM-BR-55", confidence: 0.62, source: "suggested" },
    ];

    const { container } = render(<SupplierDockProfile id="sup-1" />);

    expect(screen.getAllByText("62%").length).toBeGreaterThan(0);
    expect(container.querySelectorAll(".conf-lo").length).toBeGreaterThan(0);
    expect(container.querySelector(".conf-hi")).toBeNull();
    expect(screen.queryByText("Not scored")).toBeNull();
  });

  it("renders a real mid confidence at its true value and warn tier", () => {
    mappingsData = [
      { id: "map-1", buyerItemCode: "HX-3301", supplierItemCode: "ACM-NT-33", confidence: 0.8, source: "suggested" },
    ];

    const { container } = render(<SupplierDockProfile id="sup-1" />);

    expect(screen.getAllByText("80%").length).toBeGreaterThan(0);
    expect(container.querySelectorAll(".conf-mid").length).toBeGreaterThan(0);
    expect(container.querySelector(".conf-hi")).toBeNull();
  });

  it("still renders a genuine 100% score as a green chip", () => {
    mappingsData = [
      { id: "map-1", buyerItemCode: "HX-9001", supplierItemCode: "ACM-PN-01", confidence: 1, source: "manual" },
    ];

    const { container } = render(<SupplierDockProfile id="sup-1" />);

    expect(screen.getAllByText("100%").length).toBeGreaterThan(0);
    expect(container.querySelectorAll(".conf-hi").length).toBeGreaterThan(0);
    expect(screen.queryByText("Not scored")).toBeNull();
  });

  it("keeps scored and unscored rows distinguishable in the same table", () => {
    mappingsData = [
      { id: "map-1", buyerItemCode: "HX-4412", supplierItemCode: "ACM-FL-08", source: "manual" },
      { id: "map-2", buyerItemCode: "HX-5500", supplierItemCode: "ACM-BR-55", confidence: 0.62, source: "suggested" },
    ];

    const { container } = render(<SupplierDockProfile id="sup-1" />);

    expect(screen.getAllByText("Not scored").length).toBeGreaterThan(0);
    expect(screen.getAllByText("62%").length).toBeGreaterThan(0);
    // Exactly the scored row gets a chip — one per layout (desktop + mobile).
    expect(confidenceChips(container)).toHaveLength(2);
    expect(screen.queryByText("100%")).toBeNull();
  });
});
