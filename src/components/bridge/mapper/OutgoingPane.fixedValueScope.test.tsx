// A FIXED VALUE TYPED ON A LINE FIELD WAS WRITTEN TO THE HEADER.
//
// `OutgoingPaneProps.onSetFixedValue` was declared with two parameters. The model's handler
// takes three — `(outputPath, value, scope = "header")` — so every fixed value this pane set
// arrived with the scope missing and defaulted to header. Quantity, UnitPrice and
// SupplierItemCode are LINE fields, and three of the four the supplier dispatcher requires:
// the violet "fixed" chip appeared on the row, the operator moved on, and the line column
// shipped empty because the literal had been written to `output.header[path]`.
//
// The workbench's own drop handler passed `field?.scope` (MapperWorkbench.tsx onWireConnect)
// and so did onUseCatalogPrice — only the pane's inline editor dropped it, and no test looked.
//
// These assert WHERE the value landed, by running the captured call through the REAL
// `withFixedValue` the model uses. A test that only checked "onSetFixedValue was called with
// a value" passes against the defect, which is how the defect survived.

import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, within } from "@testing-library/react";
import { OutgoingPane, type OutgoingPaneProps } from "./OutgoingPane";
import { emptyOverride, withFixedValue } from "./mapperModel";
import type { TargetField } from "./types";
import type { OutgoingStatusInput } from "./outgoingStatusModel";

afterEach(cleanup);

const QUANTITY: TargetField = { outputPath: "Quantity", label: "Quantity", scope: "line" };
const CURRENCY: TargetField = { outputPath: "Currency", label: "Currency", scope: "header" };

const STATUS_INPUT: OutgoingStatusInput = {
  outputConnections: {},
  sourceConnections: {},
  fixedValues: {},
  tokenValueById: new Map(),
  canonicalValueByKey: new Map(),
  labelForCanonical: (k) => k,
  valuesKnown: true,
};

/**
 * Drives the pane's real inline fixed-value editor for one field and returns the arguments the
 * host received. "wires" mode (the default) is used because it renders the "= value" chip
 * directly on the row; picker mode reaches the same `startFixedEdit` through its chip footer.
 */
function typeFixedValue(field: TargetField, value: string) {
  const onSetFixedValue = vi.fn();
  const props: OutgoingPaneProps = {
    variant: "order",
    targetFields: [field],
    statusInput: STATUS_INPUT,
    onSetFixedValue,
  };
  const { container } = render(<OutgoingPane {...props} />);

  const row = within(container).getByText(field.label!).closest("[data-mapper-row]") as HTMLElement;
  fireEvent.click(within(row).getByRole("button", { name: /= value/i }));

  const input = screen.getByLabelText(`Fixed value for ${field.outputPath}`);
  fireEvent.change(input, { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "Set" }));

  expect(onSetFixedValue).toHaveBeenCalledTimes(1);
  return onSetFixedValue.mock.calls[0] as [string, string | null, "header" | "line" | undefined];
}

describe("OutgoingPane — a fixed value on a LINE field", () => {
  it("passes the row's own scope to the host", () => {
    const [path, value, scope] = typeFixedValue(QUANTITY, "12");
    expect(path).toBe("Quantity");
    expect(value).toBe("12");
    // The defect: this argument was absent, and `withFixedValue` defaults a missing scope to
    // "header".
    expect(scope).toBe("line");
  });

  it("lands in output.lines, and NOT in output.header", () => {
    // The assertion that matters. Run the captured call through the same pure helper the model
    // applies, and look at the document that would be PUT.
    const [path, value, scope] = typeFixedValue(QUANTITY, "12");
    const next = withFixedValue(emptyOverride(), path, value, scope);

    expect(next.output?.lines?.Quantity?.fixedValue).toBe("12");
    expect(next.output?.header?.Quantity).toBeUndefined();
  });
});

