// The output row's source picker may not dress a saved supplier mapping as a model score.
//
// The option label was `✦ AI{confidence != null ? ` ${pct}%` : ""}` in the AI violet, and
// `GET /api/orders/{id}/mapping-suggestions` sent a hard-coded `confidence: 0.95` for every
// entry read back from the supplier's SAVED PO mapping. So the option a procurement operator
// was most likely to trust read "✦ AI 95%" when no model had ever looked at it.
//
// Asserted on the visible option text and the option's accessible name.

import { describe, it, expect, vi } from "vitest";
import { afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SourcePickerChip } from "./SourcePickerChip";
import type { SourceField } from "./types";
import type { OutgoingFieldStatus } from "./outgoingStatusModel";

afterEach(cleanup);

const UNSOURCED: OutgoingFieldStatus = {
  outputPath: "ItemCode",
  mapped: false,
  kind: "none",
  source: null,
  valuePreview: null,
  required: true,
  auto: false,
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
  id: "IhreMaterialnr",
  label: "Ihre Materialnr",
  value: "88-4410",
  group: "line",
  mapped: false,
  suggestedFor: "ItemCode",
  suggestionConfidence: 0.86,
  suggestionBasis: "model",
};

/** Render the chip and open its dropdown — the badge only exists inside the option list. */
function openPicker(fields: SourceField[]) {
  const view = render(
    <SourcePickerChip
      outputPath="ItemCode"
      status={UNSOURCED}
      incomingFields={fields}
      onPickSource={vi.fn()}
      onPickFixed={vi.fn()}
      onClear={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /pick a field/i }));
  return view;
}

/** The <button role="option"> for a given incoming label. */
function option(label: string): HTMLElement {
  const opt = screen.getAllByRole("option").find((el) => el.textContent?.includes(label));
  if (!opt) throw new Error(`no option for "${label}"`);
  return opt;
}

describe("SourcePickerChip — a saved-mapping option", () => {
  it("reads 'Saved mapping', not '✦ AI 95%'", () => {
    openPicker([SAVED_FIELD]);
    const opt = option("Buyer item code");
    expect(opt.textContent).toContain("Saved mapping");
    expect(opt.textContent).not.toMatch(/✦ AI/);
    expect(opt.textContent).not.toMatch(/95/);
    expect(opt.textContent).not.toMatch(/%/);
  });

  it("puts no 'AI' claim in any accessible name", () => {
    openPicker([SAVED_FIELD]);
    const names = Array.from(document.querySelectorAll("[aria-label]")).map(
      (el) => el.getAttribute("aria-label") ?? "",
    );
    expect(names.filter((n) => /AI confidence/.test(n))).toEqual([]);
    expect(screen.queryByLabelText("AI suggested")).toBeNull();
  });
});

describe("SourcePickerChip — a scored option is unchanged", () => {
  it("still reads '✦ AI 86%'", () => {
    openPicker([SCORED_FIELD]);
    const opt = option("Ihre Materialnr");
    expect(opt.textContent).toContain("✦ AI 86%");
    expect(screen.getByLabelText("AI suggested")).toBeTruthy();
  });

  it("reads an older response with no `basis` as a model score", () => {
    openPicker([{ ...SCORED_FIELD, suggestionBasis: undefined }]);
    expect(option("Ihre Materialnr").textContent).toContain("✦ AI 86%");
  });
});
