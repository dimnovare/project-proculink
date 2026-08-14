import { describe, test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { IssuesPanel, type WorkshopIssue, type IssuesResolveApi } from "./IssuesPanel";
import type { OrderLine } from "@/types/procurement";

afterEach(cleanup);

/**
 * The review panel is where an operator decides whether to trust a supplier code, so it is the
 * screen where a fabricated confidence does the most damage.
 *
 * The backend used to stamp a literal 0.95 on two DETERMINISTIC producers — an exact hit in the
 * supplier's own catalog, and an echo of a manufacturer part number the source document prints —
 * and this panel rendered that number as `aria-label="AI confidence 95%"` alongside "95% match".
 * No model ran on either path.
 *
 * These pin the rendered DOM for both cases. The accessible name is asserted SEPARATELY from the
 * text, because the defect lived partly in an aria-label: a textContent-only assertion would pass
 * against the exact string it is meant to stop.
 */

const makeLine = (over: Partial<OrderLine> = {}): OrderLine => ({
  id: "l1",
  lineNumber: 1,
  buyerItemCode: "29954596",
  supplierItemCode: null,
  description: "QuickTrace scanner",
  quantity: 1,
  unitPrice: 10,
  confidence: 0,
  needsReview: true,
  ...over,
}) as OrderLine;

const makeResolve = (over: Partial<IssuesResolveApi> = {}): IssuesResolveApi => ({
  lineEditId: null,
  lineDraft: "",
  setLineDraft: vi.fn(),
  startLineEdit: vi.fn(),
  commitLineCode: vi.fn(),
  cancelLineEdit: vi.fn(),
  confirmFlaggedLine: vi.fn(),
  acceptingLineId: null,
  ...over,
});

/** A deterministic catalog hit, as the API now sends it: a real code and NO number. */
const CATALOG_SUGGESTION = {
  supplierItemCode: "FAB-SCAN-77120",
  confidence: null,
  reason: "Manufacturer part number LTQ2500-BK-BTK1 matched the supplier catalog.",
  provenance: "catalog: manufacturer part number",
} as unknown as NonNullable<OrderLine["aiSuggestion"]>;

const MODEL_SUGGESTION = {
  supplierItemCode: "SUP-FROM-MODEL",
  confidence: 0.82,
  reason: "fuzzy match on description",
  provenance: "OpenAI structured output",
} as unknown as NonNullable<OrderLine["aiSuggestion"]>;

function renderPanel(aiSuggestion: NonNullable<OrderLine["aiSuggestion"]>) {
  const issues: WorkshopIssue[] = [
    {
      code: "ai-1",
      ref: "ai-1",
      severity: "warning",
      title: "Suggested supplier code",
      kind: "ai-suggestion",
      lineId: "l1",
    } as WorkshopIssue,
  ];
  return render(
    <IssuesPanel
      issues={issues}
      lines={[makeLine({ id: "l1", aiSuggestion })]}
      resolve={makeResolve()}
      onFocusField={vi.fn()}
    />,
  );
}

describe("IssuesPanel — a deterministic suggestion makes no AI claim", () => {
  test("a catalog match shows the code, with no percentage and no AI wording", () => {
    renderPanel(CATALOG_SUGGESTION);

    // Scoped to the panel's own subtree, not the whole document.
    const panel = within(screen.getByTestId("issues-panel"));

    // Anti-vacuity: the suggested code really did render, so the negatives below mean something.
    expect(panel.getByText("FAB-SCAN-77120")).toBeInTheDocument();

    // No percentage at all — not a "95% match", and not a 0% either.
    expect(screen.getByTestId("issues-panel").textContent).not.toMatch(/\d+%/);

    // No AI claim in the accessible name. The aria-label is where the defect actually lived.
    expect(panel.queryByLabelText(/AI confidence/i)).toBeNull();
    expect(screen.getByTestId("issues-panel").querySelector('[aria-label*="AI confidence"]')).toBeNull();
  });

  test("CONTROL — a real model suggestion still shows its score, named as AI", () => {
    // Without this the guard above is satisfiable by never rendering a confidence anywhere.
    renderPanel(MODEL_SUGGESTION);

    const panel = within(screen.getByTestId("issues-panel"));
    expect(panel.getByText("SUP-FROM-MODEL")).toBeInTheDocument();
    expect(panel.getByText("82% match")).toBeInTheDocument();
    expect(panel.getByLabelText("AI confidence 82%")).toBeInTheDocument();
  });
});
