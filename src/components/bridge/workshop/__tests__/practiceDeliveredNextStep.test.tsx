// The delivered-practice banner's only forward affordance used to be
// "Upload your own order →" — a route that walks a fresh user PAST delivery
// setup, while the product's own checklist locks "Send your first order" until
// delivery is configured (buildChecklistSteps.ts). The next real step after a
// delivered practice order is delivery setup, so that link now leads.
//
// The href must point at the operator's REAL supplier, not the practice order's
// own supplierId: the sample supplier is excluded from the onboarding status by
// the backend (OnboardingController filters IsSample), and configuring delivery
// on it would satisfy nothing the checklist measures. `firstSupplierId` is the
// same id buildChecklistSteps uses for its own delivery step; when it is absent
// the link falls back to /library/suppliers.
//
// Harness mirrors practiceFraming.test.tsx (same mocks, same slot reasoning).

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { Order, OrderValidationResult } from "@/types/procurement";

const mockState: {
  order: Order | null | undefined;
  firstSupplierId: string | null;
} = {
  order: undefined,
  firstSupplierId: null,
};

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: undefined }),
  useQueryClient: () => ({ invalidateQueries: vi.fn(), setQueryData: vi.fn() }),
}));

vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => true, useTenantQueriesEnabled: () => true }));

vi.mock("@/hooks/useSampleOrder", () => ({
  practiceDeliveryKnown: () => null,
}));

vi.mock("@/hooks/useOnboardingStatus", () => ({
  useOnboardingStatus: () => ({
    data: mockState.firstSupplierId === null
      ? undefined
      : { firstSupplierId: mockState.firstSupplierId },
  }),
}));

let counterpartyNoun = "Supplier";

vi.mock("@/hooks/useOrderDirection", () => ({
  useOrderDirection: () => ({
    labels: {
      counterpartyNoun,
      primaryCta: `Send to ${counterpartyNoun.toLowerCase()}`,
      primaryCtaProgress: "Sending…",
      doneLabel: "Sent",
      deliveredLabel: `Delivered to ${counterpartyNoun.toLowerCase()}`,
    },
  }),
}));

vi.mock("@/lib/api-client", () => ({
  isApiMockMode: false,
  apiClient: {
    getAiCalibration: vi.fn().mockResolvedValue({ isActive: false, buckets: [] }),
    getOrderAudit: vi.fn().mockResolvedValue([]),
    getOrderPassport: vi.fn().mockResolvedValue(null),
    getOrderById: vi.fn(),
    transformOrder: vi.fn(),
    retryDelivery: vi.fn(),
    redeliverOrder: vi.fn(),
    markDelivered: vi.fn(),
  },
  requeueDelivery: vi.fn(),
  getOpsHealth: vi.fn(),
  getMappingOverride: vi.fn().mockResolvedValue(null),
  previewMappingOverride: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../review/hooks/useOrderReview", () => ({
  useOrderReview: () => ({
    order: mockState.order,
    isLoading: false,
    isError: false,
    refetchOrder: vi.fn().mockResolvedValue(undefined),
    exceptionCount: 0,
  }),
}));

vi.mock("../../review/hooks/useSendFlow", () => ({
  useSendFlow: () => ({
    flowNotice: null,
    flowSeverity: "info",
    setFlow: vi.fn(),
    sendState: "idle",
    crossed: false,
    confirmSend: vi.fn(),
    showConfirm: false,
    setShowConfirm: vi.fn(),
  }),
}));

vi.mock("../../review/hooks/useResolveActions", () => ({
  useResolveActions: () => ({
    acceptSuggestion: vi.fn(),
    commitVersion: 0,
    lineEditId: null,
    lineDraft: "",
    setLineDraft: vi.fn(),
    startLineEdit: vi.fn(),
    commitLineCode: vi.fn(),
    cancelLineEdit: vi.fn(),
    confirmFlaggedLine: vi.fn(),
    acceptingLineId: null,
    bulkAcceptSuggestions: vi.fn(),
    bulkAccepting: false,
  }),
}));

