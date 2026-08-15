import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConfirmProvider } from "@/components/ui/confirm";
import type { Order, OrderValidationResult } from "@/types/procurement";

// ─────────────────────────────────────────────────────────────────────────────
// WP-19 + WP-24 — "See their reply" was a button that did nothing.
//
// A refused order's panel offered a primary CTA labelled "See their reply"
// pointing at `/inbox/{id}?details=response`. Two independent reasons it was
// inert, and fixing either alone leaves it inert:
//
//   1. NOTHING in the app has ever read `details`. The drawer reads `?tab=`,
//      accepting passport | conformance | response. Every route gate in the repo
//      scored the href green because they all normalise through
//      `appRoutes.normalizePath`, which strips `?` before matching.
//
//   2. The tab was SEEDED in a `useState` initialiser. The panel is a banner
//      already rendered at `/inbox/{id}`, so the link is a SAME-ROUTE
//      navigation — React does not remount, the initialiser never re-runs, and
//      even the correct parameter would have opened nothing.
//
// So this test drives the DOM rather than reading the source: it asserts the
// drawer is closed, changes the query the way a same-route <Link> does, and
// asserts the supplier-response view is now on screen. A source-text assertion
// (`/useTabParamSync/.test(src)`) would pass with the call commented out.
// ─────────────────────────────────────────────────────────────────────────────

const mockState: {
  order: Order | null | undefined;
  validationResult: OrderValidationResult | null;
  exceptionCount: number;
  search: URLSearchParams;
} = {
  order: undefined,
  validationResult: { passed: true, results: [] } as OrderValidationResult,
  exceptionCount: 0,
  search: new URLSearchParams(),
};

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/inbox/ord-1",
  // Read through the holder so a test can change the query the way a same-route
  // navigation does, without remounting the component.
  useSearchParams: () => mockState.search,
}));

vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => true }));

vi.mock("@/hooks/useOrderDirection", () => ({
  useOrderDirection: () => ({
    direction: "outbound",
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
    transformOrder: vi.fn(),
    retryDelivery: vi.fn(),
    redeliverOrder: vi.fn(),
    markDelivered: vi.fn(),
    getOrderById: vi.fn(),
  },
  requeueDelivery: vi.fn(),
  getOpsHealth: vi.fn().mockResolvedValue({ workerHealthy: true }),
  getMappingOverride: vi.fn().mockResolvedValue(null),
  previewMappingOverride: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../review/hooks/useOrderReview", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../review/hooks/useOrderReview")>();
  return {
    ...actual,
    useOrderReview: () => ({
      order: mockState.order,
      isLoading: false,
      isError: false,
      refetchOrder: vi.fn().mockResolvedValue(undefined),
      exceptionCount: mockState.exceptionCount,
    }),
  };
});

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
    validationResult: mockState.validationResult,
    failingRuleCount: 0,
    isStale: false,
  }),
}));

vi.mock("../../mapper/MapperWorkbench", () => ({
  MapperWorkbench: () => <div data-testid="mock-mapper-workbench" />,
}));
vi.mock("../MobileTriage", () => ({ MobileTriage: () => <div data-testid="mock-mobile-triage" /> }));
vi.mock("../../review/CatalogHintCard", () => ({ CatalogHintCard: () => null }));
vi.mock("../AssignSupplierBanner", () => ({
  AssignSupplierBanner: () => <div data-testid="assign-supplier-banner" />,
}));

import { OrderWorkshop } from "../OrderWorkshop";
import { PROBLEM_COPY } from "../../problem/problemCopy";

function makeOrder(over: Partial<Order> = {}): Order {
  return {
    id: "ord-1",
    poNumber: "PO-4091678643",
    supplierId: "sup-1",
    supplierName: "BoltWorks BV",
    buyerName: "Heinrich Industries",
    orderDate: "2026-07-18",
    currency: "EUR",
    status: "rejected_by_supplier",
    errorMessage: "Item 4 is not in our catalogue.",
    createdAt: "2026-07-18T00:00:00Z",
    updatedAt: "2026-07-18T00:00:00Z",
    lines: [],
    artifacts: [],
    ...over,
  } as Order;
}

function renderWorkshop() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ConfirmProvider>
        <OrderWorkshop orderId="ord-1" />
      </ConfirmProvider>
    </QueryClientProvider>,
  );
}

/** The order-details drawer, or null when it is closed. */
function drawer(): HTMLElement | null {
  return screen.queryByRole("dialog", { name: /Order details for/i });
}

beforeEach(() => {
  mockState.order = makeOrder();
  mockState.search = new URLSearchParams();
});
afterEach(cleanup);

describe("a refused order's reply is reachable from its own panel", () => {
  test("the CTA asks for a parameter the drawer accepts", () => {
    const reply = PROBLEM_COPY.rejected_by_supplier
      .actions({
        supplier: "BoltWorks BV",
        po: "PO 4091678643",
        supplierId: "sup-1",
        orderId: "ord-1",
        serverMessage: null,
        failureCause: null,
        retryAfterSeconds: null,
        readOnly: false,
        accountStatus: null,
        atOrderLimit: false,
        processingPaused: false,
      })
      .find((a) => a.kind === "link" && a.variant === "primary");

    expect(reply).toBeTruthy();
    const href = (reply as { href: string }).href;
    // The value the drawer actually switches on. `details` was read by nothing.
    expect(href).toBe("/inbox/ord-1?tab=response");
    expect(href).not.toContain("details=");
  });

  test("a same-route ?tab=response opens the supplier-response view while mounted", async () => {
    const { rerender } = renderWorkshop();

    // Nothing is open: the operator is looking at the refused order's banner.
    expect(drawer()).toBeNull();

    // What clicking the panel's primary CTA does. The route is unchanged, so the
    // component is NOT remounted — only the query moves.
    mockState.search = new URLSearchParams("tab=response");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    rerender(
      <QueryClientProvider client={qc}>
        <ConfirmProvider>
          <OrderWorkshop orderId="ord-1" />
        </ConfirmProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(drawer()).not.toBeNull());
    const tab = screen.getByRole("tab", { name: /response/i });
    expect(tab).toHaveAttribute("aria-selected", "true");
  });

  test("an unrecognised tab value leaves the drawer shut rather than guessing", async () => {
    const { rerender } = renderWorkshop();
    expect(drawer()).toBeNull();

    mockState.search = new URLSearchParams("tab=not-a-tab");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    rerender(
      <QueryClientProvider client={qc}>
        <ConfirmProvider>
          <OrderWorkshop orderId="ord-1" />
        </ConfirmProvider>
      </QueryClientProvider>,
    );

    // Give the sync effect a chance to run before asserting the negative.
    await waitFor(() => expect(screen.queryByTestId("mock-mapper-workbench")).toBeTruthy());
    expect(drawer()).toBeNull();
  });

  test("a deep link that arrives on FIRST paint still opens it", async () => {
    // The other half of the contract: arriving from another screen mounts the
    // component with the param already set, which the useState initialiser owns.
    mockState.search = new URLSearchParams("tab=response");
    renderWorkshop();
    await waitFor(() => expect(drawer()).not.toBeNull());
  });
});
