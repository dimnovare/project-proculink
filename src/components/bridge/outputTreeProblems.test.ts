// outputTreeProblems — design-time validation for the output designer (WP-16 · S14/S16).
//
// THE POINT OF THIS FILE. A layout that cannot produce a valid document currently fails at DELIVERY,
// as an exception, after the operator has left the screen. Two separate gaps produce that:
//
//   • the emitter's own throw sites are never checked in the browser, so a prefix with no address,
//     both namespace modes at once, or a repeating list with no item template all save happily; and
//   • the tree path calls `GuardResolved` — needs-review and missing supplier item code — while all
//     six FIXED transforms call `OutputFieldValidator.ValidateEntity`, which also refuses a negative
//     unit price and a non-positive quantity. Those two checks are exactly what the tree path skips.
//
// The tier split is what keeps the second half honest: a zero quantity is an ORDER problem, not a
// LAYOUT problem, and painting it red inside a layout editor would teach the operator to look in the
// wrong place. Tier 1 blocks the save; tier 2 and tier 3 never do.

import { describe, it, expect } from "vitest";
import {
  collectLayoutProblems, collectOrderProblems, blocksSave, problemCounts,
} from "./outputTreeProblems";
import { UBL_CBC_URI, UBL_CAC_URI } from "./outputNamespacePresets";
import type { OutputNode, OutputNodeTemplate } from "@/lib/api/types";
import type { OrderLine } from "@/types/procurement";

function field(name: string, canonicalField: string | null = "PoNumber"): OutputNode {
  return { name, nodeType: "field", rule: { outputPath: name, canonicalField, sourceToken: null, fixedValue: null, fieldManipulators: [] } };
}

/** A layout with nothing wrong with it — the anti-vacuity floor for every test below. */
function healthyTree(format: OutputNodeTemplate["format"] = "xml"): OutputNodeTemplate {
  return {
    format,
    root: { name: "Order", nodeType: "object", children: [
      field("orderNumber"),
      { name: "lines", nodeType: "array", collection: "lines", children: [
        { name: "line", nodeType: "object", children: [field("itemCode", "SupplierItemCode"), field("quantity", "Quantity")] },
      ] },
    ] },
  };
}

function line(over: Partial<OrderLine> = {}): OrderLine {
  return {
    id: "l1", lineNumber: 1, buyerItemCode: "B-1", supplierItemCode: "S-1",
    description: "Widget", quantity: 5, unit: "EA", unitPrice: 10, confidence: 1, needsReview: false,
    ...over,
  };
}

const msgs = (ps: { message: string }[]) => ps.map((p) => p.message);

describe("a healthy layout reports nothing", () => {
  it.each(["xml", "json", "csv"] as const)("%s", (format) => {
    expect(collectLayoutProblems(healthyTree(format))).toEqual([]);
  });

  it("and does not block the save", () => {
    expect(blocksSave(collectLayoutProblems(healthyTree()))).toBe(false);
  });
});

