import { describe, it, expect } from "vitest";
import {
  computeOutgoingStatus,
  computeOutgoingStatuses,
  isRequiredOutput,
  type OutgoingStatusInput,
} from "./outgoingStatusModel";
import type { TargetField } from "./types";

const tf = (outputPath: string, scope: "header" | "line" = "header"): TargetField => ({
  outputPath,
  label: outputPath,
  scope,
});

/**
 * A baseline input with no wires/fixed/values — overridable per test.
 *
 * `valuesKnown: true` is the default because most of this file is about an ORDER whose parsed
 * values are loaded: there, an absent value means the supplier really gets nothing. The tests
 * that flip it to false are the ones about the connection editor with no sample order, where an
 * absent value means nobody ever looked.
 */
function baseInput(over: Partial<OutgoingStatusInput> = {}): OutgoingStatusInput {
  return {
    outputConnections: {},
    sourceConnections: {},
    fixedValues: {},
    tokenValueById: new Map(),
    canonicalValueByKey: new Map(),
    labelForCanonical: (k) => k,
    valuesKnown: true,
    ...over,
  };
}

describe("isRequiredOutput", () => {
  it("flags the dispatcher-required canonical outputs", () => {
    expect(isRequiredOutput(tf("PoNumber"))).toBe(true);
    expect(isRequiredOutput(tf("Quantity", "line"))).toBe(true);
    expect(isRequiredOutput(tf("UnitPrice", "line"))).toBe(true);
    expect(isRequiredOutput(tf("SupplierItemCode", "line"))).toBe(true);
  });

  it("leaves optional outputs un-required", () => {
    expect(isRequiredOutput(tf("Description", "line"))).toBe(false);
    expect(isRequiredOutput(tf("ArbitrarySupplierColumn"))).toBe(false);
    expect(isRequiredOutput(tf("BuyerName"))).toBe(false);
  });
});

describe("computeOutgoingStatus — fixed value", () => {
  it("treats an explicit fixed literal as mapped with a '= value' tag", () => {
    const s = computeOutgoingStatus(tf("Currency"), baseInput({ fixedValues: { Currency: "EUR" } }));
    expect(s.mapped).toBe(true);
    expect(s.kind).toBe("fixed");
    expect(s.source).toBe("= EUR");
    expect(s.valuePreview).toBe("EUR");
    expect(s.auto).toBe(false);
  });

  it("ignores an empty fixed value (falls through to auto/unmapped)", () => {
    const s = computeOutgoingStatus(tf("ArbitraryCol"), baseInput({ fixedValues: { ArbitraryCol: "" } }));
    expect(s.kind).toBe("none");
    expect(s.mapped).toBe(false);
  });
});

describe("computeOutgoingStatus — wired canonical", () => {
  it("resolves the value through a source-token wire and labels the source", () => {
    const s = computeOutgoingStatus(
      tf("OrderRef"),
      baseInput({
        outputConnections: { OrderRef: "PoNumber" },
        sourceConnections: { PoNumber: "cell:r1c1" },
        tokenValueById: new Map([["cell:r1c1", "PO-DEMO-001"]]),
        labelForCanonical: (k) => (k === "PoNumber" ? "PO number" : k),
      }),
    );
    expect(s.mapped).toBe(true);
    expect(s.kind).toBe("wired");
    expect(s.source).toBe("← PO number");
    expect(s.valuePreview).toBe("PO-DEMO-001");
    expect(s.auto).toBe(false);
  });

  it("falls back to the parsed canonical value when there is no source wire", () => {
    const s = computeOutgoingStatus(
      tf("OrderRef"),
      baseInput({
        outputConnections: { OrderRef: "PoNumber" },
        canonicalValueByKey: new Map([["PoNumber", "PO-PARSED-9"]]),
      }),
    );
    expect(s.valuePreview).toBe("PO-PARSED-9");
    expect(s.mapped).toBe(true);
  });

  it("is still mapped (wired) even when no value is resolvable yet", () => {
    const s = computeOutgoingStatus(tf("OrderRef"), baseInput({ outputConnections: { OrderRef: "PoNumber" } }));
    expect(s.mapped).toBe(true);
    expect(s.valuePreview).toBeNull();
  });
});

