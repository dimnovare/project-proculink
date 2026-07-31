import { describe, test, expect } from "vitest";
import { withBinding, withFormatManipulator, withManipulators } from "./outputRuleModel";
import { MANIPULATOR_TYPES } from "@/lib/api/types";
import type { OutputFieldRule } from "@/lib/api/types";

const FORMAT_TYPES = new Set(["DateFormat", "NumberFormat"]);

function ruleWith(over: Partial<OutputFieldRule> = {}): OutputFieldRule {
  return {
    outputPath: "ItemCode",
    canonicalField: "SupplierItemCode",
    sourceToken: null,
    fixedValue: null,
    fieldManipulators: [],
    ...over,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// WP-15 · S1 — the designer must stop destroying rule fields it does not name.
//
// `Expression` sits at the TOP of the backend's resolution precedence
// (`MappedTransformService.ResolveExpressionOrField`). The two rule writers used to
// rebuild `rule` from a five-key literal, so rebinding a node — or just changing its
// date format — silently deleted the expression and changed the delivered document.
// ─────────────────────────────────────────────────────────────────────────────
describe("the rule writers preserve fields they do not own", () => {
  test("a rebind keeps the expression", () => {
    const prev = ruleWith({ expression: "line.Qty * 2" });
    const next = withBinding(prev, "ItemCode", "sourceToken", "cell:r2c5");

    expect(next.expression).toBe("line.Qty * 2");
    expect(next.sourceToken).toBe("cell:r2c5");
    expect(next.canonicalField).toBeNull();
    expect(next.fixedValue).toBeNull();
  });

  test("a format-preset change keeps the expression", () => {
    const prev = ruleWith({ expression: "line.Qty * 2" });
    const next = withFormatManipulator(prev, "ItemCode", FORMAT_TYPES, {
      type: "DateFormat", params: ["yyyy-MM-dd", "dd/MM/yyyy"],
    });

    expect(next.expression).toBe("line.Qty * 2");
    expect(next.fieldManipulators).toEqual([{ type: "DateFormat", params: ["yyyy-MM-dd", "dd/MM/yyyy"] }]);
  });

  test("a manipulator-stack edit keeps the expression", () => {
    const prev = ruleWith({ expression: "line.Qty * 2" });
    const next = withManipulators(prev, "ItemCode", [{ type: "Trim", params: [] }]);

    expect(next.expression).toBe("line.Qty * 2");
  });

  // The property that matters more than `expression` itself: this is the bug class,
  // not the bug. A backend field added tomorrow must survive without touching this
  // file — which a five-key literal can never do.
  test("an UNKNOWN rule field survives every writer", () => {
    const prev = { ...ruleWith(), somethingTheBackendAddedLater: "keep me" } as OutputFieldRule;

    for (const next of [
      withBinding(prev, "ItemCode", "fixedValue", "X"),
      withFormatManipulator(prev, "ItemCode", FORMAT_TYPES, null),
      withManipulators(prev, "ItemCode", []),
    ]) {
      expect((next as unknown as Record<string, unknown>).somethingTheBackendAddedLater).toBe("keep me");
    }
  });
});

describe("the rule writers still do their own job", () => {
  test("a binding is exclusive — setting one clears the other two", () => {
    const prev = ruleWith({ canonicalField: "PoNumber", sourceToken: null, fixedValue: null });
    const next = withBinding(prev, "ItemCode", "fixedValue", "LITERAL");

    expect(next.fixedValue).toBe("LITERAL");
    expect(next.canonicalField).toBeNull();
    expect(next.sourceToken).toBeNull();
  });

  test("outputPath re-syncs to the node name — a renamed node must not bind the old path", () => {
    const prev = ruleWith({ outputPath: "OldName" });
    expect(withBinding(prev, "NewName", "canonicalField", "PoNumber").outputPath).toBe("NewName");
    expect(withFormatManipulator(prev, "NewName", FORMAT_TYPES, null).outputPath).toBe("NewName");
  });

  test("a format change swaps ONLY the format step and keeps the rest in order", () => {
    const prev = ruleWith({
      fieldManipulators: [
        { type: "Trim", params: [] },
        { type: "DateFormat", params: ["a", "b"] },
        { type: "Multiply", params: ["2"] },
      ],
    });
    const next = withFormatManipulator(prev, "ItemCode", FORMAT_TYPES, { type: "NumberFormat", params: ["0.00"] });

    expect(next.fieldManipulators.map((m) => m.type)).toEqual(["Trim", "Multiply", "NumberFormat"]);
  });

  test("clearing the format leaves the other steps untouched", () => {
    const prev = ruleWith({
      fieldManipulators: [{ type: "Trim", params: [] }, { type: "DateFormat", params: ["a", "b"] }],
    });
    expect(withFormatManipulator(prev, "ItemCode", FORMAT_TYPES, null).fieldManipulators)
      .toEqual([{ type: "Trim", params: [] }]);
  });

  test("a node with no previous rule still gets a well-formed one", () => {
    const next = withBinding(null, "NewNode", "canonicalField", "PoNumber");
    expect(next).toEqual({
      outputPath: "NewNode",
      canonicalField: "PoNumber",
      sourceToken: null,
      fixedValue: null,
      fieldManipulators: [],
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// WP-15 · S2 — MANIPULATOR_TYPES must describe the manipulators that EXIST.
//
// Pinned by hand against `ProcuLink.Transform/Mapping/ManipulatorRegistry.cs` and the
// manipulator classes themselves on `origin/main`. This is the same two-repo guard
// shape as `canonicalFields.test.ts`: the frontend cannot import the C#, so the
// contract is written down once and asserted, and a drift shows up here rather than
// as an ArgumentException at transform time.
//
// The two entries that were WRONG, and what shipping them would have cost:
//
//   Concat   — declared ["suffix"]. The real ConcatManipulator requires >= 2 params
//              ([separator, col1, col2, …]), reads NAMED ROW COLUMNS, and ignores the
//              incoming value entirely. A one-param Concat throws
//              ArgumentException("Concat requires at least 2 params") at transform
//              time — i.e. the order fails to transform, in production.
//
//   Fallback — declared ["default"] / "Use a default when the value is empty". The real
//              FallbackManipulator treats each param as a COLUMN NAME and returns NULL
//              when none of them holds a value. Labelled as a literal default it would
//              silently BLANK a supplier's column. That is the most dangerous single
//              line the old table carried.
// ─────────────────────────────────────────────────────────────────────────────
describe("MANIPULATOR_TYPES matches the backend registry", () => {
  const byType = new Map(MANIPULATOR_TYPES.map((m) => [m.type, m]));

  test("every registry type an author may use is offered, and nothing else", () => {
    // LoadCatalogProduct is in the registry but is NOT author-facing: it is the
    // catalog-enrichment step, wired by the catalog pipeline rather than chosen in
    // the designer. Offering it would put a catalog lookup in a formatting menu.
    expect([...byType.keys()].sort()).toEqual([
      "Concat", "DateFormat", "Divide", "Fallback",
      "Multiply", "NumberFormat", "Replace", "Split", "Trim",
    ]);
  });

  test("Concat is the two-field JOIN it really is, not an append-suffix", () => {
    const c = byType.get("Concat")!;
    expect(c.params.length).toBeGreaterThanOrEqual(2);
    expect(c.params[0]).toBe("separator");
    // Its params after the separator are FIELD names, so the hint must not invite a
    // literal — a literal there resolves to an empty column and joins to "".
    expect(c.hint.toLowerCase()).toContain("field");
    expect(c.hint.toLowerCase()).not.toContain("suffix");
  });

  test("Fallback chains to other FIELDS, and its hint never promises a literal default", () => {
    const f = byType.get("Fallback")!;
    expect(f.params[0]).toBe("field");
    expect(f.hint.toLowerCase()).toContain("field");
    // "use a default" / "use this instead" would describe a literal. It cannot do that.
    expect(f.hint.toLowerCase()).not.toContain("default");
  });

  test("the arity of every entry matches the manipulator's own constructor", () => {
    expect(byType.get("Trim")!.params).toEqual([]);
    expect(byType.get("Replace")!.params).toEqual(["find", "replace"]);
    expect(byType.get("DateFormat")!.params).toEqual(["from", "to"]);
    expect(byType.get("NumberFormat")!.params).toEqual(["format"]);
    expect(byType.get("Split")!.params).toEqual(["separator", "index"]);
    expect(byType.get("Multiply")!.params).toEqual(["factor"]);
    expect(byType.get("Divide")!.params).toEqual(["divisor"]);
  });
});
