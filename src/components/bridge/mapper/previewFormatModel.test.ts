import { describe, it, expect } from "vitest";
import {
  shouldHonorFormat,
  ignoresManualOutputFields,
  structuredFormatLabel,
} from "./previewFormatModel";

describe("shouldHonorFormat — exploratory opt-in decision", () => {
  it("is false when the delivered format is unknown (no pin / no defaultFormat)", () => {
    expect(shouldHonorFormat("csv", null)).toBe(false);
    expect(shouldHonorFormat("json", null)).toBe(false);
  });

  it("is false when the toggle matches the connection's delivered format", () => {
    expect(shouldHonorFormat("json", "json")).toBe(false);
  });

  it("is true only when the toggle differs from a KNOWN delivered format", () => {
    expect(shouldHonorFormat("csv", "json")).toBe(true);
    expect(shouldHonorFormat("xml", "json")).toBe(true);
  });
});

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