describe("computeOutgoingStatus — auto 1:1 default", () => {
  it("treats a canonical-keyed output with no override as auto, with a muted tag", () => {
    const s = computeOutgoingStatus(
      tf("PoNumber"),
      baseInput({ canonicalValueByKey: new Map([["PoNumber", "PO-1"]]) }),
    );
    expect(s.mapped).toBe(true);
    expect(s.kind).toBe("auto");
    expect(s.auto).toBe(true);
    expect(s.source).toBe("auto");
    expect(s.valuePreview).toBe("PO-1");
  });

  it("prefers an explicit source wire over the auto default for the same key", () => {
    const s = computeOutgoingStatus(
      tf("PoNumber"),
      baseInput({
        sourceConnections: { PoNumber: "cell:x" },
        tokenValueById: new Map([["cell:x", "FROM-SOURCE"]]),
        canonicalValueByKey: new Map([["PoNumber", "PARSED"]]),
      }),
    );
    // No explicit outputConnections, so this is still the auto branch, but the value
    // should resolve through the source wire (resolveCanonicalValue prefers the token).
    expect(s.kind).toBe("auto");
    expect(s.valuePreview).toBe("FROM-SOURCE");
  });
});

describe("computeOutgoingStatus — unmapped honesty", () => {
  it("an arbitrary unmapped output is quiet (kind none, not required)", () => {
    const s = computeOutgoingStatus(tf("SupplierSpecificCol"), baseInput());
    expect(s.mapped).toBe(false);
    expect(s.kind).toBe("none");
    expect(s.required).toBe(false);
    expect(s.source).toBeNull();
    expect(s.valuePreview).toBeNull();
  });

  it("a required output the default transform emits with nothing in it resolves to 'missing'", () => {
    // SupplierItemCode is required AND a canonical spine key, so it takes the auto branch and
    // `mapped` stays true — the default transform really does emit the column. What it emits is
    // empty, and that is what `resolution` reports. This assertion used to read only
    // `expect(s.required).toBe(true)` under a name that promised the field was "flagged
    // required+unmapped", which nothing checked and nothing did.
    const s = computeOutgoingStatus(tf("SupplierItemCode", "line"), baseInput()); // no value anywhere

    expect(s.required).toBe(true);
    expect(s.kind).toBe("auto");
    expect(s.mapped).toBe(true);
    expect(s.valuePreview).toBeNull();
    expect(s.resolution).toBe("missing");
  });

  it("an output with no rule at all is 'missing' whether or not the order's values are loaded", () => {
    // Branch 4 needs no value lookup to be certain: nothing emits this column, so there is
    // nothing to be unsure about. Only the branches that CHASE a value can answer "unknown".
    for (const valuesKnown of [true, false]) {
      const s = computeOutgoingStatus(tf("SupplierSpecificCol"), baseInput({ valuesKnown }));
      expect(s.kind).toBe("none");
      expect(s.resolution).toBe("missing");
    }
  });
});

describe("computeOutgoingStatuses — summary", () => {
  it("counts mapped / total and required-unmapped across the pane", () => {
    const fields = [tf("PoNumber"), tf("Currency"), tf("CustomA"), tf("CustomB")];
    const { statuses, summary } = computeOutgoingStatuses(
      fields,
      baseInput({
        // PoNumber auto-maps (canonical key); Currency fixed; CustomA/B unmapped.
        fixedValues: { Currency: "EUR" },
        canonicalValueByKey: new Map([["PoNumber", "PO-1"]]),
      }),
    );
    expect(summary.total).toBe(4);
    // PoNumber (auto) + Currency (fixed) mapped; the two customs unmapped.
    expect(summary.mappedCount).toBe(2);
    expect(statuses.find((s) => s.outputPath === "CustomA")!.mapped).toBe(false);
    // Neither custom is required → no loud unmapped.
    expect(summary.requiredUnmapped).toBe(0);
  });

  it("reports required-unmapped only for genuinely sourceless required outputs", () => {
    const fields = [tf("RequiredButFree")];
    // Not a canonical key, not required by name → stays 0 required-unmapped.
    const { summary } = computeOutgoingStatuses(fields, baseInput());
    expect(summary.requiredUnmapped).toBe(0);
  });
});

