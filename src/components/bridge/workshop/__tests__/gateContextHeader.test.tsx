import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { Order, OrderValidationResult } from "@/types/procurement";

// ─────────────────────────────────────────────────────────────────────────────
// Gate context header (polish follow-up to the #24 chrome compression).
// BridgeTopbar suppresses its breadcrumb row on /inbox/[orderId] ROUTE-WIDE;
// the compensating "← Inbox + PO number" header existed only in the healthy
// workshop return. These tests pin that EVERY early-return gate state now
// renders the shared WorkshopGateShell header: ← Inbox chip + PO title (the
// page's one h1) + the status badge where a status is known.
//
// The heavy panels are mocked to stubs — the assertion here is the WRAPPING
// (the workshop composes header + panel), not the panels' own content.
// ─────────────────────────────────────────────────────────────────────────────

const mockState: {
  order: Order | null | undefined;
  isLoading: boolean;
  isError: boolean;
  exceptionCount: number;
  routerPush: ReturnType<typeof vi.fn>;
} = {
  order: undefined,
  isLoading: false,
  isError: false,
  exceptionCount: 0,
  routerPush: vi.fn(),
};

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockState.routerPush, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: undefined }),
}));

vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => true }));

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
  },
  getMappingOverride: vi.fn().mockResolvedValue(null),
  previewMappingOverride: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../review/hooks/useOrderReview", () => ({
  useOrderReview: () => ({
    order: mockState.order,
    isLoading: mockState.isLoading,
    isError: mockState.isError,
    refetchOrder: vi.fn().mockResolvedValue(undefined),
    exceptionCount: mockState.exceptionCount,
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

vi.mock("../../mapper/MapperWorkbench", () => ({
  MapperWorkbench: () => <div data-testid="mock-mapper-workbench" />,
}));

// The gate panels themselves — stubbed; their own content has its own tests.
vi.mock("../../FailedPanels", () => ({
  ParseFailedPanel: () => <div data-testid="panel-parse-failed" />,
  FailedPanel: ({ stage }: { stage: string }) => <div data-testid={`panel-${stage}-failed`} />,
}));
vi.mock("../BillingHeldPanel", () => ({
  BillingHeldPanel: () => <div data-testid="panel-billing-held" />,
}));
vi.mock("../DeliveryUnconfirmedPanel", () => ({
  DeliveryUnconfirmedPanel: () => <div data-testid="panel-delivery-unconfirmed" />,
}));

import { OrderWorkshop } from "../OrderWorkshop";

function makeOrder(over: Partial<Order> = {}): Order {
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
    lines: [],
    artifacts: [],
    ...over,
  };
}

beforeEach(() => {
  mockState.order = undefined;
  mockState.isLoading = false;
  mockState.isError = false;
  mockState.exceptionCount = 0;
  mockState.routerPush = vi.fn();
});
afterEach(cleanup);

/** The shared context-header contract: back chip + PO title as the ONE h1. */
function expectGateHeader(poTitle: string) {
  expect(screen.getByTestId("workshop-gate-shell")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Back to inbox" })).toBeTruthy();
  const headings = screen.getAllByRole("heading", { level: 1 });
  expect(headings).toHaveLength(1);
  expect(headings[0]).toHaveTextContent(poTitle);
}

describe("every workshop gate state renders the shared context header", () => {
  test("parse-failed (status=failed): header + badge + panel", () => {
    mockState.order = makeOrder({ status: "failed" });
    render(<OrderWorkshop orderId="ord-1" />);
    expectGateHeader("PO-1");
    expect(screen.getByText("Failed")).toBeTruthy();
    expect(screen.getByTestId("panel-parse-failed")).toBeTruthy();
  });

  test("transform_failed: header + badge + panel", () => {
    mockState.order = makeOrder({ status: "transform_failed" });
    render(<OrderWorkshop orderId="ord-1" />);
    expectGateHeader("PO-1");
    expect(screen.getByText("Transform failed")).toBeTruthy();
    expect(screen.getByTestId("panel-transform-failed")).toBeTruthy();
  });

  test("delivery_failed: header + badge + panel", () => {
    mockState.order = makeOrder({ status: "delivery_failed" });
    render(<OrderWorkshop orderId="ord-1" />);
    expectGateHeader("PO-1");
    expect(screen.getByText("Delivery failed")).toBeTruthy();
    expect(screen.getByTestId("panel-delivery-failed")).toBeTruthy();
  });

  test("delivery_held: header + badge + panel, and the chip navigates to /inbox", () => {
    mockState.order = makeOrder({ status: "delivery_held" });
    render(<OrderWorkshop orderId="ord-1" />);
    expectGateHeader("PO-1");
    expect(screen.getByText("Delivery paused")).toBeTruthy();
    expect(screen.getByTestId("panel-billing-held")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to inbox" }));
    expect(mockState.routerPush).toHaveBeenCalledWith("/inbox");
  });

  test("delivery_unconfirmed: header + badge + panel", () => {
    mockState.order = makeOrder({ status: "delivery_unconfirmed" });
    render(<OrderWorkshop orderId="ord-1" />);
    expectGateHeader("PO-1");
    expect(screen.getByText("Delivery unknown")).toBeTruthy();
    expect(screen.getByTestId("panel-delivery-unconfirmed")).toBeTruthy();
  });

  test("parsing: header + badge; the PO number appears ONCE (the old in-panel duplicate is gone)", () => {
    mockState.order = makeOrder({ status: "parsing" });
    render(<OrderWorkshop orderId="ord-1" />);
    expectGateHeader("PO-1");
    expect(screen.getByText("Extracting")).toBeTruthy();
    expect(screen.getByTestId("order-parsing")).toBeTruthy();
    expect(screen.getAllByText("PO-1")).toHaveLength(1);
  });

  test("loading (no order yet): header with the neutral 'Order' title, no badge", () => {
    mockState.order = undefined;
    mockState.isLoading = true;
    render(<OrderWorkshop orderId="ord-1" />);
    expectGateHeader("Order");
  });

  test("not-found (order=null): header + the existing recovery panel", () => {
    mockState.order = null;
    render(<OrderWorkshop orderId="ord-1" />);
    expectGateHeader("Order");
    expect(screen.getByText("Order not found")).toBeTruthy();
  });
});
