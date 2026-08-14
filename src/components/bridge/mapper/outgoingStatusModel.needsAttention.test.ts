// The attention-first split asked "is this field unmapped?" twice and called the second one
// "required without a resolved value".
//
// MapperWorkbench.tsx read:
//
//     const needsAttention = !st.mapped || (st.required && !st.mapped);
//
// The second disjunct is subsumed by the first, so the expression is exactly `!st.mapped` and the
// required half is dead twice over. Dead once because it is redundant; dead again because it could
// never have been true on its own: `isRequiredOutput` returns true only for PoNumber / Quantity /
// UnitPrice / SupplierItemCode, all four are CANONICAL_SPINE members, and branch 3 of
// `computeOutgoingStatus` claims every spine key with `mapped: true`. `required && !mapped` is
// structurally false.
//
// The question it MEANT to ask has had an answer since PR 181 added `resolution`: `mapped` says a
// rule emits the column, `resolution` says whether that rule reaches a value. So the predicate is
// `required && resolution === "missing"` — and it lives here, in the model that owns the tri-state,
// rather than being hand-written a fourth time at the call site.
//
// The third state is the reason this is a function and not an inlined `!==`. A required field whose
// order was never loaded is `"unknown"`, not `"missing"`, and must NOT be pulled into attention:
// that is the connection editor with no sample order, where an absent value means nobody looked.

import { describe, it, expect } from "vitest";
import {
  computeOutgoingStatus,
  needsAttentionStatus,
  needsSourceStatus,
  type OutgoingStatusInput,
} from "./outgoingStatusModel";
import type { TargetField } from "./types";

const tf = (outputPath: string, scope: "header" | "line" = "header"): TargetField => ({
  outputPath,
  label: outputPath,
  scope,
});

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

describe("needsSourceStatus", () => {
  it("is true for a required field the order is loaded for and nothing fills", () => {
    // The real shape, built through computeOutgoingStatus rather than hand-assembled: PoNumber is
    // a spine key, so branch 3 claims it with mapped: true — and with the order's values loaded
    // and no PoNumber among them, resolution is "missing". This is the case the old predicate
    // could not see.
    const status = computeOutgoingStatus(tf("PoNumber"), baseInput());

    expect(status.mapped).toBe(true);
    expect(status.required).toBe(true);
    expect(status.resolution).toBe("missing");
    expect(needsSourceStatus(status)).toBe(true);
  });

  it("is false for a required field whose values were never loaded", () => {
    // valuesKnown: false — the connection editor with no sample order. Both value maps are empty
    // because nobody looked, not because the supplier gets nothing. Accusing this field of a
    // missing source would be a verdict without evidence.
    const status = computeOutgoingStatus(tf("PoNumber"), baseInput({ valuesKnown: false }));

    expect(status.resolution).toBe("unknown");
    expect(needsSourceStatus(status)).toBe(false);
  });

  it("is false for a required field that resolves to a value", () => {
    const status = computeOutgoingStatus(
      tf("PoNumber"),
      baseInput({ canonicalValueByKey: new Map([["PoNumber", "PO-4471"]]) }),
    );

    expect(status.resolution).toBe("resolved");
    expect(needsSourceStatus(status)).toBe(false);
  });

  it("is false for an OPTIONAL output with no rule behind it", () => {
    // Anti-vacuity in the other direction: "missing" alone is not enough. An unmapped optional
    // column is quiet by design, and folding it in here would make the predicate mean "unmapped".
    const status = computeOutgoingStatus(tf("delivery_city"), baseInput());

    expect(status.required).toBe(false);
    expect(status.resolution).toBe("missing");
    expect(needsSourceStatus(status)).toBe(false);
  });
});

describe("needsAttentionStatus", () => {
  it("pulls in a required field that emits nothing — the case the old expression dropped", () => {
    const status = computeOutgoingStatus(tf("PoNumber"), baseInput());

    expect(needsAttentionStatus(status)).toBe(true);

    // The defect verbatim, as a control: the shipped expression evaluated to false for this exact
    // status, so the row it describes was filed under "already mapped" and collapsed out of sight.
    // If this line ever starts returning true, the subsumption is gone and the guard above is no
    // longer pinning anything.
    expect(!status.mapped || (status.required && !status.mapped)).toBe(false);
  });

  it("still pulls in a genuinely unmapped column", () => {
    // Non-vacuity for the FIRST disjunct: it is live and load-bearing, and the fix must not
    // narrow the split to required fields only. An output column no rule emits needs a human
    // whether or not the supplier demands it.
    const status = computeOutgoingStatus(tf("delivery_city"), baseInput());

    expect(status.mapped).toBe(false);
    expect(needsAttentionStatus(status)).toBe(true);
  });

  it("leaves a required field alone when its values were never loaded", () => {
    // The whole reason resolution is three states. Neither disjunct may fire on "unknown".
    const status = computeOutgoingStatus(tf("SupplierItemCode", "line"), baseInput({ valuesKnown: false }));

    expect(status.required).toBe(true);
    expect(status.resolution).toBe("unknown");
    expect(needsAttentionStatus(status)).toBe(false);
  });

  it("leaves a cleanly resolved field alone", () => {
    const status = computeOutgoingStatus(
      tf("Quantity", "line"),
      baseInput({ canonicalValueByKey: new Map([["Quantity", "12"]]) }),
    );

    expect(needsAttentionStatus(status)).toBe(false);
  });

  it("leaves a wired field alone once the wire reaches a value", () => {
    // Branch 2 rather than branch 3, so the predicate is not accidentally reading "auto" only.
    const status = computeOutgoingStatus(
      tf("ItemCode", "line"),
      baseInput({
        outputConnections: { ItemCode: "SupplierItemCode" },
        canonicalValueByKey: new Map([["SupplierItemCode", "ACM-BLT-M8"]]),
      }),
    );

    expect(status.kind).toBe("wired");
    expect(needsAttentionStatus(status)).toBe(false);
  });
});