/**
 * `requiredUnmapped` is the Send gate's own term, and it was structurally incapable of being
 * anything but 0.
 *
 * REQUIRED_CANONICAL = {PoNumber, Quantity, UnitPrice, SupplierItemCode} is a strict SUBSET of
 * CANONICAL_SPINE, so branch 3 (the implicit 1:1 auto default) fires first for every required
 * field and hard-codes `mapped: true` — while `value` may be null. The summary then counted
 * `required && !mapped`, which no required field could ever satisfy. The gate that reads it
 * (`canDeliver`) therefore had a term that was pinned to zero, and the amber "N fields need a
 * source" warnings that read it were unreachable code.
 *
 * The two `toBe(0)` assertions above are not the guard: both fixtures give every required field
 * a value, so they pass identically before and after the fix. THIS block is the control — a
 * required field whose resolved value is null — and it fails against the old model.
 */
describe("computeOutgoingStatuses — a required output that resolves to nothing is counted", () => {
  it("counts the required canonical field the default transform would emit empty", () => {
    const { summary } = computeOutgoingStatuses(
      [tf("PoNumber"), tf("SupplierItemCode", "line")],
      // The order parsed a PO number but no supplier item code — the ordinary state of an
      // order that has not been mapped yet, and exactly what review exists to resolve.
      baseInput({ canonicalValueByKey: new Map([["PoNumber", "PO-1"]]) }),
    );

    expect(summary.requiredUnmapped).toBe(1);
    expect(summary.requiredUnknown).toBe(0);
  });

  it("counts a required field wired to a canonical key that carries no value", () => {
    // The wired branch resolves through the wire and finds nothing. `mapped` stays true (there
    // IS a wire) but the supplier still receives an empty required field.
    const { summary } = computeOutgoingStatuses(
      [tf("SupplierItemCode", "line")],
      baseInput({ outputConnections: { SupplierItemCode: "BuyerItemCode" } }),
    );

    expect(summary.requiredUnmapped).toBe(1);
  });

  it("counts nothing once every required output resolves", () => {
    // Anti-vacuity: a model that flagged everything would satisfy the assertions above and be
    // just as useless. A fully resolved order must still read clean.
    const { summary } = computeOutgoingStatuses(
      [tf("PoNumber"), tf("SupplierItemCode", "line"), tf("Quantity", "line"), tf("UnitPrice", "line")],
      baseInput({
        canonicalValueByKey: new Map([
          ["PoNumber", "PO-1"], ["SupplierItemCode", "SKU-9"], ["Quantity", "3"], ["UnitPrice", "9.50"],
        ]),
      }),
    );

    expect(summary.requiredUnmapped).toBe(0);
    expect(summary.requiredUnknown).toBe(0);
  });

  it("counts a fixed value as resolved without consulting the order at all", () => {
    // A literal needs no lookup, so it is "resolved" even where nothing else could be judged.
    const { summary } = computeOutgoingStatuses(
      [tf("SupplierItemCode", "line")],
      baseInput({ valuesKnown: false, fixedValues: { SupplierItemCode: "SKU-FIXED" } }),
    );

    expect(summary.requiredUnmapped).toBe(0);
    expect(summary.requiredUnknown).toBe(0);
  });
});

/**
 * The same defect rotated: an absent value must not become an accusation either.
 *
 * `canonicalValueByKey` is EMPTY whenever there is no order to build it from — the connection
 * editor with no sample order is the shipped case. Reading that as "these four required fields
 * have no source" would be the identical mistake pointed the other way: a verdict drawn from
 * evidence nobody produced. The third state is the answer, and it is carried separately so no
 * caller can fold it into either verdict by accident.
 */
