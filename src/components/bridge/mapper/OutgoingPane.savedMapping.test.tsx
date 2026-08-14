// The "what we'll send" column may not print a confidence nobody measured.
//
// `GET /api/orders/{id}/mapping-suggestions` used to send a hard-coded `confidence: 0.95` for
// every entry read back from a supplier's SAVED PO mapping. This pane fed that number to
// <ConfidenceChip>, which announced it as "AI confidence 95%".
//
// SCOPE NOTE, because it is load-bearing for reading these tests: the pane has TWO confidence
// surfaces and only one of them is reachable today.
//
//   • The inline AI-fix strip (OutgoingPane.tsx, `aiFix`) is gated on
//     `needsSource = status.required && !status.mapped`. `isRequiredOutput` returns true only
//     for PoNumber / Quantity / UnitPrice / SupplierItemCode, and all four are members of
//     CANONICAL_SPINE, so `computeOutgoingStatus` always resolves them through its implicit
//     1:1 "auto" branch with `mapped: true`. `needsSource` is therefore never true and the
//     strip does not render in the shipped app. Its chip is fixed anyway — it just cannot be
//     driven from here.
//   • The source picker (SourcePickerChip) IS reachable, and is where an operator actually
//     meets the suggestion. Its own saved-mapping behaviour is pinned in
//     SourcePickerChip.savedMapping.test.tsx; what this file adds is the whole-pane
//     invariant: with a saved-mapping suggestion in play, no percentage reaches the screen.

import { describe, it, expect, vi } from "vitest";
import { afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { OutgoingPane, type OutgoingPaneProps } from "./OutgoingPane";
import type { SourceField, TargetField } from "./types";
import type { OutgoingStatusInput } from "./outgoingStatusModel";

afterEach(cleanup);

const TARGETS: TargetField[] = [{ outputPath: "ItemCode", label: "Item code", scope: "line" }];

const STATUS_INPUT: OutgoingStatusInput = {
  outputConnections: {},
  sourceConnections: {},
  fixedValues: {},
  tokenValueById: new Map(),
  canonicalValueByKey: new Map(),
  labelForCanonical: (k) => k,
  // Both value maps are empty and no order backs this fixture, so the honest flag is false:
  // an unresolved field here means nobody looked, not that the supplier gets nothing.
  valuesKnown: false,
};

const SAVED_FIELD: SourceField = {
  id: "BuyerItemCode",
  label: "Buyer item code",
  value: "ACM-BLT-M8",
  group: "line",
  mapped: false,
  suggestedFor: "ItemCode",
  suggestionConfidence: null,
  suggestionBasis: "saved_mapping",
};

const SCORED_FIELD: SourceField = {
  ...SAVED_FIELD,
  id: "IhreMaterialnr",
  label: "Ihre Materialnr",
  suggestionConfidence: 0.86,
  suggestionBasis: "model",
};

function setup(incomingFields: SourceField[]) {
  const props: OutgoingPaneProps = {
    variant: "order",
    targetFields: TARGETS,
    statusInput: STATUS_INPUT,
    mappingMode: "picker",
    incomingFields,
    onPickSource: vi.fn(),
  };
  return render(<OutgoingPane {...props} />);
}

function accessibleNames(): string[] {
  return Array.from(document.querySelectorAll("[aria-label]")).map(
    (el) => el.getAttribute("aria-label") ?? "",
  );
}

describe("OutgoingPane — a saved-mapping suggestion", () => {
  it("prints no percentage anywhere in the column", () => {
    const { container } = setup([SAVED_FIELD]);
    fireEvent.click(screen.getByRole("button", { name: /pick a field/i }));
    expect(document.body.textContent).not.toMatch(/95/);
    expect(container.textContent).not.toMatch(/%/);
  });

  it("claims 'AI confidence' in no accessible name", () => {
    setup([SAVED_FIELD]);
    fireEvent.click(screen.getByRole("button", { name: /pick a field/i }));
    for (const name of accessibleNames()) expect(name).not.toMatch(/AI confidence/);
  });

  it("names the suggestion 'Saved mapping' where it surfaces", () => {
    setup([SAVED_FIELD]);
    fireEvent.click(screen.getByRole("button", { name: /pick a field/i }));
    expect(screen.getByText("Saved mapping")).toBeTruthy();
  });
});

describe("OutgoingPane — a real model score is untouched", () => {
  it("still shows 86% on the suggested source", () => {
    setup([SCORED_FIELD]);
    fireEvent.click(screen.getByRole("button", { name: /pick a field/i }));
    const opt = screen.getAllByRole("option").find((el) => el.textContent?.includes("Ihre Materialnr"));
    expect(opt?.textContent).toContain("✦ AI 86%");
  });
});
