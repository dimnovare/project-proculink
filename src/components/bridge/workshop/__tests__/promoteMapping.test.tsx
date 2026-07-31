import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { useEffect } from "react";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { Order } from "@/types/procurement";
import type { PromoteMappingResult } from "@/lib/api/types";

// ─────────────────────────────────────────────────────────────────────────────
// WP-13 — the promote control.
//
// `promoteMapping()` shipped with ZERO call sites: no mount passed
// `onSaveMappings`, so MapperWorkbench never rendered the button, AND the Order
// Workshop hides the mapper toolbar entirely (`hideToolbar`), so even passing it
// there would have rendered nothing. The engine that carries a designed output
// tree from one order to the supplier (WP-12) had no reachable trigger, and
// /help/output-mapping-editor documented a control that did not exist.
//
// These tests pin the reachable path: the control renders on the workshop's
// consolidated status bar, calls the endpoint once, and REPORTS WHAT IT SAVED —
// the server's own `message`, not a generic "Saved".
// ─────────────────────────────────────────────────────────────────────────────

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (!("ResizeObserver" in globalThis)) {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
}

const mockState: {
  order: Order | null;
  promote: ReturnType<typeof vi.fn>;
  /** The per-org direction label. "Customer" is the inbound mode (founder decision 2026-07-30). */
  counterparty: string;
} = {
  order: null,
  promote: vi.fn(),
  counterparty: "Supplier",
};

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: undefined }),
  // AssignSupplierBanner (the no-counterparty case below) invalidates on save.
  useQueryClient: () => ({ invalidateQueries: vi.fn(), setQueryData: vi.fn() }),
}));

vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => true }));

vi.mock("@/hooks/useOrderDirection", () => ({
  useOrderDirection: () => ({
    labels: {
      counterpartyNoun: mockState.counterparty,
      counterpartyPlural: `${mockState.counterparty}s`,
      railHeader: "Buyer → Supplier",
      primaryCta: "Send to supplier",
      primaryCtaProgress: "Sending…",
      doneLabel: "Sent",
      deliveredLabel: "Delivered to supplier",
    },
  }),
}));

vi.mock("@/lib/api-client", () => ({
  apiClient: { getAiCalibration: vi.fn().mockResolvedValue({ isActive: false, buckets: [] }) },
  getMappingOverride: vi.fn().mockResolvedValue(null),
  previewMappingOverride: vi.fn().mockResolvedValue({ content: null }),
  promoteMapping: (...args: unknown[]) => mockState.promote(...args),
}));

