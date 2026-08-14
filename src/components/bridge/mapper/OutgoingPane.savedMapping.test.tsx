// The "what we'll send" column may not print a confidence nobody measured.
//
// `GET /api/orders/{id}/mapping-suggestions` used to send a hard-coded `confidence: 0.95` for
// every entry read back from a supplier's SAVED PO mapping. This pane fed that number to
// <ConfidenceChip>, which announced it as "AI confidence 95%".
//
// SCOPE NOTE, because it is load-bearing for reading these tests: the pane has TWO confidence
// surfaces, and BOTH are now reachable.
//
//   • The inline AI-fix strip (OutgoingPane.tsx, `aiFix`) is gated on `needsSource`. That
//     predicate used to be `status.required && !status.mapped`, and `isRequiredOutput` returns
//     true only for PoNumber / Quantity / UnitPrice / SupplierItemCode — all four members of
//     CANONICAL_SPINE, so `computeOutgoingStatus` always claimed them through its implicit 1:1
//     "auto" branch with `mapped: true`. The predicate was structurally false and the strip had
//     never rendered in the shipped app, which is what this note used to record. It is now
//     `status.required && status.resolution === "missing"` — a question about the VALUE rather
//     than about whether a rule emits the column — and the strip renders on exactly the case it
//     was written for: a required field the order leaves empty. The last describe below covers
//     it, because a surface nothing could reach is also a surface nothing was testing.
//   • The source picker (SourcePickerChip) was always reachable, and is where an operator
//     usually meets the suggestion. Its own saved-mapping behaviour is pinned in
//     SourcePickerChip.savedMapping.test.tsx; what this file adds is the whole-pane
//     invariant: with a saved-mapping suggestion in play, no percentage reaches the screen.
//
// The first three describes deliberately keep a NON-required target (`ItemCode`) and
// `valuesKnown: false`, so they exercise the picker with the strip absent. Changing that
// fixture would silently move them onto the strip's path and stop testing the picker.

import { describe, it, expect, vi } from "vitest";
import { afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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

// ── The inline AI-fix strip ──────────────────────────────────────────────────
// A REQUIRED target the order leaves empty, with the values actually loaded — the one state
// that makes `needsSource` true and puts the strip on screen. SupplierItemCode unresolved is
// the common case on a freshly uploaded order, not a corner.
const REQUIRED_TARGETS: TargetField[] = [
  { outputPath: "SupplierItemCode", label: "Supplier item code", scope: "line" },
];
const VALUES_KNOWN_INPUT: OutgoingStatusInput = { ...STATUS_INPUT, valuesKnown: true };

function setupStrip(field: SourceField) {
  const props: OutgoingPaneProps = {
    variant: "order",
    targetFields: REQUIRED_TARGETS,
    statusInput: VALUES_KNOWN_INPUT,
    mappingMode: "picker",
    incomingFields: [{ ...field, suggestedFor: "SupplierItemCode" }],
    onPickSource: vi.fn(),
  };
  return render(<OutgoingPane {...props} />);
}

/** The strip, located by its own Apply action — the only control it owns. */
function strip(container: HTMLElement): HTMLElement {
  return within(container).getByRole("button", { name: "Apply" }).parentElement as HTMLElement;
}

describe("OutgoingPane — the inline AI-fix strip on a required empty field", () => {
  it("renders at all (it could not, before the row predicate asked about values)", () => {
    const { container } = setupStrip(SAVED_FIELD);
    expect(strip(container).textContent).toMatch(/SUGGESTED/);
  });

  it("prints no percentage for a saved-mapping suggestion", () => {
    const { container } = setupStrip(SAVED_FIELD);
    expect(strip(container).textContent).not.toMatch(/%/);
    expect(within(strip(container)).getByText("Saved mapping")).toBeTruthy();
    for (const name of accessibleNames()) expect(name).not.toMatch(/AI confidence/);
  });

  it("still prints a real model score on the same strip", () => {
    const { container } = setupStrip(SCORED_FIELD);
    expect(within(strip(container)).getByLabelText("AI confidence 86%")).toBeTruthy();
  });
});