describe("tier 1 — the emitter's own throw sites, caught here instead", () => {
  it("a prefix with no address", () => {
    const t = healthyTree();
    t.root.children![0] = { ...t.root.children![0], prefix: "cbc", namespace: null };
    const ps = collectLayoutProblems(t);
    expect(msgs(ps)).toContain('"cbc" has a prefix but no web address. A prefix needs an address to point at.');
    expect(ps.every((p) => p.tier === 1)).toBe(true);
    expect(blocksSave(ps)).toBe(true);
  });

  it("namespaces set in both places at once", () => {
    const t: OutputNodeTemplate = { ...healthyTree(), namespaces: { cbc: UBL_CBC_URI } };
    t.root = { ...t.root, prefix: "cac", namespace: UBL_CAC_URI };
    expect(msgs(collectLayoutProblems(t)))
      .toContain("Namespaces are set both at the top and on individual elements. Pick one place.");
  });

  // OutputTreeFormats.IsRenderable is an exhaustive switch with no default arm: cXml, ubl, x12,
  // ublOrder, x12_850 and edifactOrders are ALL false. A tree in any of them throws at delivery.
  it.each(["cXml", "ubl", "x12"] as const)("a layout saved as %s cannot be built from a layout at all", (format) => {
    const ps = collectLayoutProblems({ ...healthyTree(), format });
    expect(ps.some((p) => p.tier === 1 && p.kind === "format-not-renderable")).toBe(true);
    expect(blocksSave(ps)).toBe(true);
  });

  it("a tag name that XmlWriter would reject", () => {
    const t = healthyTree("xml");
    t.root.children![0] = { ...t.root.children![0], name: "2nd item" };
    expect(msgs(collectLayoutProblems(t)))
      .toContain(`"2nd item" isn't a valid tag name. Start it with a letter and use no spaces.`);
  });

  it("the tag-name rule does not fire for JSON or CSV, where a space is legal", () => {
    for (const format of ["json", "csv"] as const) {
      const t = healthyTree(format);
      t.root.children![0] = { ...t.root.children![0], name: "2nd item" };
      expect(collectLayoutProblems(t).filter((p) => p.kind === "invalid-xml-name")).toEqual([]);
    }
  });

  // Found by trying to break this after building it. Both namespace rules are XML-only because a
  // tree REACHES the flagged state by ordinary use: infer a namespaced XML sample, then switch the
  // format to JSON. JSON and CSV ignore namespaces entirely, so the data is dead but harmless —
  // blocking the save on it would lock an author out of a layout that emits perfectly.
  it.each(["json", "csv"] as const)("neither namespace rule fires for %s, where namespaces mean nothing", (format) => {
    const t: OutputNodeTemplate = { ...healthyTree(format), namespaces: { cbc: UBL_CBC_URI } };
    t.root = { ...t.root, prefix: "cac", namespace: UBL_CAC_URI };
    t.root.children![0] = { ...t.root.children![0], prefix: "cbc", namespace: null };
    const ps = collectLayoutProblems(t);
    expect(ps.filter((p) => p.kind === "prefix-without-namespace")).toEqual([]);
    expect(ps.filter((p) => p.kind === "namespace-mode-collision")).toEqual([]);
    expect(blocksSave(ps)).toBe(false);
    // Anti-vacuity: the identical tree in XML reports both, so the exemption is about the format and
    // not about the fixture failing to reproduce the state.
    const asXml = collectLayoutProblems({ ...t, format: "xml" });
    expect(asXml.filter((p) => p.kind === "prefix-without-namespace")).toHaveLength(1);
    expect(asXml.filter((p) => p.kind === "namespace-mode-collision")).toHaveLength(1);
  });

  it("two CSV columns with the same name", () => {
    const t = healthyTree("csv");
    t.root.children!.push(field("orderNumber"));
    expect(msgs(collectLayoutProblems(t)))
      .toContain(`Two columns are both called "orderNumber". Column names must be different.`);
  });

  it("a CSV layout with no columns at all", () => {
    const t: OutputNodeTemplate = { format: "csv", root: { name: "order", nodeType: "object", children: [] } };
    expect(msgs(collectLayoutProblems(t))).toContain("This layout has no columns yet.");
  });

  it("a repeating list with no item template — the silent data loss", () => {
    const t = healthyTree();
    t.root.children![1] = { ...t.root.children![1], children: [] };
    expect(msgs(collectLayoutProblems(t)))
      .toContain(`The repeating list "lines" is empty, so no order lines would be sent.`);
  });

  it("two JSON properties with the same name in one object — last one wins, silently", () => {
    const t = healthyTree("json");
    t.root.children!.push(field("orderNumber"));
    expect(msgs(collectLayoutProblems(t)))
      .toContain(`Two values in "Order" are both called "orderNumber". Names must be different.`);
  });

  it("the duplicate-property rule is scoped to ONE object, not the whole tree", () => {
    // `id` at the top and `id` inside the repeating line group is legal JSON — different objects.
    const t = healthyTree("json");
    t.root.children!.push(field("id"));
    (t.root.children![1].children![0].children as OutputNode[]).push(field("id"));
    expect(collectLayoutProblems(t).filter((p) => p.kind === "duplicate-json-name")).toEqual([]);
  });
});

describe("tier 3 — it will deliver, and it is probably not what you meant", () => {
  it("a value bound to nothing will always be sent empty", () => {
    const t = healthyTree();
    t.root.children!.push(field("vat_code", null));
    const ps = collectLayoutProblems(t);
    const unbound = ps.filter((p) => p.kind === "unbound-value");
    expect(msgs(unbound)).toEqual([`"vat_code" has no field, so it will always be sent empty.`]);
    expect(unbound[0].tier).toBe(3);
    // A warning is not a blocker. This is the whole reason for the tier split.
    expect(blocksSave(ps)).toBe(false);
  });

  it("a fixed value counts as bound", () => {
    const t = healthyTree();
    t.root.children!.push({ name: "src", nodeType: "field", rule: { outputPath: "src", canonicalField: null, sourceToken: null, fixedValue: "PROCULINK", fieldManipulators: [] } });
    expect(collectLayoutProblems(t).filter((p) => p.kind === "unbound-value")).toEqual([]);
  });

  it("a source token counts as bound", () => {
    const t = healthyTree();
    t.root.children!.push({ name: "src", nodeType: "field", rule: { outputPath: "src", canonicalField: null, sourceToken: "col_7", fixedValue: null, fieldManipulators: [] } });
    expect(collectLayoutProblems(t).filter((p) => p.kind === "unbound-value")).toEqual([]);
  });
});

