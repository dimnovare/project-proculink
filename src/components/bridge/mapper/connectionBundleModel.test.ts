import { describe, it, expect } from "vitest";
import {
  outputConfigFromJson,
  sourceMapFromJson,
  overrideFromConnectionBundle,
  inputMappingJsonFromOverride,
  outputMappingJsonFromOverride,
} from "./connectionBundleModel";
import type { OrderMappingOverride } from "@/lib/api/types";

describe("outputConfigFromJson", () => {
  it("returns null for null/empty/malformed json", () => {
    expect(outputConfigFromJson(null)).toBeNull();
    expect(outputConfigFromJson(undefined)).toBeNull();
    expect(outputConfigFromJson("")).toBeNull();
    expect(outputConfigFromJson("{not json")).toBeNull();
  });
  it("parses a bare OutputMappingConfig ({header,lines})", () => {
    const json = JSON.stringify({ header: { ItemCode: { outputPath: "ItemCode", canonicalField: "PoNumber" } }, lines: {} });
    expect(outputConfigFromJson(json)).toEqual({ header: { ItemCode: { outputPath: "ItemCode", canonicalField: "PoNumber" } }, lines: {} });
  });
  it("unwraps a { output } envelope", () => {
    const json = JSON.stringify({ output: { header: { A: { outputPath: "A" } }, lines: {} } });
    expect(outputConfigFromJson(json)).toEqual({ header: { A: { outputPath: "A" } }, lines: {} });
  });
});

describe("sourceMapFromJson", () => {
  it("returns null for null/empty/malformed json", () => {
    expect(sourceMapFromJson(null)).toBeNull();
    expect(sourceMapFromJson("nope")).toBeNull();
  });
  it("reads our written { sourceMap } envelope", () => {
    const json = JSON.stringify({ sourceMap: { PoNumber: { sourceToken: "cell:r1c1", manipulators: [] } } });
    expect(sourceMapFromJson(json)).toEqual({ PoNumber: { sourceToken: "cell:r1c1", manipulators: [] } });
  });
  it("tolerates a bare canonicalField→rule map", () => {
    const json = JSON.stringify({ Currency: { sourceToken: "tok:eur" } });
    expect(sourceMapFromJson(json)).toEqual({ Currency: { sourceToken: "tok:eur" } });
  });
  it("does NOT treat an arbitrary object as a source map", () => {
    expect(sourceMapFromJson(JSON.stringify({ foo: 1, bar: "x" }))).toBeNull();
  });
});

describe("overrideFromConnectionBundle + serializers — round-trip", () => {
  it("merges both bundle sides into one override", () => {
    const input = JSON.stringify({ sourceMap: { PoNumber: { sourceToken: "cell:r1c1", manipulators: [] } } });
    const output = JSON.stringify({ header: { ItemCode: { outputPath: "ItemCode", canonicalField: "Sku" } }, lines: {} });
    const o = overrideFromConnectionBundle(input, output);
    expect(o.sourceMap).toEqual({ PoNumber: { sourceToken: "cell:r1c1", manipulators: [] } });
    expect(o.output).toEqual({ header: { ItemCode: { outputPath: "ItemCode", canonicalField: "Sku" } }, lines: {} });
    expect(o.customFields).toEqual([]);
  });

  it("round-trips override → JSON sides → override (no data loss)", () => {
    const o: OrderMappingOverride = {
      customFields: [],
      sourceMap: { PoNumber: { sourceToken: "cell:r1c1", manipulators: [] } },
      output: { header: { ItemCode: { outputPath: "ItemCode", canonicalField: "Sku", fieldManipulators: [] } }, lines: {} },
    };
    const back = overrideFromConnectionBundle(
      inputMappingJsonFromOverride(o),
      outputMappingJsonFromOverride(o),
    );
    expect(back.sourceMap).toEqual(o.sourceMap);
    expect(back.output).toEqual(o.output);
  });

  it("serializes empty sides to null (byte-identical default mapping)", () => {
    const o: OrderMappingOverride = { customFields: [], sourceMap: null, output: null };
    expect(inputMappingJsonFromOverride(o)).toBeNull();
    expect(outputMappingJsonFromOverride(o)).toBeNull();
    const back = overrideFromConnectionBundle(null, null);
    expect(back.sourceMap).toBeNull();
    expect(back.output).toBeNull();
  });
});
