import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConfirmProvider } from "@/components/ui/confirm";
import type { Order, OrderValidationResult } from "@/types/procurement";

// ─────────────────────────────────────────────────────────────────────────────
// WP-24 — recovery UI. One test per problem state, asserting the SAME contract:
// the screen offers a control that performs a REAL recovery (an endpoint the
// backend's guard set accepts) or an honest "nothing to do, and here is why" —
// and never a control the backend will reject.
//
// The four verified defects these tests exist to pin:
//   D1  transform_failed's only CTA was a Link to /inbox/{id} — the page it is
//       already on. Recovery existed in the backend and was unreachable.
//   D2  delivery_dead_letter fell through to the mapper, whose Send calls
//       redeliverOrder — 400 for that status. Its rescue is the ops requeue.
//   D4  rejected_by_supplier had no arm at all: a live green Send on a status
//       with NO outgoing transitions.
//   §5  delivery_unconfirmed must never offer a one-click re-send.
//
// Deliberately at the OrderWorkshop level, not the panel's: the defect was the
// SCREEN offering a doomed control, and the workshop is what composes both the
// panel and the header Send.
// ─────────────────────────────────────────────────────────────────────────────

const mockState: {
  order: Order | null | undefined;
  validationResult: OrderValidationResult | null;
  exceptionCount: number;
  routerPush: ReturnType<typeof vi.fn>;
} = {
  order: undefined,
  validationResult: { passed: true, results: [] } as OrderValidationResult,
  exceptionCount: 0,
  routerPush: vi.fn(),
};

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockState.routerPush, replace: vi.fn() }),
  usePathname: () => "/inbox/ord-1",
  useSearchParams: () => new URLSearchParams(),
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

const api = {
  transformOrder: vi.fn(),
  retryDelivery: vi.fn(),
  redeliverOrder: vi.fn(),
  markDelivered: vi.fn(),
  requeueDelivery: vi.fn(),
  getOrderById: vi.fn(),
};

