import { describe, it, expect } from "vitest";
import {
  ignoresManualOutputFields,
  structuredFormatLabel,
} from "./previewFormatModel";

describe("ignoresManualOutputFields — structured-standard gate for the outgoing notice", () => {
  it("is true for the structured-standard formats produced by a fixed transformer", () => {
    expect(ignoresManualOutputFields("cxml")).toBe(true);
    expect(ignoresManualOutputFields("x12")).toBe(true);
    expect(ignoresManualOutputFields("ubl")).toBe(true);
  });

  it("is false for the flat formats that honor the mapper (csv / json / xml-via-OutputNode)", () => {
    expect(ignoresManualOutputFields("csv")).toBe(false);
    expect(ignoresManualOutputFields("json")).toBe(false);
    expect(ignoresManualOutputFields("xml")).toBe(false);
  });

  it("is false when the format is unknown (null / undefined) — assume the mapper is honored", () => {
    expect(ignoresManualOutputFields(null)).toBe(false);
    expect(ignoresManualOutputFields(undefined)).toBe(false);
  });
});

describe("structuredFormatLabel — display label in the notice copy", () => {
  it("uses the canonical casing for the named standards", () => {
    expect(structuredFormatLabel("cxml")).toBe("cXML");
    expect(structuredFormatLabel("x12")).toBe("X12");
    expect(structuredFormatLabel("ubl")).toBe("UBL");
  });
});
