// outputConditionModel — the structured ⇄ raw round trip for `OutputNode.includeWhen` (WP-16 · S12).
//
// The predicate the emitter runs is a bare Scriban boolean. Until now the only way to author one was
// to type it, so every conditional in the product was a developer artefact. These tests pin the two
// halves that make a builder safe: what it EMITS must be exactly the predicate a hand-author would
// have written, and what it PARSES must refuse anything it could not have emitted — because a
// builder that half-understands an expression rewrites it, and a rewritten predicate silently
// changes which lines reach the supplier.

import { describe, it, expect } from "vitest";
import {
  buildPredicate, parsePredicate, operatorsForField, isNumericConditionField,
  operatorTakesValue, OPERATOR_LABELS, NUMERIC_CONDITION_FIELDS,
  type StructuredCondition, type ConditionOperator,
} from "./outputConditionModel";
import { BINDABLE_HEADER_FIELDS, BINDABLE_LINE_FIELDS } from "@/lib/api/types";

const LINE = BINDABLE_LINE_FIELDS as readonly string[];
const HEADER = BINDABLE_HEADER_FIELDS as readonly string[];

describe("buildPredicate — the six operators emit the documented Scriban", () => {
  it("`is` on a text field quotes the value", () => {
    expect(buildPredicate({ scope: "order", field: "Currency", operator: "is", value: "EUR" }))
      .toBe('order.Currency == "EUR"');
  });

  it("`is not` on a text field quotes the value", () => {
    expect(buildPredicate({ scope: "order", field: "Currency", operator: "isNot", value: "EUR" }))
      .toBe('order.Currency != "EUR"');
  });

  it("`is empty` compares against the empty string and ignores the typed value", () => {
    expect(buildPredicate({ scope: "line", field: "Description", operator: "isEmpty", value: "leftover" }))
      .toBe('line.Description == ""');
  });

  it("`is not empty` compares against the empty string", () => {
    expect(buildPredicate({ scope: "line", field: "Description", operator: "isNotEmpty", value: "" }))
      .toBe('line.Description != ""');
  });

  it("`is more than` on a numeric field emits an UNQUOTED number", () => {
    expect(buildPredicate({ scope: "line", field: "Quantity", operator: "isMoreThan", value: "0" }))
      .toBe("line.Quantity > 0");
  });

  it("`is less than` on a numeric field emits an UNQUOTED number", () => {
    expect(buildPredicate({ scope: "line", field: "UnitPrice", operator: "isLessThan", value: "100" }))
      .toBe("line.UnitPrice < 100");
  });

  // The whole reason `>` is numeric-only. `"10" > "9"` is FALSE as a string comparison and produces
  // a perfectly plausible file, so a coordinator would never find it.
  it("equality on a NUMERIC field emits the number unquoted too", () => {
    expect(buildPredicate({ scope: "line", field: "Quantity", operator: "is", value: "1" }))
      .toBe("line.Quantity == 1");
  });

  it("a quote inside a text value is escaped, not emitted raw", () => {
    expect(buildPredicate({ scope: "line", field: "Description", operator: "is", value: 'a "b" c' }))
      .toBe('line.Description == "a \\"b\\" c"');
  });

  it("a backslash inside a text value is escaped", () => {
    expect(buildPredicate({ scope: "line", field: "Description", operator: "is", value: "a\\b" }))
      .toBe('line.Description == "a\\\\b"');
  });
});

describe("operator availability", () => {
  it("the nine numeric row-bag fields are numeric", () => {
    for (const f of ["Quantity", "UnitPrice", "LineTotal", "LineAmount", "LineNumber", "TaxRate", "SubTotal", "TaxTotal", "GrandTotal"]) {
      expect(isNumericConditionField(f)).toBe(true);
    }
    expect(NUMERIC_CONDITION_FIELDS).toHaveLength(9);
  });

  it("a text field is not numeric", () => {
    expect(isNumericConditionField("Description")).toBe(false);
    expect(isNumericConditionField("Currency")).toBe(false);
  });

  it("`is more than` / `is less than` are offered ONLY on numeric fields", () => {
    expect(operatorsForField("Quantity")).toEqual(["is", "isNot", "isEmpty", "isNotEmpty", "isMoreThan", "isLessThan"]);
    expect(operatorsForField("Description")).toEqual(["is", "isNot", "isEmpty", "isNotEmpty"]);
  });

  it("the emptiness operators take no value", () => {
    expect(operatorTakesValue("isEmpty")).toBe(false);
    expect(operatorTakesValue("isNotEmpty")).toBe(false);
    expect(operatorTakesValue("is")).toBe(true);
    expect(operatorTakesValue("isMoreThan")).toBe(true);
  });

  it("every operator has a plain-English label", () => {
    const ops: ConditionOperator[] = ["is", "isNot", "isEmpty", "isNotEmpty", "isMoreThan", "isLessThan"];
    expect(ops.map((o) => OPERATOR_LABELS[o]))
      .toEqual(["is", "is not", "is empty", "is not empty", "is more than", "is less than"]);
  });
});