vi.mock("../../review/hooks/useAcceptanceValidation", () => ({
  useAcceptanceValidation: () => ({
    validationResult: { passed: true, results: [] } as OrderValidationResult,
    failingRuleCount: 0,
    isStale: false,
  }),
}));

// Must render issuesSlot — the practice note travels in it (WP-28); same shape
// as practiceFraming.test.tsx.
vi.mock("../../mapper/MapperWorkbench", () => ({
  MapperWorkbench: (props: { issuesSlot?: React.ReactNode }) => (
    <div data-testid="mock-mapper-workbench">{props.issuesSlot}</div>
  ),
}));
vi.mock("../../problem/OrderProblemPanel", () => ({
  OrderProblemPanel: () => <div data-testid="mock-problem-panel" />,
}));
vi.mock("../MobileTriage", () => ({ MobileTriage: () => <div data-testid="mock-mobile-triage" /> }));

import { OrderWorkshop } from "../OrderWorkshop";

function deliveredSample(): Order {
  return {
    id: "ord-1",
    poNumber: "DEMO-2026-001",
    supplierId: "sup-sample",
    supplierName: "ProcuLink Sample Supplier",
    buyerName: "Buyer Co",
    orderDate: "2026-06-18",
    currency: "EUR",
    status: "delivered",
    createdAt: "2026-06-18T00:00:00Z",
    updatedAt: "2026-06-18T00:00:00Z",
    lines: [],
    artifacts: [],
    isSample: true,
  };
}

const banner = () => screen.queryByRole("note", { name: /practice order/i });

beforeEach(() => {
  mockState.order = undefined;
  mockState.firstSupplierId = null;
  counterpartyNoun = "Supplier";
});
afterEach(cleanup);

describe("delivered practice banner routes to delivery setup, not past it", () => {
  test("the FIRST link is delivery setup for the real supplier, via firstSupplierId", () => {
    mockState.order = deliveredSample();
    mockState.firstSupplierId = "sup-real-7";
    render(<OrderWorkshop orderId="ord-1" />);

    const note = banner();
    expect(note).not.toBeNull();
    const links = Array.from(note!.querySelectorAll("a"));
    expect(links.length).toBeGreaterThanOrEqual(2);
    // Primary = first. The old sole affordance routed past delivery setup.
    expect(links[0].getAttribute("href")).toBe("/library/suppliers/sup-real-7?tab=delivery");
    expect(links[0].textContent).toMatch(/set up delivery/i);
    // NOT the practice order's own (sample) supplier.
    expect(note!.querySelector('a[href*="sup-sample"]')).toBeNull();
  });

  test("upload stays offered, demoted to second", () => {
    mockState.order = deliveredSample();
    mockState.firstSupplierId = "sup-real-7";
    render(<OrderWorkshop orderId="ord-1" />);

    const note = banner();
    expect(note!.querySelector('a[href="/upload"]')).not.toBeNull();
  });

  test("falls back to the supplier list when the onboarding status has not answered", () => {
    // `undefined` data (loading, failed, or an org with no real supplier yet)
    // must not fabricate an id — the honest fallback is the list.
    mockState.order = deliveredSample();
    mockState.firstSupplierId = null;
    render(<OrderWorkshop orderId="ord-1" />);

    const note = banner();
    const links = Array.from(note!.querySelectorAll("a"));
    expect(links[0].getAttribute("href")).toBe("/library/suppliers");
    expect(links[0].textContent).toMatch(/set up delivery/i);
  });

  test("never hardcodes the party noun — an inbound org reads 'customer'", () => {
    counterpartyNoun = "Customer";
    mockState.order = deliveredSample();
    mockState.firstSupplierId = "sup-real-7";
    render(<OrderWorkshop orderId="ord-1" />);

    const note = banner();
    const primary = note!.querySelectorAll("a")[0];
    expect(primary.textContent).toMatch(/customer/i);
    expect(primary.textContent).not.toMatch(/supplier/i);
  });
});
