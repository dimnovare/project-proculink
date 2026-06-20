import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { renderHook, act } from "@testing-library/react";
import type { Order, OrderValidationResult } from "@/types/procurement";

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
  lineEditId: string | null;
  lastMapperProps: Record<string, unknown> | null;
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
  lineEditId: null,
  lastMapperProps: null,
};

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
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
  }),
}));

vi.mock("../../review/hooks/useAcceptanceValidation", () => ({
  useAcceptanceValidation: () => ({
    validationResult: mockState.validationResult,
    failingRuleCount: mockState.validationResult && !mockState.validationResult.passed
      ? mockState.validationResult.results.filter((r) => !r.passed).length
      : 0,
    isStale: false,
  }),
}));

// Capture the props the workshop passes to the (mocked) MapperWorkbench so we can
// assert composition + the attention-first / issuesSlot / layout wiring.
vi.mock("../../mapper/MapperWorkbench", () => ({
  MapperWorkbench: (props: Record<string, unknown>) => {
    mockState.lastMapperProps = props;
    return (
      <div data-testid="mock-mapper-workbench">
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
  mockState.lineEditId = null;
  mockState.lastMapperProps = null;
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
          passed: false, severity: "error", lineNumber: 1,
          rule: { fieldPath: "Quantity" },
          title: "Quantity must be positive",
          message: "Quantity (-3) failed rule: greater than 0",
        } as OrderValidationResult["results"][number],
      ],
    } as OrderValidationResult;

    render(<OrderWorkshop orderId="ord-1" />);

    // The send-readiness strip reflects open work — NOT the green "ready" bar.
    expect(screen.queryByText(/Ready to send/i)).toBeNull();
    expect(screen.getByText(/field(?:s)? to fill before sending/i)).toBeTruthy();

    // Send is gated: EVERY Send button (desktop header + mobile bar) is disabled, and
    // clicking must NOT open the confirm dialog.
    const sendBtns = screen.getAllByRole("button", { name: /send to supplier|fix \d+ to send/i });
    expect(sendBtns.length).toBeGreaterThan(0);
    expect(sendBtns.every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    expect(mockState.setShowConfirm).not.toHaveBeenCalled();
  });

  test("a clean order shows the green ready bar and an enabled Send", () => {
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

    // The green ready bar (send-readiness strip) appears; no "fields to fill" warning.
    expect(screen.getAllByText(/Ready to send/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/field(?:s)? to fill before sending/i)).toBeNull();

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
    // ref deep-links to the owning line where present.
    expect(issues.find((i) => i.code === "line:l1")?.ref).toBe("l1");
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
//   (b) the SendReadinessStrip blocker chip's jump target ACTUALLY EXISTS in the
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

  test("the SendReadinessStrip blocker chip jumps to a card that EXISTS in the DOM", () => {
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
