// WP-14 AC — "the FE picker offers every exposed name."
//
// The constants test pins the vocabulary; this pins that the picker actually RENDERS it, grouped,
// and that picking a widened field fires onPickCanonical with the exact backend row key.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { OutputSourcePicker } from "./OutputSourcePicker";
import { CANONICAL_HEADER_SOURCE_FIELDS, CANONICAL_LINE_SOURCE_FIELDS } from "@/lib/api/types";

afterEach(cleanup);

function openPicker(fields: readonly string[], onPickCanonical = vi.fn()) {
  render(
    <OutputSourcePicker
      outputPath="deliveryCity"
      binding={{}}
      canonicalFields={fields}
      sourceTokens={[]}
      onPickCanonical={onPickCanonical}
      onPickSourceToken={vi.fn()}
      onPickFixed={vi.fn()}
      onClear={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /Source for deliveryCity/i }));
  return onPickCanonical;
}

describe("OutputSourcePicker offers the widened canonical vocabulary", () => {
  it("renders every header source field", () => {
    openPicker(CANONICAL_HEADER_SOURCE_FIELDS);
    for (const f of CANONICAL_HEADER_SOURCE_FIELDS) {
      expect(screen.getByText(f)).toBeTruthy();
    }
  });

  it("renders every line source field", () => {
    openPicker(CANONICAL_LINE_SOURCE_FIELDS);
    for (const f of CANONICAL_LINE_SOURCE_FIELDS) {
      expect(screen.getByText(f)).toBeTruthy();
    }
  });

  it("groups the header list by subject instead of one flat wall of names", () => {
    openPicker(CANONICAL_HEADER_SOURCE_FIELDS);
    for (const label of ["Order", "Totals & terms", "Order details", "Contact", "Ship to", "Bill to"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it("groups the line list by subject", () => {
    openPicker(CANONICAL_LINE_SOURCE_FIELDS);
    for (const label of ["Item", "Amounts", "Identifiers", "Delivery"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it("binds a widened field with the exact backend row key", () => {
    const onPick = openPicker(CANONICAL_HEADER_SOURCE_FIELDS);
    fireEvent.click(screen.getByText("ShipToCity"));
    expect(onPick).toHaveBeenCalledWith("ShipToCity");
  });

  it("still finds a widened field through search", () => {
    openPicker(CANONICAL_LINE_SOURCE_FIELDS);
    fireEvent.change(screen.getByLabelText(/search source fields/i), {
      target: { value: "manufacturerpart" },
    });
    expect(screen.getByText("ManufacturerPartNumber")).toBeTruthy();
    expect(screen.queryByText("Quantity")).toBeNull();
  });

  it("puts an unclassified name (a custom field key) in a trailing group rather than dropping it", () => {
    openPicker([...CANONICAL_HEADER_SOURCE_FIELDS, "MyCustomKey"]);
    expect(screen.getByText("MyCustomKey")).toBeTruthy();
    expect(screen.getByText("Other fields")).toBeTruthy();
  });
});
