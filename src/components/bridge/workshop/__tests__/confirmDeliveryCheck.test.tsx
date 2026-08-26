// WIRING test for the confirm dialog's delivery check — the presentational half
// lives in ConfirmDialog.delivery.test.tsx; this mounts OrderWorkshop with a
// real QueryClient and asserts the dialog receives what getDeliveryConfig
// actually answered. The lesson is readyBarClaim's: a prop with no producer
// ships silently, so the producer is what this file pins.
//
//   • `null` (the API's 204, "nothing saved") → the amber will-fail warning,
//     linking THIS supplier's delivery tab — the first pre-send mention of
//     delivery a new user ever gets.
//   • a saved config → the destination named in plain terms.
//   • a FAILED read → the noncommittal line. Never the warning: this query is
//     informational, the server owns refusal, and a failed config read must
//     never lock (or bad-mouth) a working send.
//
// Harness mirrors readyBarClaim.test.tsx.

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { Order } from "@/types/procurement";
import type { AcceptanceGateDecision, DeliveryConfig } from "@/lib/api/types";

const mockState: { order: Order | null } = { order: null };

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => true, useTenantQueriesEnabled: () => true }));

vi.mock("@/hooks/useOrderDirection", () => ({
  useOrderDirection: () => ({
    labels: {
      counterpartyNoun: "Supplier",
      primaryCta: "Send to supplier",
      primaryCtaProgress: "Sending…",
      doneLabel: "Sent",
      deliveredLabel: "Delivered to supplier",
    },
  }),
}));

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    getAiCalibration: vi.fn().mockResolvedValue({ isActive: false, buckets: [] }),
    getOrderAudit: vi.fn().mockResolvedValue([]),
    getOnboardingStatus: vi.fn().mockResolvedValue({ hasSupplier: true, hasUpload: true, hasDelivery: false }),
  },
  getMappingOverride: vi.fn().mockResolvedValue(null),
  previewMappingOverride: vi.fn().mockResolvedValue({ content: "", error: null }),
  validateOrder: vi.fn().mockResolvedValue({ orderId: "ord-1", passed: true, results: [] }),
}));

vi.mock("@/lib/api/acceptance-gate", () => ({
  getAcceptanceGate: vi.fn(() =>
    Promise.resolve({
      blocked: false,
      reason: null,
      overridden: false,
      overriddenBy: null,
      overrideReason: null,
      blockers: [],
    } satisfies AcceptanceGateDecision),
  ),
}));

// The producer under test.
const getDeliveryConfigMock = vi.fn<(supplierId: string) => Promise<DeliveryConfig | null>>();
vi.mock("@/lib/api/delivery", () => ({
  getDeliveryConfig: (supplierId: string) => getDeliveryConfigMock(supplierId),
}));

vi.mock("../../review/CatalogHintCard", () => ({
  CatalogHintCard: () => <div data-testid="catalog-hint-stub" />,
}));

vi.mock("../../review/hooks/useOrderReview", () => ({
  useOrderReview: () => ({
    order: mockState.order,
    isLoading: false,
    isError: false,
    refetchOrder: vi.fn().mockResolvedValue(undefined),
    exceptionCount: 0,
    isStuck: false,
  }),
}));

// showConfirm: true — the operator has pressed Send and the dialog is open.
vi.mock("../../review/hooks/useSendFlow", () => ({
  useSendFlow: () => ({
    flowNotice: null,
    flowSeverity: "info",
    setFlow: vi.fn(),
    sendState: "idle",
    crossed: false,
    confirmSend: vi.fn(),
    showConfirm: true,
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

vi.mock("../../mapper/MapperWorkbench", () => ({
  MapperWorkbench: (props: Record<string, unknown>) => (
    <div data-testid="mock-mapper-workbench">
      <div data-testid="issues-slot">{props.issuesSlot as ReactNode}</div>
    </div>
  ),
}));
vi.mock("../MobileTriage", () => ({ MobileTriage: () => <div data-testid="mock-mobile-triage" /> }));

import { OrderWorkshop } from "../OrderWorkshop";

function order(): Order {
  return {
    id: "ord-1",
    poNumber: "PO-1",
    supplierId: "sup-1",
    supplierName: "Acme",
    buyerName: "Buyer Co",
    orderDate: "2026-06-18",
    currency: "EUR",
    status: "pending_review",
    createdAt: "2026-06-18T00:00:00Z",
    updatedAt: "2026-06-18T00:00:00Z",
    lines: [
      {
        id: "l-1",
        lineNumber: 1,
        description: "Widget",
        quantity: 2,
        unitPrice: 10,
        supplierItemCode: "ACM-1",
        buyerItemCode: "B-1",
        needsReview: false,
      },
    ] as Order["lines"],
    artifacts: [],
  };
}

function renderWorkshop() {
  mockState.order = order();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <OrderWorkshop orderId="ord-1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  getDeliveryConfigMock.mockReset();
});
afterEach(cleanup);

describe("the open confirm dialog reflects the supplier's real delivery config", () => {
  test("no config saved → the will-fail warning, before the server ever refuses", async () => {
    getDeliveryConfigMock.mockResolvedValue(null);
    renderWorkshop();

    await screen.findByText(/no delivery is set up for/i);
    expect(document.querySelector('a[href="/library/suppliers/sup-1?tab=delivery"]')).not.toBeNull();
    expect(getDeliveryConfigMock).toHaveBeenCalledWith("sup-1");
  });

  test("a saved email config → the destination, named in the dialog", async () => {
    getDeliveryConfigMock.mockResolvedValue({
      supplierId: "sup-1",
      protocol: "email",
      autoDeliver: false,
      configJson: JSON.stringify({ toAddresses: ["orders@acme.example"] }),
      outputFormat: "csv",
      hasCredentials: false,
      createdAt: "2026-08-01T00:00:00Z",
      updatedAt: "2026-08-01T00:00:00Z",
    });
    renderWorkshop();

    await screen.findByText(/sends by email to orders@acme\.example/i);
    expect(document.body.textContent).not.toMatch(/no delivery is set up/i);
  });

  test("a FAILED read → noncommittal, and never the warning", async () => {
    getDeliveryConfigMock.mockRejectedValue(new Error("API error 500: boom"));
    renderWorkshop();

    await screen.findByText(/couldn.t check whether delivery is set up/i);
    expect(document.body.textContent).not.toMatch(/no delivery is set up/i);
    expect(document.body.textContent).not.toMatch(/sends by email/i);
  });
});
