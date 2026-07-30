// OutputSourcePicker — F-1 "bind ANY source field" RTL tests.
//
// Pins the contract the picker must keep: (1) canonical fields show first; (2) the raw source
// tokens (the getSourceTokens universe) are reachable behind the "More source fields…" disclosure,
// grouped, with their SAMPLE VALUES; (3) picking a SOURCE token writes the BARE token id via
// onPickSourceToken (the host clears canonicalField); (4) picking a canonical field goes through
// onPickCanonical (the host clears sourceToken). The mutually-exclusive clearing is the host's
// responsibility — these tests assert the picker fires the right callback with the bare id.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { OutputSourcePicker, type OutputBinding } from "./OutputSourcePicker";
import type { SourceToken } from "@/lib/api/types";

afterEach(cleanup);

// Mirrors a getSourceTokens(orderId) response: header cells + a line cell + a party XML attr + a
// PDF/email raw_field — each with a sample value.
const TOKENS: SourceToken[] = [
  { id: "cell:r1c5", label: "VAT number", value: "EE100200300", group: "header" },
  { id: "cell:r2c3", label: "EAN", value: "4006381333931", group: "line" },
  { id: "/Order/Party/VatId", label: "Supplier VAT", value: "DE811234567", group: "parties" },
  { id: "raw:Customer ref", label: "Customer ref", value: "CR-99", group: "raw" },
];

// F-1 Phase 4 — a REPEATING line column emits one token per data row, each carrying the SAME
// relativeId (the row stripped). The picker collapses them to one "per line" option (writes
// relativeId) with the absolute per-row cells behind "exact cell".
const LINE_TOKENS: SourceToken[] = [
  { id: "cell:r1c2", label: "Warehouse", value: "Warehouse", group: "header" },
  { id: "cell:r2c2", label: "Warehouse · row 2", value: "TLL-A", group: "line", relativeId: "cell:c2" },
  { id: "cell:r3c2", label: "Warehouse · row 3", value: "TLL-B", group: "line", relativeId: "cell:c2" },
  { id: "cell:r4c2", label: "Warehouse · row 4", value: "RIX-1", group: "line", relativeId: "cell:c2" },
];

const CANONICAL = ["PoNumber", "OrderDate", "BuyerName"];

function renderPicker(overrides?: {
  binding?: OutputBinding;
  sourceTokens?: SourceToken[];
  onPickSourceToken?: (id: string) => void;
  onPickCanonical?: (f: string) => void;
}) {
  const onPickSourceToken = overrides?.onPickSourceToken ?? vi.fn();
  const onPickCanonical = overrides?.onPickCanonical ?? vi.fn();
  render(
    <OutputSourcePicker
      outputPath="vatNumber"
      binding={overrides?.binding ?? {}}
      canonicalFields={CANONICAL}
      sourceTokens={overrides?.sourceTokens ?? TOKENS}
      onPickCanonical={onPickCanonical}
      onPickSourceToken={onPickSourceToken}
      onPickFixed={vi.fn()}
      onClear={vi.fn()}
    />,
  );
  return { onPickSourceToken, onPickCanonical };
}

function openPanel() {
  fireEvent.click(screen.getByRole("button", { name: /Source for vatNumber/i }));
  return screen.getByRole("listbox", { name: /Source for vatNumber/i });
}

describe("OutputSourcePicker — progressive disclosure", () => {
  it("shows canonical fields first and HIDES the raw tokens behind a 'More source fields…' disclosure", () => {
    renderPicker();
    const panel = openPanel();
    // Canonical fields are listed immediately.
    expect(within(panel).getByRole("option", { name: /PoNumber/ })).toBeInTheDocument();
    // The raw source tokens are NOT rendered until the disclosure is expanded.
    expect(within(panel).queryByRole("option", { name: /VAT number/ })).toBeNull();
    // The disclosure advertises how many source fields are available.
    expect(within(panel).getByRole("button", { name: /More source fields/ })).toHaveTextContent("4");
  });

  it("reveals the source-token universe grouped, with sample values, after expanding", () => {
    renderPicker();
    const panel = openPanel();
    fireEvent.click(within(panel).getByRole("button", { name: /More source fields/ }));

    // Grouped headings (header / line / parties / raw).
    expect(within(panel).getByText("Header fields")).toBeInTheDocument();
    expect(within(panel).getByText("Line items")).toBeInTheDocument();
    expect(within(panel).getByText("Parties")).toBeInTheDocument();
    expect(within(panel).getByText("Other fields")).toBeInTheDocument();

    // Each token option carries its label AND its sample value.
    const vatOption = within(panel).getByRole("option", { name: /VAT number/ });
    expect(vatOption).toHaveTextContent("VAT number");
    expect(vatOption).toHaveTextContent("EE100200300");
    expect(within(panel).getByText("4006381333931")).toBeInTheDocument();
  });

  it("typing a query auto-reveals the tokens (search reaches the collapsed universe)", () => {
    renderPicker();
    const panel = openPanel();
    fireEvent.change(within(panel).getByLabelText("Search source fields"), { target: { value: "ean" } });
    // The query matched a token by label even though the user never clicked "More…".
    expect(within(panel).getByRole("option", { name: /EAN/ })).toBeInTheDocument();
    // Canonical non-matches are filtered out.
    expect(within(panel).queryByRole("option", { name: /PoNumber/ })).toBeNull();
  });
});

