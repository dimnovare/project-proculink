import { describe, test, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { IssuesPanel, type WorkshopIssue, type IssuesResolveApi } from "./IssuesPanel";
import type { OrderLine } from "@/types/procurement";

afterEach(cleanup);

const issue = (over: Partial<WorkshopIssue> & { code: string }): WorkshopIssue => ({
  severity: "blocking",
  ref: over.code,
  title: "Needs a supplier code",
  ...over,
});

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

describe("IssuesPanel", () => {
  test("renders one row per issue with title + why", () => {
    const issues = [
      issue({ code: "a", title: "Needs a supplier code", why: "Line 2 has no mapped supplier SKU." }),
      issue({ code: "b", title: "Quantity must be positive", why: "Line 4 quantity is -3.", severity: "warning" }),
    ];
    render(<IssuesPanel issues={issues} onFocusField={vi.fn()} />);
    expect(screen.getAllByTestId("issue-row")).toHaveLength(2);
    expect(screen.getByText("Needs a supplier code")).toBeInTheDocument();
    expect(screen.getByText("Line 4 quantity is -3.")).toBeInTheDocument();
  });

  test("the 'Where →' affordance calls onFocusField with the issue ref", () => {
    const onFocusField = vi.fn();
    render(
      <IssuesPanel
        issues={[issue({ code: "a", ref: "line:42", title: "Flagged for review" })]}
        onFocusField={onFocusField}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /show .* in the mapper/i }));
    expect(onFocusField).toHaveBeenCalledWith("line:42");
  });

  test("a deterministic fixAction renders a one-click button → onFix(issue)", () => {
    const onFix = vi.fn();
    const withFix = issue({ code: "a", title: "Accept AI suggestion", fixAction: { label: "Accept" } });
    render(<IssuesPanel issues={[withFix]} onFocusField={vi.fn()} onFix={onFix} />);
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(onFix).toHaveBeenCalledWith(withFix);
  });

  test("no fixAction → no fix button (only the Where affordance)", () => {
    render(<IssuesPanel issues={[issue({ code: "a" })]} onFocusField={vi.fn()} onFix={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Accept" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /show .* in the mapper/i })).toBeInTheDocument();
  });

  test("0 issues → the green 'ready to send' bar, no issue rows", () => {
    render(<IssuesPanel issues={[]} onFocusField={vi.fn()} />);
    expect(screen.getByText("Ready to send")).toBeInTheDocument();
    expect(screen.queryAllByTestId("issue-row")).toHaveLength(0);
    expect(screen.getByTestId("issues-panel")).toHaveAttribute("data-issues", "0");
  });

  test("a blocking issue never renders the green ready bar (invariant: green only when valid)", () => {
    render(<IssuesPanel issues={[issue({ code: "a", severity: "blocking" })]} onFocusField={vi.fn()} />);
    expect(screen.queryByText("Ready to send")).not.toBeInTheDocument();
    expect(screen.getByTestId("issues-panel")).toHaveAttribute("data-issues", "1");
  });

  test("summarizes blocking count in the header", () => {
    render(
      <IssuesPanel
        issues={[issue({ code: "a", severity: "blocking" }), issue({ code: "b", severity: "warning" })]}
        onFocusField={vi.fn()}
      />,
    );
    expect(screen.getByText(/2 issues · 1 blocking/)).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Inline per-line resolution (Phase 0 Task 1) — the bug fix: a manual-code card
// must let you TYPE a supplier code and Save; review-flag must let you Confirm.
// These are the acceptance tests the prior "fix" was missing (it checked queue
// purity but never that the control DOES anything).
// ─────────────────────────────────────────────────────────────────────────────
describe("IssuesPanel — inline line resolution", () => {
  test("a manual-code card opens a FOCUSABLE input; typing a code + Enter commits it", () => {
    // First render: not editing → the primary "Enter code" affordance (NOT a dead "Where →").
    const startLineEdit = vi.fn();
    const { rerender } = render(
      <IssuesPanel
        issues={[issue({ code: "line:l1", kind: "manual-code", lineId: "l1", title: "Needs a supplier code" })]}
        onFocusField={vi.fn()}
        resolve={makeResolve({ startLineEdit })}
        lines={[makeLine({ id: "l1" })]}
      />,
    );
    // The dead "Where →" jump is NOT the primary control for a manual-code card.
    expect(screen.queryByRole("button", { name: /show .* in the mapper/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /enter code/i }));
    expect(startLineEdit).toHaveBeenCalledWith("l1", "");

    // Second render: editing this line → a focusable text input appears.
    const setLineDraft = vi.fn();
    const commitLineCode = vi.fn();
    rerender(
      <IssuesPanel
        issues={[issue({ code: "line:l1", kind: "manual-code", lineId: "l1", title: "Needs a supplier code" })]}
        onFocusField={vi.fn()}
        resolve={makeResolve({ lineEditId: "l1", lineDraft: "", setLineDraft, commitLineCode })}
        lines={[makeLine({ id: "l1" })]}
      />,
    );
    const input = screen.getByRole("textbox", { name: /supplier code/i }) as HTMLInputElement;
    expect(input).toBeInTheDocument();
    // It is the focused element (autoFocus on open).
    expect(document.activeElement).toBe(input);

    // Typing routes to the draft setter…
    fireEvent.change(input, { target: { value: "S-99" } });
    expect(setLineDraft).toHaveBeenCalledWith("S-99");

    // …and Enter commits the line via the SAME server-truth path.
    fireEvent.keyDown(input, { key: "Enter" });
    expect(commitLineCode).toHaveBeenCalledWith("l1");
  });

  test("the inline Save button commits the line code", () => {
    const commitLineCode = vi.fn();
    render(
      <IssuesPanel
        issues={[issue({ code: "line:l1", kind: "manual-code", lineId: "l1" })]}
        onFocusField={vi.fn()}
        resolve={makeResolve({ lineEditId: "l1", lineDraft: "S-99", commitLineCode })}
        lines={[makeLine({ id: "l1" })]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(commitLineCode).toHaveBeenCalledWith("l1");
  });

  test("a review-flag card renders a Confirm button that calls confirmFlaggedLine", () => {
    const confirmFlaggedLine = vi.fn();
    render(
      <IssuesPanel
        issues={[issue({ code: "line:l2", kind: "review-flag", lineId: "l2", title: "Flagged for review" })]}
        onFocusField={vi.fn()}
        resolve={makeResolve({ confirmFlaggedLine })}
        lines={[makeLine({ id: "l2", lineNumber: 2, supplierItemCode: "S-7", needsReview: true })]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(confirmFlaggedLine).toHaveBeenCalledWith({ id: "l2", lineNumber: 2, supplierItemCode: "S-7" });
  });

  test("an ai-suggestion card keeps Accept AND offers Enter manually", () => {
    const onFix = vi.fn();
    const startLineEdit = vi.fn();
    render(
      <IssuesPanel
        issues={[issue({ code: "line:l3", kind: "ai-suggestion", lineId: "l3", title: "AI suggestion", fixAction: { label: "Accept suggestion" } })]}
        onFocusField={vi.fn()}
        onFix={onFix}
        resolve={makeResolve({ startLineEdit })}
        lines={[makeLine({ id: "l3", aiSuggestion: { supplierItemCode: "AI-5", confidence: 0.9, reason: "", provenance: "ai" } })]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Accept suggestion" }));
    expect(onFix).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /enter manually/i }));
    expect(startLineEdit).toHaveBeenCalledWith("l3", "AI-5");
  });

  test("every card is anchored with data-issue-ref (the strip chip jump target)", () => {
    render(
      <IssuesPanel
        issues={[issue({ code: "line:l1", kind: "manual-code", lineId: "l1" })]}
        onFocusField={vi.fn()}
        resolve={makeResolve()}
        lines={[makeLine({ id: "l1" })]}
      />,
    );
    expect(document.querySelector('[data-issue-ref="line:l1"]')).not.toBeNull();
  });

  test("without a resolve API the panel degrades to the read-only 'Where →' (pure view)", () => {
    render(
      <IssuesPanel
        issues={[issue({ code: "line:l1", kind: "manual-code", lineId: "l1" })]}
        onFocusField={vi.fn()}
        lines={[makeLine({ id: "l1" })]}
      />,
    );
    expect(screen.getByRole("button", { name: /show .* in the mapper/i })).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});
