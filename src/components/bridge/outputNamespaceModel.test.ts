// outputNamespaceModel — T8 unit tests.
//
// The headline guarantee: editing an UNRELATED node in an inferred NAMESPACED tree must NOT strip any
// namespace (per-node namespace/prefix OR the root prefix→uri map). Before T8 the FE OutputNode type
// lacked namespace/prefix, so the fields were invisible to TypeScript and at risk of being dropped by
// any explicit node reconstruction — a silent data-loss bug that turns schema-valid UBL into
// no-namespace XML the supplier rejects. These tests pin that namespaces survive every edit path.

import { describe, it, expect } from "vitest";
import {
  updateAt, removeAt, setNodeNamespace,
  treeHasPerNodeNamespaces, namespacesToRows, rowsToNamespaces, templateHasRootNamespaces,
} from "./outputNamespaceModel";
import type { OutputNode, OutputNodeTemplate } from "@/lib/api/types";

// A realistic INFERRED UBL tree: root default namespace + cbc:/cac: prefixed nodes (mirrors what
// OutputNodeTemplateInferrer.FromSample produces for a pasted UBL Order sample).
const ORDER2 = "urn:oasis:names:specification:ubl:schema:xsd:Order-2";
const CBC = "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2";
const CAC = "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2";

function inferredUblTree(): OutputNode {
  return {
    name: "Order", nodeType: "object", namespace: ORDER2, prefix: null,
    children: [
      { name: "ID", nodeType: "field", namespace: CBC, prefix: "cbc",
        rule: { outputPath: "ID", canonicalField: "PoNumber", sourceToken: null, fixedValue: null, fieldManipulators: [] } },
      { name: "", nodeType: "array", collection: "lines", children: [
        { name: "OrderLine", nodeType: "object", namespace: CAC, prefix: "cac", children: [
          { name: "Quantity", nodeType: "field", namespace: CBC, prefix: "cbc",
            rule: { outputPath: "Quantity", canonicalField: "Quantity", sourceToken: null, fixedValue: null, fieldManipulators: [] } },
        ] },
      ] },
    ],
  };
}

describe("updateAt / removeAt — namespace preservation (data-loss fix)", () => {
  it("editing an UNRELATED node leaves every other node's namespace + prefix intact", () => {
    const tree = inferredUblTree();
    // Edit ID's name only (path [0]) — a totally unrelated edit to the OrderLine/Quantity namespaces.
    const next = updateAt(tree, [0], (n) => ({ ...n, name: "OrderNumber" }));

    // The edited node keeps its OWN namespace.
    expect(next.children![0].name).toBe("OrderNumber");
    expect(next.children![0].namespace).toBe(CBC);
    expect(next.children![0].prefix).toBe("cbc");
    // The ROOT default namespace survives.
    expect(next.namespace).toBe(ORDER2);
    // The deeply-nested cac:OrderLine + cbc:Quantity namespaces survive untouched.
    const orderLine = next.children![1].children![0];
    expect(orderLine.namespace).toBe(CAC);
    expect(orderLine.prefix).toBe("cac");
    expect(orderLine.children![0].namespace).toBe(CBC);
    expect(orderLine.children![0].prefix).toBe("cbc");
  });

  it("a deep edit (re-bind a leaf's rule via updateAt) preserves that leaf's own namespace", () => {
    const tree = inferredUblTree();
    // Path to cbc:Quantity is [1, 0, 0]. Re-point its canonical field; the namespace must stay.
    const next = updateAt(tree, [1, 0, 0], (x) => ({
      ...x,
      rule: { outputPath: x.name, canonicalField: "LineNumber", sourceToken: null, fixedValue: null, fieldManipulators: [] },
    }));
    const qty = next.children![1].children![0].children![0];
    expect(qty.rule!.canonicalField).toBe("LineNumber");
    expect(qty.namespace).toBe(CBC);
    expect(qty.prefix).toBe("cbc");
  });

  it("removeAt drops the target but leaves sibling namespaces intact", () => {
    const tree = inferredUblTree();
    const next = removeAt(tree, [0]); // remove cbc:ID
    expect(next.children).toHaveLength(1);
    // The remaining array + its cac:OrderLine still carry their namespaces.
    expect(next.children![0].children![0].namespace).toBe(CAC);
    expect(next.namespace).toBe(ORDER2); // root untouched
  });
});