describe("OutputSourcePicker — the write on pick", () => {
  it("picking a SOURCE token fires onPickSourceToken with the BARE token id", () => {
    const onPickSourceToken = vi.fn();
    renderPicker({ onPickSourceToken });
    const panel = openPanel();
    fireEvent.click(within(panel).getByRole("button", { name: /More source fields/ }));
    fireEvent.click(within(panel).getByRole("option", { name: /Supplier VAT/ }));

    // Bare id — NOT prefixed with `src::` (the backend prefixes on lookup).
    expect(onPickSourceToken).toHaveBeenCalledWith("/Order/Party/VatId");
    expect(onPickSourceToken).toHaveBeenCalledTimes(1);
  });

  it("picking a CANONICAL field fires onPickCanonical (not the token callback)", () => {
    const onPickCanonical = vi.fn();
    const onPickSourceToken = vi.fn();
    renderPicker({ onPickCanonical, onPickSourceToken });
    const panel = openPanel();
    fireEvent.click(within(panel).getByRole("option", { name: /BuyerName/ }));

    expect(onPickCanonical).toHaveBeenCalledWith("BuyerName");
    expect(onPickSourceToken).not.toHaveBeenCalled();
  });

  it("shows the bound source token's label + sample on the trigger when already bound", () => {
    renderPicker({ binding: { sourceToken: "cell:r1c5" } });
    // The chosen binding is legible on the row (label resolved from the token set).
    expect(screen.getByRole("button", { name: /Source for vatNumber — VAT number/i })).toBeInTheDocument();
  });
});

describe("OutputSourcePicker — F-1 Phase 4 relative line binding", () => {
  function openLinePanel() {
    fireEvent.click(screen.getByRole("button", { name: /Source for vatNumber/i }));
    const panel = screen.getByRole("listbox", { name: /Source for vatNumber/i });
    // Reveal the source-token universe (per-line options live under "More source fields…").
    fireEvent.click(within(panel).getByRole("button", { name: /More source fields/ }));
    return panel;
  }

  it("collapses a repeating line column to ONE 'per line' option (default) and writes its relativeId", () => {
    const onPickSourceToken = vi.fn();
    // Only the three repeating data-row cells (no header cell) → exactly one per-line column option.
    renderPicker({ sourceTokens: LINE_TOKENS.filter((t) => t.group === "line"), onPickSourceToken });
    const panel = openLinePanel();

    // The three per-row cells collapse to a single column option, marked "per line", with the
    // first line's sample value — NOT three separate row options.
    const perLine = within(panel).getByRole("option", { name: /per line/i });
    expect(perLine).toHaveTextContent("Warehouse");
    expect(perLine).toHaveTextContent("· per line");
    expect(perLine).toHaveTextContent("TLL-A");
    // Exactly ONE per-line option is shown by default (the three absolute rows stay collapsed).
    expect(within(panel).getAllByRole("option", { name: /per line/i })).toHaveLength(1);
    // The absolute per-row cells are NOT rendered until "exact cell" is opened.
    expect(within(panel).queryByRole("option", { name: /row 2/ })).toBeNull();

    // Picking it binds the RELATIVE id → ONE rule fills every line.
    fireEvent.click(perLine);
    expect(onPickSourceToken).toHaveBeenCalledWith("cell:c2");
    expect(onPickSourceToken).toHaveBeenCalledTimes(1);
  });

  it("the 'exact cell' affordance discloses the absolute per-row cells; picking one writes the absolute id", () => {
    const onPickSourceToken = vi.fn();
    renderPicker({ sourceTokens: LINE_TOKENS, onPickSourceToken });
    const panel = openLinePanel();

    // Absolute per-row cells are hidden until "exact cell" is expanded.
    expect(within(panel).queryByRole("option", { name: /row 3/ })).toBeNull();
    const exactCell = within(panel).getByRole("button", { name: /exact cell/i });
    expect(exactCell).toHaveTextContent("3"); // three rows
    fireEvent.click(exactCell);

    // Now each absolute cell is listed; pick row 3 → writes the ABSOLUTE id (a specific line).
    const row3 = within(panel).getByRole("option", { name: /row 3/ });
    fireEvent.click(row3);
    expect(onPickSourceToken).toHaveBeenCalledWith("cell:r3c2");
    expect(onPickSourceToken).toHaveBeenCalledTimes(1);
  });

  it("header tokens (relativeId null) still bind by their absolute id, as before", () => {
    const onPickSourceToken = vi.fn();
    // A header token alongside the per-line column: it must bind by its ABSOLUTE id (no relativeId).
    const tokens: SourceToken[] = [
      { id: "cell:r1c5", label: "Order ref", value: "PO-7700", group: "header" },
      ...LINE_TOKENS.filter((t) => t.group === "line"),
    ];
    renderPicker({ sourceTokens: tokens, onPickSourceToken });
    const panel = openLinePanel();
    // The header field appears in the "Header fields" group and binds by its absolute id.
    fireEvent.click(within(panel).getByRole("option", { name: /Order ref/ }));
    expect(onPickSourceToken).toHaveBeenCalledWith("cell:r1c5");
  });

  it("renders the bound 'per line' relative id as the column name + 'per line' on the trigger", () => {
    renderPicker({ sourceTokens: LINE_TOKENS, binding: { sourceToken: "cell:c2" } });
    // describeBinding matches the relativeId → column name, not row-2's cell label.
    expect(screen.getByRole("button", { name: /Source for vatNumber — Warehouse · per line/i })).toBeInTheDocument();
  });
});

