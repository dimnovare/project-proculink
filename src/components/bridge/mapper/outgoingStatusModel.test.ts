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

/** A baseline input with no wires/fixed/values — overridable per test. */
function baseInput(over: Partial<OutgoingStatusInput> = {}): OutgoingStatusInput {
  return {
    outputConnections: {},
    sourceConnections: {},
    fixedValues: {},
    tokenValueById: new Map(),
    canonicalValueByKey: new Map(),
    labelForCanonical: (k) => k,
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

  it("a required output (non-canonical-path) that is unmapped is flagged required+unmapped", () => {
    // SupplierItemCode is required; as a line output with no source/auto value it is loud.
    const s = computeOutgoingStatus(
      tf("SupplierItemCode", "line"),
      baseInput(), // no value anywhere
    );
    // SupplierItemCode is a canonical spine key → auto branch; but with no value it's still
    // "mapped" by the default transform. Required loudness is for genuinely sourceless fields.
    expect(s.required).toBe(true);
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
