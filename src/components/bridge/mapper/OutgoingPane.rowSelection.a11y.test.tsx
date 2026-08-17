// SELECTING AN OUTPUT ROW WAS MOUSE-ONLY — AND THE FIRST FIX FOR IT WAS WORSE.
//
// Selection is not decorative: it drives `?field=` (the shareable deep link) and the
// workbench's focus/scroll target. It lived on an `onClick` on a bare <div> with no role, no
// tabIndex and no key handler, so a keyboard operator could reach every control INSIDE the row
// and never the row itself.
//
// The first attempt gave the ROW `role="button"` + `tabIndex={0}`. That row contains the source
// picker, the "= value" and "Edit value" chips and the fixed-value input — an interactive
// element may not have focusable descendants — so every output field tripped axe's
// `nested-interactive`: /inbox/ord-002 went from 0 violating nodes to 13 locally (55 in CI,
// which renders more rows), one per output row.
//
// The keyboard path now lives on a CHILD: the field-name <button>, which is already the row's
// first tab stop and already names the field. The row is a plain container again.
//
// Two things are pinned here, and the second is the one that matters long-term:
//   1. a keyboard operator can still select a field;
//   2. nothing inside the row is an interactive element WITH focusable descendants — the exact
//      shape axe refused — so the regression cannot come back quietly.

import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, fireEvent, screen, within } from "@testing-library/react";
import { OutgoingPane, type OutgoingPaneProps } from "./OutgoingPane";
import type { TargetField, SourceField } from "./types";
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

/** The child control that owns selection — a real button, so the browser gives it the keyboard. */
function selectControl(row: HTMLElement): HTMLElement {
  return within(row).getByRole("button", { name: /Select output field/i });
}

describe("OutgoingPane — an output row can be selected without a mouse", () => {
  it("exposes a named, focusable control for it", () => {
    const { row } = setup();
    const control = selectControl(row);

    expect(control.tagName).toBe("BUTTON");
    expect(control).toBeEnabled();
    expect(control.getAttribute("aria-label")).toContain("Quantity");
  });

  it("selects the field when that control is activated", () => {
    const { onSelect, row } = setup();
    fireEvent.click(selectControl(row));
    expect(onSelect).toHaveBeenCalledWith("Quantity");
  });

  it("does not make the ROW itself an interactive element", () => {
    // The regression, stated directly. A row that announces itself as a button is the thing
    // axe refused, because of what the row contains.
    const { row } = setup({ onSetFixedValue: vi.fn() });

    expect(row.getAttribute("role")).toBeNull();
    expect(row.getAttribute("tabindex")).toBeNull();
  });
});

/**
 * Every element that ARIA treats as interactive: the roles axe's `nested-interactive` rule
 * checks, whether they come from a tag or from an explicit `role`.
 */
const INTERACTIVE_SELECTOR = [
  "button", "a[href]", "input", "select", "textarea",
  '[role="button"]', '[role="link"]', '[role="checkbox"]', '[role="radio"]',
  '[role="tab"]', '[role="menuitem"]', '[role="option"]', '[role="switch"]',
  '[role="textbox"]', '[role="combobox"]', '[role="slider"]', '[role="spinbutton"]',
].join(",");

/** Anything the browser will put in the tab order (or that is programmatically focusable). */
const FOCUSABLE_SELECTOR = [
  "button:not([disabled])", "a[href]", "input:not([disabled])", "select:not([disabled])",
  "textarea:not([disabled])", "[tabindex]:not([tabindex='-1'])",
].join(",");

/**
 * The guard itself: interactive elements that CONTAIN a focusable element. Also treats the row
 * container as interactive when it has claimed a role or a tab stop, which is how the first fix
 * failed.
 */
function nestedInteractive(row: HTMLElement): string[] {
  const roots: HTMLElement[] = Array.from(row.querySelectorAll<HTMLElement>(INTERACTIVE_SELECTOR));
  if (row.matches(INTERACTIVE_SELECTOR) || row.hasAttribute("tabindex")) roots.unshift(row);

  return roots
    .filter((el) => el.querySelector(FOCUSABLE_SELECTOR) != null)
    .map((el) => `${el.tagName.toLowerCase()}[role=${el.getAttribute("role") ?? "-"}][aria-label=${el.getAttribute("aria-label") ?? "-"}]`);
}

describe("OutgoingPane — nothing interactive in the row may contain a focusable element", () => {
  /** The row with every control it can render at once — the densest real state. */
  function denseRow() {
    const incoming: SourceField[] = [
      { id: "Quantity", label: "Quantity", value: "3", group: "line", mapped: false, suggestedFor: null, suggestionConfidence: null },
    ];
    return setup({
      mappingMode: "picker",
      incomingFields: incoming,
      onPickSource: vi.fn(),
      onSetFixedValue: vi.fn(),
      onDisconnect: vi.fn(),
      manipulatorsOf: () => [],
      onFieldManipulatorsChange: vi.fn(),
    }).row;
  }

  it("finds no nested-interactive element in the dense row", () => {
    expect(nestedInteractive(denseRow())).toEqual([]);
  });

  it("finds none once the fixed-value editor is open either", () => {
    // The editor mounts an <input> and two buttons INSIDE the row — the descendants that made
    // an interactive row illegal in the first place.
    const { row } = setup({ onSetFixedValue: vi.fn() });
    fireEvent.click(within(row).getByRole("button", { name: /= value/i }));
    expect(screen.getByLabelText("Fixed value for Quantity")).toBeTruthy();

    expect(nestedInteractive(row)).toEqual([]);
  });
});

describe("OutgoingPane — anti-vacuity", () => {
  it("the row really does contain several focusable controls, so the guard has something to bite on", () => {
    // A guard that scans an empty row proves nothing. If this count ever drops to 1 the two
    // assertions above become tautologies and should be re-read, not trusted.
    const { row } = setup({ onSetFixedValue: vi.fn(), manipulatorsOf: () => [], onFieldManipulatorsChange: vi.fn() });
    const focusable = row.querySelectorAll(FOCUSABLE_SELECTOR);

    expect(focusable.length).toBeGreaterThanOrEqual(3);
  });

  it("the guard DETECTS the shape it exists to refuse", () => {
    // Reproduce the exact regression by hand — mark the row interactive, the way the reverted
    // fix did — and confirm the check refuses it. Without this the check could be blind and
    // every assertion above would be decoration.
    const { row } = setup({ onSetFixedValue: vi.fn() });
    expect(nestedInteractive(row)).toEqual([]);

    row.setAttribute("role", "button");
    row.setAttribute("tabindex", "0");

    const found = nestedInteractive(row);
    expect(found.length).toBe(1);
    expect(found[0]).toContain("div[role=button]");
  });

  it("still selects on a click anywhere in the row, and stays inert with no onSelect", () => {
    // The mouse path must survive, and a pane rendered without a selection handler must not
    // advertise a control that does nothing.
    const { onSelect, row } = setup();
    fireEvent.click(row);
    expect(onSelect).toHaveBeenCalledWith("Quantity");

    cleanup();
    const { container } = render(
      <OutgoingPane variant="order" targetFields={[FIELD]} statusInput={STATUS_INPUT} />,
    );
    const inert = within(container).getByText("Quantity").closest("[data-mapper-row]") as HTMLElement;
    expect(inert.getAttribute("role")).toBeNull();
    expect(within(inert).queryByRole("button", { name: /Select output field/i })).toBeNull();
  });
});