/**
 * Offer ⇔ works — the picker must not offer a binding the delivered format cannot honour.
 *
 * The flat formats (CSV/JSON) are emitted by the override engine itself, so any name in the row
 * bag lands in the author's column. A structured format's shape is fixed by its standard, so the
 * backend can only write a rule BACK onto the canonical entity — and `EffectiveEntityResolver`
 * recognises 6 header + 7 line names for that, silently `continue`-ing every other rule.
 *
 * WP-14 widened the offered list from 13 names to 53 without gating it, so an operator on a cXML
 * connection could bind `ShipToCity`, see the row rendered as wired WITH a value preview, and
 * receive a document that ignored it. Pre-existing for ~13 names; at 53 it is an offer-⇔-works
 * violation, not an edge case.
 */
describe("OutputSourcePicker — the offered canonical set respects the delivered format", () => {
  const WIDE = ["PoNumber", "Quantity", "ShipToCity", "Incoterms", "ManufacturerPartNumber"];

  function renderWithFormat(outputFormat: string | null) {
    const onPickCanonical = vi.fn();
    render(
      <OutputSourcePicker
        outputPath="vatNumber"
        binding={{}}
        canonicalFields={WIDE}
        sourceTokens={[]}
        outputFormat={outputFormat}
        onPickCanonical={onPickCanonical}
        onPickSourceToken={vi.fn()}
        onPickFixed={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    return { onPickCanonical };
  }

  it("offers every canonical name for a flat format (CSV)", () => {
    renderWithFormat("csv");
    const panel = openPanel();
    for (const name of WIDE) {
      expect(within(panel).getByRole("option", { name: new RegExp(name) })).not.toBeDisabled();
    }
  });

  it("disables the names cXML cannot carry, and explains why", () => {
    renderWithFormat("cxml");
    const panel = openPanel();

    // The write-back set stays selectable — the operator CAN change these values.
    expect(within(panel).getByRole("option", { name: /PoNumber/ })).not.toBeDisabled();
    expect(within(panel).getByRole("option", { name: /Quantity/ })).not.toBeDisabled();

    // …and the rest are shown as unavailable rather than silently dropped after the fact.
    for (const name of ["ShipToCity", "Incoterms", "ManufacturerPartNumber"]) {
      expect(within(panel).getByRole("option", { name: new RegExp(name) })).toBeDisabled();
    }

    expect(within(panel).getByText(/document structure is set by the standard/i)).toBeInTheDocument();
  });

  it("does not fire onPickCanonical for a field the format cannot carry", () => {
    // The visual grey-out is not the guarantee; not writing the rule is.
    const { onPickCanonical } = renderWithFormat("ubl");
    const panel = openPanel();

    fireEvent.click(within(panel).getByRole("option", { name: /ShipToCity/ }));
    expect(onPickCanonical).not.toHaveBeenCalled();

    fireEvent.click(within(panel).getByRole("option", { name: /PoNumber/ }));
    expect(onPickCanonical).toHaveBeenCalledWith("PoNumber");
  });

  it("offers everything when the format is not yet known", () => {
    // Before the first preview returns there is no server truth. Defaulting to "restrict" would
    // hide working bindings on a CSV connection, which is the opposite failure.
    renderWithFormat(null);
    const panel = openPanel();
    for (const name of WIDE) {
      expect(within(panel).getByRole("option", { name: new RegExp(name) })).not.toBeDisabled();
    }
  });
});
