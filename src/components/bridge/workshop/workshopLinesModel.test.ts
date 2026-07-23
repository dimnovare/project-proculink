import { describe, it, expect } from "vitest";
import {
  lineAmountOf,
  sumLineAmounts,
  reconcileTotals,
  lineChipStatus,
  blockedLineCount,
  showLinesToggle,
  linesToggleAlert,
  bulkApplyEnabled,
  bulkApplySuggestionCount,
  currencyMark,
  formatAmount,
} from "./workshopLinesModel";
import { formatMoney } from "../review/orderDisplay";
import type { OrderLine } from "@/types/procurement";

// Minimal line factory — only the fields the model reads.
function line(over: Partial<OrderLine> = {}): OrderLine {
  return {
    id: over.id ?? "l1",
    lineNumber: over.lineNumber ?? 1,
    buyerItemCode: "BUY-1",
    quantity: 2,
    unitPrice: 10,
    confidence: 1,
    needsReview: false,
    ...over,
  } as OrderLine;
}

describe("lineAmountOf — the amount a line contributes", () => {
  it("prefers the document's stated lineAmount over qty × unitPrice", () => {
    expect(lineAmountOf(line({ quantity: 2, unitPrice: 10, lineAmount: 19.5 }))).toBe(19.5);
  });

  it("falls back to qty × unitPrice rounded to cents when lineAmount is absent", () => {
    expect(lineAmountOf(line({ quantity: 3, unitPrice: 33.333, lineAmount: null }))).toBe(100.0);
    expect(lineAmountOf(line({ quantity: 2, unitPrice: 89.9, lineAmount: undefined }))).toBe(179.8);
  });

  it("keeps a stated lineAmount of 0 (nullish coalescing, not falsy)", () => {
    expect(lineAmountOf(line({ quantity: 2, unitPrice: 10, lineAmount: 0 }))).toBe(0);
  });
});

describe("reconcileTotals — Σ lines vs the stated order total", () => {
  const lines = [
    line({ quantity: 2, unitPrice: 89.9 }), // 179.80
    line({ quantity: 1, unitPrice: 74.5 }), // 74.50
    line({ quantity: 1, unitPrice: 66.13 }), // 66.13
    line({ quantity: 1, unitPrice: 25.5 }), // 25.50
  ]; // Σ = 345.93

  it("sums via lineAmountOf (stated amounts win over computed)", () => {
    expect(sumLineAmounts(lines)).toBe(345.93);
    expect(sumLineAmounts([line({ quantity: 2, unitPrice: 10, lineAmount: 19.5 })])).toBe(19.5);
  });

  it("matches when |Σ − grandTotal| is at or under 0.01", () => {
    expect(reconcileTotals(lines, 345.93).verdict).toBe("match");
    expect(reconcileTotals(lines, 345.94).verdict).toBe("match"); // exactly 0.01 off
    expect(reconcileTotals(lines, 345.92).verdict).toBe("match");
  });

  it("mismatches beyond the 0.01 tolerance", () => {
    expect(reconcileTotals(lines, 345.95).verdict).toBe("mismatch");
    expect(reconcileTotals(lines, 346.0).verdict).toBe("mismatch");
  });

  it("makes no equality claim when grandTotal is null or undefined", () => {
    expect(reconcileTotals(lines, null)).toEqual({ sum: 345.93, verdict: "no-total" });
    expect(reconcileTotals(lines, undefined).verdict).toBe("no-total");
  });

  it("treats a stated grandTotal of 0 as unknown (an extracted 0 means not captured)", () => {
    // Mirrors resolvedGrandTotal's `stated > 0` guard (orderDisplay.ts:29-34).
    expect(reconcileTotals(lines, 0).verdict).toBe("no-total");
  });
});

describe("lineChipStatus — the per-line status chip", () => {
  it("is 'supplier-code' (red) when needsReview and the supplier code is missing", () => {
    expect(lineChipStatus(line({ needsReview: true, supplierItemCode: null }))).toBe("supplier-code");
    expect(lineChipStatus(line({ needsReview: true, supplierItemCode: "" }))).toBe("supplier-code");
    expect(lineChipStatus(line({ needsReview: true, supplierItemCode: undefined }))).toBe("supplier-code");
  });

  it("is 'review' (amber) when needsReview but a code is already set", () => {
    expect(lineChipStatus(line({ needsReview: true, supplierItemCode: "TY-1" }))).toBe("review");
  });

  it("is 'ready' when the line does not need review", () => {
    expect(lineChipStatus(line({ needsReview: false, supplierItemCode: "TY-1" }))).toBe("ready");
    expect(lineChipStatus(line({ needsReview: false, supplierItemCode: null }))).toBe("ready");
  });
});

describe("Fields|Lines toggle visibility", () => {
  it("no toggle for an order with 0 lines", () => {
    expect(showLinesToggle(0)).toBe(false);
  });

  it("a 1-line order still gets the toggle", () => {
    expect(showLinesToggle(1)).toBe(true);
  });

  it("shows the red dot only when some line needsReview", () => {
    expect(linesToggleAlert([line({ needsReview: false }), line({ needsReview: true })])).toBe(true);
    expect(linesToggleAlert([line({ needsReview: false })])).toBe(false);
    expect(linesToggleAlert([])).toBe(false);
  });
});

describe("bulk apply — scope and disabled rule", () => {
  it("counts only blocked (needsReview) lines that carry an AI-suggested code", () => {
    const lines = [
      line({ needsReview: true, aiSuggestion: { supplierItemCode: "A-1", confidence: 0.9, reason: "", provenance: "" } }),
      line({ needsReview: true, aiSuggestion: null }),
      // a resolved line's leftover suggestion is NOT in scope
      line({ needsReview: false, aiSuggestion: { supplierItemCode: "B-2", confidence: 0.9, reason: "", provenance: "" } }),
    ];
    expect(bulkApplySuggestionCount(lines)).toBe(1);
    expect(bulkApplyEnabled(lines)).toBe(true);
  });

  it("is disabled when none of the blocked lines has a suggestion", () => {
    expect(bulkApplyEnabled([line({ needsReview: true, aiSuggestion: null }), line({ needsReview: true })])).toBe(false);
    expect(bulkApplyEnabled([line({ needsReview: false })])).toBe(false);
  });

  it("blockedLineCount counts every needsReview line regardless of suggestions", () => {
    expect(blockedLineCount([line({ needsReview: true }), line({ needsReview: true }), line({ needsReview: false })])).toBe(2);
  });
});

describe("display helpers", () => {
  it("formats amounts with two decimals and en-IE thousand grouping", () => {
    expect(formatAmount(89.9)).toBe("89.90");
    expect(formatAmount(345.93)).toBe("345.93");
    expect(formatAmount(1469)).toBe("1,469.00");
    expect(formatAmount(12345.6)).toBe("12,345.60");
  });

  it("renders the same digits the header's formatMoney renders for the same amount", () => {
    // The founder bug: footer "1469.00" vs header "EUR 1,469.00" on one screen.
    // Pin the two formatters to identical grouping for a 2-decimal amount.
    expect(formatMoney("EUR", 1469)).toBe(`EUR ${formatAmount(1469)}`);
  });

  it("marks common currencies with a symbol and falls back to the code", () => {
    expect(currencyMark("EUR")).toBe("€");
    expect(currencyMark("USD")).toBe("$");
    expect(currencyMark("PLN")).toBe("PLN");
    expect(currencyMark(null)).toBe("");
  });
});
