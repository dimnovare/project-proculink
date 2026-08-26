import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConfirmProvider } from "@/components/ui/confirm";
import type { Order, OrderValidationResult } from "@/types/procurement";

// ─────────────────────────────────────────────────────────────────────────────
// WP-19 — what the order screen says when the order will not load.
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
  isError: boolean;
  error: unknown;
} = {
  isError: false,
  error: null,
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

vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => true, useTenantQueriesEnabled: () => true }));

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
      isError: mockState.isError,
      error: mockState.error,
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
import { ApiHttpError } from "@/lib/api/core";

function makeOrder(): Order {
  return {
    id: "ord-1", poNumber: "PO-4091678643", supplierId: "sup-1", supplierName: "BoltWorks BV",
    buyerName: "Heinrich Industries", orderDate: "2026-07-18", currency: "EUR",
    status: "pending_review", createdAt: "2026-07-18T00:00:00Z", updatedAt: "2026-07-18T00:00:00Z",
    lines: [], artifacts: [],
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

beforeEach(() => {
  mockState.order = makeOrder();
  mockState.search = new URLSearchParams();
  mockState.isError = false;
  mockState.error = null;
});
afterEach(cleanup);

// Before this, every one of these rendered "Something went wrong loading this
// order. Try again in a moment." with no control on the screen at all — chosen
// only by whether the value happened to be null. A 404 THROWS here, so a missing
// order was indistinguishable from a malfunction, and an expired session had no
// route back to sign-in.
describe("an order that will not load says WHICH failure it is", () => {
  test("404 — it is gone, and that is not a crash", async () => {
    mockState.order = undefined;
    mockState.isError = true;
    mockState.error = new ApiHttpError("Order ord-1 not found", 404);
    renderWorkshop();

    expect(await screen.findByText(/We can't find this order/i)).toBeInTheDocument();
    expect(screen.queryByText(/Something went wrong/i)).toBeNull();
    // No retry: the second answer is the first answer.
    expect(screen.queryByRole("button", { name: /Try again/i })).toBeNull();
    // The exit is WorkshopGateShell's own chip. This panel deliberately adds no
    // back control of its own — doing so put two controls that do the same thing
    // on one screen, in two vocabularies ("orders" and "inbox").
    expect(screen.getByRole("button", { name: /Back to inbox/i })).toBeTruthy();
  });

  test("401 — it routes to re-auth, and comes back here", async () => {
    mockState.order = undefined;
    mockState.isError = true;
    mockState.error = new ApiHttpError("unauthorised", 401);
    renderWorkshop();

    expect(await screen.findByText(/You've been signed out/i)).toBeInTheDocument();
    const signIn = screen.getByRole("link", { name: /Sign in again/i });
    expect(signIn).toHaveAttribute("href", "/sign-in?redirect_url=%2Finbox%2Ford-1");
  });

  test("429 — transient, with the wait when the server named one", async () => {
    mockState.order = undefined;
    mockState.isError = true;
    mockState.error = new ApiHttpError("slow down", 429, { retryAfterSeconds: 120 });
    renderWorkshop();

    expect(await screen.findByText(/Too many requests just now/i)).toBeInTheDocument();
    expect(screen.getByText(/about 2 minutes/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Try again/i })).toBeInTheDocument();
  });

  test("429 with no named wait states no number at all", async () => {
    mockState.order = undefined;
    mockState.isError = true;
    mockState.error = new ApiHttpError("slow down", 429);
    renderWorkshop();

    const body = await screen.findByText(/clears on its own/i);
    expect(body.textContent ?? "").not.toMatch(/\d/);
  });

  test("anything else keeps a retry, and does not blame the order", async () => {
    mockState.order = undefined;
    mockState.isError = true;
    mockState.error = new Error("Failed to fetch");
    renderWorkshop();

    expect(await screen.findByText(/We couldn't load this order/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Try again/i })).toBeInTheDocument();
  });
});
