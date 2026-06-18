import { describe, test, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { IssuesPanel, type WorkshopIssue } from "./IssuesPanel";

afterEach(cleanup);

const issue = (over: Partial<WorkshopIssue> & { code: string }): WorkshopIssue => ({
  severity: "blocking",
  ref: over.code,
  title: "Needs a supplier code",
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