describe("setNodeNamespace — per-node authoring", () => {
  const plain: OutputNode = { name: "ID", nodeType: "field", rule: { outputPath: "ID", canonicalField: "PoNumber", fieldManipulators: [] } };

  it("sets a prefix + URI (a prefixed element like <cbc:ID>)", () => {
    const n = setNodeNamespace(plain, CBC, "cbc");
    expect(n.namespace).toBe(CBC);
    expect(n.prefix).toBe("cbc");
    // The rest of the node is untouched.
    expect(n.rule!.canonicalField).toBe("PoNumber");
  });

  it("blank prefix + URI = a DEFAULT namespace (no prefix)", () => {
    const n = setNodeNamespace(plain, ORDER2, "");
    expect(n.namespace).toBe(ORDER2);
    expect(n.prefix).toBeNull();
  });

  it("blank URI clears BOTH (prefix-without-namespace is rejected by the emitter)", () => {
    const ns = setNodeNamespace(plain, CBC, "cbc");
    const cleared = setNodeNamespace(ns, "", "cbc"); // user blanks the URI but leaves a prefix typed
    expect(cleared.namespace).toBeNull();
    expect(cleared.prefix).toBeNull();
  });

  it("trims whitespace-only input to a cleared namespace", () => {
    const n = setNodeNamespace(plain, "   ", "  ");
    expect(n.namespace).toBeNull();
    expect(n.prefix).toBeNull();
  });
});

describe("treeHasPerNodeNamespaces", () => {
  it("true when any node carries a namespace or prefix", () => {
    expect(treeHasPerNodeNamespaces(inferredUblTree())).toBe(true);
  });
  it("false for a fully non-namespaced tree", () => {
    const plain: OutputNode = { name: "order", nodeType: "object", children: [
      { name: "po", nodeType: "field", rule: { outputPath: "po", canonicalField: "PoNumber", fieldManipulators: [] } },
    ] };
    expect(treeHasPerNodeNamespaces(plain)).toBe(false);
  });
});

describe("root namespaces map ↔ rows", () => {
  it("namespacesToRows round-trips through rowsToNamespaces", () => {
    const map = { cbc: CBC, cac: CAC };
    const rows = namespacesToRows(map);
    expect(rows).toEqual([{ prefix: "cbc", uri: CBC }, { prefix: "cac", uri: CAC }]);
    expect(rowsToNamespaces(rows)).toEqual(map);
  });

  it("namespacesToRows of null/undefined is an empty list", () => {
    expect(namespacesToRows(null)).toEqual([]);
    expect(namespacesToRows(undefined)).toEqual([]);
  });

  it("rowsToNamespaces drops incomplete rows and nulls an empty result (byte-identical clear)", () => {
    expect(rowsToNamespaces([{ prefix: "cbc", uri: "" }, { prefix: "", uri: CBC }])).toBeNull();
    expect(rowsToNamespaces([])).toBeNull();
    expect(rowsToNamespaces([{ prefix: " cbc ", uri: ` ${CBC} ` }])).toEqual({ cbc: CBC }); // trims
  });

  it("templateHasRootNamespaces reflects a non-empty map only", () => {
    const base = { format: "xml", root: { name: "Order", nodeType: "object", children: [] } } as OutputNodeTemplate;
    expect(templateHasRootNamespaces(base)).toBe(false);
    expect(templateHasRootNamespaces({ ...base, namespaces: {} })).toBe(false);
    expect(templateHasRootNamespaces({ ...base, namespaces: { cbc: CBC } })).toBe(true);
  });
});