vi.mock("@/lib/api-client", () => ({
  isApiMockMode: false,
  apiClient: {
    getAiCalibration: vi.fn().mockResolvedValue({ isActive: false, buckets: [] }),
    getOrderAudit: vi.fn().mockResolvedValue([]),
    getOrderPassport: vi.fn().mockResolvedValue(null),
    transformOrder: (...a: unknown[]) => api.transformOrder(...a),
    retryDelivery: (...a: unknown[]) => api.retryDelivery(...a),
    redeliverOrder: (...a: unknown[]) => api.redeliverOrder(...a),
    markDelivered: (...a: unknown[]) => api.markDelivered(...a),
    getOrderById: (...a: unknown[]) => api.getOrderById(...a),
  },
  requeueDelivery: (...a: unknown[]) => api.requeueDelivery(...a),
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
vi.mock("../MobileTriage", () => ({
  MobileTriage: (p: { canSend: boolean }) => (
    <div data-testid="mock-mobile-triage" data-can-send={String(p.canSend)} />
  ),
}));
vi.mock("../../review/CatalogHintCard", () => ({ CatalogHintCard: () => null }));
vi.mock("../AssignSupplierBanner", () => ({
  AssignSupplierBanner: () => <div data-testid="assign-supplier-banner" />,
}));

import { OrderWorkshop } from "../OrderWorkshop";

function makeOrder(over: Partial<Order> = {}): Order {
  return {
    id: "ord-1",
    poNumber: "PO-4091678643",
    supplierId: "sup-1",
    supplierName: "BoltWorks BV",
    buyerName: "Heinrich Industries",
    orderDate: "2026-07-18",
    currency: "EUR",
    status: "pending_review",
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

/** Every anchor's href on screen. */
function hrefs(): string[] {
  return Array.from(document.querySelectorAll("a"))
    .map((a) => a.getAttribute("href") ?? "")
    .filter(Boolean);
}

/** Every ENABLED button's accessible-ish name (aria-label first, then text). */
function enabledButtonNames(): string[] {
  return Array.from(document.querySelectorAll("button"))
    .filter((b) => !(b as HTMLButtonElement).disabled)
    .map((b) => b.getAttribute("aria-label") ?? b.textContent ?? "");
}

const PROBLEM_STATUSES = [
  "failed",
  "unrouted",
  "transform_failed",
  "delivery_failed",
  "delivery_dead_letter",
  "rejected_by_supplier",
  "delivery_unconfirmed",
  "delivery_held",
] as const;

beforeEach(() => {
  mockState.order = undefined;
  mockState.validationResult = { passed: true, results: [] } as OrderValidationResult;
  mockState.exceptionCount = 0;
  mockState.routerPush = vi.fn();
  Object.values(api).forEach((fn) => fn.mockReset());
  api.transformOrder.mockResolvedValue({ artifactId: "a1" });
  api.retryDelivery.mockResolvedValue(undefined);
  api.requeueDelivery.mockResolvedValue(undefined);
  api.redeliverOrder.mockResolvedValue(undefined);
  api.markDelivered.mockResolvedValue(undefined);
  api.getOrderById.mockResolvedValue(makeOrder({ status: "delivery_failed" }));
  sessionStorage.clear();
});
afterEach(cleanup);

// ─────────────────────────────────────────────────────────────────────────────
// The invariant that kills the whole D1/D2/D4 class.
// ─────────────────────────────────────────────────────────────────────────────
describe("the §1 invariant — a problem state never offers the workshop's send", () => {
  test.each(PROBLEM_STATUSES)("%s: no enabled send-shaped control anywhere", (status) => {
    mockState.order = makeOrder({ status });
    renderWorkshop();

    // "Send to supplier" is the workshop's own CTA (aria-label). It must never be
    // clickable while the order is in a problem state — the backend's guard sets
    // reject a send from every one of these eight statuses.
    expect(enabledButtonNames()).not.toContain("Send to supplier");

    // The mobile surface takes canSend from the SAME derived boolean, so a phone
    // cannot be a way around the desktop gate.
    const triage = screen.queryByTestId("mock-mobile-triage");
    if (triage) expect(triage.getAttribute("data-can-send")).toBe("false");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D1 — transform_failed
// ─────────────────────────────────────────────────────────────────────────────
describe("transform_failed — the recovery the backend already supports is reachable", () => {
  test("the primary CTA is NOT a link to the page we are already on (D1)", () => {
    mockState.order = makeOrder({ status: "transform_failed" });
    renderWorkshop();
    expect(hrefs()).not.toContain("/inbox/ord-1");
  });

  test("points at the supplier's output settings when that IS the thing that broke", () => {
    mockState.order = makeOrder({
      status: "transform_failed",
      // The backend's own sentence for this cause, verbatim
      // (OrderTransformService.cs:698-699). It used to be the copy every
      // unrecognised message inherited; it is now reached by the message that
      // means it, so the fixture has to carry that message.
      errorMessage:
        "The published output mapping for this connection could not be applied, so the order was not "
        + "delivered: Object reference not set to an instance of an object.",
    });
    renderWorkshop();
    // NOT /library/templates: FE #47 deleted that page precisely because it could
    // not change what a supplier receives. `outputFormat` (and the cXML credentials
    // the transform reads) live on the supplier's delivery config, and this is the
    // only screen that edits them.
    expect(hrefs()).toContain("/library/suppliers/sup-1?tab=delivery");
    expect(hrefs()).not.toContain("/library/templates?supplierId=sup-1");
  });

  test("does NOT point at the output settings when we could not read the message", () => {
    // The other half, on the rendered screen rather than in the copy table. An
    // order held over its line data carries "Cannot transform: lines 2, 5 still
    // need review." — nothing on the Delivery tab fixes that, and sending an
    // operator there to edit settings that are fine costs them the trip and the
    // trust. The rebuild stays on screen either way.
    mockState.order = makeOrder({
      status: "transform_failed",
      errorMessage: "Cannot transform: lines 2, 5 still need review.",
    });
    renderWorkshop();
    expect(hrefs()).not.toContain("/library/suppliers/sup-1?tab=delivery");
    expect(screen.getByRole("button", { name: /Try building it again/i })).toBeTruthy();
  });

  test("'Try building it again' calls transformOrder — a real, guard-satisfying endpoint", async () => {
    mockState.order = makeOrder({
      status: "transform_failed",
      errorMessage: "Template 'boltworks-csv-v2' — column 'unit_price' is not in this order.",
    });
    renderWorkshop();

    fireEvent.click(screen.getByRole("button", { name: /Try building it again/i }));
    await waitFor(() => expect(api.transformOrder).toHaveBeenCalledWith("ord-1"));
    expect(api.redeliverOrder).not.toHaveBeenCalled();
  });

  test("renders the server's own message verbatim — the only thing an engineer can act on", () => {
    mockState.order = makeOrder({
      status: "transform_failed",
      errorMessage: "Template 'boltworks-csv-v2' — column 'unit_price' is not in this order.",
    });
    renderWorkshop();
    expect(
      screen.getByText("Template 'boltworks-csv-v2' — column 'unit_price' is not in this order."),
    ).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D2 — delivery_dead_letter
// ─────────────────────────────────────────────────────────────────────────────
describe("delivery_dead_letter — the button that used to 400 is gone", () => {
  test("'Start sending again' calls the ops requeue, never redeliver (D2)", async () => {
    mockState.order = makeOrder({ status: "delivery_dead_letter" });
    renderWorkshop();

    fireEvent.click(screen.getByRole("button", { name: /Start sending again/i }));
    await waitFor(() => expect(api.requeueDelivery).toHaveBeenCalledWith("ord-1"));
    // RedeliverableFrom excludes delivery_dead_letter — a redeliver here is a 400.
    expect(api.redeliverOrder).not.toHaveBeenCalled();
  });

  test("no screen text tells the operator to click a Send button", () => {
    mockState.order = makeOrder({ status: "delivery_dead_letter" });
    renderWorkshop();
    expect(document.body.textContent ?? "").not.toMatch(/click\s+["“']?Send again/i);
  });

  test("checks the supplier's delivery settings before a blind retry", () => {
    mockState.order = makeOrder({ status: "delivery_dead_letter" });
    renderWorkshop();
    expect(hrefs()).toContain("/library/suppliers/sup-1?tab=delivery");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D4 — rejected_by_supplier (terminal: no outgoing transitions)
// ─────────────────────────────────────────────────────────────────────────────
describe("rejected_by_supplier — a terminal status gets an explanation, not a resend", () => {
  test("offers no post action at all — every send endpoint would 400", () => {
    mockState.order = makeOrder({ status: "rejected_by_supplier", errorMessage: "Item 4 not in catalogue" });
    renderWorkshop();

    // Click EVERY control on the screen. Not one of them may send anything:
    // rejected_by_supplier has no outgoing transitions at all.
    for (const b of Array.from(document.querySelectorAll("button"))) fireEvent.click(b);
    expect(api.redeliverOrder).not.toHaveBeenCalled();
    expect(api.requeueDelivery).not.toHaveBeenCalled();
    expect(api.retryDelivery).not.toHaveBeenCalled();
    expect(api.transformOrder).not.toHaveBeenCalled();

    // And the workshop's own send control is disabled AND renamed to what this
    // order actually needs, so it never reads "Send to supplier" to a screen reader.
    const send = document.querySelector('button[aria-label="See their reply"]');
    expect(send).toBeTruthy();
    expect(send).toBeDisabled();
  });

  // WP-19/WP-24 correction. This test asserted `?details=response` and
  // `&from=ord-1` as the expected hrefs — and BOTH parameters were read by
  // nothing, anywhere in the app. It was not a locator that drifted; it was an
  // assertion that pinned the defect in place, the same way problemContract's
  // "example of a live destination" did. Route gates all normalise the query
  // away before matching, so nothing else could see it either.
  //
  // `details` → `tab`, the parameter OrderDetailsDrawer actually switches on.
  // `from` is gone: it promised a link between a refused order and its
  // replacement that nothing kept.
  test("routes to the supplier's own reply and to a corrected order", () => {
    mockState.order = makeOrder({ status: "rejected_by_supplier" });
    renderWorkshop();
    const links = hrefs();
    expect(links).toContain("/inbox/ord-1?tab=response");
    expect(links).toContain("/upload?supplierId=sup-1");
    // The old values must not come back.
    expect(links).not.toContain("/inbox/ord-1?details=response");
    expect(links.some((h) => h.includes("from=ord-1"))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// delivery_failed — retry, and the config-missing cliff
// ─────────────────────────────────────────────────────────────────────────────
describe("delivery_failed — the retry is real, and honest about what it cannot fix", () => {
  test("'Try sending now' calls retryDelivery", async () => {
    mockState.order = makeOrder({ status: "delivery_failed", errorMessage: "Connection reset by peer" });
    renderWorkshop();

    fireEvent.click(screen.getByRole("button", { name: /Try sending now/i }));
    await waitFor(() => expect(api.retryDelivery).toHaveBeenCalledWith("ord-1"));
  });

  test("config missing: the primary is setup, and the retry is visible but disabled", () => {
    mockState.order = makeOrder({
      status: "delivery_failed",
      errorMessage: "Supplier delivery config is missing. Add a delivery endpoint before sending this order.",
    });
    renderWorkshop();

    expect(hrefs()).toContain("/library/suppliers/sup-1?tab=delivery");
    const retry = screen.getByRole("button", { name: /Try sending now/i });
    expect(retry).toBeDisabled();
    fireEvent.click(retry);
    expect(api.retryDelivery).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The two "nothing to do, here is why" states
// ─────────────────────────────────────────────────────────────────────────────
describe("delivery_held — an honest 'nothing to do', with the one link that helps", () => {
  test("links billing and offers no send-shaped post action", () => {
    mockState.order = makeOrder({ status: "delivery_held" });
    renderWorkshop();
    expect(hrefs()).toContain("/settings?tab=billing");
    expect(api.redeliverOrder).not.toHaveBeenCalled();
    expect(document.body.textContent ?? "").toMatch(/billing is up to date/i);
  });
});

describe("failed — a gate, because there is nothing underneath to read", () => {
  test("re-upload and the format list are the actions; the mapper is not rendered", () => {
    mockState.order = makeOrder({ status: "failed", errorMessage: "No text layer found in the PDF." });
    renderWorkshop();

    const links = hrefs();
    expect(links).toContain("/upload?supplierId=sup-1");
    expect(links).toContain("/formats");
    expect(screen.queryByTestId("mock-mapper-workbench")).toBeNull();
  });

  test("escalates to us from the start — a file the parser rejected is not the operator's bug", () => {
    mockState.order = makeOrder({ status: "failed" });
    renderWorkshop();
    expect(
      hrefs().some((h) => h.startsWith("/support?order=")),
    ).toBe(true);
  });
});

describe("unrouted — the shipped picker stays the recovery control", () => {
  test("renders the assign-supplier banner over the live workshop", () => {
    mockState.order = makeOrder({ status: "unrouted", supplierName: "" });
    renderWorkshop();
    expect(screen.getByTestId("assign-supplier-banner")).toBeTruthy();
    // The evidence underneath is exactly what the operator needs to answer
    // "whose order is this?" — so this state is a banner, never a gate.
    expect(screen.getByTestId("mock-mapper-workbench")).toBeTruthy();
  });
});
