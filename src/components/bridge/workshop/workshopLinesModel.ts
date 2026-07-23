// workshopLinesModel — pure derivations for the workshop's "Lines" view
// (WorkshopLinesView + the Fields|Lines toggle). No React, no fetching, fully
// unit-tested. Every number shown in the Lines view comes through here so the
// table, the footer reconcile chip, and the toggle badge can never disagree.

import type { OrderLine } from "@/types/procurement";

/** The per-line status chip. */
export type LineChipStatus = "ready" | "supplier-code" | "review";

/** |Σ lines − order total| at or under this reads as a match. */
export const RECONCILE_TOLERANCE = 0.01;

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * The amount a line contributes: the extracted per-line amount when the
 * document stated one, otherwise quantity × unit price rounded to cents.
 */
export function lineAmountOf(line: Pick<OrderLine, "quantity" | "unitPrice" | "lineAmount">): number {
  return line.lineAmount ?? round2(Number(line.quantity) * Number(line.unitPrice));
}

/** Σ of every line's amount (per `lineAmountOf`), rounded to cents. */
export function sumLineAmounts(lines: ReadonlyArray<Pick<OrderLine, "quantity" | "unitPrice" | "lineAmount">>): number {
  return round2(lines.reduce((acc, l) => acc + lineAmountOf(l), 0));
}

export type ReconcileVerdict = "match" | "mismatch" | "no-total";

/**
 * Reconcile Σ lines against the document's STATED grand total.
 *
 * The comparison uses `order.grandTotal` ONLY — never the client-computed
 * fallback `resolvedGrandTotal` falls back to (orderDisplay.ts:29-34), because
 * that fallback IS the line sum, and comparing the sum to itself would always
 * "match". A stated total of 0/absent is treated as unknown, mirroring
 * resolvedGrandTotal's `stated > 0` guard (an extracted 0 means "not captured",
 * not a zero-value order) → verdict "no-total", and the caller renders the Σ
 * alone with no equality claim.
 */
export function reconcileTotals(
  lines: ReadonlyArray<Pick<OrderLine, "quantity" | "unitPrice" | "lineAmount">>,
  grandTotal: number | null | undefined,
): { sum: number; verdict: ReconcileVerdict } {
  const sum = sumLineAmounts(lines);
  if (grandTotal == null || !Number.isFinite(grandTotal) || grandTotal <= 0) {
    return { sum, verdict: "no-total" };
  }
  // +1e-9 absorbs float representation error at exactly the tolerance boundary.
  const verdict = Math.abs(sum - grandTotal) <= RECONCILE_TOLERANCE + 1e-9 ? "match" : "mismatch";
  return { sum, verdict };
}

/**
 * The status chip for one line:
 *   • needsReview + no supplier code → "supplier-code" (red — the send blocker);
 *   • needsReview with a code       → "review" (amber — flagged, needs a confirm);
 *   • otherwise                     → "ready" (green).
 */
export function lineChipStatus(line: Pick<OrderLine, "needsReview" | "supplierItemCode">): LineChipStatus {
  if (line.needsReview && !line.supplierItemCode) return "supplier-code";
  if (line.needsReview) return "review";
  return "ready";
}

/** Lines still blocking send (server-truth needsReview — same flag the send guard reads). */
export function blockedLineCount(lines: ReadonlyArray<Pick<OrderLine, "needsReview">>): number {
  return lines.filter((l) => l.needsReview).length;
}

/** The Fields|Lines toggle renders only when the order actually has lines (N=1 included). */
export function showLinesToggle(lineCount: number): boolean {
  return lineCount > 0;
}

/** Red dot on the Lines segment — any line still needs review. */
export function linesToggleAlert(lines: ReadonlyArray<Pick<OrderLine, "needsReview">>): boolean {
  return lines.some((l) => l.needsReview);
}

/** Blocked lines that carry an AI-suggested supplier code — the bulk-apply scope. */
export function bulkApplySuggestionCount(
  lines: ReadonlyArray<Pick<OrderLine, "needsReview" | "aiSuggestion">>,
): number {
  return lines.filter((l) => l.needsReview && !!l.aiSuggestion?.supplierItemCode).length;
}

/** Bulk apply is offered only when at least one blocked line has a suggestion to apply. */
export function bulkApplyEnabled(
  lines: ReadonlyArray<Pick<OrderLine, "needsReview" | "aiSuggestion">>,
): boolean {
  return bulkApplySuggestionCount(lines) > 0;
}

/**
 * Locale-grouped 2-decimal amount for the mono table cells and footer chips
 * (e.g. "1,469.00") — the SAME en-IE grouping orderDisplay.formatMoney uses for
 * the header total, so the header and the Lines view can never disagree on how
 * the same number is grouped. Rendering only: the reconcile comparison
 * (reconcileTotals) runs on raw decimals, never on formatted strings.
 */
export function formatAmount(n: number): string {
  return n.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * A short currency mark for the Qty/Unit/Line column headers: the symbol for the
 * common codes, the code itself otherwise — never a hardcoded "€" for non-EUR.
 */
export function currencyMark(code: string | null | undefined): string {
  const c = (code ?? "").trim().toUpperCase();
  switch (c) {
    case "EUR": return "€";
    case "USD": return "$";
    case "GBP": return "£";
    default: return c; // "SEK", "PLN", … or "" when unknown
  }
}
