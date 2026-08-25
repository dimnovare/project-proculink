import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { Order, OrderException } from "@/types/procurement";
import type { AcceptanceGateDecision } from "@/lib/api/types";

// ─────────────────────────────────────────────────────────────────────────────
// P1 (verified 2026-08-25) — a flagged duplicate never reached the send screen.
//
// THE DEFECT. The backend duplicate-PO detector (OrderExceptionService, code
// `duplicate_po_number`, severity warning) opens an ORDER-level exception on the
// later copy. Its documented safety property is "no duplicate reaches a supplier
// without having been flagged first — the operator is the control." But
// `getOrderExceptions` (GET /api/orders/{id}/exceptions) had ZERO consumers, and
// the review screen's send gate derives its count ONLY from line flags
// (`order.lines.filter(l => l.needsReview)`, useOrderReview). A clean second
// copy of a PO — mapping auto-learned, zero line issues — showed a green Send
// with NO warning anywhere on the screen where Send happens.
//
// WHY A RENDER TEST OVER OrderWorkshop, not a unit test of the notice alone: the
// bug was never that a warning could not be rendered — it was that nothing on
// the send screen consumed the endpoint. Only mounting the real screen proves
// the consumer exists at the decision point.
//
// The harness mirrors readyBarClaim.test.tsx: MapperWorkbench is stubbed to
// render only its issuesSlot. jsdom mounts BOTH breakpoint trees (`lg:hidden`
// and `hidden lg:block` both render — no Tailwind in vitest), so assertions
// about the notice are scoped with within() and the send-control assertions
// deliberately walk EVERY send button (desktop header + mobile sticky bar).
// ─────────────────────────────────────────────────────────────────────────────

const DUP_MESSAGE =
  "PO number PO-1 is already on another order here. It may be the same order received twice — check before sending it to the supplier.";

const mockState: {
  order: Order | null;
  gate: AcceptanceGateDecision;
  /** null → the exceptions endpoint rejects (the could-not-check arm). */
  exceptions: OrderException[] | null;
} = {
  order: null,
  gate: undefined as unknown as AcceptanceGateDecision,
  exceptions: [],
};

// vi.hoisted, because the vi.mock factory below hands this fn out at module-load
// time — before a plain top-level `const` would have initialised (TDZ). The
// implementation is attached AFTER `mockState` exists, and only dereferences it
// at call time.
const getOrderExceptionsMock = vi.hoisted(() => vi.fn());
getOrderExceptionsMock.mockImplementation(() =>
  mockState.exceptions
    ? Promise.resolve(mockState.exceptions)
    : Promise.reject(new Error("order-exceptions: 500")),
);

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
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
  previewMappingOverride: vi.fn().mockResolvedValue({ content: "", error: null }),
  validateOrder: vi.fn().mockResolvedValue({ orderId: "ord-1", passed: true, results: [] }),
  getOrderExceptions: getOrderExceptionsMock,
}));

