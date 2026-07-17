import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// WorkshopLinesView — the workshop middle column's per-line "Lines" view.
// These tests cover the interactive contract the model tests can't:
//   • an expanded blocked row shows the real AI-suggestion chip (code + %);
//   • the chip routes through the EXISTING accept action (onAcceptSuggestion);
//   • the footer bulk-apply button is disabled when no blocked line has a
//     suggestion, enabled when one does;
//   • the footer never claims Σ = order total when no total was extracted.

vi.mock("@/lib/api-client", () => ({
  getSupplierCatalog: vi.fn().mockResolvedValue({ total: 0, items: [] }),
}));
vi.mock("@/hooks/useQueriesEnabled", () => ({
  useQueriesEnabled: () => true,
}));

import { WorkshopLinesView, WorkshopLinesToggle } from "./WorkshopLinesView";
import type { Order, OrderLine } from "@/types/procurement";

afterEach(() => cleanup());

function makeLine(over: Partial<OrderLine>): OrderLine {
  return {
    id: over.id ?? "line-1",
    lineNumber: over.lineNumber ?? 1,
    buyerItemCode: "MICH-225-45R17",
    supplierItemCode: "TY-88231",
    description: "Pilot Sport 5 225/45 R17",
    quantity: 2,
    unitPrice: 89.9,
    confidence: 1,
    needsReview: false,
    aiSuggestion: null,
    lineAmount: null,
    ...over,
  } as OrderLine;
}

const READY_LINE = makeLine({ id: "line-1", lineNumber: 1 });
const BLOCKED_LINE = makeLine({
  id: "line-2",
  lineNumber: 2,
  buyerItemCode: "MICH-CROSSCLIM",
  supplierItemCode: null,
  description: "CrossClimate 2 195/65 R15",
  quantity: 1,
  unitPrice: 74.5,
  needsReview: true,
  aiSuggestion: { supplierItemCode: "TY-90112", confidence: 0.92, reason: "", provenance: "catalog" },
});

function makeOrder(lines: OrderLine[], grandTotal: number | null): Order {
  return {
    id: "ord-1",
    poNumber: "PO-4091678643",
    supplierId: "sup-1",
    supplierName: "Demo",
    currency: "EUR",
    status: "pending_review",
    lines,
    artifacts: [],
    grandTotal,
  } as unknown as Order;
}

function renderView(order: Order, over: Partial<Parameters<typeof WorkshopLinesView>[0]> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onAcceptSuggestion = vi.fn();
  const onCommitCode = vi.fn();
  const onBulkApply = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <WorkshopLinesView
        order={order}
        onAcceptSuggestion={onAcceptSuggestion}
        onCommitCode={onCommitCode}
        acceptingLineId={null}
        onBulkApply={onBulkApply}
        {...over}
      />
    </QueryClientProvider>,
  );
  return { onAcceptSuggestion, onCommitCode, onBulkApply };
}

describe("row expand — the per-line mapping panel", () => {
  it("an expanded blocked row shows the AI-suggestion chip with the real code and confidence", () => {
    renderView(makeOrder([READY_LINE, BLOCKED_LINE], 254.3));
    // Collapsed at first: no suggestion chip anywhere.
    expect(screen.queryByText(/AI suggestion: TY-90112/)).toBeNull();

    const expandBtn = screen.getByRole("button", { name: "Line 2 details" });
    expect(expandBtn.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(expandBtn);

    expect(expandBtn.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("✨ AI suggestion: TY-90112 (92%)")).toBeTruthy();
    // The blocked line's missing supplier code is stated, in red column copy.
    expect(screen.getAllByText("— missing").length).toBeGreaterThan(0);
  });

  it("the suggestion chip calls the existing accept action with the line id", () => {
    const { onAcceptSuggestion } = renderView(makeOrder([BLOCKED_LINE], null));
    fireEvent.click(screen.getByRole("button", { name: "Line 2 details" }));
    fireEvent.click(screen.getByRole("button", { name: "Accept AI suggestion TY-90112 for line 2" }));
    expect(onAcceptSuggestion).toHaveBeenCalledWith("line-2");
  });

  it("a ready row has no expand affordance", () => {
    renderView(makeOrder([READY_LINE], null));
    expect(screen.queryByRole("button", { name: "Line 1 details" })).toBeNull();
  });

  it("a line with no description renders its item code in the Description cell", () => {
    const noDesc = makeLine({ id: "line-3", lineNumber: 3, description: null, buyerItemCode: "MICH-AGIL-215" });
    renderView(makeOrder([noDesc], null));
    // The code appears in BOTH the item-code and description cells.
    expect(screen.getAllByText("MICH-AGIL-215").length).toBe(2);
  });
});

describe("footer — reconcile chip and bulk apply", () => {
  it("claims Σ = order total only when the stated total matches within 0.01", () => {
    renderView(makeOrder([READY_LINE, BLOCKED_LINE], 254.3)); // 179.80 + 74.50
    expect(screen.getByText("Σ lines 254.30 = order total ✔")).toBeTruthy();
  });

  it("states both numbers, without blame, when Σ and the order total disagree", () => {
    renderView(makeOrder([READY_LINE, BLOCKED_LINE], 300));
    expect(screen.getByText("Σ lines 254.30 · order total 300.00")).toBeTruthy();
  });

  it("renders the Σ alone when no order total was extracted — no equality claim", () => {
    renderView(makeOrder([READY_LINE, BLOCKED_LINE], null));
    expect(screen.getByText("Σ lines 254.30")).toBeTruthy();
    expect(screen.queryByText(/order total/)).toBeNull();
  });

  it("counts blocked lines in the red chip", () => {
    renderView(makeOrder([READY_LINE, BLOCKED_LINE], null));
    expect(screen.getByText("1 line blocked")).toBeTruthy();
  });

  it("bulk apply is enabled when a blocked line has a suggestion", () => {
    renderView(makeOrder([BLOCKED_LINE], null));
    const btn = screen.getByRole("button", { name: "Apply AI suggestions to all blocked lines" });
    expect((btn as HTMLButtonElement).disabled).toBe(false);
  });

  it("bulk apply is disabled when no blocked line has a suggestion", () => {
    const blockedNoSuggestion = makeLine({ id: "line-4", lineNumber: 4, supplierItemCode: null, needsReview: true, aiSuggestion: null });
    renderView(makeOrder([blockedNoSuggestion], null));
    const btn = screen.getByRole("button", { name: "Apply AI suggestions to all blocked lines" });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("WorkshopLinesToggle", () => {
  it("shows the line count and a red dot when a line needs review", () => {
    render(
      <WorkshopLinesToggle view="fields" onView={() => {}} lineCount={2} lines={[READY_LINE, BLOCKED_LINE]} />,
    );
    expect(screen.getByText(/Lines · 2/)).toBeTruthy();
    expect(screen.getByTestId("lines-toggle-alert")).toBeTruthy();
  });

  it("has no red dot when every line is clear", () => {
    render(<WorkshopLinesToggle view="fields" onView={() => {}} lineCount={1} lines={[READY_LINE]} />);
    expect(screen.queryByTestId("lines-toggle-alert")).toBeNull();
  });

  it("marks the active segment with aria-pressed", () => {
    render(<WorkshopLinesToggle view="lines" onView={() => {}} lineCount={1} lines={[READY_LINE]} />);
    const lines = screen.getByRole("button", { name: /Lines · 1/ });
    const fields = screen.getByRole("button", { name: "Fields" });
    expect(lines.getAttribute("aria-pressed")).toBe("true");
    expect(fields.getAttribute("aria-pressed")).toBe("false");
  });
});
