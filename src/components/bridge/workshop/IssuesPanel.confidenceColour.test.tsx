import { describe, test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { IssuesPanel, type WorkshopIssue, type IssuesResolveApi } from "./IssuesPanel";
import type { OrderLine } from "@/types/procurement";

afterEach(cleanup);

/**
 * The "N% match" chip beside an AI-suggested code.
 *
 * The NUMBER was always honest — it comes off the line's real AI suggestion, and the panel
 * deliberately renders nothing when there is no suggestion payload. The COLOUR was not: it was a
 * flat `C.greenDeep` regardless of value, so a suggestion sitting on the 0.65 acceptance floor
 * painted in exactly the same success green as a 0.98. In the one panel whose job is to tell an
 * operator which line needs their eyes, a barely-passing match looked like a certain one.
 *
 * It now uses `confidenceTone` — the same ramp as every other confidence in the product
 * (ds-tokens.confidenceTier: >=90 green, 75-89 amber, <75 red), whose boundaries are pinned by
 * ConfidenceChip.test.tsx. These assert the RENDERED colour of the string a user reads.
 */

const OK_FG = "#1E6D29";
const WARN_FG = "#8A5310";
const DANGER_FG = "#B43838";

const makeLine = (over: Partial<OrderLine> = {}): OrderLine => ({
  id: "l1",
  lineNumber: 1,
  buyerItemCode: "B-1",
  supplierItemCode: null,
  description: "Widget",
  quantity: 1,
  unitPrice: 10,
  confidence: 0,
  needsReview: true,
  ...over,
});

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

function renderWithConfidence(confidence: number) {
  const issues: WorkshopIssue[] = [
    {
      code: "ai-1",
      ref: "ai-1",
      severity: "warning",
      title: "Suggested supplier code",
      kind: "ai-suggestion",
      lineId: "l1",
      suggestedCode: "ACM-BR-55",
      confidence,
    } as WorkshopIssue,
  ];
  return render(
    <IssuesPanel
      issues={issues}
      lines={[makeLine({ id: "l1" })]}
      resolve={makeResolve()}
      onFocusField={vi.fn()}
    />,
  );
}

describe("IssuesPanel — the '% match' chip is coloured by the shipped ramp", () => {
  test("a 65% match — the AI floor — is DANGER red, not success green", () => {
    renderWithConfidence(0.65);
    const chip = screen.getByText("65% match");
    expect(chip).toHaveStyle({ color: DANGER_FG });
    // The exact defect: this rendered #1E6D29, identical to a 98%.
    expect(chip).not.toHaveStyle({ color: OK_FG });
  });

  test("a 98% match is green", () => {
    renderWithConfidence(0.98);
    expect(screen.getByText("98% match")).toHaveStyle({ color: OK_FG });
  });

  test("an 80% match is amber, between the two", () => {
    renderWithConfidence(0.8);
    expect(screen.getByText("80% match")).toHaveStyle({ color: WARN_FG });
  });

  test("the number is still announced as a confidence for screen readers", () => {
    renderWithConfidence(0.65);
    expect(screen.getByLabelText("AI confidence 65%")).toBeInTheDocument();
  });
});
