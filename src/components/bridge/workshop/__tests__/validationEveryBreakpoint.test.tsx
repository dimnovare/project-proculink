import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { Order } from "@/types/procurement";
import type { FieldValidationState } from "@/lib/api/types";

// ─────────────────────────────────────────────────────────────────────────────
// WP-18 — "Validation at every breakpoint".
//
// THE DEFECT. The supplier ACCEPTANCE result reaches the UI through exactly one
// query — `getFieldValidation` (GET /api/orders/{id}/validation) — and that query
// lives inside `useMapperModel`, which is only ever instantiated by
// `MapperWorkbench`. OrderWorkshop mounts MapperWorkbench inside a
// `hidden lg:flex` container, and the count it derives (`blockingCount`) is
// consumed *only* by the mapper's own internal `canDeliver`. It never reaches
// OrderWorkshop's `canSend`.
//
// So the send gate — on the desktop header button AND on the MobileTriage send bar
// — is computed with NO knowledge of the supplier's acceptance rules. An operator
// at 390px or 768px is offered a Send that WP-17's server-side acceptance gate
// (OrderTransformService, commit 8a2dbc3) is guaranteed to refuse.
//
// WHY THIS IS "DEFER TO THE SERVER", NOT A CLIENT MIRROR. WP-17 also changed
// GET /api/orders/{id}/validation so its `blocking` flag is derived from
// ISupplierAcceptanceService.GetBlockingFailuresAsync — the SAME call
// IAcceptanceGate acts on before it refuses a transform. The backend freezes that
// equality with a set comparison (ValidationBlockingMatchesTheGateTests). The
// client therefore re-implements no rule whatsoever: it counts rows the server has
// already marked blocking. There is exactly one evaluator, so the two cannot drift.
//
// WHAT THESE TESTS PIN. The gate decision must be IDENTICAL at 390 / 768 / 1440,
// and it must be legible — a tablet operator has to see WHICH rule blocks, not
// merely be refused. Both operator send controls (desktop header + mobile bar) are
// asserted at every viewport, so a fix that wires only one of them fails here.
// ─────────────────────────────────────────────────────────────────────────────

const mockState: {
  order: Order | null;
  validation: FieldValidationState[];
  exceptionCount: number;
  validationCalls: string[];
  showConfirm: boolean;
} = { order: null, validation: [], exceptionCount: 0, validationCalls: [], showConfirm: false };

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
}));