describe("OutgoingPane — anti-vacuity: a HEADER field must still land in the header", () => {
  it("does not send every fixed value to the line scope instead", () => {
    // The mirrored defect. "Always pass line" would satisfy the two assertions above and break
    // every header field in the product — Currency, PoNumber, BuyerName, payment terms.
    const [path, value, scope] = typeFixedValue(CURRENCY, "EUR");
    expect(scope).toBe("header");

    const next = withFixedValue(emptyOverride(), path, value, scope);
    expect(next.output?.header?.Currency?.fixedValue).toBe("EUR");
    expect(next.output?.lines?.Currency).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE SAME EDITOR, REACHED THE OTHER WAY: the picker's "= Fixed value…" footer.
//
// `commitFixedEdit` calls `onSetFixedValue?.()` — optional chaining. The row chip that opens
// the editor in "wires" mode is gated on that prop being present, and so is the fixed-chip's
// own edit affordance. The PICKER footer was not: it was handed `startFixedEdit`
// unconditionally, so a host that switched picker mode on without wiring the setter would
// render a working-looking editor whose "Set" button did nothing at all and reported nothing.
// Nothing ships in that state today, which is exactly why it was worth closing before one does.
//
// These drive the real portalled picker, not a stub, and the `pick-fixed-value` locator they
// use is the shared one: the two source pickers put it on their footer entry and the row chip
// puts it on "= value", so one selector reaches the control on all three fixed-value surfaces.
// ─────────────────────────────────────────────────────────────────────────────

/** Render the pane in picker mode for one field and open the source picker's dropdown. */
function openPicker(onSetFixedValue?: OutgoingPaneProps["onSetFixedValue"]) {
  const props: OutgoingPaneProps = {
    variant: "order",
    targetFields: [QUANTITY],
    statusInput: STATUS_INPUT,
    mappingMode: "picker",
    incomingFields: [],
    onPickSource: vi.fn(),
    onSetFixedValue,
  };
  const view = render(<OutgoingPane {...props} />);
  // The trigger's accessible name is its CURRENT binding ("Auto (1:1)" for Quantity, "pick a
  // field" when unsourced), so it is matched by its listbox role relationship instead.
  const triggers = view.container.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="listbox"]');
  expect(triggers).toHaveLength(1);
  fireEvent.click(triggers[0]);
  return view;
}

describe("OutgoingPane — the picker's fixed-value entry is gated on the host being able to save", () => {
  it("does not offer it when the host passes no onSetFixedValue", () => {
    openPicker(undefined);
    // The dropdown itself must still be open — otherwise this passes for the wrong reason.
    expect(screen.getByRole("listbox", { name: `Source for ${QUANTITY.outputPath}` })).toBeTruthy();
    expect(screen.queryByTestId("pick-fixed-value")).toBeNull();
  });

  it("offers it, and the editor it opens really commits, when the host does", () => {
    // Anti-vacuity for the test above: "never render the entry" would satisfy it and remove a
    // working feature from the order review screen.
    const onSetFixedValue = vi.fn();
    openPicker(onSetFixedValue);

    fireEvent.click(screen.getByTestId("pick-fixed-value"));
    const input = screen.getByLabelText(`Fixed value for ${QUANTITY.outputPath}`);
    fireEvent.change(input, { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Set" }));

    expect(onSetFixedValue).toHaveBeenCalledWith(QUANTITY.outputPath, "12", QUANTITY.scope);
  });
});

describe("OutgoingPane — the shared fixed-value locator is on the wires-mode chip too", () => {
  it("finds the row's '= value' chip by the same test id the pickers use", () => {
    // "wires" is the default and what /inbox/[orderId] renders, so a cross-surface script that
    // only knew the picker footer would find nothing on the screen operators actually use.
    const { container } = render(
      <OutgoingPane
        variant="order"
        targetFields={[QUANTITY]}
        statusInput={STATUS_INPUT}
        onSetFixedValue={vi.fn()}
      />,
    );
    const row = within(container).getByText(QUANTITY.label!).closest("[data-mapper-row]") as HTMLElement;
    expect(within(row).getByTestId("pick-fixed-value").textContent).toContain("= value");
  });
});
