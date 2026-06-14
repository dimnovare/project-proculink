import { describe, it, expect } from "vitest";
import {
  groupSourceFields,
  filterSourceFields,
  relevanceSort,
  filterCounts,
  GROUP_META,
} from "./sourceUniverseModel";
import type { SourceField } from "./types";

const fields: SourceField[] = [
  { id: "h1", label: "po_number", value: "4730", group: "header", mapped: true },
  { id: "p1", label: "ship_to_city", value: "Linz", group: "parties", mapped: false, suggestedFor: "ShipToCity", suggestionConfidence: 0.8 },
  { id: "r1", label: "EDI id", value: "995568217", group: "raw", mapped: false },
  { id: "r2", label: "cost centre", value: "", group: "raw", mapped: false },
];

describe("groupSourceFields", () => {
  it("buckets by group, raw last", () => {
    const g = groupSourceFields(fields);
    expect(g.map((x) => x.group)).toEqual(["header", "parties", "raw"]);
    expect(g.find((x) => x.group === "raw")!.fields).toHaveLength(2);
  });

  it("drops empty groups (no 'line' group here)", () => {
    expect(groupSourceFields(fields).some((g) => g.group === "line")).toBe(false);
  });

  it("preserves the fixed header→parties→line→raw order even when input is shuffled", () => {
    const shuffled = [fields[2], fields[0], fields[1]]; // raw, header, parties
    expect(groupSourceFields(shuffled).map((x) => x.group)).toEqual(["header", "parties", "raw"]);
  });
});

describe("filterSourceFields", () => {
  it("search matches label OR value (case-insensitive)", () => {
    expect(filterSourceFields(fields, "995", "all").map((f) => f.id)).toEqual(["r1"]);
    expect(filterSourceFields(fields, "LINZ", "all").map((f) => f.id)).toEqual(["p1"]);
  });

  it("empty query returns everything for the 'all' filter", () => {
    expect(filterSourceFields(fields, "", "all").map((f) => f.id)).toEqual(["h1", "p1", "r1", "r2"]);
  });

  it("filter chips: unmapped / mapped / ai / hasValue", () => {
    expect(filterSourceFields(fields, "", "mapped").map((f) => f.id)).toEqual(["h1"]);
    expect(filterSourceFields(fields, "", "unmapped").map((f) => f.id).sort()).toEqual(["p1", "r1", "r2"]);
    expect(filterSourceFields(fields, "", "ai").map((f) => f.id)).toEqual(["p1"]);
    expect(filterSourceFields(fields, "", "hasValue").map((f) => f.id).sort()).toEqual(["h1", "p1", "r1"]);
  });

  it("combines query AND chip filter", () => {
    // "9" matches r1 (value 995568217) and nothing else; intersect with unmapped → still r1.
    expect(filterSourceFields(fields, "9", "unmapped").map((f) => f.id)).toEqual(["r1"]);
    // "9" intersect mapped → empty (r1 is unmapped).
    expect(filterSourceFields(fields, "9", "mapped")).toEqual([]);
  });
});

describe("relevanceSort", () => {
  it("pins AI-suggested fields to the top, highest confidence first, stable otherwise", () => {
    const input: SourceField[] = [
      { id: "a", label: "a", value: "", group: "header", mapped: false },
      { id: "b", label: "b", value: "", group: "header", mapped: false, suggestedFor: "X", suggestionConfidence: 0.6 },
      { id: "c", label: "c", value: "", group: "header", mapped: false },
      { id: "d", label: "d", value: "", group: "header", mapped: false, suggestedFor: "Y", suggestionConfidence: 0.9 },
    ];
    expect(relevanceSort(input).map((f) => f.id)).toEqual(["d", "b", "a", "c"]);
  });

  it("does not mutate its input", () => {
    const input = [...fields];
    const before = input.map((f) => f.id);
    relevanceSort(input);
    expect(input.map((f) => f.id)).toEqual(before);
  });
});

describe("filterCounts", () => {
  it("counts each chip over the unsearched set", () => {
    expect(filterCounts(fields)).toEqual({ all: 4, unmapped: 3, mapped: 1, ai: 1, hasValue: 3 });
  });
});

describe("GROUP_META", () => {
  it("collapses the Raw bag and Line fields by default; Header/Parties expanded", () => {
    expect(GROUP_META.raw.defaultCollapsed).toBe(true);
    expect(GROUP_META.line.defaultCollapsed).toBe(true);
    expect(GROUP_META.header.defaultCollapsed).toBe(false);
    expect(GROUP_META.parties.defaultCollapsed).toBe(false);
  });
});
