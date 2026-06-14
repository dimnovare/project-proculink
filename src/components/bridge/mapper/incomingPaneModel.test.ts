import { describe, it, expect } from "vitest";
import {
  buildIncomingGroups,
  incomingFilterCounts,
  hasIncomingData,
  incomingAnchorId,
  INCOMING_GROUP_META,
} from "./incomingPaneModel";
import type { SourceField } from "./types";

const sf = (over: Partial<SourceField> & { id: string }): SourceField => ({
  label: over.id,
  value: "",
  group: "header",
  mapped: false,
  suggestedFor: null,
  suggestionConfidence: null,
  ...over,
});

const sample: SourceField[] = [
  sf({ id: "h1", label: "PO Number", value: "PO-1", group: "header" }),
  sf({ id: "p1", label: "Ship-to", value: "Acme OÜ", group: "parties" }),
  sf({ id: "l1", label: "Item", value: "BOLT-1", group: "line", mapped: true }),
  sf({ id: "r1", label: "Vendor Ref", value: "VR-9", group: "raw" }),
];

describe("buildIncomingGroups", () => {
  it("groups into header/parties/line/raw, dropping empty groups, raw last", () => {
    const groups = buildIncomingGroups(sample, "", "all");
    expect(groups.map((g) => g.group)).toEqual(["header", "parties", "line", "raw"]);
  });

  it("carries the real values through to the rows", () => {
    const groups = buildIncomingGroups(sample, "", "all");
    const header = groups.find((g) => g.group === "header")!;
    expect(header.fields[0].value).toBe("PO-1");
  });

  it("search matches label OR value across groups", () => {
    const groups = buildIncomingGroups(sample, "acme", "all");
    // Only the parties row (value "Acme OÜ") matches.
    expect(groups.flatMap((g) => g.fields).map((f) => f.id)).toEqual(["p1"]);
  });

  it("the unmapped filter hides mapped rows", () => {
    const groups = buildIncomingGroups(sample, "", "unmapped");
    const ids = groups.flatMap((g) => g.fields).map((f) => f.id);
    expect(ids).not.toContain("l1"); // l1 is mapped
    expect(ids).toContain("h1");
  });
});

describe("incomingFilterCounts", () => {
  it("counts all/unmapped/mapped/ai/hasValue", () => {
    const counts = incomingFilterCounts(sample);
    expect(counts.all).toBe(4);
    expect(counts.mapped).toBe(1);
    expect(counts.unmapped).toBe(3);
    expect(counts.hasValue).toBe(4);
  });
});

describe("hasIncomingData", () => {
  it("is true with rows, false when there are none", () => {
    expect(hasIncomingData(sample)).toBe(true);
    expect(hasIncomingData([])).toBe(false);
  });
});

describe("incomingAnchorId", () => {
  it("returns the token id as the stable wire anchor", () => {
    expect(incomingAnchorId(sample[0])).toBe("h1");
  });
});

describe("INCOMING_GROUP_META", () => {
  it("labels groups for the incoming framing and collapses raw extras by default", () => {
    expect(INCOMING_GROUP_META.line.label).toBe("Line items");
    expect(INCOMING_GROUP_META.raw.label).toBe("Raw extras");
    expect(INCOMING_GROUP_META.raw.defaultCollapsed).toBe(true);
    expect(INCOMING_GROUP_META.header.defaultCollapsed).toBe(false);
  });
});
