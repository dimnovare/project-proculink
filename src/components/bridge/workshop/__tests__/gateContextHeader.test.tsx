import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { Order, OrderStatus, OrderValidationResult } from "@/types/procurement";

// ─────────────────────────────────────────────────────────────────────────────
// Gate context header (polish follow-up to the #24 chrome compression).
//
// WP-24 narrowed the gate set to ONE status. `failed` still replaces the page —
// parsing produced no lines, no header and no output, so there is nothing
// underneath to read. The other problem states (transform_failed,
// delivery_failed, delivery_held, delivery_unconfirmed) now render a BANNER over
// the live workshop, because the extracted order and its item codes are the
// evidence the operator needs; hiding them is what left transform_failed with a
// primary CTA pointing at the page it had already replaced. Their header contract
// is therefore the healthy workshop's (back chip + PO title + badge), and the
// cases below assert that instead of the gate shell.
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
  useQueryClient: () => ({ invalidateQueries: vi.fn(), setQueryData: vi.fn() }),
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

// The one problem panel — stubbed; its content has its own tests (problem/__tests__
// and workshop/__tests__/recovery.test.tsx). The assertion here is the WRAPPING.
vi.mock("../../problem/OrderProblemPanel", () => ({
  OrderProblemPanel: ({ order, mode }: { order: { status: string }; mode?: string }) => (
    <div data-testid={`panel-${order.status}`} data-mode={mode ?? "banner"} />
  ),
}));
vi.mock("../MobileTriage", () => ({ MobileTriage: () => <div data-testid="mock-mobile-triage" /> }));

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
  test("parse-failed (status=failed) is the ONE gate: header + badge + panel", () => {
    mockState.order = makeOrder({ status: "failed" });
    render(<OrderWorkshop orderId="ord-1" />);
    expectGateHeader("PO-1");
    expect(screen.getByText("Couldn't read file")).toBeTruthy();
    const panel = screen.getByTestId("panel-failed");
    expect(panel.getAttribute("data-mode")).toBe("gate");
    // Nothing parsed, so there is deliberately no mapper underneath.
    expect(screen.queryByTestId("mock-mapper-workbench")).toBeNull();
  });

  // `satisfies` rather than a bare literal: test.each widens tuple members to
  // `string`, and makeOrder takes an OrderStatus. Without this the CI typecheck
  // gate (#56) fails the PR — and the annotation also pins these four names as
  // real statuses, so a rename in the union breaks here instead of silently
  // testing a status that no longer exists.
  test.each([
    ["transform_failed", "Couldn't build output"],
    ["delivery_failed", "Couldn't send"],
    ["delivery_held", "Delivery paused"],
    ["delivery_unconfirmed", "Delivery unknown"],
  ] satisfies Array<[OrderStatus, string]>)("%s renders the panel as a BANNER over the live workshop", (status, badge) => {
    mockState.order = makeOrder({ status });
    render(<OrderWorkshop orderId="ord-1" />);
    // The healthy header carries the same context the gate shell used to: the back
    // chip, the PO number, and the status badge.
    expect(screen.getByRole("button", { name: "Back to inbox" })).toBeTruthy();
    expect(screen.getByText("PO-1")).toBeTruthy();
    expect(screen.getByText(badge)).toBeTruthy();
    const panel = screen.getByTestId(`panel-${status}`);
    expect(panel.getAttribute("data-mode")).toBe("banner");
    // The evidence stays on screen — that is the whole point of the banner.
    expect(screen.getByTestId("mock-mapper-workbench")).toBeTruthy();
  });

  test("a banner state keeps the way back to the inbox", () => {
    mockState.order = makeOrder({ status: "delivery_held" });
    render(<OrderWorkshop orderId="ord-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Back to inbox" }));
    expect(mockState.routerPush).toHaveBeenCalledWith("/inbox");
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
    // WP-19 reworded this gate ("Order not found" → "We can't find this order")
    // and gave it a way out. This test's subject is the shared context header, so
    // the copy is only its LOCATOR — matched loosely here so a future rewording
    // does not read as a header regression. The wording itself, and the fact that
    // the state is reachable at all, are asserted in orderLoadFailure.test.tsx.
    expect(screen.getByText(/can't find this order/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Back to inbox/i })).toBeTruthy();
  });
});
