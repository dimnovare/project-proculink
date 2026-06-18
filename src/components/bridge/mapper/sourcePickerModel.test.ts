import { describe, it, expect } from "vitest";
import {
  buildSourceOptions,
  suggestedSourceFor,
  currentSourceLabel,
  isUnsourced,
} from "./sourcePickerModel";
import type { SourceField } from "./types";
import type { OutgoingFieldStatus } from "./outgoingStatusModel";

const f = (over: Partial<SourceField>): SourceField =>
  ({
    id: "x",
    label: "X",
    value: "",
    group: "header",
    suggestedFor: undefined,
    suggestionConfidence: undefined,
    ...over,
  }) as SourceField;

const fields: SourceField[] = [
  f({ id: "raw:po", label: "PO_NUMBER", value: "po-1", group: "raw" }),
  f({ id: "buyerName", label: "Buyer name", value: "Acme", group: "header" }),
  f({ id: "line0.sku", label: "SKU", value: "ABC", group: "line", suggestedFor: "items[].sku", suggestionConfidence: 0.92 }),
];

describe("buildSourceOptions — ordered + filtered source list", () => {
  it("floats the AI suggestion to the top, then header → parties → line → raw", () => {
    const opts = buildSourceOptions(fields, "", "line0.sku");
    expect(opts.map((o) => o.id)).toEqual(["line0.sku", "buyerName", "raw:po"]);
    expect(opts[0].suggested).toBe(true);
    expect(opts[0].confidence).toBe(0.92);
  });

  it("filters by label OR value, case-insensitive", () => {
    expect(buildSourceOptions(fields, "acme", null).map((o) => o.id)).toEqual(["buyerName"]);
    expect(buildSourceOptions(fields, "po_", null).map((o) => o.id)).toEqual(["raw:po"]);
  });

  it("with no suggestion, pure group order (header, line, raw)", () => {
    expect(buildSourceOptions(fields, "", null).map((o) => o.id)).toEqual(["buyerName", "line0.sku", "raw:po"]);
  });
});

describe("suggestedSourceFor — the AI source for an output path", () => {
  it("returns the field whose suggestedFor matches", () => {
    expect(suggestedSourceFor("items[].sku", fields)?.id).toBe("line0.sku");
  });
  it("returns null when nothing is suggested for the path", () => {
    expect(suggestedSourceFor("currency", fields)).toBeNull();
  });
});

describe("currentSourceLabel / isUnsourced — the chip's reading of the row status", () => {
  const st = (over: Partial<OutgoingFieldStatus>): OutgoingFieldStatus =>
    ({ kind: "none", mapped: false, required: false, ...over }) as OutgoingFieldStatus;

  it("wired → the source label without the arrow", () => {
    expect(currentSourceLabel(st({ kind: "wired", source: "← Buyer name" }))).toBe("Buyer name");
  });
  it("fixed → the fixed value label", () => {
    expect(currentSourceLabel(st({ kind: "fixed", source: "EUR" }))).toBe("EUR");
  });
  it("none → the call-to-action + isUnsourced true", () => {
    const s = st({ kind: "none" });
    expect(currentSourceLabel(s)).toBe("Pick a field");
    expect(isUnsourced(s)).toBe(true);
  });
});
