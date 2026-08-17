// SELECTING AN OUTPUT ROW WAS MOUSE-ONLY.
//
// The row is a bare <div> carrying `onClick={() => onSelect(field.outputPath)}` — no role, no
// tabIndex, no key handler. Selection is not decorative: it drives `?field=` (the shareable
// deep link) and the workbench's focus/scroll target. A keyboard or screen-reader operator
// could tab to every control INSIDE the row and never reach the row itself.
//
// The guard the fix carries is as load-bearing as the handler: the fixed-value <input> is a
// descendant of this same div and its own Enter handler does not stop propagation, so an
// unguarded row handler would fire on every Enter typed into it.

import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, fireEvent, screen, within } from "@testing-library/react";
import { OutgoingPane, type OutgoingPaneProps } from "./OutgoingPane";
import type { TargetField } from "./types";
import type { OutgoingStatusInput } from "./outgoingStatusModel";

afterEach(cleanup);

const FIELD: TargetField = { outputPath: "Quantity", label: "Quantity", scope: "line" };

const STATUS_INPUT: OutgoingStatusInput = {
  outputConnections: {},
  sourceConnections: {},
  fixedValues: {},
  tokenValueById: new Map(),
  canonicalValueByKey: new Map(),
  labelForCanonical: (k) => k,
  valuesKnown: true,
};

function setup(extra: Partial<OutgoingPaneProps> = {}) {
  const onSelect = vi.fn();
  const props: OutgoingPaneProps = {
    variant: "order",
    targetFields: [FIELD],
    statusInput: STATUS_INPUT,
    onSelect,
    ...extra,
  };
  const { container } = render(<OutgoingPane {...props} />);
  const row = within(container).getByText("Quantity").closest("[data-mapper-row]") as HTMLElement;
  return { onSelect, row, container };
}

describe("OutgoingPane — an output row can be selected without a mouse", () => {
  it("is focusable and exposed as a control, not as an anonymous box", () => {
    const { row } = setup();
    expect(row.getAttribute("tabindex")).toBe("0");
    expect(row.getAttribute("role")).toBe("button");
    expect(row.getAttribute("aria-label")).toContain("Quantity");
  });

  it("selects the field on Enter", () => {
    const { onSelect, row } = setup();
    fireEvent.keyDown(row, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith("Quantity");
  });

  it("selects the field on Space", () => {
    const { onSelect, row } = setup();
    fireEvent.keyDown(row, { key: " " });
    expect(onSelect).toHaveBeenCalledWith("Quantity");
  });
});

describe("OutgoingPane — anti-vacuity: the row handler must not swallow its descendants' keys", () => {
  it("does not select the row when Enter is pressed inside the fixed-value input", () => {
    // The input's Enter commits the value and does not stopPropagation, so an unguarded row
    // handler would fire on the same keystroke — selecting (and re-routing `?field=`) on every
    // value the operator types.
    const onSetFixedValue = vi.fn();
    const { onSelect, row } = setup({ onSetFixedValue });

    fireEvent.click(within(row).getByRole("button", { name: /= value/i }));
    const input = screen.getByLabelText("Fixed value for Quantity");
    onSelect.mockClear();

    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSelect).not.toHaveBeenCalled();
  });

  it("still selects on click, and stays inert when the host passes no onSelect", () => {
    // Two controls in one: the mouse path must survive the change, and a pane rendered without
    // a selection handler must not advertise a role and a tab stop that do nothing.
    const { onSelect, row } = setup();
    fireEvent.click(row);
    expect(onSelect).toHaveBeenCalledWith("Quantity");

    cleanup();
    const { container } = render(
      <OutgoingPane variant="order" targetFields={[FIELD]} statusInput={STATUS_INPUT} />,
    );
    const inert = within(container).getByText("Quantity").closest("[data-mapper-row]") as HTMLElement;
    expect(inert.getAttribute("tabindex")).toBeNull();
    expect(inert.getAttribute("role")).toBeNull();
  });
});
