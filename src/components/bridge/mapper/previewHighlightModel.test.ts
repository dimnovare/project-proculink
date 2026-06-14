import { describe, it, expect } from "vitest";
import { findHighlightRange, splitForHighlight } from "./previewHighlightModel";

describe("findHighlightRange", () => {
  const csv = "PoNumber,Currency\nPO-1001,EUR\nPO-1002,USD";

  it("returns null for an empty needle", () => {
    expect(findHighlightRange(csv, null)).toBeNull();
    expect(findHighlightRange(csv, "")).toBeNull();
  });

  it("returns null when the needle is absent", () => {
    expect(findHighlightRange(csv, "ZZZ")).toBeNull();
  });

  it("spans the whole line containing the needle (header line)", () => {
    const r = findHighlightRange(csv, "Currency")!;
    expect(csv.slice(r.start, r.end)).toBe("PoNumber,Currency");
  });

  it("spans the whole line containing a value in the middle", () => {
    const r = findHighlightRange(csv, "PO-1001")!;
    expect(csv.slice(r.start, r.end)).toBe("PO-1001,EUR");
  });

  it("spans the last line (no trailing newline)", () => {
    const r = findHighlightRange(csv, "USD")!;
    expect(csv.slice(r.start, r.end)).toBe("PO-1002,USD");
  });
});

describe("splitForHighlight", () => {
  it("returns empty parts for null content", () => {
    expect(splitForHighlight(null, "x")).toEqual({ before: "", match: "", after: "" });
  });

  it("puts everything in before when there is no match", () => {
    expect(splitForHighlight("abc\ndef", "zzz")).toEqual({ before: "abc\ndef", match: "", after: "" });
  });

  it("isolates the matching line as the match segment", () => {
    const { before, match, after } = splitForHighlight("a,1\nb,2\nc,3", "b,2");
    expect(before).toBe("a,1\n");
    expect(match).toBe("b,2");
    expect(after).toBe("\nc,3");
  });

  it("reassembles to the original content", () => {
    const content = "h1,h2\nv1,v2\nv3,v4";
    const { before, match, after } = splitForHighlight(content, "v2");
    expect(before + match + after).toBe(content);
  });
});
