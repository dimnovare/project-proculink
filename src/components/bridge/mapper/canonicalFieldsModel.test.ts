import { describe, it, expect } from "vitest";
import {
  systemCanonicalNodes,
  mergeCanonicalNodes,
  validateNewFieldName,
  toKey,
} from "./canonicalFieldsModel";
import type { CanonicalFieldDef } from "@/lib/api/types";
import type { CanonicalNode } from "./types";

describe("systemCanonicalNodes", () => {
  const nodes = systemCanonicalNodes();

  it("includes the built-in header + line fields, all flagged system", () => {
    expect(nodes.every((n) => n.system)).toBe(true);
    expect(nodes.map((n) => n.id)).toContain("PoNumber");
    expect(nodes.map((n) => n.id)).toContain("SupplierItemCode");
  });

  it("orders header fields before line fields", () => {
    const firstLineIdx = nodes.findIndex((n) => n.scope === "line");
    const lastHeaderIdx = nodes.map((n) => n.scope).lastIndexOf("header");
    expect(lastHeaderIdx).toBeLessThan(firstLineIdx);
  });

  it("labels known fields from the standards catalog (no parallel label list)", () => {
    expect(nodes.find((n) => n.id === "PoNumber")!.label).toBe("PO number");
    expect(nodes.find((n) => n.id === "UnitPrice")!.label).toBe("Unit price");
  });

  it("falls back to a humanized label for a field with no catalog entry", () => {
    // SupplierName / SupplierItemCode / LineTotal aren't in FIELD_STANDARDS → humanized.
    expect(nodes.find((n) => n.id === "SupplierItemCode")!.label).toBe("Supplier Item Code");
  });
});

describe("mergeCanonicalNodes", () => {
  const system: CanonicalNode[] = [
    { id: "PoNumber", label: "PO number", scope: "header", system: true },
    { id: "Quantity", label: "Quantity", scope: "line", system: true },
  ];

  it("appends custom nodes after the system spine, sorted by order", () => {
    const custom: CanonicalFieldDef[] = [
      { key: "CostCentre", label: "Cost centre", scope: "header", type: "string", order: 2 },
      { key: "Project", label: "Project", scope: "header", type: "string", order: 1 },
    ];
    expect(mergeCanonicalNodes(system, custom).map((n) => n.id)).toEqual([
      "PoNumber",
      "Quantity",
      "Project",
      "CostCentre",
    ]);
  });

  it("marks custom nodes system:false and carries scope + standardsRef", () => {
    const custom: CanonicalFieldDef[] = [
      { key: "VatId", label: "VAT id", scope: "header", type: "string", standardsRef: "UBL cbc:CompanyID" },
    ];
    const merged = mergeCanonicalNodes(system, custom);
    const vat = merged.find((n) => n.id === "VatId")!;
    expect(vat.system).toBe(false);
    expect(vat.standardsRef).toBe("UBL cbc:CompanyID");
  });

  it("drops a custom field that shadows a system key (system wins)", () => {
    const custom: CanonicalFieldDef[] = [
      { key: "PoNumber", label: "My PO", scope: "header", type: "string" },
    ];
    const merged = mergeCanonicalNodes(system, custom);
    expect(merged.filter((n) => n.id === "PoNumber")).toHaveLength(1);
    expect(merged.find((n) => n.id === "PoNumber")!.system).toBe(true);
  });

  it("de-dupes two custom fields with the same key (first wins)", () => {
    const custom: CanonicalFieldDef[] = [
      { key: "Dup", label: "First", scope: "header", type: "string", order: 1 },
      { key: "Dup", label: "Second", scope: "header", type: "string", order: 2 },
    ];
    const merged = mergeCanonicalNodes(system, custom).filter((n) => n.id === "Dup");
    expect(merged).toHaveLength(1);
    expect(merged[0].label).toBe("First");
  });

  it("does not mutate the inputs", () => {
    const custom: CanonicalFieldDef[] = [
      { key: "B", label: "B", scope: "header", type: "string", order: 2 },
      { key: "A", label: "A", scope: "header", type: "string", order: 1 },
    ];
    const customBefore = custom.map((c) => c.key);
    mergeCanonicalNodes(system, custom);
    expect(custom.map((c) => c.key)).toEqual(customBefore);
  });
});

describe("toKey", () => {
  it("PascalCases spaces / underscores / mixed separators", () => {
    expect(toKey("ship to city")).toBe("ShipToCity");
    expect(toKey("cost_centre")).toBe("CostCentre");
    expect(toKey("VAT-id")).toBe("VATId");
    expect(toKey("alreadyPascal")).toBe("AlreadyPascal");
  });

  it("strips punctuation and returns empty for a value with no alnum", () => {
    expect(toKey("  ---  ")).toBe("");
    expect(toKey("@@@")).toBe("");
  });
});

describe("validateNewFieldName", () => {
  const existing = new Set(["PoNumber", "Quantity", "CostCentre"]);

  it("accepts a fresh name and derives its key", () => {
    expect(validateNewFieldName("project code", existing)).toEqual({ ok: true, key: "ProjectCode" });
  });

  it("rejects a blank name", () => {
    expect(validateNewFieldName("   ", existing).ok).toBe(false);
  });

  it("rejects a name that has no letters or numbers", () => {
    const r = validateNewFieldName("---", existing);
    expect(r.ok).toBe(false);
    expect(r.key).toBe("");
  });

  it("rejects a name whose derived key collides with an existing field", () => {
    // "cost centre" → "CostCentre", already present.
    const r = validateNewFieldName("cost centre", existing);
    expect(r.ok).toBe(false);
    expect(r.key).toBe("CostCentre");
    expect(r.error).toMatch(/already exists/);
  });

  it("accepts an Iterable (not just a Set) of existing keys", () => {
    expect(validateNewFieldName("New", ["PoNumber"]).ok).toBe(true);
  });
});
