// The received column's confidence slot may not print a percentage nobody measured.
//
// `GET /api/orders/{id}/mapping-suggestions` used to send a hard-coded `confidence: 0.95` for
// every entry read back from a supplier's SAVED PO mapping — no model produced it, because the
// suggester is deliberately never invoked on that path — and this row rendered it as an
// "AI confidence 95%" chip. An operator scanning the column for weak extractions read a
// configured fact as the most confident thing on the screen.
//
// Asserted on the RENDERED STRING and on accessible names, so a row that kept the data plumbing
// but restored the chip still fails.

import { describe, it, expect, vi } from "vitest";
import { afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { IncomingPane, type IncomingPaneProps } from "./IncomingPane";
import type { MapperSourcePortProps } from "./MapperWireLayer";
import type { SourceField } from "./types";

afterEach(cleanup);

const noop = () => {};

const portProps = (): MapperSourcePortProps => ({
  ref: noop,
  onPointerDown: noop,
  onPointerMove: noop,
  onPointerUp: noop,
  onPointerCancel: noop,
  onKeyDown: noop,
  tabIndex: 0,
  role: "button",
  "aria-label": "Map this field",
  "data-wired": false,
  "data-connecting": false,
});

/** Read back from the supplier's saved PO mapping — a configured fact, so nothing scored it. */
const SAVED_FIELD: SourceField = {
  id: "BuyerItemCode",
  label: "Buyer item code",
  value: "ACM-BLT-M8",
  group: "line",
  mapped: false,
  suggestedFor: "SupplierItemCode",
  suggestionConfidence: null,
  suggestionBasis: "saved_mapping",
};

/** A real scorer ran on this one. (group "line", not "raw": the raw group is collapsed by
 *  default, and a collapsed row renders nothing to assert on.) */
const SCORED_FIELD: SourceField = {
  id: "IhreMaterialnr",
  label: "Ihre Materialnr",
  value: "88-4410",
  group: "line",
  mapped: false,
  suggestedFor: "SupplierItemCode",
  suggestionConfidence: 0.86,
  suggestionBasis: "model",
};

function setup(fields: SourceField[]) {
  const props: IncomingPaneProps = {
    fields,
    query: "",
    onQuery: vi.fn(),
    filter: "all",
    onFilter: vi.fn(),
    portProps,
    hasIncomingSource: true,
    view: "fields",
  };
  return render(<IncomingPane {...props} />);
}

/** Every accessible name currently on screen. */
function accessibleNames(): string[] {
  return Array.from(document.querySelectorAll("[aria-label]")).map(
    (el) => el.getAttribute("aria-label") ?? "",
  );
}

describe("IncomingPane row — a suggestion read back from the saved mapping", () => {
  it("says 'Saved mapping' instead of a percentage", () => {
    setup([SAVED_FIELD]);
    expect(screen.getByText("Saved mapping")).toBeTruthy();
  });

  it("prints no percentage at all — not 95%, not any %", () => {
    const { container } = setup([SAVED_FIELD]);
    const row = container.querySelector("[data-mapper-row]");
    expect(row?.textContent).not.toMatch(/95/);
    expect(row?.textContent).not.toMatch(/%/);
  });

  it("puts 'AI confidence' in no accessible name on the row", () => {
    setup([SAVED_FIELD]);
    for (const name of accessibleNames()) expect(name).not.toMatch(/AI confidence/);
  });

  it("withholds the violet ✦ AI badge — no model produced this pairing", () => {
    const { container } = setup([SAVED_FIELD]);
    const row = container.querySelector("[data-mapper-row]");
    expect(row?.textContent).not.toMatch(/✦ AI/);
    expect(screen.queryByLabelText("AI suggested")).toBeNull();
  });
});

describe("IncomingPane row — a real model score", () => {
  it("still renders 86% as an AI confidence chip", () => {
    setup([SCORED_FIELD]);
    expect(screen.getByText("86%")).toBeTruthy();
    expect(screen.getByLabelText("AI confidence 86%")).toBeTruthy();
  });

  it("keeps the ✦ AI badge", () => {
    setup([SCORED_FIELD]);
    expect(screen.getByLabelText("AI suggested")).toBeTruthy();
  });

  it("reads an older response with no `basis` as a model score", () => {
    setup([{ ...SCORED_FIELD, suggestionBasis: undefined }]);
    expect(screen.getByLabelText("AI confidence 86%")).toBeTruthy();
  });
});

describe("IncomingPane row — a field with no suggestion at all", () => {
  it("stays blank rather than falling through to 'Saved mapping'", () => {
    // The rollout rule resolves "no basis + no score" to saved_mapping, so an unguarded row
    // would have labelled every ordinary field as a saved mapping.
    setup([{ id: "PoNumber", label: "PO number", value: "PO-2026-0142", group: "header", mapped: false }]);
    expect(screen.queryByText("Saved mapping")).toBeNull();
  });
});
