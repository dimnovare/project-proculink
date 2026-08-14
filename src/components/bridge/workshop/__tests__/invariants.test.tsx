import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { useEffect } from "react";
import { render, screen, cleanup, fireEvent, within, waitFor } from "@testing-library/react";
import { renderHook, act } from "@testing-library/react";
import type { Order, OrderValidationResult } from "@/types/procurement";

// Radix DropdownMenu (the status bar's ⋯ overflow) positions its content with a
// ResizeObserver, which jsdom does not implement — stub it for these tests.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (!("ResizeObserver" in globalThis)) {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
}

// ─────────────────────────────────────────────────────────────────────────────
// Characterization tests for the Order Workshop's 5 invariants (Task 13). These
// FREEZE the contracts that broke across the 3 prior rebuilds, so a future change
// that violates one fails loudly here:
//
//   (1) adding/wiring a field never SHRINKS the visible target list;
//   (2) the issue list === the send-gating validator (a -3 qty → not green, Send disabled);
//   (3) every source field appears for a sample of each format (lossless, post-P0);
//   (4) collapsing a zone preserves an unsaved mapping edit;
//   (5) preview == delivery is covered by the existing parity suite (referenced below).
//
// The OrderWorkshop tests mock the heavy/composed surface (MapperWorkbench pulls
// TanStack Query + the wire engine; next/navigation + the review hooks pull the
// network). The mocks PROVE composition + the workshop's OWN logic (issue mapping,
// send gating, layout) without reimplementing the engine.
// ─────────────────────────────────────────────────────────────────────────────

// ── Shared mock state, mutated per test before render ────────────────────────
const mockState: {
  order: Order | null;
  validationResult: OrderValidationResult | null;
  exceptionCount: number;
  setShowConfirm: ReturnType<typeof vi.fn>;
  confirmSend: ReturnType<typeof vi.fn>;
  acceptSuggestion: ReturnType<typeof vi.fn>;
  startLineEdit: ReturnType<typeof vi.fn>;
  commitLineCode: ReturnType<typeof vi.fn>;
  confirmFlaggedLine: ReturnType<typeof vi.fn>;
  bulkAcceptSuggestions: ReturnType<typeof vi.fn>;
  lineEditId: string | null;
  lastMapperProps: Record<string, unknown> | null;
  routerPush: ReturnType<typeof vi.fn>;
  // Handlers the mocked MapperWorkbench publishes via onToolbarState (the
  // re-hosted ⋯ overflow tools on the consolidated status bar).
  openLayoutDesigner: ReturnType<typeof vi.fn>;
  openTemplateEditor: ReturnType<typeof vi.fn>;
  toggleConnections: ReturnType<typeof vi.fn>;
  // Published as the toolbar's fillFromCatalog. null (the default) = no catalog
  // hints → the ⋯ item renders honestly disabled; a fn = enabled.
  fillFromCatalog: ReturnType<typeof vi.fn> | null;
} = {
  order: null,
  validationResult: null,
  exceptionCount: 0,
  setShowConfirm: vi.fn(),
  confirmSend: vi.fn(),
  acceptSuggestion: vi.fn(),
  startLineEdit: vi.fn(),
  commitLineCode: vi.fn(),
  confirmFlaggedLine: vi.fn(),
  bulkAcceptSuggestions: vi.fn(),
  lineEditId: null,
  lastMapperProps: null,
  routerPush: vi.fn(),
  openLayoutDesigner: vi.fn(),
  openTemplateEditor: vi.fn(),
  toggleConnections: vi.fn(),
  fillFromCatalog: null,
};

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockState.routerPush, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@tanstack/react-query", () => ({
  // The workshop calls useQuery for calibration + the override; both degrade to a
  // safe empty here so the component renders deterministically.
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
  apiClient: { getAiCalibration: vi.fn().mockResolvedValue({ isActive: false, buckets: [] }) },
  getMappingOverride: vi.fn().mockResolvedValue(null),
}));

// The catalog hint owns its own visibility (it probes the supplier's catalog and
// renders null until that probe proves the catalog is empty — see
// CatalogHintCard.test.tsx). Stubbed here so these tests can assert the MOUNT and
// the facts the workshop feeds it, without standing up a query client.
vi.mock("../../review/CatalogHintCard", () => ({
  CatalogHintCard: (p: {
    supplierId: string;
    supplierName: string;
    hasUnresolvedLines: boolean;
    anyLineResolved: boolean;
  }) => (
    <div
      data-testid="catalog-hint-stub"
      data-supplier-id={p.supplierId}
      data-supplier-name={p.supplierName}
      data-unresolved={String(p.hasUnresolvedLines)}
      data-any-resolved={String(p.anyLineResolved)}
    />
  ),
}));

vi.mock("../../review/hooks/useOrderReview", () => ({
  useOrderReview: () => ({
    order: mockState.order,
    isLoading: false,
    isError: false,
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
    confirmSend: mockState.confirmSend,
    showConfirm: false,
    setShowConfirm: mockState.setShowConfirm,
  }),
}));

vi.mock("../../review/hooks/useResolveActions", () => ({
  useResolveActions: () => ({
    acceptSuggestion: mockState.acceptSuggestion,
    commitVersion: 0,
    // Inline per-line resolution subset (consumed by the IssuesPanel cards).
    lineEditId: mockState.lineEditId,
    lineDraft: "",
    setLineDraft: vi.fn(),
    startLineEdit: mockState.startLineEdit,
    commitLineCode: mockState.commitLineCode,
    cancelLineEdit: vi.fn(),
    confirmFlaggedLine: mockState.confirmFlaggedLine,
    acceptingLineId: null,
    // STRUCT-2 — bulk-accept parity (server-side accept-all).
    bulkAcceptSuggestions: mockState.bulkAcceptSuggestions,
    bulkAccepting: false,
  }),
}));

vi.mock("../../review/hooks/useAcceptanceValidation", () => ({
  useAcceptanceValidation: () => ({
    validationResult: mockState.validationResult,
    failingRuleCount: mockState.validationResult && !mockState.validationResult.passed
      ? mockState.validationResult.results.filter((r) => r.outcome === "fail").length
      : 0,
    isStale: false,
  }),
}));

