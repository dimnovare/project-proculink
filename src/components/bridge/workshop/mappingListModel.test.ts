import { describe, test, expect } from "vitest";
import { splitMappings, type MappingRow } from "./mappingListModel";

const sug: MappingRow[] = [
  { outputField: "orderNumber", source: "PO", confidence: 0.99, accepted: true },
  { outputField: "items[].sku", source: "WIDGET-B", confidence: 0.6, accepted: false },
  { outputField: "currency", source: null, confidence: 0, accepted: false },
];

describe("splitMappings", () => {
  test("auto = accepted/high-confidence; attention = unmapped or low-confidence", () => {
    const { auto, attention } = splitMappings(sug, { trustedThreshold: 0.85 });
    expect(auto.map((a) => a.outputField)).toEqual(["orderNumber"]);
    expect(attention.map((a) => a.outputField)).toEqual(["items[].sku", "currency"]);
  });

  test("high-confidence WITH a source is auto even when not yet accepted", () => {
    const rows: MappingRow[] = [{ outputField: "date", source: "OrderDate", confidence: 0.9, accepted: false }];
    const { auto, attention } = splitMappings(rows, { trustedThreshold: 0.85 });
    expect(auto.map((a) => a.outputField)).toEqual(["date"]);
    expect(attention).toEqual([]);
  });

  test("high-confidence but NO source is attention (nothing to commit)", () => {
    const rows: MappingRow[] = [{ outputField: "buyer", source: null, confidence: 0.95, accepted: false }];
    const { auto, attention } = splitMappings(rows, { trustedThreshold: 0.85 });
    expect(auto).toEqual([]);
    expect(attention.map((a) => a.outputField)).toEqual(["buyer"]);
  });

  test("accepted rows are always auto regardless of confidence or source", () => {
    const rows: MappingRow[] = [
      { outputField: "note", source: null, confidence: 0.1, accepted: true },
    ];
    const { auto, attention } = splitMappings(rows, { trustedThreshold: 0.85 });
    expect(auto.map((a) => a.outputField)).toEqual(["note"]);
    expect(attention).toEqual([]);
  });

  test("the threshold is inclusive (confidence === threshold counts as auto)", () => {
    const rows: MappingRow[] = [{ outputField: "x", source: "S", confidence: 0.85, accepted: false }];
    const { auto } = splitMappings(rows, { trustedThreshold: 0.85 });
    expect(auto.map((a) => a.outputField)).toEqual(["x"]);
  });

  test("defaults trustedThreshold to 0.85 when omitted", () => {
    const rows: MappingRow[] = [
      { outputField: "a", source: "S", confidence: 0.86, accepted: false },
      { outputField: "b", source: "S", confidence: 0.84, accepted: false },
    ];
    const { auto, attention } = splitMappings(rows);
    expect(auto.map((a) => a.outputField)).toEqual(["a"]);
    expect(attention.map((a) => a.outputField)).toEqual(["b"]);
  });

  test("preserves input order within each bucket", () => {
    const rows: MappingRow[] = [
      { outputField: "lo1", source: "S", confidence: 0.2, accepted: false },
      { outputField: "hi1", source: "S", confidence: 0.95, accepted: false },
      { outputField: "lo2", source: null, confidence: 0, accepted: false },
      { outputField: "hi2", source: "S", confidence: 0.9, accepted: false },
    ];
    const { auto, attention } = splitMappings(rows, { trustedThreshold: 0.85 });
    expect(auto.map((a) => a.outputField)).toEqual(["hi1", "hi2"]);
    expect(attention.map((a) => a.outputField)).toEqual(["lo1", "lo2"]);
  });

  test("empty input → empty buckets", () => {
    expect(splitMappings([], { trustedThreshold: 0.85 })).toEqual({ auto: [], attention: [] });
  });
});
