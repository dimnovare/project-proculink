import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// WorkshopLinesView — the workshop middle column's per-line "Lines" view.
// These tests cover the interactive contract the model tests can't:
//   • an expanded blocked row shows the real AI-suggestion chip (code + %);
//   • the chip routes through the EXISTING accept action (onAcceptSuggestion);
//   • the footer bulk-apply button is disabled when no blocked line has a
//     suggestion, enabled when one does;
//   • the footer never claims Σ = order total when no total was extracted;
//   • the catalog picker searches SERVER-side (a 120k-row catalog is fully
//     searchable) and only makes claims its probe actually proved (error ≠
//     empty; unrouted ≠ a supplier with no catalog; a full page ≠ all matches);
//   • a resolved row's expand panel closes instead of sticking open;
//   • a line jump scrolls once, honors reduced motion, and reports consumption.

vi.mock("@/lib/api-client", () => ({
  getSupplierCatalog: vi.fn().mockResolvedValue({ total: 0, items: [] }),
}));
vi.mock("@/hooks/useQueriesEnabled", () => ({
  useQueriesEnabled: () => true,
}));

import { getSupplierCatalog } from "@/lib/api-client";
import { CATALOG_CODES_TAKE } from "@/lib/catalogCodes";
import { WorkshopLinesView, WorkshopLinesToggle } from "./WorkshopLinesView";
import type { Order, OrderLine } from "@/types/procurement";

const catalogMock = vi.mocked(getSupplierCatalog);

afterEach(() => {
  cleanup();
  // Per-test rejections/pages must not leak into the next test.
  catalogMock.mockReset().mockResolvedValue({ total: 0, items: [] });
});

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
    // The leading mark is an SVG sparkle now, not an emoji (WP-28), so the text
    // node is the label alone.
    expect(screen.getByText("AI suggestion: TY-90112 (92%)")).toBeTruthy();
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

  it("an expanded row closes when its line resolves — no stuck-open, uncollapsible panel", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const shared = {
      onAcceptSuggestion: vi.fn(),
      onCommitCode: vi.fn(),
      acceptingLineId: null,
    };
    const { rerender } = render(
      <QueryClientProvider client={qc}>
        <WorkshopLinesView order={makeOrder([BLOCKED_LINE], null)} {...shared} />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Line 2 details" }));
    expect(screen.getByTestId("line-expand-2")).toBeTruthy();

    // Server truth returns after an accept: the SAME line id, now carrying its
    // code with the review flag cleared. `expandable` flips false — the panel
    // must close with it, because the collapse affordances are gone too.
    const resolved = makeLine({
      id: "line-2", lineNumber: 2, buyerItemCode: "MICH-CROSSCLIM",
      supplierItemCode: "TY-90112", needsReview: false, aiSuggestion: null,
    });
    rerender(
      <QueryClientProvider client={qc}>
        <WorkshopLinesView order={makeOrder([resolved], null)} {...shared} />
      </QueryClientProvider>,
    );
    expect(screen.queryByTestId("line-expand-2")).toBeNull();
    expect(screen.queryByRole("button", { name: "Line 2 details" })).toBeNull();
  });
});

