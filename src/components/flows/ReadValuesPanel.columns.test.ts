import { describe, expect, it } from "vitest";
import { columnShape } from "./ReadValuesPanel";

const cell = (value: string | null) => ({ value, confidence: 1, edited: false, location: null });
const rows = (key: string, values: (string | null)[]) => ({ rows: values.map((v) => ({ cells: { [key]: cell(v) } })) }) as unknown as Parameters<typeof columnShape>[0];

describe("columnShape", () => {
  it("is as wide as the longest value or the label, between 4 and 28 characters", () => {
    expect(columnShape(rows("qty", ["1", "12"]), "qty", "Qty").size).toBe(4);
    expect(columnShape(rows("d", ["Gasket set, stainless"]), "d", "Item").size).toBe(21);
    expect(columnShape(rows("d", ["x".repeat(80)]), "d", "Item").size).toBe(28);
  });

  it("right-aligns a column only when every value in it is a number", () => {
    expect(columnShape(rows("p", ["12.50", "1 303,40", null]), "p", "Price").numeric).toBe(true);
    expect(columnShape(rows("c", ["KS-100", "214"]), "c", "Code").numeric).toBe(false);
    expect(columnShape(rows("e", [null, ""]), "e", "Empty").numeric).toBe(false);
  });
});