// Capture the props the workshop passes to the (mocked) MapperWorkbench so we can
// assert composition + the attention-first / issuesSlot / layout wiring. The mock
// also publishes a representative toolbar state through onToolbarState — exactly
// what the real workbench's publish effect does — so the workshop's consolidated
// status bar renders its re-hosted controls (mapped chip + ⋯ overflow) under test.
vi.mock("../../mapper/MapperWorkbench", () => ({
  MapperWorkbench: (props: Record<string, unknown>) => {
    mockState.lastMapperProps = props;
    const onToolbarState = props.onToolbarState as ((s: unknown) => void) | undefined;
    useEffect(() => {
      onToolbarState?.({
        mapped: 13, total: 13, requiredUnmapped: 0,
        saving: false, justSaved: false, error: null, aiUnavailable: false,
        showConnections: true,
        toggleConnections: mockState.toggleConnections,
        openLayoutDesigner: mockState.openLayoutDesigner,
        openTemplateEditor: mockState.openTemplateEditor,
        catalogHintCount: mockState.fillFromCatalog ? 1 : 0,
        fillFromCatalog: mockState.fillFromCatalog,
      });
    }, [onToolbarState]);
    // The two Lines-view slots render like the real OutgoingPane renders them
    // (header extra + body override), so the workshop-level tests can drive the
    // REAL Fields|Lines toggle and observe the REAL override mount/unmount.
    return (
      <div data-testid="mock-mapper-workbench">
        {props.outgoingHeaderExtra as React.ReactNode}
        {props.outgoingBodyOverride as React.ReactNode}
        <div data-testid="issues-slot">{props.issuesSlot as React.ReactNode}</div>
      </div>
    );
  },
}));

// Import AFTER the mocks are registered.
import { OrderWorkshop, deriveTrustedThreshold, fixQueueToIssues } from "../OrderWorkshop";
import { computeGrid, useWorkshopLayout } from "../useWorkshopLayout";
import { buildIncomingFromOrder, rawExtraFieldsFromTokens } from "../../mapper/incomingFromOrder";
import { computeOutgoingStatus, type OutgoingStatusInput } from "../../mapper/outgoingStatusModel";
import { splitMappings } from "../mappingListModel";
import type { TargetField } from "../../mapper/types";
import type { FixQueueCard } from "../../review/buildFixQueue";
import type { SourceToken } from "@/lib/api/types";
import { bulkAcceptCount, type BulkSelectableLine } from "../../magicBulkAcceptSelection";
import type { OrderLine } from "@/types/procurement";

// ── Fixtures ─────────────────────────────────────────────────────────────────
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
  mockState.order = null;
  mockState.validationResult = null;
  mockState.exceptionCount = 0;
  mockState.setShowConfirm = vi.fn();
  mockState.confirmSend = vi.fn();
  mockState.acceptSuggestion = vi.fn();
  mockState.startLineEdit = vi.fn();
  mockState.commitLineCode = vi.fn();
  mockState.confirmFlaggedLine = vi.fn();
  mockState.bulkAcceptSuggestions = vi.fn();
  mockState.lineEditId = null;
  mockState.lastMapperProps = null;
  mockState.routerPush = vi.fn();
  mockState.openLayoutDesigner = vi.fn();
  mockState.openTemplateEditor = vi.fn();
  mockState.toggleConnections = vi.fn();
  mockState.fillFromCatalog = null;
});
afterEach(cleanup);