describe("parsePredicate — round trip", () => {
  const cases: StructuredCondition[] = [
    { scope: "order", field: "Currency", operator: "is", value: "EUR" },
    { scope: "order", field: "Currency", operator: "isNot", value: "EUR" },
    { scope: "line", field: "Description", operator: "isEmpty", value: "" },
    { scope: "line", field: "Description", operator: "isNotEmpty", value: "" },
    { scope: "line", field: "Quantity", operator: "isMoreThan", value: "0" },
    { scope: "line", field: "UnitPrice", operator: "isLessThan", value: "100" },
    { scope: "line", field: "Quantity", operator: "is", value: "1" },
    { scope: "line", field: "Description", operator: "is", value: 'a "b" c' },
    { scope: "line", field: "Description", operator: "is", value: "a\\b" },
    { scope: "line", field: "UnitPrice", operator: "isMoreThan", value: "-1.5" },
  ];

  it.each(cases)("structured → raw → structured is identity for %o", (c) => {
    const fields = c.scope === "line" ? LINE : HEADER;
    expect(parsePredicate(buildPredicate(c), c.scope, fields)).toEqual(c);
  });

  it("tolerates the spacing a hand-author would use", () => {
    expect(parsePredicate("line.Quantity>0", "line", LINE))
      .toEqual({ scope: "line", field: "Quantity", operator: "isMoreThan", value: "0" });
    expect(parsePredicate("  line.Quantity   >   0  ", "line", LINE))
      .toEqual({ scope: "line", field: "Quantity", operator: "isMoreThan", value: "0" });
  });
});

describe("parsePredicate — refuses everything the builder could not have produced", () => {
  it("blank / null is not a condition", () => {
    expect(parsePredicate("", "line", LINE)).toBeNull();
    expect(parsePredicate(null, "line", LINE)).toBeNull();
    expect(parsePredicate(undefined, "line", LINE)).toBeNull();
    expect(parsePredicate("   ", "line", LINE)).toBeNull();
  });

  it("a compound expression stays raw", () => {
    expect(parsePredicate('line.Quantity > 0 && line.Unit == "EA"', "line", LINE)).toBeNull();
  });

  it("a function call stays raw", () => {
    expect(parsePredicate("string.size(line.Description) > 3", "line", LINE)).toBeNull();
  });

  it("an unsupported operator stays raw", () => {
    expect(parsePredicate("line.Quantity >= 0", "line", LINE)).toBeNull();
  });

  // The scope prefix is a fact about WHERE the value comes from. Reading `line.` into an order-scope
  // builder would let the field dropdown offer order fields against a line reference, and saving that
  // would rewrite a predicate the author never wrote.
  it("a scope prefix that does not match this position stays raw", () => {
    expect(parsePredicate('line.Quantity > 0', "order", HEADER)).toBeNull();
    expect(parsePredicate('order.Currency == "EUR"', "line", LINE)).toBeNull();
  });

  // Same class as the blank <select> the format control used to render: a value with no matching
  // option is worse than no builder at all.
  it("a field this position cannot offer stays raw", () => {
    expect(parsePredicate('line.NotAFieldAtAll == "x"', "line", LINE)).toBeNull();
  });

  // `>` on a text field is the string-comparison trap. The builder never offers it, so it must never
  // parse INTO the builder either — otherwise re-saving would launder it into a supported state.
  it("a numeric comparison on a TEXT field stays raw", () => {
    expect(parsePredicate("line.Description > 3", "line", LINE)).toBeNull();
  });

  it("a quoted right-hand side on a numeric comparison stays raw", () => {
    expect(parsePredicate('line.Quantity > "0"', "line", LINE)).toBeNull();
  });

  it("an unterminated string stays raw", () => {
    expect(parsePredicate('line.Description == "EUR', "line", LINE)).toBeNull();
  });

  it("a bare identifier right-hand side (a field-to-field comparison) stays raw", () => {
    expect(parsePredicate("line.Quantity == line.UnitPrice", "line", LINE)).toBeNull();
  });
});
