import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { useEffect } from "react";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { Order } from "@/types/procurement";
import type { PromoteMappingResult } from "@/lib/api/types";
import { UNASSIGNED_SUPPLIER_ID } from "@/lib/catalogCodes";

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

/** A real plan-gate 403 body, kept verbatim on the Error message by the api layer. */
const GATE_BODY_FIXTURE = '{"error":"mapping_promotion_requires_growth","upgradeUrl":"/settings?tab=billing"}';

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

  test("with no message, it still says WHAT was saved — the count and the party name", async () => {
    // One total across all four count fields, not the inbound pair: see the
    // output-side-only case below for why splitting them misreports the result.
    render(<OrderWorkshop orderId="ord-1" />);
    fireEvent.click(saveButton());

    const notice = await screen.findByTestId("promote-notice");
    expect(notice.textContent).toContain("10");
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

  // The REAL wire shape for an unassigned counterparty. `Order.supplierId` is typed
  // non-optional and the API serializes Guid.Empty, so a fixture using `undefined`
  // exercises a shape that cannot occur — and a bare `!supplierId` guard passes that
  // fixture while letting the live one straight through.
  test("read-only: an unassigned counterparty serializes as Guid.Empty, and that disables it", () => {
    mockState.order = makeOrder({ supplierId: UNASSIGNED_SUPPLIER_ID, supplierName: "", status: "unrouted" });
    render(<OrderWorkshop orderId="ord-1" />);
    expect(saveButton()).toHaveProperty("disabled", true);
  });

  test("a disabled control never fires the request", () => {
    mockState.order = makeOrder({ supplierId: UNASSIGNED_SUPPLIER_ID, supplierName: "", status: "unrouted" });
    render(<OrderWorkshop orderId="ord-1" />);
    fireEvent.click(saveButton());
    expect(mockState.promote).not.toHaveBeenCalled();
  });

  // ── F2: the counts the sentence prints must be the counts that were saved ────
  test("an output-side-only promotion is NOT reported as zero fields saved", async () => {
    // WP-12 carries the OUTPUT tree to the counterparty, so these are the counts most
    // likely to be the only non-zero ones. A sentence built from header+line alone
    // reports "Saved 0 header and 0 line mappings" — as a SUCCESS.
    mockState.promote = vi.fn().mockResolvedValue(result({
      headerFieldsPromoted: 0,
      lineFieldsPromoted: 0,
      outputHeaderFieldsPromoted: 7,
      outputLineFieldsPromoted: 3,
    }));
    render(<OrderWorkshop orderId="ord-1" />);
    fireEvent.click(saveButton());

    const notice = await screen.findByTestId("promote-notice");
    expect(notice.getAttribute("data-tone")).toBe("success");
    expect(notice.textContent).toContain("10");
    expect(notice.textContent).not.toContain("0 header");
  });

  test("an aggregate-only result never prints 'undefined' at the operator", async () => {
    mockState.promote = vi.fn().mockResolvedValue({
      supplierId: "sup-1",
      totalFieldsPromoted: 12,
      schemaFingerprintHash: null,
    } as unknown as PromoteMappingResult);
    render(<OrderWorkshop orderId="ord-1" />);
    fireEvent.click(saveButton());

    const notice = await screen.findByTestId("promote-notice");
    expect(notice.textContent).not.toContain("undefined");
    expect(notice.textContent).toContain("12");
  });

  test("a zero total reads as info even when nothingToPromote is absent", async () => {
    mockState.promote = vi.fn().mockResolvedValue(
      result({ headerFieldsPromoted: 0, lineFieldsPromoted: 0 }),
    );
    render(<OrderWorkshop orderId="ord-1" />);
    fireEvent.click(saveButton());

    const notice = await screen.findByTestId("promote-notice");
    expect(notice.getAttribute("data-tone")).toBe("info");
  });

  // ── F4 + F9: every user-visible string carries the direction noun ────────────
  test("the label and the tooltip both name the counterparty by its direction noun", () => {
    mockState.counterparty = "Customer";
    render(<OrderWorkshop orderId="ord-1" />);
    const btn = saveButton();

    // "counterparty" is our INTERNAL word for this. It must never reach a user — and
    // the label has to distinguish this control from the mapper's autosave "Saved"
    // indicator sitting a few pixels to its left on the same bar.
    expect(btn.textContent?.toLowerCase()).toContain("customer");
    expect(btn.getAttribute("title")?.toLowerCase()).toContain("customer");
    expect(btn.getAttribute("title")?.toLowerCase()).not.toContain("counterparty");
    expect(btn.textContent?.toLowerCase()).not.toContain("counterparty");
  });

  // ── F8: the fallback noun lands in a slot that expects a proper name ─────────
  test("with no counterparty name the sentence still reads as English", async () => {
    mockState.order = makeOrder({ supplierId: "sup-1", supplierName: "" });
    render(<OrderWorkshop orderId="ord-1" />);
    fireEvent.click(saveButton());

    const notice = await screen.findByTestId("promote-notice");
    expect(notice.textContent).toContain("this supplier");
  });

  // ── F6: technical failure strings are not operator copy ─────────────────────
  test("a timeout reads as a sentence, not as 'Request timed out after 30000ms'", async () => {
    mockState.promote = vi.fn().mockRejectedValue(new Error("Request timed out after 30000ms"));
    render(<OrderWorkshop orderId="ord-1" />);
    fireEvent.click(saveButton());

    const notice = await screen.findByTestId("promote-notice");
    expect(notice.getAttribute("data-tone")).toBe("error");
    expect(notice.textContent).not.toContain("30000ms");
    expect(notice.textContent).toMatch(/try again/i);
  });

  test("a malformed 200 body does not paint a SyntaxError into the banner", async () => {
    mockState.promote = vi.fn().mockRejectedValue(new SyntaxError("Unexpected end of JSON input"));
    render(<OrderWorkshop orderId="ord-1" />);
    fireEvent.click(saveButton());

    const notice = await screen.findByTestId("promote-notice");
    expect(notice.textContent).not.toContain("JSON");
    expect(notice.textContent).toMatch(/try again/i);
  });

  // ── F7: the upgradeUrl the api layer preserves must actually be used ────────
  test("a plan gate offers the upgrade link the SERVER chose", async () => {
    mockState.promote = vi.fn().mockRejectedValue(
      new Error(GATE_BODY_FIXTURE),
    );
    render(<OrderWorkshop orderId="ord-1" />);
    fireEvent.click(saveButton());

    const notice = await screen.findByTestId("promote-notice");
    const link = notice.querySelector("a");
    expect(link).not.toBeNull();
    expect(link!.getAttribute("href")).toBe("/settings?tab=billing");
  });

  // ── X18 / X11 / X9: the notice chrome nothing pinned ────────────────────────
  test("the notice announces itself and can be dismissed", async () => {
    render(<OrderWorkshop orderId="ord-1" />);
    fireEvent.click(saveButton());

    const notice = await screen.findByTestId("promote-notice");
    expect(notice.getAttribute("role")).toBe("status");
    expect(notice.getAttribute("aria-live")).toBe("polite");

    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    await waitFor(() => expect(screen.queryByTestId("promote-notice")).toBeNull());
  });

  test("a second attempt clears the first result before it resolves", async () => {
    render(<OrderWorkshop orderId="ord-1" />);
    fireEvent.click(saveButton());
    await screen.findByTestId("promote-notice");

    let release: (v: PromoteMappingResult) => void = () => {};
    mockState.promote = vi.fn().mockReturnValue(new Promise<PromoteMappingResult>((r) => { release = r; }));
    fireEvent.click(saveButton());

    // Mid-flight the stale success must be gone — otherwise a failing retry sits
    // under a green "Saved" from the attempt before it.
    await waitFor(() => expect(screen.queryByTestId("promote-notice")).toBeNull());
    release(result());
    await screen.findByTestId("promote-notice");
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