describe("computeOutgoingStatuses — no order values loaded is UNKNOWN, not 'needs a source'", () => {
  const REQUIRED = [tf("PoNumber"), tf("Quantity", "line"), tf("UnitPrice", "line"), tf("SupplierItemCode", "line")];

  it("accuses nothing when there was never anything to resolve against", () => {
    const { summary } = computeOutgoingStatuses(REQUIRED, baseInput({ valuesKnown: false }));

    expect(summary.requiredUnmapped).toBe(0);
    expect(summary.requiredUnknown).toBe(4);
  });

  it("keeps unknown out of the resolved count too", () => {
    // The opposite over-claim: "we couldn't look" is not "it's fine" either.
    const statuses = computeOutgoingStatuses(REQUIRED, baseInput({ valuesKnown: false })).statuses;

    expect(statuses.every((s) => s.resolution === "unknown")).toBe(true);
    expect(statuses.some((s) => s.resolution === "resolved")).toBe(false);
  });

  it("switches to the accusation as soon as the order's values ARE loaded", () => {
    // Anti-vacuity for the unknown arm: the flag must actually change the answer, or it is
    // just a permanent excuse that re-pins requiredUnmapped to 0 by another route.
    const { summary } = computeOutgoingStatuses(REQUIRED, baseInput({ valuesKnown: true }));

    expect(summary.requiredUnmapped).toBe(4);
    expect(summary.requiredUnknown).toBe(0);
  });
});

/**
 * WP-14 — the "auto" branch must keep meaning what it says.
 *
 * `kind: "auto"` claims "the DEFAULT transform already carries this value 1:1, you do not need a
 * wire". That is true for the 13 names the default outgoing document actually emits. It is NOT
 * true for the 40 names WP-14 made BINDABLE: those resolve only when a rule names them, so for an
 * output column called `ShipToCity` with no rule the backend emits nothing at all — while the pane
 * showed it green, "auto", with a value preview taken from the parsed order.
 *
 * Bindable and emitted-by-default are two different sets. Conflating them turns the honest-status
 * model into a confident lie, which is worse than the amber it replaced.
 */
describe("computeOutgoingStatus — auto means the DEFAULT transform emits it, not merely that it is bindable", () => {
  it.each([
    "ShipToCity",
    "ShipToName",
    "Incoterms",
    "BuyerTaxId",
    "ContractNumber",
    "ManufacturerPartNumber",
  ])("does not claim %s is auto-mapped when no rule names it", (columnName) => {
    const s = computeOutgoingStatus(
      tf(columnName),
      // The parsed order HAS the value — that is exactly the trap: the preview would look right.
      baseInput({ canonicalValueByKey: new Map([[columnName, "Tallinn"]]) }),
    );

    expect(s.kind).toBe("none");
    expect(s.mapped).toBe(false);
    expect(s.valuePreview).toBeNull();
  });

  it("still reports the DEFAULT spine as auto-mapped", () => {
    // Non-vacuity: narrowing the spine must not make everything unmapped.
    for (const [field, value] of [
      ["PoNumber", "PO-1"],
      ["Currency", "EUR"],
      ["BuyerName", "Acme"],
      ["Quantity", "3"],
      ["UnitPrice", "9.50"],
    ] as const) {
      const s = computeOutgoingStatus(tf(field), baseInput({ canonicalValueByKey: new Map([[field, value]]) }));
      expect(s.kind).toBe("auto");
      expect(s.mapped).toBe(true);
      expect(s.valuePreview).toBe(value);
    }
  });

  it("reports a widened field as mapped once a rule actually binds it", () => {
    // The other half: binding ShipToCity IS supported by the backend row bag, so an explicit wire
    // must read as mapped. The defect is the claim without the rule, not the capability.
    const s = computeOutgoingStatus(
      tf("delivery_city"),
      baseInput({
        outputConnections: { delivery_city: "ShipToCity" },
        canonicalValueByKey: new Map([["ShipToCity", "Tallinn"]]),
      }),
    );

    expect(s.kind).toBe("wired");
    expect(s.mapped).toBe(true);
    expect(s.valuePreview).toBe("Tallinn");
  });
});
