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

const CANONICAL = ["PoNumber", "OrderDate", "BuyerName"];

function renderPicker(overrides?: {
  binding?: OutputBinding;
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
      sourceTokens={TOKENS}
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
    expect(within(panel).getByText("Raw extras")).toBeInTheDocument();

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
