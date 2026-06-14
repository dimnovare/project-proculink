import { describe, it, expect } from "vitest";
import { deriveTargetFields, isTargetWired, isRenameAffordanceShown } from "./targetLaneModel";
import type { OutputMappingConfig, OutputFieldRule } from "@/lib/api/types";

const rule = (outputPath: string): OutputFieldRule => ({ outputPath, fieldManipulators: [] });

describe("deriveTargetFields", () => {
  it("defaults to the canonical spine when output is null (fresh order, byte-identical)", () => {
    const fields = deriveTargetFields(null);
    expect(fields.map((f) => f.outputPath)).toContain("PoNumber");
    expect(fields.map((f) => f.outputPath)).toContain("SupplierItemCode");
    // header fields precede line fields
    const firstLine = fields.findIndex((f) => f.scope === "line");
    const lastHeader = fields.map((f) => f.scope).lastIndexOf("header");
    expect(lastHeader).toBeLessThan(firstLine);
  });

  it("derives arbitrary output paths from a declared output config, header then line", () => {
    const output: OutputMappingConfig = {
      header: { OrderRef: rule("OrderRef"), Cur: rule("Cur") },
      lines: { ItemCode: rule("ItemCode"), Qty: rule("Qty") },
    };
    expect(deriveTargetFields(output).map((f) => f.outputPath)).toEqual([
      "OrderRef",
      "Cur",
      "ItemCode",
      "Qty",
    ]);
  });

  it("tags each derived field with its scope", () => {
    const output: OutputMappingConfig = {
      header: { OrderRef: rule("OrderRef") },
      lines: { ItemCode: rule("ItemCode") },
    };
    const fields = deriveTargetFields(output);
    expect(fields.find((f) => f.outputPath === "OrderRef")!.scope).toBe("header");
    expect(fields.find((f) => f.outputPath === "ItemCode")!.scope).toBe("line");
  });

  it("labels a canonical-named output path from the catalog, raw path otherwise", () => {
    const output: OutputMappingConfig = {
      header: { PoNumber: rule("PoNumber"), Weird_Col: rule("Weird_Col") },
      lines: {},
    };
    const fields = deriveTargetFields(output);
    expect(fields.find((f) => f.outputPath === "PoNumber")!.label).toBe("PO number");
    expect(fields.find((f) => f.outputPath === "Weird_Col")!.label).toBe("Weird_Col");
  });

  it("de-dupes a path present in both scopes (first scope wins)", () => {
    const output: OutputMappingConfig = {
      header: { Dup: rule("Dup") },
      lines: { Dup: rule("Dup") },
    };
    const fields = deriveTargetFields(output).filter((f) => f.outputPath === "Dup");
    expect(fields).toHaveLength(1);
    expect(fields[0].scope).toBe("header");
  });

  it("uses canonical line fields when only the header is declared", () => {
    const output: OutputMappingConfig = { header: { OrderRef: rule("OrderRef") }, lines: {} };
    const fields = deriveTargetFields(output);
    // lines:{} is an empty (declared) object → no line targets; header has the one declared path
    expect(fields.map((f) => f.outputPath)).toEqual(["OrderRef"]);
  });
});

describe("isTargetWired", () => {
  it("true when the output path has a canonical connection", () => {
    expect(isTargetWired("ItemCode", { ItemCode: "SupplierItemCode" })).toBe(true);
  });
  it("false when unmapped or connections absent", () => {
    expect(isTargetWired("ItemCode", { Other: "X" })).toBe(false);
    expect(isTargetWired("ItemCode", undefined)).toBe(false);
  });
});

describe("isRenameAffordanceShown", () => {
  const handler = (_old: string, _next: string) => {};

  it("true only when editable AND a real onRenamePath handler is wired", () => {
    expect(isRenameAffordanceShown(true, handler)).toBe(true);
  });

  it("false when onRenamePath is undefined even if editable (the dead-control case)", () => {
    // ThreePaneMapper mounts TargetLane without onRenamePath — the control must not render.
    expect(isRenameAffordanceShown(true, undefined)).toBe(false);
  });

  it("false when not editable even if a handler is wired (read-only / order variant)", () => {
    expect(isRenameAffordanceShown(false, handler)).toBe(false);
  });

  it("false when neither editable nor wired", () => {
    expect(isRenameAffordanceShown(false, undefined)).toBe(false);
  });
});
