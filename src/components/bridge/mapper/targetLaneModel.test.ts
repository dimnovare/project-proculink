import { describe, it, expect } from "vitest";
import { deriveTargetFields, isTargetWired, isRenameAffordanceShown } from "./targetLaneModel";
import type { OutputMappingConfig, OutputFieldRule } from "@/lib/api/types";
import { CANONICAL_HEADER_FIELDS, CANONICAL_LINE_FIELDS } from "@/lib/api/types";

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

  it("falls back to canonical line fields when the line scope is an empty {} (non-empty guard)", () => {
    // An empty declared scope {} is truthy but yields zero keys. A truthy-only guard would drop
    // the whole scope (the outgoing_empty bug); the non-empty guard falls back to the canonical
    // spine so the line targets are never silently empty. The declared header path is kept.
    const output: OutputMappingConfig = { header: { OrderRef: rule("OrderRef") }, lines: {} };
    const paths = deriveTargetFields(output).map((f) => f.outputPath);
    expect(paths).toContain("OrderRef"); // declared header path preserved
    expect(paths).toContain("SupplierItemCode"); // empty lines:{} → canonical line fields
    // the OrderRef header precedes the fallback line fields
    expect(paths.indexOf("OrderRef")).toBeLessThan(paths.indexOf("SupplierItemCode"));
  });

  it("falls back to the FULL canonical spine when BOTH scopes are empty {} (intermittent bug case)", () => {
    // The persisted override can carry empty header AND lines; both must fall back so the
    // OutgoingPane never shows the false "This output has no declared fields."
    const output: OutputMappingConfig = { header: {}, lines: {} };
    const paths = deriveTargetFields(output).map((f) => f.outputPath);
    expect(paths).toContain("PoNumber"); // canonical header
    expect(paths).toContain("SupplierItemCode"); // canonical line
    // equivalent to a null output (full default spine)
    expect(paths).toEqual(deriveTargetFields(null).map((f) => f.outputPath));
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

describe("deriveTargetFields — order path merges canonical + authored", () => {
  it("keeps the full canonical spine and appends extra authored paths (no collapse on wire/add)", () => {
    const output = {
      header: { PoNumber: rule("PoNumber"), Identity: rule("Identity") },
      lines: {},
    } as never;
    const paths = deriveTargetFields(output, true).map((f) => f.outputPath);
    // every canonical header field is still present (not collapsed to just PoNumber)…
    for (const f of CANONICAL_HEADER_FIELDS) expect(paths).toContain(f);
    for (const f of CANONICAL_LINE_FIELDS) expect(paths).toContain(f);
    // …plus the extra authored "Identity" column, appended once.
    expect(paths.filter((p) => p === "Identity")).toHaveLength(1);
    expect(paths.filter((p) => p === "PoNumber")).toHaveLength(1);
  });
});