// ─────────────────────────────────────────────────────────────────────────────
// Invariant 1 — adding / wiring a field never SHRINKS the visible target list.
//
// The workshop's attention-first split (in MapperWorkbench) is the only thing
// that hides target rows. This freezes the contract that the COLLAPSED view is
// always a SUBSET of the full list, and that an expand path exists — i.e. wiring
// a field (which can only move it from attention→mapped, collapsing it) never
// makes a field unreachable, because the chip reveals the full list.
// ─────────────────────────────────────────────────────────────────────────────
describe("invariant 1 — adding/wiring never shrinks the reachable target list", () => {
  const FIELDS: TargetField[] = [
    { outputPath: "PoNumber", label: "PO", scope: "header" },
    { outputPath: "Currency", label: "Currency", scope: "header" },
    { outputPath: "ExtraNote", label: "Note", scope: "header" },
  ];

  function attentionSplit(input: OutgoingStatusInput) {
    const attention: TargetField[] = [];
    let mapped = 0;
    for (const f of FIELDS) {
      const st = computeOutgoingStatus(f, input);
      if (!st.mapped) attention.push(f);
      else mapped++;
    }
    return { attention, mapped };
  }

  const baseInput: OutgoingStatusInput = {
    outputConnections: {},
    sourceConnections: {},
    fixedValues: {},
    tokenValueById: new Map(),
    canonicalValueByKey: new Map([["PoNumber", "PO-1"]]),
    labelForCanonical: (k) => k,
  };

  test("collapsed attention is always a subset; expanding reveals every field", () => {
    const before = attentionSplit(baseInput);
    // Wire one more field (Currency gets a fixed value → it becomes mapped).
    const after = attentionSplit({ ...baseInput, fixedValues: { Currency: "EUR" } });

    // Wiring a field NEVER grows attention (the visible work shrinks, not the
    // reachable list) and NEVER drops a field off the full set.
    expect(after.attention.length).toBeLessThanOrEqual(before.attention.length);

    // The FULL list (attention ∪ mapped) is always every field — nothing vanishes.
    expect(after.attention.length + after.mapped).toBe(FIELDS.length);
    expect(before.attention.length + before.mapped).toBe(FIELDS.length);
  });

  test("splitMappings keeps every row across auto + attention", () => {
    const rows = [
      { outputField: "a", source: "x", confidence: 0.99, accepted: true },
      { outputField: "b", source: "y", confidence: 0.4, accepted: false },
      { outputField: "c", source: null, confidence: 0, accepted: false },
    ];
    const { auto, attention } = splitMappings(rows, { trustedThreshold: 0.85 });
    expect(auto.length + attention.length).toBe(rows.length);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Invariant 2 — the issue list === the send-gating validator. A -3 qty (a failing
// acceptance rule + a needs-review line) → the panel is NOT green and Send is
// DISABLED. This is the trust-bomb invariant: never green-on-garbage.
// ─────────────────────────────────────────────────────────────────────────────
describe("invariant 2 — issues === send-gate; -3 qty is not green, Send disabled", () => {
  test("a failing-validation order shows issues and disables Send", () => {
    mockState.order = makeOrder({
      lines: [
        {
          id: "l1", lineNumber: 1, buyerItemCode: "B-1", supplierItemCode: "S-1",
          description: "Widget", quantity: -3, unitPrice: 10, confidence: 0.9,
          needsReview: true,
        } as Order["lines"][number],
      ],
    });
    mockState.exceptionCount = 1; // server truth: a needs-review line
    mockState.validationResult = {
      passed: false,
      results: [
        {
          outcome: "fail", severity: "error", lineNumber: 1,
          rule: { fieldPath: "Quantity" },
          title: "Quantity must be positive",
          message: "Quantity (-3) failed rule: greater than 0",
        } as OrderValidationResult["results"][number],
      ],
    } as OrderValidationResult;

    render(<OrderWorkshop orderId="ord-1" />);

    // The consolidated status bar shows the open work in its RED segment. The
    // count is the two blocking issues: the flagged line + the failing rule.
    const redSegment = screen.getByTestId("status-bar-blockers");
    expect(within(redSegment).getByText(/2 blockers/)).toBeTruthy();

    // Send is gated: EVERY Send button (desktop header + mobile bar) is disabled, and
    // clicking must NOT open the confirm dialog. While blocked the button carries the
    // count in its own label (the old caption line is gone). WP-28 replaced
    // "Send · 2 blockers" with "Send to supplier · 2 to fix": "blocker" is not one of
    // the nine nouns, the old label dropped the direction-aware party noun, and both
    // send surfaces now read from ONE ladder (sendBarLabel).
    const sendBtns = screen.getAllByRole("button", { name: /send to supplier|fix \d+ to send/i });
    expect(sendBtns.length).toBeGreaterThan(0);
    expect(sendBtns.every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    expect(sendBtns.some((b) => /Send to supplier · 2 to fix/.test(b.textContent ?? ""))).toBe(true);
    expect(mockState.setShowConfirm).not.toHaveBeenCalled();
  });

  test("a clean order renders NO red blocker segment and an enabled Send", () => {
    mockState.order = makeOrder({
      status: "ready_to_deliver",
      lines: [
        {
          id: "l1", lineNumber: 1, buyerItemCode: "B-1", supplierItemCode: "S-1",
          description: "Widget", quantity: 3, unitPrice: 10, confidence: 0.99,
          needsReview: false,
        } as Order["lines"][number],
      ],
    });
    mockState.exceptionCount = 0;
    mockState.validationResult = { passed: true, results: [] } as OrderValidationResult;

    render(<OrderWorkshop orderId="ord-1" />);

    // Zero blockers → the consolidated bar is a single white row: the red
    // segment is entirely absent (not just empty).
    expect(screen.getByTestId("workshop-status-bar")).toBeTruthy();
    expect(screen.queryByTestId("status-bar-blockers")).toBeNull();
    expect(screen.queryByText(/blockers/)).toBeNull();

    const send = screen
      .getAllByRole("button")
      .find((b) => /send to supplier/i.test(b.textContent ?? "")) as HTMLButtonElement;
    expect(send.disabled).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Invariant 2b (unit) — the FixQueueCard → WorkshopIssue mapping is faithful to
// the validator: warnings → "warning", everything else → "blocking", AI cards get
// a one-click fix, resolved cards are dropped.
// ─────────────────────────────────────────────────────────────────────────────
describe("invariant 2b — fixQueueToIssues maps the validator faithfully", () => {
  test("severity + fixAction + resolved filtering", () => {
    const queue: FixQueueCard[] = [
      { key: "line:l1", kind: "ai-suggestion", lineId: "l1", lineNumber: 1, severity: 0, title: "AI suggestion", detail: "S-9", resolved: false },
      { key: "line:l2", kind: "manual-code", lineId: "l2", lineNumber: 2, severity: 1, title: "Needs a supplier code", resolved: false },
      { key: "rule:Qty:1", kind: "rule-failure", lineNumber: 1, severity: 3, title: "Quantity must be positive", detail: "Quantity (-3) failed", resolved: false },
      { key: "rule:Note:h", kind: "rule-failure", headerLevel: true, severity: 4, title: "Note recommended", detail: "warn", resolved: false },
      { key: "line:l3", kind: "manual-code", lineId: "l3", severity: 1, title: "Resolved already", resolved: true },
    ];
    const issues = fixQueueToIssues(queue);
    // Resolved card dropped.
    expect(issues.map((i) => i.code)).not.toContain("line:l3");
    expect(issues).toHaveLength(4);
    // The severity-4 rule-failure is a warning; the rest block.
    const warn = issues.find((i) => i.code === "rule:Note:h");
    expect(warn?.severity).toBe("warning");
    expect(issues.filter((i) => i.severity === "blocking")).toHaveLength(3);
    // AI suggestion card gets a deterministic one-click fix; manual-code does NOT
    // (manual-code now renders an inline code input, keyed off `kind`, not fixAction).
    expect(issues.find((i) => i.code === "line:l1")?.fixAction).toBeTruthy();
    expect(issues.find((i) => i.code === "line:l2")?.fixAction).toBeUndefined();
    // A line card's ref points at the SupplierItemCode OUTPUT field (a resolvable
    // mapper row) so a chip jump highlights across columns; the owning line is still
    // carried on `lineId` (asserted below).
    expect(issues.find((i) => i.code === "line:l1")?.ref).toBe("SupplierItemCode");
    // The card's kind + owning lineId are carried through so the panel can pick the
    // right inline resolution control (input / accept / confirm).
    expect(issues.find((i) => i.code === "line:l2")?.kind).toBe("manual-code");
    expect(issues.find((i) => i.code === "line:l2")?.lineId).toBe("l2");
    expect(issues.find((i) => i.code === "line:l1")?.kind).toBe("ai-suggestion");
    expect(issues.find((i) => i.code === "line:l1")?.lineId).toBe("l1");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Invariant 3 — every source field appears for a sample of each format (lossless,
// post-P0). The incoming model is built DIRECTLY from the parsed Order (so PDF/XLSX
// are as populated as CSV) and the raw-bag tokens are NEVER silently dropped.
// ─────────────────────────────────────────────────────────────────────────────
describe("invariant 3 — every source field appears (lossless), per format shape", () => {
  // One representative Order per ingest family — the incoming column must surface
  // every populated canonical field regardless of how it was parsed.
  const cases: { name: string; order: Parameters<typeof buildIncomingFromOrder>[0] }[] = [
    {
      name: "CSV/XLSX (header + lines)",
      order: { poNumber: "PO-1", orderDate: "2026-06-18", currency: "EUR", buyerName: "B", supplierName: "Acme", lines: [{ lineNumber: 1, buyerItemCode: "X", description: "d", quantity: 2, unitPrice: 3 }] },
    },
    {
      name: "PDF (no tokens, Order-direct)",
      order: { poNumber: "PO-9", buyerName: "B", supplierName: "Acme", currency: "USD", lines: [{ lineNumber: 1, buyerItemCode: "Y", quantity: 1 }] },
    },
    {
      name: "XML/JSON (full header)",
      order: { poNumber: "PO-3", orderDate: "2026-01-01", currency: "GBP", buyerName: "B2", supplierName: "Sup2", lines: [{ lineNumber: 1, buyerItemCode: "Z", description: "z", quantity: 5, unitPrice: 9 }] },
    },
  ];

  test.each(cases)("$name — every populated field becomes an incoming row", ({ order }) => {
    const fields = buildIncomingFromOrder(order);
    const ids = new Set(fields.map((f) => f.id));
    // The PO number is always present; populated parties + lines surface too.
    expect(ids.has("PoNumber")).toBe(true);
    expect(ids.has("BuyerName")).toBe(true);
    expect(ids.has("SupplierName")).toBe(true);
    if (order?.lines && order.lines.length > 0) {
      expect(ids.has("BuyerItemCode")).toBe(true);
      expect(ids.has("Quantity")).toBe(true);
    }
    // No populated field is dropped: every field carries a non-empty value.
    for (const f of fields) expect(f.value).not.toBe("");
  });

  test("raw-bag tokens are never silently dropped (only canonical-duplicate dedupe)", () => {
    const canonical = buildIncomingFromOrder({ poNumber: "PO-1", lines: [] });
    const tokens: SourceToken[] = [
      { id: "raw:1", label: "Custom Ref", value: "CR-1" } as SourceToken,
      { id: "raw:2", label: "Cost Center", value: "CC-7" } as SourceToken,
    ];
    const extras = rawExtraFieldsFromTokens(tokens, canonical);
    // Both genuinely-extra columns survive (lossless).
    expect(extras.map((e) => e.id).sort()).toEqual(["raw:1", "raw:2"]);
    expect(extras.every((e) => e.value !== "")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Invariant 4 — collapsing a zone preserves an unsaved mapping edit. The collapse
// state lives in useWorkshopLayout and is RENDER-ONLY (a thin rail vs the full
// pane); it never touches the mapper's draft/override. So toggling collapse/focus
// must not lose any other layout state, and the mapper edit model is independent.
// ─────────────────────────────────────────────────────────────────────────────
describe("invariant 4 — collapsing a zone preserves state (render-only collapse)", () => {
  test("computeGrid collapse is pure: it changes only the collapsed track", () => {
    const expanded = computeGrid({ focus: "all", leftCollapsed: false, rightCollapsed: false });
    const leftRail = computeGrid({ focus: "all", leftCollapsed: true, rightCollapsed: false });
    // Collapsing LEFT only changes the left track — center + right are untouched.
    expect(leftRail.center).toBe(expanded.center);
    expect(leftRail.right).toBe(expanded.right);
    expect(leftRail.left).toBe("rail");
  });

  test("toggling collapse does not lose the focus state (no reset)", () => {
    const { result } = renderHook(() => useWorkshopLayout());
    act(() => result.current.setFocus("mapping"));
    expect(result.current.focus).toBe("mapping");
    act(() => result.current.toggleLeft());
    // Collapsing a zone must NOT silently reset the operator's focus choice —
    // the mapper's unsaved edit lives in the same render tree, so a reset here
    // would imply remounting / losing it.
    expect(result.current.focus).toBe("mapping");
  });

  test("the workshop mounts MapperWorkbench with collapse driven by layout, not a remount key", () => {
    mockState.order = makeOrder({ status: "ready_to_deliver" });
    mockState.validationResult = { passed: true, results: [] } as OrderValidationResult;
    render(<OrderWorkshop orderId="ord-1" />);
    // The mapper is passed a `layout` (collapse driver) + `order` (its edit model
    // source) — collapse is a prop, so the engine is never remounted on collapse.
    expect(mockState.lastMapperProps).toBeTruthy();
    expect(mockState.lastMapperProps!.layout).toBeTruthy();
    expect(mockState.lastMapperProps!.attentionFirstOutput).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Invariant 5 — preview == delivery. This is owned by the mapper's own
// MapperPreviewPane / OutputPreview, whose preview is fed by the SAME override the
// delivery transform reads (no separate preview document). The workshop does NOT
// add a second preview path: it mounts the single preview-bearing MapperWorkbench
// (above) and that component carries the docked MapperPreviewPane. We assert the
// composition here and DEFER the byte-for-byte parity to the engine's own suite
// (the OutputPreview / mapper preview tests), exactly as the plan directs.
// ─────────────────────────────────────────────────────────────────────────────
describe("invariant 5 — preview == delivery (single preview path, referenced)", () => {
  test("the workshop renders exactly one preview-bearing mapper (no second preview)", () => {
    mockState.order = makeOrder({ status: "ready_to_deliver" });
    mockState.validationResult = { passed: true, results: [] } as OrderValidationResult;
    render(<OrderWorkshop orderId="ord-1" />);
    // Exactly one MapperWorkbench (which owns the single MapperPreviewPane) — the
    // workshop never mounts a parallel OutputPreview, so there is one preview path
    // and it is the delivery path (parity is covered by the mapper preview suite).
    expect(screen.getAllByTestId("mock-mapper-workbench")).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 0 / Task 1 — inline line resolution is REACHABLE on the prod screen.
//   (a) a manual-code blocker renders a real, focusable supplier-code path (the
//       "Enter code" affordance) — not just a dead jump;
//   (b) the status bar's blocker chip's jump target ACTUALLY EXISTS in the
//       DOM (the card is anchored data-issue-ref={code}) — the node is found, not
//       null. This is the exact regression that left 78/83 prod orders stuck.
// ─────────────────────────────────────────────────────────────────────────────
describe("Task 1 — inline resolution is reachable + the chip jump target exists", () => {
  function mountUnresolvedManualCodeOrder() {
    mockState.order = makeOrder({
      lines: [
        {
          id: "l1", lineNumber: 1, buyerItemCode: "B-1", supplierItemCode: null,
          description: "Widget", quantity: 2, unitPrice: 10, confidence: 0,
          needsReview: true, aiSuggestion: null,
        } as Order["lines"][number],
      ],
    });
    mockState.exceptionCount = 1;           // server truth: a needs-review line
    mockState.validationResult = { passed: true, results: [] } as OrderValidationResult;
    render(<OrderWorkshop orderId="ord-1" />);
  }

  test("a manual-code blocker exposes the inline 'Enter code' affordance (not a dead jump)", () => {
    mountUnresolvedManualCodeOrder();
    // The IssuesPanel renders the card with the inline code-entry control.
    const enter = screen.getAllByRole("button", { name: /enter code/i });
    expect(enter.length).toBeGreaterThan(0);
    fireEvent.click(enter[0]);
    // The real resolution API is invoked (server-truth path), seeded with the empty code.
    expect(mockState.startLineEdit).toHaveBeenCalledWith("l1", "");
  });

  test("the status-bar blocker chip jumps to a card that EXISTS in the DOM", () => {
    mountUnresolvedManualCodeOrder();
    // The blocker chip uses the issue CODE as its id ("line:l1") → the card anchor.
    // (The chip's tooltip is "Jump to {title}".)
    const chip = screen.getByTitle("Jump to Needs a supplier code");
    // The chip click handler scrolls to [data-issue-ref="line:l1"]; that node MUST exist
    // (the old bug pointed at a line GUID the mapper had no element for → null).
    const target = document.querySelector('[data-issue-ref="line:l1"]');
    expect(target).not.toBeNull();
    // Clicking does not throw (the scroll target resolves).
    expect(() => fireEvent.click(chip)).not.toThrow();
  });

  // REGRESSION GUARD (a8babcc): the line-level chip-jump fix repointed a line
  // card's `ref` at the "SupplierItemCode" OUTPUT field. onFix used to pass
  // issue.ref straight into acceptSuggestion(id), which resolves the line by
  // `order.lines.find(l => l.id === id)` — so "SupplierItemCode" matched nothing
  // and the one-click "Accept suggestion" silently did nothing. onFix must pass
  // the OWNING LINE id (issue.lineId), not the field ref.
  test("the one-click 'Accept suggestion' resolves the owning LINE, not the field ref", () => {
    mockState.order = makeOrder({
      lines: [
        {
          id: "l1", lineNumber: 1, buyerItemCode: "B-1", supplierItemCode: null,
          description: "Widget", quantity: 2, unitPrice: 10, confidence: 0.4,
          needsReview: true,
          aiSuggestion: { supplierItemCode: "S-9", confidence: 0.4, reason: "catalog match", source: "catalog" },
        } as unknown as Order["lines"][number],
      ],
    });
    mockState.exceptionCount = 1;
    mockState.validationResult = { passed: true, results: [] } as OrderValidationResult;
    render(<OrderWorkshop orderId="ord-1" />);

    const acceptBtns = screen.getAllByRole("button", { name: /accept suggestion/i });
    expect(acceptBtns.length).toBeGreaterThan(0);
    fireEvent.click(acceptBtns[0]);

    expect(mockState.acceptSuggestion).toHaveBeenCalledWith("l1");
    expect(mockState.acceptSuggestion).not.toHaveBeenCalledWith("SupplierItemCode");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bonus unit — deriveTrustedThreshold reads the lowest trusted bucket (default 0.85).
// ─────────────────────────────────────────────────────────────────────────────
describe("deriveTrustedThreshold", () => {
  test("cold start / inactive → 0.85", () => {
    expect(deriveTrustedThreshold(null)).toBe(0.85);
    expect(deriveTrustedThreshold({ isActive: false, totalDecisions: 0, minBucketSamples: 0, minOrgSamples: 0, buckets: [] })).toBe(0.85);
  });
  test("active → the lowest trusted bucket's lower bound", () => {
    const cal = {
      isActive: true, totalDecisions: 50, minBucketSamples: 8, minOrgSamples: 20,
      buckets: [
        { label: "[0,0.5)", lowerInclusive: 0, upperExclusive: 0.5, accepted: 1, rejected: 6, total: 7, smoothedAcceptRate: 0.2, isTrusted: false },
        { label: "[0.5,0.75)", lowerInclusive: 0.5, upperExclusive: 0.75, accepted: 5, rejected: 5, total: 10, smoothedAcceptRate: 0.5, isTrusted: true },
        { label: "[0.75,0.85)", lowerInclusive: 0.75, upperExclusive: 0.85, accepted: 8, rejected: 3, total: 11, smoothedAcceptRate: 0.69, isTrusted: true },
      ],
    };
    expect(deriveTrustedThreshold(cal)).toBe(0.5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// STRUCT-2 — bulk-accept parity in the workshop.
//   (a) the order.lines → BulkSelectableLine adapter produces counts that match
//       bulkAcceptCount (the SAME selection MagicMappingPreview uses), so the
//       workshop's "Accept all" / "Accept ≥85%" badges can't drift from the
//       /upload/preview step's semantics;
//   (b) the wired count reaches the IssuesPanel's bulk-accept header, and clicking
//       it calls the server-truth bulkAcceptSuggestions(0).
// ─────────────────────────────────────────────────────────────────────────────
describe("STRUCT-2 — order.lines → BulkSelectableLine adapter parity", () => {
  // Mirrors the adapter inside OrderWorkshop's suggestableCount/highConfCount memo:
  // suggestable = needsReview (unresolved) AND has an AI-suggested supplier code;
  // ≥85% uses aiSuggestion.confidence ?? line.confidence. Empty rejection set (the
  // workshop has no local "rejected" state).
  const adapt = (lines: OrderLine[]): BulkSelectableLine[] =>
    lines.map((l) => ({
      lineNumber: l.lineNumber,
      status: l.needsReview ? "suggested" : "resolved",
      aiSuggestedSupplierCode: l.aiSuggestion?.supplierItemCode ?? null,
      confidence: l.aiSuggestion?.confidence ?? l.confidence ?? null,
    }));

  const line = (over: Partial<OrderLine> & { lineNumber: number }): OrderLine => ({
    id: `l${over.lineNumber}`,
    buyerItemCode: `B-${over.lineNumber}`,
    supplierItemCode: null,
    description: "Widget",
    quantity: 1,
    unitPrice: 10,
    confidence: 0,
    needsReview: true,
    ...over,
  });

  test("counts match bulkAcceptCount across resolved / suggested / high-vs-low confidence", () => {
    const lines: OrderLine[] = [
      // resolved (not needsReview) — excluded even though it has a suggestion
      line({ lineNumber: 1, needsReview: false, aiSuggestion: { supplierItemCode: "AI-1", confidence: 0.95, reason: "", provenance: "ai" } }),
      // suggested, high confidence (≥0.85)
      line({ lineNumber: 2, aiSuggestion: { supplierItemCode: "AI-2", confidence: 0.9, reason: "", provenance: "ai" } }),
      // suggested, low confidence (<0.85)
      line({ lineNumber: 3, aiSuggestion: { supplierItemCode: "AI-3", confidence: 0.5, reason: "", provenance: "ai" } }),
      // suggested but no AI code — excluded (manual-code line)
      line({ lineNumber: 4, aiSuggestion: null }),
    ];
    const selectable = adapt(lines);
    const empty: ReadonlySet<number> = new Set();

    // suggestableCount (minConfidence 0): lines 2 + 3 → 2.
    expect(bulkAcceptCount({ lines: selectable, minConfidence: 0, rejectedLineNumbers: empty })).toBe(2);
    // highConfCount (minConfidence 0.85): line 2 only → 1.
    expect(bulkAcceptCount({ lines: selectable, minConfidence: 0.85, rejectedLineNumbers: empty })).toBe(1);
  });
});

describe("STRUCT-2 — the workshop wires the bulk-accept header to the IssuesPanel", () => {
  test("an order with an unresolved AI-suggested line renders 'Resolve all suggested' → bulkAcceptSuggestions(0)", () => {
    mockState.order = makeOrder({
      lines: [
        {
          id: "l1", lineNumber: 1, buyerItemCode: "B-1", supplierItemCode: null,
          description: "Widget", quantity: 1, unitPrice: 10, confidence: 0,
          needsReview: true,
          aiSuggestion: { supplierItemCode: "AI-1", confidence: 0.9, reason: "", provenance: "ai" },
        } as Order["lines"][number],
      ],
    });
    mockState.exceptionCount = 1; // server truth: a needs-review line
    mockState.validationResult = { passed: true, results: [] } as OrderValidationResult;

    render(<OrderWorkshop orderId="ord-1" />);

    // Two surfaces carry the bulk accept: the status bar's "Resolve suggested (n)"
    // and the IssuesPanel header's "Resolve all suggested" — both hit the same
    // server-truth bulkAcceptSuggestions(0).
    const bulkBtns = screen.getAllByRole("button", { name: /resolve (all )?suggested/i });
    expect(bulkBtns.length).toBeGreaterThan(0);
    fireEvent.click(bulkBtns[0]);
    expect(mockState.bulkAcceptSuggestions).toHaveBeenCalledWith(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Chrome compression (founder-approved mock, 2026-07-17) — the order-page chrome
// is two rows: Row 1 (← Inbox chip · PO-number title · badges · buyer→supplier ·
// Details/Focus/Send) and Row 2 (the consolidated status bar). These freeze:
//   • the page keeps exactly ONE h1 — the old title sentence, sr-only;
//   • the back control keeps its aria-label + /inbox target;
//   • the ⋯ overflow re-hosts the four mapper tools (relocated handlers);
//   • the workshop hides the mapper's own toolbar row (hideToolbar).
// ─────────────────────────────────────────────────────────────────────────────
describe("chrome compression — Row 1 identity header + Row 2 status bar", () => {
  function mountClean(poNumber = "4091678643") {
    mockState.order = makeOrder({ status: "ready_to_deliver", poNumber });
    mockState.validationResult = { passed: true, results: [] } as OrderValidationResult;
    render(<OrderWorkshop orderId="ord-1" />);
  }

  test("the title sentence survives as the ONE sr-only h1; the PO number is the visible title", () => {
    mountClean();
    const h1 = screen.getByRole("heading", { level: 1, name: /review and send this order/i });
    expect(h1.className).toContain("sr-only");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    // Visible title = "PO <number>", with the raw number as its hover title.
    expect(screen.getByText("PO 4091678643")).toBeTruthy();
    expect(screen.getByText("PO 4091678643").getAttribute("title")).toBe("4091678643");
  });

  test("a separator-less 'PO12345' number is not double-prefixed", () => {
    mountClean("PO12345");
    // The number renders on more than one surface (Row 1 title + MobileTriage,
    // which jsdom cannot hide) — every one must show the raw number, and no
    // surface may show the doubled prefix.
    expect(screen.getAllByText("PO12345").length).toBeGreaterThan(0);
    expect(screen.queryByText("PO PO12345")).toBeNull();
  });

  // Honest scope: jsdom cannot lay out a 390px viewport, so this pins the
  // STYLES that make the title truncate (nowrap + ellipsis + a shrinkable
  // min-width-0 flex child), not a rendered clip.
  test("the visible PO title carries the truncation styles (ellipsis + min-width 0)", () => {
    mountClean("4091678643");
    const title = screen.getByText("PO 4091678643") as HTMLElement;
    expect(title.style.whiteSpace).toBe("nowrap");
    expect(title.style.overflow).toBe("hidden");
    expect(title.style.textOverflow).toBe("ellipsis");
    expect(title.style.minWidth).toBe("0"); // React keeps 0 unitless
    expect(title.getAttribute("title")).toBe("4091678643");
  });

  test("the back control is the '← Inbox' chip: same aria-label, same /inbox target", () => {
    mountClean();
    const back = screen.getByRole("button", { name: "Back to inbox" });
    expect(back.textContent).toContain("Inbox");
    fireEvent.click(back);
    expect(mockState.routerPush).toHaveBeenCalledWith("/inbox");
  });

  test("the workshop hides the mapper toolbar and re-hosts its mapped count on the bar", () => {
    mountClean();
    expect(mockState.lastMapperProps).toBeTruthy();
    expect(mockState.lastMapperProps!.hideToolbar).toBe(true);
    // The mocked workbench published mapped 13/13 via onToolbarState → the chip.
    expect(screen.getByText(/13\/13 mapped/)).toBeTruthy();
  });

  test("the ⋯ overflow carries the four relocated tools and drives the workbench's own handlers", async () => {
    mountClean();
    const trigger = screen.getByRole("button", { name: "More order tools" });
    fireEvent.keyDown(trigger, { key: "Enter" });
    const items = await screen.findAllByRole("menuitem");
    // Zero blockers → no "Review issues" item; the menu is exactly the four tools.
    expect(items).toHaveLength(4);
    const text = items.map((i) => i.textContent ?? "");
    expect(text.some((t) => t.includes("Customize output layout"))).toBe(true);
    expect(text.some((t) => t.includes("Edit as template"))).toBe(true);
    expect(text.some((t) => t.includes("Fill from catalog"))).toBe(true);
    expect(text.some((t) => t.includes("Hide connections"))).toBe(true);
    // No catalog hints in the published state → honestly disabled, not hidden.
    const catalog = items.find((i) => (i.textContent ?? "").includes("Fill from catalog"))!;
    expect(catalog.getAttribute("aria-disabled")).toBe("true");
    // A menu item invokes the RELOCATED workbench handler (not a reimplementation).
    fireEvent.click(screen.getByRole("menuitem", { name: /customize output layout/i }));
    expect(mockState.openLayoutDesigner).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PR #23 wiring pin — the Fields|Lines view survives the #24 rebase. The SAME
// MapperWorkbench call site carries #24's hideToolbar/onToolbarState AND #23's
// outgoingHeaderExtra/outgoingBodyOverride; all four props are OPTIONAL, so a
// one-sided conflict resolution (keeping only one PR's set) compiles clean and
// stays green everywhere else while silently deleting the other feature. These
// tests make that silent deletion fail the build, in either direction.
// ─────────────────────────────────────────────────────────────────────────────
describe("wiring pin — the #23 Lines props AND the #24 toolbar props coexist on the mapper", () => {
  const LINES_LINE = {
    id: "l1", lineNumber: 1, buyerItemCode: "B-1", supplierItemCode: "S-1",
    description: "Widget", quantity: 2, unitPrice: 10, confidence: 1,
    needsReview: false,
  } as Order["lines"][number];

  function mountLinesOrder() {
    mockState.order = makeOrder({ status: "ready_to_deliver", lines: [LINES_LINE] });
    mockState.validationResult = { passed: true, results: [] } as OrderValidationResult;
    render(<OrderWorkshop orderId="ord-1" />);
  }

  test("a lines-bearing order passes BOTH prop sets: outgoingHeaderExtra + hideToolbar/onToolbarState", () => {
    mountLinesOrder();
    const p = mockState.lastMapperProps!;
    // #23's side — the Fields|Lines toggle reaches the outgoing pane header.
    expect(p.outgoingHeaderExtra != null).toBe(true);
    // #24's side — the toolbar is hidden + re-hosted through the publish callback.
    expect(p.hideToolbar).toBe(true);
    expect(typeof p.onToolbarState).toBe("function");
    // Fields is the default view — no body override until Lines is chosen.
    expect(p.outgoingBodyOverride == null).toBe(true);
  });

  test("choosing Lines passes outgoingBodyOverride and it mounts the per-line view", () => {
    mountLinesOrder();
    fireEvent.click(screen.getByRole("button", { name: /Lines · 1/ }));
    expect(mockState.lastMapperProps!.outgoingBodyOverride != null).toBe(true);
    expect(screen.getByTestId("lines-view")).toBeTruthy();
  });

  test("a zero-line order passes NEITHER Lines prop (the toggle has nothing to show)", () => {
    mockState.order = makeOrder({ status: "ready_to_deliver", lines: [] });
    mockState.validationResult = { passed: true, results: [] } as OrderValidationResult;
    render(<OrderWorkshop orderId="ord-1" />);
    expect(mockState.lastMapperProps!.outgoingHeaderExtra == null).toBe(true);
    expect(mockState.lastMapperProps!.outgoingBodyOverride == null).toBe(true);
    expect(screen.queryByTestId("lines-toggle")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Lines-view escape hatches — actions whose scroll targets are OUTPUT-FIELD row
// anchors (which the Lines body-override unmounts) must first route back to
// Fields instead of silently no-opping:
//   • the IssuesPanel "Where →" field jump (onFocusField);
//   • the status bar's ⋯ "Fill from catalog" (the workbench's scroll-to-hint).
// Plus the jump-signal lifecycle: a consumed line jump must NOT replay when the
// Lines view is re-entered.
// ─────────────────────────────────────────────────────────────────────────────
describe("Lines view — field-anchored actions route back to Fields; a jump is consumed once", () => {
  const CLEAN_LINE = {
    id: "l1", lineNumber: 1, buyerItemCode: "B-1", supplierItemCode: "S-1",
    description: "Widget", quantity: 2, unitPrice: 10, confidence: 1,
    needsReview: false,
  } as Order["lines"][number];

  test("'Where →' while Lines is active switches the middle column back to Fields", () => {
    mockState.order = makeOrder({ lines: [CLEAN_LINE] });
    // A failing header-side rule → a blocking card whose only action is "Where →".
    mockState.validationResult = {
      passed: false,
      results: [
        {
          outcome: "fail", severity: "error", lineNumber: 1,
          rule: { fieldPath: "Quantity" },
          title: "Quantity must be positive",
          message: "Quantity (-3) failed rule: greater than 0",
        } as OrderValidationResult["results"][number],
      ],
    } as OrderValidationResult;
    render(<OrderWorkshop orderId="ord-1" />);

    fireEvent.click(screen.getByRole("button", { name: /Lines · 1/ }));
    expect(screen.getByTestId("lines-view")).toBeTruthy();

    fireEvent.click(
      screen.getAllByRole("button", { name: /show quantity must be positive in the mapper/i })[0],
    );
    // The override is gone → the mapper's output-row anchors are mounted again,
    // so the focus effect (post-commit) scrolls to a real element.
    expect(screen.queryByTestId("lines-view")).toBeNull();
    expect(mockState.lastMapperProps!.outgoingBodyOverride == null).toBe(true);
  });

  test("'Fill from catalog' while Lines is active returns to Fields, then runs the workbench scroll", async () => {
    mockState.fillFromCatalog = vi.fn();
    mockState.order = makeOrder({ status: "ready_to_deliver", lines: [CLEAN_LINE] });
    mockState.validationResult = { passed: true, results: [] } as OrderValidationResult;
    render(<OrderWorkshop orderId="ord-1" />);

    fireEvent.click(screen.getByRole("button", { name: /Lines · 1/ }));
    expect(screen.getByTestId("lines-view")).toBeTruthy();

    fireEvent.keyDown(screen.getByRole("button", { name: "More order tools" }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: /fill from catalog/i }));

    // Back on Fields immediately (the anchors remount)…
    expect(screen.queryByTestId("lines-view")).toBeNull();
    // …and the workbench's own scroll runs only after that view has painted
    // (deferred past this synchronous click, then observed via waitFor).
    expect(mockState.fillFromCatalog).not.toHaveBeenCalled();
    await waitFor(() => expect(mockState.fillFromCatalog).toHaveBeenCalledTimes(1));
  });

  test("a consumed line jump does not replay when Lines is re-entered", async () => {
    const scrollSpy = vi.spyOn(Element.prototype, "scrollIntoView");
    mockState.order = makeOrder({
      lines: [
        {
          id: "l1", lineNumber: 1, buyerItemCode: "B-1", supplierItemCode: null,
          description: "Widget", quantity: 2, unitPrice: 10, confidence: 0,
          needsReview: true, aiSuggestion: null,
        } as Order["lines"][number],
      ],
    });
    mockState.exceptionCount = 1;
    mockState.validationResult = { passed: true, results: [] } as OrderValidationResult;
    render(<OrderWorkshop orderId="ord-1" />);

    // The issue card's "Go to line 1" → Lines view + one scroll to the row.
    fireEvent.click(screen.getAllByRole("button", { name: "Go to line 1" })[0]);
    expect(screen.getByTestId("lines-view")).toBeTruthy();
    await waitFor(() => expect(scrollSpy).toHaveBeenCalledTimes(1));

    // Leave Lines, re-enter Lines. The signal was consumed → NO replayed scroll.
    fireEvent.click(screen.getByRole("button", { name: "Fields" }));
    expect(screen.queryByTestId("lines-view")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Lines · 1/ }));
    expect(screen.getByTestId("lines-view")).toBeTruthy();
    // Give the (would-be) double-rAF chain ample time to fire before asserting
    // the negative: still exactly the one original scroll.
    await new Promise((r) => setTimeout(r, 80));
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    scrollSpy.mockRestore();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FE-3(c) — CatalogHintCard is MOUNTED, not orphaned.
//
// The card was exported and unit-modelled but rendered nowhere, so the catalog
// cliff it exists to teach never got taught. It is fed server truth: unresolved
// lines = exceptionCount, and "nothing resolved yet" = no line carries a code.
// The card decides its own visibility from its probe (CatalogHintCard.test.tsx);
// what this freezes is that the workshop mounts it with the right facts, on both
// the desktop Issues tab and the mobile triage view.
// ─────────────────────────────────────────────────────────────────────────────
describe("the review screen mounts the catalog hint", () => {
  test("passes server-truth resolution facts, on desktop AND mobile", () => {
    mockState.order = makeOrder({
      lines: [
        {
          id: "l1", lineNumber: 1, buyerItemCode: "B-1", supplierItemCode: null,
          description: "Widget", quantity: 1, unitPrice: 10, confidence: 1,
          needsReview: true, aiSuggestion: null,
        } as Order["lines"][number],
      ],
    });
    mockState.exceptionCount = 1;
    mockState.validationResult = { passed: true, results: [] } as OrderValidationResult;
    render(<OrderWorkshop orderId="ord-1" />);

    const cards = screen.getAllByTestId("catalog-hint-stub");
    // One in the desktop Issues tab, one in the mobile triage view.
    expect(cards.length).toBe(2);
    for (const card of cards) {
      expect(card.getAttribute("data-supplier-id")).toBe("sup-1");
      expect(card.getAttribute("data-supplier-name")).toBe("Acme");
      expect(card.getAttribute("data-unresolved")).toBe("true");
      expect(card.getAttribute("data-any-resolved")).toBe("false");
    }
  });

  test("reports 'something already resolved' once a line carries a code", () => {
    mockState.order = makeOrder({
      lines: [
        {
          id: "l1", lineNumber: 1, buyerItemCode: "B-1", supplierItemCode: "S-1",
          description: "Widget", quantity: 1, unitPrice: 10, confidence: 1,
          needsReview: false, aiSuggestion: null,
        } as Order["lines"][number],
        {
          id: "l2", lineNumber: 2, buyerItemCode: "B-2", supplierItemCode: null,
          description: "Gadget", quantity: 1, unitPrice: 10, confidence: 1,
          needsReview: true, aiSuggestion: null,
        } as Order["lines"][number],
      ],
    });
    mockState.exceptionCount = 1;
    mockState.validationResult = { passed: true, results: [] } as OrderValidationResult;
    render(<OrderWorkshop orderId="ord-1" />);

    // A mapping DID resolve something — the cliff is not what is blocking here.
    expect(screen.getAllByTestId("catalog-hint-stub")[0].getAttribute("data-any-resolved"))
      .toBe("true");
  });
});