vi.mock("@/lib/api/acceptance-gate", () => ({
  getAcceptanceGate: vi.fn(() => Promise.resolve(mockState.gate)),
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

vi.mock("../../mapper/MapperWorkbench", () => ({
  MapperWorkbench: (props: Record<string, unknown>) => (
    <div data-testid="mock-mapper-workbench">
      <div data-testid="issues-slot">{props.issuesSlot as ReactNode}</div>
    </div>
  ),
}));

import { OrderWorkshop } from "../OrderWorkshop";

/** A clean order — zero line flags, which is exactly the duplicate that shipped. */
function cleanOrder(): Order {
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

const NOTHING_BLOCKS: AcceptanceGateDecision = {
  blocked: false,
  reason: null,
  overridden: false,
  overriddenBy: null,
  overrideReason: null,
  blockers: [],
};

function dupException(over: Partial<OrderException> = {}): OrderException {
  return {
    id: "exc-1",
    severity: "warning",
    message: DUP_MESSAGE,
    createdAt: "2026-06-18T00:00:00Z",
    resolvedAt: null,
    orderId: "ord-1",
    lineId: null,
    stage: "validate",
    code: "duplicate_po_number",
    state: "open",
    ...over,
  };
}

function renderWorkshop(exceptions: OrderException[] | null): void {
  mockState.order = cleanOrder();
  mockState.gate = NOTHING_BLOCKS;
  mockState.exceptions = exceptions;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <OrderWorkshop orderId="ord-1" />
    </QueryClientProvider>,
  );
}

/** Every send control on the mounted page — desktop header AND mobile sticky bar. */
function allSendButtons(): HTMLElement[] {
  return screen.getAllByRole("button", { name: "Send to supplier" });
}

beforeEach(() => {
  mockState.order = null;
  mockState.exceptions = [];
  getOrderExceptionsMock.mockClear();
});
afterEach(() => cleanup());

describe("a flagged duplicate reaches the send screen (P1)", () => {
  test("an open duplicate_po_number exception renders the server's message on the send screen", async () => {
    renderWorkshop([dupException()]);

    const notice = await screen.findByTestId("order-exceptions-notice");
    // The SERVER's sentence, verbatim — never a local copy of it.
    expect(within(notice).getByText(DUP_MESSAGE)).toBeInTheDocument();
    // The short plain framing heading.
    expect(notice.textContent).toContain("Possible duplicate");
    // Advisory chrome: the warning tone, announced politely — not an alert
    // claiming a failure, not the success green.
    const toned = notice.querySelector("[data-notice-tone]");
    expect(toned?.getAttribute("data-notice-tone")).toBe("warning");
    expect(toned?.getAttribute("role")).toBe("status");
    // And it shares the screen with the send controls it warns about. The name
    // regex is deliberately loose: while the acceptance gate is still settling
    // the control's accessible name carries a suffix.
    expect(
      screen.getAllByRole("button", { name: /send to supplier/i }).length,
    ).toBeGreaterThanOrEqual(2);
  });

  test("the warning does not block send — every send control stays enabled", async () => {
    renderWorkshop([dupException()]);

    await screen.findByTestId("order-exceptions-notice");
    // Both trees mount in jsdom: the desktop header button AND MobileTriage's
    // sticky-bar button. Walk every one — a warning that disabled either surface
    // would block a legitimate PO revision.
    await waitFor(() => {
      const buttons = allSendButtons();
      expect(buttons.length).toBeGreaterThanOrEqual(2);
      for (const b of buttons) expect(b).not.toBeDisabled();
    });
  });

  test("a resolved or ignored exception renders no warning", async () => {
    // Positive control first: the open row DOES render through this exact
    // pathway — otherwise the absences below would pass against a component
    // that renders nothing for any input.
    renderWorkshop([dupException()]);
    await screen.findByTestId("order-exceptions-notice");
    cleanup();

    // Settled via `state` (the all-orders shape) …
    renderWorkshop([dupException({ state: "resolved", resolvedAt: "2026-06-19T00:00:00Z" })]);
    await waitFor(() => expect(getOrderExceptionsMock).toHaveBeenCalled());
    await screen.findByTestId("issues-panel");
    expect(screen.queryByTestId("order-exceptions-notice")).toBeNull();
    cleanup();
    getOrderExceptionsMock.mockClear();

    // … via `resolvedAt` alone (the per-order endpoint may omit `state`) …
    renderWorkshop([dupException({ state: null, resolvedAt: "2026-06-19T00:00:00Z" })]);
    await waitFor(() => expect(getOrderExceptionsMock).toHaveBeenCalled());
    await screen.findByTestId("issues-panel");
    expect(screen.queryByTestId("order-exceptions-notice")).toBeNull();
    cleanup();
    getOrderExceptionsMock.mockClear();

    // … and a person's explicit dismissal stays dismissed.
    renderWorkshop([dupException({ state: "ignored" })]);
    await waitFor(() => expect(getOrderExceptionsMock).toHaveBeenCalled());
    await screen.findByTestId("issues-panel");
    expect(screen.queryByTestId("order-exceptions-notice")).toBeNull();
  });

  test("a failed check says so — it never renders as a silent all-clear", async () => {
    renderWorkshop(null); // endpoint rejects

    // The honest third answer renders … (the query retries once before erroring,
    // and TanStack's default retryDelay is ~1s — longer than findBy's default)
    const line = await screen.findByTestId("order-exceptions-check-failed", undefined, {
      timeout: 5000,
    });
    expect(line).toHaveTextContent(/couldn.t check for duplicates/i);
    // … the amber warning does not (there is no duplicate to report) …
    expect(screen.queryByTestId("order-exceptions-notice")).toBeNull();
    // … and the screen is not broken: the send controls survive the failure.
    await waitFor(() => {
      const buttons = allSendButtons();
      expect(buttons.length).toBeGreaterThanOrEqual(2);
      for (const b of buttons) expect(b).not.toBeDisabled();
    });
  });
});