// THE endpoint under test. Recording every call proves WHO owns the evaluation:
// after the fix it must fire from OrderWorkshop itself, not from the mapper.
vi.mock("@/lib/api/mapper-ai", () => ({
  getFieldValidation: vi.fn((orderId: string) => {
    mockState.validationCalls.push(orderId);
    return Promise.resolve(mockState.validation);
  }),
  getMappingSuggestions: vi.fn().mockResolvedValue([]),
  getCatalogHints: vi.fn().mockResolvedValue([]),
  recordSuggestionDecision: vi.fn().mockResolvedValue(undefined),
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
    exceptionCount: mockState.exceptionCount,
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
    showConfirm: mockState.showConfirm,
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

// The mapper is the surface the defect hides behind. Stubbing it to render ONLY
// its issuesSlot (never its own model, never useMapperModel) is the structural
// half of the proof: with no mapper model in the tree at all, the acceptance
// evaluation must still happen and must still gate Send.
vi.mock("../../mapper/MapperWorkbench", () => ({
  MapperWorkbench: (props: Record<string, unknown>) => (
    <div data-testid="mock-mapper-workbench">
      <div data-testid="issues-slot">{props.issuesSlot as ReactNode}</div>
    </div>
  ),
}));

import { OrderWorkshop } from "../OrderWorkshop";

// ── Fixtures ─────────────────────────────────────────────────────────────────

/**
 * A CLEAN order: every line resolved, nothing needing review, no exceptions.
 * Everything the UI knows locally says "ready to send" — so the ONLY thing that
 * can refuse it is the server's acceptance answer. That is what makes the RED
 * unambiguous: nothing else in the fixture could be doing the blocking.
 */
function cleanOrder(over: Partial<Order> = {}): Order {
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
    ...over,
  };
}

/** The server's answer: one supplier acceptance rule refuses this order. */
const BLOCKING_ROW: FieldValidationState = {
  key: "lines[0].unitPrice",
  state: "review",
  reason: "Unit price above the agreed ceiling for this supplier",
  blocking: true,
};

/** An ADVISORY row — the server will still send. Must NOT gate. */
const ADVISORY_ROW: FieldValidationState = {
  key: "PoNumber",
  state: "review",
  reason: "PO number looks unusual",
  blocking: false,
};

const VIEWPORTS = [390, 768, 1440] as const;

/**
 * jsdom applies no Tailwind, so `hidden lg:flex` cannot be observed as CSS here.
 * Setting the width + a width-aware matchMedia is what makes the viewport axis
 * real for any breakpoint logic that consults the environment, and documents the
 * three widths the acceptance criteria name.
 */
function setViewport(width: number) {
  Object.defineProperty(window, "innerWidth", { value: width, writable: true, configurable: true });
  Object.defineProperty(window, "outerWidth", { value: width, writable: true, configurable: true });
  window.matchMedia = ((query: string) => {
    const min = /min-width:\s*(\d+)px/.exec(query);
    const max = /max-width:\s*(\d+)px/.exec(query);
    let matches = false;
    if (min) matches = width >= Number(min[1]);
    else if (max) matches = width <= Number(max[1]);
    return {
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
  window.dispatchEvent(new Event("resize"));
}

function renderWorkshop() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <OrderWorkshop orderId="ord-1" />
    </QueryClientProvider>,
  );
}

/**
 * The two controls an operator can actually press. The mobile bar is testid-anchored;
 * the desktop header Send is the send-labelled button OUTSIDE that bar. Resolving
 * them separately is what forces a fix to wire BOTH — a change to either alone
 * breaks the equality assertion below (rule R6).
 */
function sendControls() {
  const mobileBar = screen.getByTestId("mobile-send-bar");
  const mobile = within(mobileBar).getByRole("button");
  // Prefix, not equality: WP-28 made the disabled control say WHY it is disabled,
  // so the accessible name is "Send to supplier — 1 issue to fix first" while
  // blocked and "Send to supplier — 1 optional issue you can send past" when the
  // only failures are advisory. The control this helper must find is unchanged;
  // an exact match would only be pinning the copy, which sendBarLabel.test.ts owns.
  const desktop = screen
    .getAllByRole("button")
    .find((b) => !mobileBar.contains(b) && !!b.getAttribute("aria-label")?.startsWith("Send to supplier"));
  if (!desktop) throw new Error("desktop send button not found");
  return { desktop, mobile };
}

beforeEach(() => {
  mockState.order = cleanOrder();
  mockState.validation = [];
  mockState.exceptionCount = 0;
  mockState.validationCalls = [];
  mockState.showConfirm = false;
  setViewport(1440);
});
afterEach(cleanup);

// ─────────────────────────────────────────────────────────────────────────────
// 1 — the gate itself, at all three viewports.
// ─────────────────────────────────────────────────────────────────────────────
describe.each(VIEWPORTS)("send gate honours the server's acceptance answer at %ipx", (width) => {
  test("a blocking acceptance rule disables BOTH send controls", async () => {
    mockState.validation = [BLOCKING_ROW];
    setViewport(width);
    renderWorkshop();

    await waitFor(() => {
      const { desktop, mobile } = sendControls();
      expect(desktop).toBeDisabled();
      expect(mobile).toBeDisabled();
    });
  });

  test("an advisory-only rule leaves BOTH send controls enabled", async () => {
    mockState.validation = [ADVISORY_ROW];
    setViewport(width);
    renderWorkshop();

    await waitFor(() => expect(mockState.validationCalls).toContain("ord-1"));
    const { desktop, mobile } = sendControls();
    expect(desktop).toBeEnabled();
    expect(mobile).toBeEnabled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2 — legibility. Being refused is not enough: the operator must be told WHICH
// rule refuses, on the surface they actually have at that width.
// ─────────────────────────────────────────────────────────────────────────────
describe.each(VIEWPORTS)("the blocking rule is legible at %ipx", (width) => {
  test("the reduced (sub-lg) surface names the blocking rule", async () => {
    mockState.validation = [BLOCKING_ROW];
    setViewport(width);
    renderWorkshop();

    const list = await screen.findByTestId("mobile-issue-list");
    expect(within(list).getByText(/agreed ceiling/i)).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3 — R6: assert the DIFFERENCE. The desktop and reduced surfaces must reach the
// same decision from the same data at every width. This fails if either side is
// changed alone — including a "fix" that only wires the desktop header.
// ─────────────────────────────────────────────────────────────────────────────
describe("desktop and reduced surfaces cannot drift", () => {
  test.each(VIEWPORTS)("both surfaces agree at %ipx, blocked and clear", async (width) => {
    for (const rows of [[BLOCKING_ROW], [ADVISORY_ROW], []] as FieldValidationState[][]) {
      mockState.validation = rows;
      mockState.validationCalls = [];
      setViewport(width);
      renderWorkshop();

      await waitFor(() => expect(mockState.validationCalls).toContain("ord-1"));
      const { desktop, mobile } = sendControls();
      const expectedBlocked = rows.some((r) => r.state === "review" && r.blocking === true);

      expect((desktop as HTMLButtonElement).disabled).toBe(expectedBlocked);
      expect((mobile as HTMLButtonElement).disabled).toBe(expectedBlocked);
      expect((desktop as HTMLButtonElement).disabled).toBe((mobile as HTMLButtonElement).disabled);
      cleanup();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3b — R1: the useAcceptanceValidation wire must have a real consumer.
//
// The hook was never dead code (OrderWorkshop mounts it), but its validate()
// mutation has no caller anywhere in src/, so validationResult was permanently
// null and failingRuleCount permanently 0 — the send-confirmation dialog's
// acknowledgement could not appear even when rules had failed. The blocking rows
// are NOT the useful signal here (they set canSend=false, so the dialog cannot
// open); the ADVISORY failures are, and this pins that.
// ─────────────────────────────────────────────────────────────────────────────
describe("the send-confirmation dialog reflects the live acceptance answer", () => {
  test.each(VIEWPORTS)("an advisory failure is acknowledged before send at %ipx", async (width) => {
    mockState.validation = [ADVISORY_ROW];
    mockState.showConfirm = true;
    setViewport(width);
    renderWorkshop();

    const dialog = await screen.findByRole("dialog");
    expect(
      await within(dialog).findByText(/1 acceptance rule failed validation/i),
    ).toBeInTheDocument();
  });

  test("a clean order shows no acknowledgement", async () => {
    mockState.validation = [];
    mockState.showConfirm = true;
    renderWorkshop();

    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(mockState.validationCalls).toContain("ord-1"));
    expect(within(dialog).queryByText(/acceptance rule.* failed validation/i)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4 — ownership. The evaluation must belong to OrderWorkshop, not to the mapper.
// MapperWorkbench is stubbed here (it never builds useMapperModel), so a call to
// GET /api/orders/{id}/validation can only have come from the workshop itself.
// ─────────────────────────────────────────────────────────────────────────────
describe("the acceptance query is owned by the workshop, not the desktop mapper", () => {
  test.each(VIEWPORTS)("it fires at %ipx with no mapper model in the tree", async (width) => {
    mockState.validation = [BLOCKING_ROW];
    setViewport(width);
    renderWorkshop();

    await waitFor(() => expect(mockState.validationCalls).toContain("ord-1"));
  });
});