// ── The packet's load-bearing claim ──────────────────────────────────────────
// "a validator test proving the tree path now rejects what the fixed path rejects".
//
// The fixed transforms all call `OutputFieldValidator.ValidateEntity`. The tree path calls
// `GuardResolved`, which is needs-review + missing supplier item code and nothing else. So the two
// checks the tree path has always skipped are a NEGATIVE UNIT PRICE and a NON-POSITIVE QUANTITY —
// and an order carrying either delivers today through a designed layout and throws through a fixed
// one. These tests are what closes that gap at design time.
describe("tier 2 — the checks the tree path skipped and the fixed transforms never did", () => {
  it("a clean order reports nothing", () => {
    expect(collectOrderProblems([line(), line({ id: "l2", lineNumber: 2 })])).toEqual([]);
  });

  it("a NON-POSITIVE quantity — skipped by GuardResolved, refused by OutputFieldValidator", () => {
    const ps = collectOrderProblems([line({ lineNumber: 4, quantity: 0 })]);
    expect(msgs(ps)).toEqual(["Line 4's quantity is 0. Orders with a zero quantity are held for review."]);
    expect(ps[0].tier).toBe(2);
  });

  it("a NEGATIVE quantity reads as negative, not as zero", () => {
    expect(msgs(collectOrderProblems([line({ lineNumber: 2, quantity: -3 })])))
      .toEqual(["Line 2's quantity is -3. Orders with a negative quantity are held for review."]);
  });

  it("a NEGATIVE unit price — the other check the tree path skipped", () => {
    const ps = collectOrderProblems([line({ lineNumber: 7, unitPrice: -1.5 })]);
    expect(msgs(ps)).toEqual(["Line 7's unit price is -1.5. Orders with a negative price are held for review."]);
    expect(ps[0].tier).toBe(2);
  });

  // `OutputFieldValidator` checks `UnitPrice < 0`, not `<= 0`. A zero price is a real thing a buyer
  // sends (a free-of-charge line) and holding it would stop orders that deliver today.
  it("a ZERO unit price is not a problem — the asymmetry with quantity is deliberate", () => {
    expect(collectOrderProblems([line({ unitPrice: 0 })])).toEqual([]);
  });

  it("lines that still need review", () => {
    expect(msgs(collectOrderProblems([line({ needsReview: true }), line({ id: "l2", lineNumber: 2, needsReview: true })])))
      .toEqual(["2 order lines still need review, so this order can't be built. The layout itself is fine."]);
  });

  it("a missing supplier item code, aggregated across lines", () => {
    expect(msgs(collectOrderProblems([line({ supplierItemCode: null }), line({ id: "l2", lineNumber: 2, supplierItemCode: "  " })])))
      .toEqual(["2 order lines don't have a supplier item code yet, so this order can't be built. The layout itself is fine."]);
  });

  it("one line reads as one line, not as \"1 order lines\"", () => {
    expect(msgs(collectOrderProblems([line({ supplierItemCode: null })])))
      .toEqual(["1 order line doesn't have a supplier item code yet, so this order can't be built. The layout itself is fine."]);
  });

  it("order problems never block the save — the layout can be correct for an order that is not ready", () => {
    const ps = collectOrderProblems([line({ quantity: 0, unitPrice: -1, needsReview: true, supplierItemCode: null })]);
    expect(ps.length).toBe(4);
    expect(blocksSave(ps)).toBe(false);
  });
});

describe("problemCounts", () => {
  it("counts blockers and warnings separately", () => {
    const t = healthyTree();
    t.root.children![0] = { ...t.root.children![0], prefix: "cbc", namespace: null };
    t.root.children!.push(field("vat_code", null));
    expect(problemCounts([...collectLayoutProblems(t), ...collectOrderProblems([line({ quantity: 0 })])]))
      .toEqual({ problems: 1, notReady: 1, warnings: 1 });
  });

  it("a clean layout counts nothing", () => {
    expect(problemCounts(collectLayoutProblems(healthyTree()))).toEqual({ problems: 0, notReady: 0, warnings: 0 });
  });
});
