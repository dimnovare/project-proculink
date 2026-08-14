import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { Order } from "@/types/procurement";
import type { AcceptanceGateDecision } from "@/lib/api/types";

// ─────────────────────────────────────────────────────────────────────────────
// P0-B (audit 2026-08-13 v3, finding 2) — "No open issues — every required field
// is filled and checked." rendered over a check that never ran.
//
// THE DEFECT, verbatim. `IssuesPanel.tsx` read
//     {readyLabel ?? "No open issues — every required field is filled and checked."}
// (the fallback is now `READY_BAR_DEFAULT`, which carries no such claim)
// and `readyLabel` had NO PRODUCER anywhere in `src/`, so only the default ever
// rendered. "and checked" names a check; the only rule-level check this screen can
// run is `POST /api/orders/{id}/validate`, which has no caller in `src/` — the
// hook's own comment concedes it at `OrderWorkshop.tsx:434`. `validationResult` is
// therefore permanently null and `buildFixQueue`'s rule branch is unreachable.
//
// The second leg is the contradiction an operator actually meets: an order whose
// blockers were OVERRIDDEN is `blocked:false` with a NON-EMPTY `blockers` list
// (AcceptanceGate.cs:62-77), so `acceptanceIssues` returns [] and this bar goes
// green — while the send control beside it reads "Send · N optional" about those
// very rules.
//
// WHY A RENDER TEST AND NOT ONLY A MODEL TEST. The bug was never that the sentence
// could not be computed; it was that the prop had no producer. A test of
// `readyBarLabel` alone would pass with `readyLabel` still unpassed at the call
// site — which is the exact state that shipped. So this mounts OrderWorkshop and
// reads the DOM.
//
// The harness mirrors validationEveryBreakpoint.test.tsx: MapperWorkbench is
// stubbed to render ONLY its issuesSlot, so what is asserted below is the real
// IssuesPanel receiving whatever OrderWorkshop actually passes it.
// ─────────────────────────────────────────────────────────────────────────────

const OLD_CLAIM = "No open issues — every required field is filled and checked.";

const mockState: { order: Order | null; gate: AcceptanceGateDecision } = {
  order: null,
  gate: undefined as unknown as AcceptanceGateDecision,
};

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

/** A clean order — nothing local can be producing an issue. */
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

/**
 * The state the audit named: `blocked:false` because an operator overrode it, with
 * the blockers STILL LISTED. `acceptanceIssues` returns [] here — correctly, since
 * re-imposing them would refuse a send the server allows — so the green bar renders.
 */
const OVERRIDDEN: AcceptanceGateDecision = {
  blocked: false,
  reason: "Acme will refuse this order.",
  overridden: true,
  overriddenBy: "user_1",
  overrideReason: "Agreed by phone with the supplier.",
  blockers: [
    { code: "unitPrice.atMost", lineNumber: 1, message: "Unit price above the agreed ceiling" },
    { code: "leadTimeDays.atMost", lineNumber: null, message: "Lead time above the agreed maximum" },
  ],
};

async function renderWorkshop(gate: AcceptanceGateDecision): Promise<HTMLElement> {
  mockState.order = cleanOrder();
  mockState.gate = gate;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <OrderWorkshop orderId="ord-1" />
    </QueryClientProvider>,
  );
  // The green bar is `data-issues="0"` — wait for the real IssuesPanel, so an
  // assertion never runs against a tree that has not settled.
  return await screen.findByTestId("issues-panel");
}

beforeEach(() => {
  mockState.order = null;
});
afterEach(() => cleanup());

describe("the ready bar states what was actually checked (P0-B)", () => {
  test("green bar no longer claims every required field was CHECKED", async () => {
    const panel = await renderWorkshop(NOTHING_BLOCKS);

    // Proof the green branch is the one rendering — otherwise the negative
    // assertion below would pass against the wrong bar, or against no bar.
    expect(panel.getAttribute("data-issues")).toBe("0");
    expect(panel.textContent).toContain("Ready to send");

    // The exact sentence the operator read before this fix.
    expect(panel.textContent).not.toContain(OLD_CLAIM);
    expect(panel.textContent).not.toMatch(/filled and checked/);

    // What it says instead: the true half, plus the boundary of the claim.
    expect(panel.textContent).toContain("No open issues.");
    expect(panel.textContent).toContain("everything ProcuLink can check before sending");
    expect(panel.textContent).toContain("not a guarantee that the supplier will accept the order");
  });

  test("an OVERRIDDEN order names the rules the send bar is about to ask about", async () => {
    const panel = await renderWorkshop(OVERRIDDEN);

    // The gate lets it through, so the green bar really is what renders — this is
    // the contradiction the audit found, reproduced.
    expect(panel.getAttribute("data-issues")).toBe("0");
    expect(panel.textContent).toContain("Ready to send");

    expect(panel.textContent).not.toContain(OLD_CLAIM);
    expect(panel.textContent).not.toMatch(/filled and checked/);
    expect(panel.textContent).toContain("2 supplier rules did not pass and were overridden");
  });

  test("the label is PRODUCED, not defaulted — the two states differ", async () => {
    const clean = (await renderWorkshop(NOTHING_BLOCKS)).textContent ?? "";
    cleanup();
    const overridden = (await renderWorkshop(OVERRIDDEN)).textContent ?? "";

    // If OrderWorkshop stopped passing `readyLabel`, both would fall back to the
    // same hardcoded default and this would fail — which is the shipped state.
    expect(clean).not.toBe(overridden);
    expect(clean.length).toBeGreaterThan(0);
    expect(overridden.length).toBeGreaterThan(0);
  });
});