vi.mock("../../review/CatalogHintCard", () => ({
  CatalogHintCard: () => null,
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

vi.mock("../../review/hooks/useAcceptanceValidation", () => ({
  useAcceptanceValidation: () => ({ validationResult: null, failingRuleCount: 0, isStale: false }),
}));

// The workbench is heavy (TanStack Query + the wire engine). Stubbed, but it
// still publishes a toolbar state exactly as the real one does, so the workshop's
// consolidated status bar renders — that bar is where the control must appear.
vi.mock("../../mapper/MapperWorkbench", () => ({
  MapperWorkbench: (props: Record<string, unknown>) => {
    const onToolbarState = props.onToolbarState as ((s: unknown) => void) | undefined;
    useEffect(() => {
      onToolbarState?.({
        mapped: 13, total: 13, requiredUnmapped: 0,
        saving: false, justSaved: false, error: null, aiUnavailable: false,
        showConnections: true,
        toggleConnections: vi.fn(),
        openLayoutDesigner: vi.fn(),
        openTemplateEditor: vi.fn(),
        catalogHintCount: 0,
        fillFromCatalog: null,
      });
    }, [onToolbarState]);
    return <div data-testid="mock-mapper-workbench" />;
  },
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

function result(over: Partial<PromoteMappingResult> = {}): PromoteMappingResult {
  return {
    supplierId: "sup-1",
    headerFieldsPromoted: 6,
    lineFieldsPromoted: 4,
    schemaFingerprintHash: null,
    ...over,
  };
}

beforeEach(() => {
  mockState.order = makeOrder();
  mockState.promote = vi.fn().mockResolvedValue(result());
  mockState.counterparty = "Supplier";
});
afterEach(cleanup);

// By test id, not by label: the label becomes "Saving…" mid-flight, and a helper
// that matched on "Save mappings" would silently stop finding the SAME button
// exactly when the in-flight assertions need it.
function saveButton(): HTMLButtonElement {
  return screen.getByTestId("save-mappings") as HTMLButtonElement;
}

describe("WP-13 — the promote control is reachable on /inbox/[orderId]", () => {
  test("the control RENDERS on the workshop (it had zero call sites before)", () => {
    render(<OrderWorkshop orderId="ord-1" />);
    expect(saveButton()).toBeTruthy();
  });

  test("clicking it calls promoteMapping with THIS order id, exactly once", async () => {
    render(<OrderWorkshop orderId="ord-1" />);
    fireEvent.click(saveButton());
    await waitFor(() => expect(mockState.promote).toHaveBeenCalledTimes(1));
    expect(mockState.promote).toHaveBeenCalledWith("ord-1");
  });

  test("the server's own message is what the operator reads — not a generic 'Saved'", async () => {
    mockState.promote = vi.fn().mockResolvedValue(
      result({ message: "Saved 6 header and 4 line mappings for Acme." }),
    );
    render(<OrderWorkshop orderId="ord-1" />);
    fireEvent.click(saveButton());

    const notice = await screen.findByTestId("promote-notice");
    expect(notice.textContent).toContain("Saved 6 header and 4 line mappings for Acme.");
    expect(notice.getAttribute("data-tone")).toBe("success");
  });

  test("with no message, it still says WHAT was saved — counts and the party name", async () => {
    render(<OrderWorkshop orderId="ord-1" />);
    fireEvent.click(saveButton());

    const notice = await screen.findByTestId("promote-notice");
    expect(notice.textContent).toMatch(/6/);
    expect(notice.textContent).toMatch(/4/);
    expect(notice.textContent).toContain("Acme");
  });

  test("the party noun comes from the direction labels, never a hardcoded 'supplier'", async () => {
    // Inbound mode: the counterparty is a CUSTOMER. Hardcoding "supplier" anywhere in
    // user-facing copy silently deletes that mode (founder decision, 2026-07-30).
    mockState.counterparty = "Customer";
    mockState.order = makeOrder({ supplierId: "sup-1", supplierName: undefined });
    render(<OrderWorkshop orderId="ord-1" />);
    fireEvent.click(saveButton());

    const notice = await screen.findByTestId("promote-notice");
    expect(notice.textContent).toContain("customer");
    expect(notice.textContent).not.toContain("supplier");
  });

  test("nothing to promote reads as INFO, never as a success", async () => {
    mockState.promote = vi.fn().mockResolvedValue(
      result({
        headerFieldsPromoted: 0,
        lineFieldsPromoted: 0,
        nothingToPromote: true,
        message: "There was nothing new to save.",
      }),
    );
    render(<OrderWorkshop orderId="ord-1" />);
    fireEvent.click(saveButton());

    const notice = await screen.findByTestId("promote-notice");
    expect(notice.getAttribute("data-tone")).toBe("info");
    expect(notice.textContent).toContain("There was nothing new to save.");
  });

  test("a failure is shown as an error, with the reason the API gave", async () => {
    mockState.promote = vi.fn().mockRejectedValue(
      new Error("No saved mapping to promote yet for this order."),
    );
    render(<OrderWorkshop orderId="ord-1" />);
    fireEvent.click(saveButton());

    const notice = await screen.findByTestId("promote-notice");
    expect(notice.getAttribute("data-tone")).toBe("error");
    expect(notice.textContent).toContain("No saved mapping to promote yet for this order.");
  });

  test("a plan-gate 403 reads as a sentence, never as the raw code", async () => {
    mockState.promote = vi.fn().mockRejectedValue(
      new Error('{"error":"mapping_promotion_requires_growth","upgradeUrl":"/settings"}'),
    );
    render(<OrderWorkshop orderId="ord-1" />);
    fireEvent.click(saveButton());

    const notice = await screen.findByTestId("promote-notice");
    expect(notice.textContent).not.toContain("mapping_promotion_requires_growth");
    expect(notice.textContent).toContain("Growth");
  });

  test("read-only: with no supplier assigned there is nowhere to save, so it is disabled", () => {
    mockState.order = makeOrder({ supplierId: undefined, supplierName: undefined, status: "unrouted" });
    render(<OrderWorkshop orderId="ord-1" />);
    expect(saveButton()).toHaveProperty("disabled", true);
  });

  test("a disabled control never fires the request", () => {
    mockState.order = makeOrder({ supplierId: undefined, supplierName: undefined, status: "unrouted" });
    render(<OrderWorkshop orderId="ord-1" />);
    fireEvent.click(saveButton());
    expect(mockState.promote).not.toHaveBeenCalled();
  });

  test("it is disabled while the request is in flight, so one click cannot become two", async () => {
    let release: (v: PromoteMappingResult) => void = () => {};
    mockState.promote = vi.fn().mockReturnValue(new Promise<PromoteMappingResult>((r) => { release = r; }));
    render(<OrderWorkshop orderId="ord-1" />);

    fireEvent.click(saveButton());
    await waitFor(() => expect(saveButton()).toHaveProperty("disabled", true));
    fireEvent.click(saveButton());
    expect(mockState.promote).toHaveBeenCalledTimes(1);

    release(result());
    await waitFor(() => expect(saveButton()).toHaveProperty("disabled", false));
  });
});