describe("footer — reconcile chip and bulk apply", () => {
  // Footer amounts render through the header's formatMoney ("EUR 254.30") so the
  // same total can never read differently in the two places.
  it("claims Σ = order total only when the stated total matches within 0.01", () => {
    renderView(makeOrder([READY_LINE, BLOCKED_LINE], 254.3)); // 179.80 + 74.50
    expect(screen.getByText("Σ lines EUR 254.30 = order total ✔")).toBeTruthy();
  });

  it("states both numbers, without blame, when Σ and the order total disagree", () => {
    renderView(makeOrder([READY_LINE, BLOCKED_LINE], 300));
    expect(screen.getByText("Σ lines EUR 254.30 · order total EUR 300.00")).toBeTruthy();
  });

  it("renders the Σ alone when no order total was extracted — no equality claim", () => {
    renderView(makeOrder([READY_LINE, BLOCKED_LINE], null));
    expect(screen.getByText("Σ lines EUR 254.30")).toBeTruthy();
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

describe("catalog picker — the panel only claims what its probe proved", () => {
  function openCatalog() {
    fireEvent.click(screen.getByRole("button", { name: "Line 2 details" }));
    fireEvent.click(screen.getByRole("button", { name: "Pick from catalog" }));
  }

  it("a FAILED probe says so with a retry — it never claims the catalog is empty", async () => {
    catalogMock.mockRejectedValue(new Error("catalog: 500"));
    renderView(makeOrder([BLOCKED_LINE], null));
    openCatalog();
    // The component retries once (retry: 1) before surfacing the error.
    expect(await screen.findByText(/Couldn’t load the catalog — try again\./, undefined, { timeout: 4000 })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.queryByText(/No catalog for this supplier yet/)).toBeNull();
  });

  it("the 'import one' call-to-action renders only after a SUCCESSFUL probe returns 0 rows", async () => {
    // Default mock: resolves { total: 0, items: [] } — a genuine known-empty catalog.
    renderView(makeOrder([BLOCKED_LINE], null));
    openCatalog();
    expect(await screen.findByText(/No catalog for this supplier yet/)).toBeTruthy();
  });

  it("an unrouted order (Guid.Empty supplier) disables the pick and never probes", () => {
    const unrouted = {
      ...makeOrder([BLOCKED_LINE], null),
      supplierId: "00000000-0000-0000-0000-000000000000",
    } as Order;
    renderView(unrouted);
    fireEvent.click(screen.getByRole("button", { name: "Line 2 details" }));
    const pick = screen.getByRole("button", { name: "Pick from catalog" }) as HTMLButtonElement;
    expect(pick.disabled).toBe(true);
    expect(pick.title).toContain("Assign a supplier first");
    expect(catalogMock).not.toHaveBeenCalled();
  });

  it("sends the search to the SERVER, so a code past the first page is findable", async () => {
    // A real distributor catalog: 120,000 rows. The wanted code is nowhere near
    // the first page, so the query text itself has to reach the API.
    catalogMock.mockImplementation(async (_id: string, q?: string) =>
      q === "TY-90112"
        ? { total: 120_000, items: [{ id: "p9", code: "TY-90112", name: "CrossClimate 2" }] }
        : { total: 120_000, items: [{ id: "p1", code: "AA-0001", name: "First row" }] },
    );
    const { onCommitCode } = renderView(makeOrder([BLOCKED_LINE], null));
    openCatalog();
    const input = await screen.findByLabelText("Search the supplier catalog");
    fireEvent.change(input, { target: { value: "TY-90112" } });

    await waitFor(
      () => expect(catalogMock).toHaveBeenCalledWith("sup-1", "TY-90112", CATALOG_CODES_TAKE),
      { timeout: 3000 },
    );
    const hit = await screen.findByText("TY-90112");
    fireEvent.click(hit);
    expect(onCommitCode).toHaveBeenCalledWith({
      id: "line-2",
      lineNumber: 2,
      supplierItemCode: "TY-90112",
    });
  });

  it("a no-match search says exactly that — the server searched the WHOLE catalog", async () => {
    // `total` is the whole-catalog count (the API's CountAsync ignores ?q=), so a
    // stocked catalog with no match is a no-match, never "no catalog".
    catalogMock.mockImplementation(async (_id: string, q?: string) =>
      q ? { total: 120_000, items: [] } : { total: 120_000, items: [{ id: "p1", code: "AA-0001" }] },
    );
    renderView(makeOrder([BLOCKED_LINE], null));
    openCatalog();
    const input = await screen.findByLabelText("Search the supplier catalog");
    fireEvent.change(input, { target: { value: "zzz" } });
    expect(
      await screen.findByText(/No product matches “zzz”/, undefined, { timeout: 3000 }),
    ).toBeTruthy();
    expect(screen.queryByText(/No catalog for this supplier yet/)).toBeNull();
    expect(screen.queryByText(/Searched only the first/)).toBeNull();
  });

  it("a FULL page of matches says there may be more — it never implies these are all", async () => {
    catalogMock.mockResolvedValue({
      total: 120_000,
      items: Array.from({ length: CATALOG_CODES_TAKE }, (_, i) => ({
        id: `p${i}`,
        code: `TY-${i}`,
        name: null,
      })),
    });
    renderView(makeOrder([BLOCKED_LINE], null));
    openCatalog();
    const input = await screen.findByLabelText("Search the supplier catalog");
    fireEvent.change(input, { target: { value: "TY" } });
    expect(
      await screen.findByText(
        new RegExp(`first ${CATALOG_CODES_TAKE} matches`),
        undefined,
        { timeout: 3000 },
      ),
    ).toBeTruthy();
  });

  it("a partial page of matches is the complete set — no 'refine' nag", async () => {
    catalogMock.mockResolvedValue({
      total: 120_000,
      items: [{ id: "p1", code: "TY-90112", name: "CrossClimate 2" }],
    });
    renderView(makeOrder([BLOCKED_LINE], null));
    openCatalog();
    expect(await screen.findByText("TY-90112", undefined, { timeout: 3000 })).toBeTruthy();
    expect(screen.queryByText(/matches/)).toBeNull();
  });
});

describe("line jump — one scroll, reduced motion honored, signal consumed", () => {
  function withAnimateSpy() {
    // jsdom has no Element.animate — install one so the flash is observable.
    const animateSpy = vi.fn();
    (Element.prototype as unknown as { animate: unknown }).animate = animateSpy;
    const scrollSpy = vi.spyOn(Element.prototype, "scrollIntoView");
    return {
      animateSpy,
      scrollSpy,
      restore() {
        scrollSpy.mockRestore();
        delete (Element.prototype as unknown as { animate?: unknown }).animate;
      },
    };
  }

  it("scrolls smoothly, flashes, then reports consumption so the host clears the signal", async () => {
    const spies = withAnimateSpy();
    const onJumpConsumed = vi.fn();
    renderView(makeOrder([BLOCKED_LINE], null), {
      jumpSignal: { lineId: "line-2", n: 1 },
      onJumpConsumed,
    });
    await waitFor(() => expect(onJumpConsumed).toHaveBeenCalledTimes(1));
    expect(spies.scrollSpy).toHaveBeenCalledWith({ block: "center", behavior: "smooth" });
    expect(spies.animateSpy).toHaveBeenCalledTimes(1);
    spies.restore();
  });

  it("prefers-reduced-motion → instant jump, no flash", async () => {
    const spies = withAnimateSpy();
    const matchMediaSpy = vi.spyOn(window, "matchMedia").mockImplementation(
      (query: string) =>
        ({
          matches: query === "(prefers-reduced-motion: reduce)",
          media: query,
          onchange: null,
          addListener: () => {},
          removeListener: () => {},
          addEventListener: () => {},
          removeEventListener: () => {},
          dispatchEvent: () => false,
        }) as unknown as MediaQueryList,
    );
    const onJumpConsumed = vi.fn();
    renderView(makeOrder([BLOCKED_LINE], null), {
      jumpSignal: { lineId: "line-2", n: 1 },
      onJumpConsumed,
    });
    await waitFor(() => expect(onJumpConsumed).toHaveBeenCalledTimes(1));
    expect(spies.scrollSpy).toHaveBeenCalledWith({ block: "center", behavior: "auto" });
    expect(spies.animateSpy).not.toHaveBeenCalled();
    matchMediaSpy.mockRestore();
    spies.restore();
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
