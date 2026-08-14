// The outgoing column has to MARK the field the toolbar is complaining about.
//
// PR 181 gave `OutgoingFieldStatus` a tri-state `resolution` and repointed the pane HEADER count
// (`summary.requiredUnmapped`) at it, but left the per-ROW split on `status.required &&
// !status.mapped`. Every required canonical name is a CANONICAL_SPINE member, so
// `computeOutgoingStatus` claims all four through its implicit 1:1 "auto" branch with
// `mapped: true` — the row predicate could not be true, and the toolbar could say "1 field needs
// a source" over a column in which nothing was marked.
//
// The three cases a REQUIRED row can be in, and what each must look like:
//
//   • resolved → normal. Nothing here asserts about it beyond it staying out of the way.
//   • missing  → hoisted above the auto group AND carrying a visible amber marker. A border tint
//                alone is not "marked"; the operator has to be able to read which field it is.
//   • unknown  → NOT amber (we did not look, so we may not accuse) and NOT counted in the
//                "N fields ready" summary either, because "we didn't check" rendering as "ready"
//                is the same defect pointed the other way.

import { describe, it, expect, vi } from "vitest";
import { afterEach } from "vitest";
import { cleanup, render, within } from "@testing-library/react";
import { OutgoingPane, type OutgoingPaneProps } from "./OutgoingPane";
import type { TargetField } from "./types";
import type { OutgoingStatusInput } from "./outgoingStatusModel";

afterEach(cleanup);

// SupplierItemCode is required (REQUIRED_CANONICAL) and a spine member, so it is the shipped
// common case: an unmapped order resolves it through the auto branch to nothing at all.
const REQUIRED: TargetField = { outputPath: "SupplierItemCode", label: "Supplier item code", scope: "line" };
const OPTIONAL: TargetField = { outputPath: "BuyerName", label: "Buyer name", scope: "header" };

function statusInput(valuesKnown: boolean): OutgoingStatusInput {
  return {
    outputConnections: {},
    sourceConnections: {},
    fixedValues: {},
    // Empty on purpose: nothing resolves. `valuesKnown` is the whole question — whether that
    // emptiness is the order's answer or the absence of one.
    tokenValueById: new Map(),
    canonicalValueByKey: new Map(),
    labelForCanonical: (k) => k,
    valuesKnown,
  };
}

function setup(valuesKnown: boolean) {
  const props: OutgoingPaneProps = {
    variant: "order",
    targetFields: [REQUIRED, OPTIONAL],
    statusInput: statusInput(valuesKnown),
    mappingMode: "picker",
    incomingFields: [],
    onPickSource: vi.fn(),
  };
  return render(<OutgoingPane {...props} />);
}

describe("OutgoingPane — a required output with no value, when we looked", () => {
  it("marks the row so the operator can see which field it is", () => {
    const { container } = setup(true);
    expect(within(container).getByText(/needs a value/i)).toBeTruthy();
  });

  it("puts the marker on the required field's own row, not loose in the column", () => {
    const { container } = setup(true);
    const row = within(container)
      .getByText("Supplier item code")
      .closest("[data-mapper-row]") as HTMLElement | null;
    expect(row).toBeTruthy();
    expect(within(row!).getByText(/needs a value/i)).toBeTruthy();
  });

  it("does not count it among the fields reported ready", () => {
    const { container } = setup(true);
    expect(within(container).getByText("1 field ready")).toBeTruthy();
  });
});

describe("OutgoingPane — a required output we could not evaluate", () => {
  it("does not accuse it of missing a source", () => {
    const { container } = setup(false);
    expect(within(container).queryByText(/needs a value/i)).toBeNull();
  });

  it("says the required fields were not checked", () => {
    const { container } = setup(false);
    expect(within(container).getByText(/not checked yet/i)).toBeTruthy();
  });

  it("does not count it among the fields reported ready either", () => {
    const { container } = setup(false);
    expect(within(container).getByText("1 field ready")).toBeTruthy();
  });
});
