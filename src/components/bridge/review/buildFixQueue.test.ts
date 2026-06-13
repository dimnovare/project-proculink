// buildFixQueue unit tests — parity gate G3 for the spine redesign (batch 9
// Phase A). Proves: queue length === server needsReview lines + failing rules
// (INCLUDING the flagged-with-code class), frozen ordering on resolve, and
// append-only insertion of newly flagged issues.

import { describe, it, expect } from "vitest";
import { buildFixQueue, openCardCount, adjacentOpenKey, bulkAcceptStats, bulkAcceptDisabledReason, type FixQueueCard } from "./buildFixQueue";
import { shouldRequireConfirmCheckbox } from "./confirmPolicy";
import type { Order, OrderLine, OrderValidationResult, AcceptanceRule } from "@/types/procurement";

// ── Factories ────────────────────────────────────────────────────────────────

function makeLine(over: Partial<OrderLine> & { id: string; lineNumber: number }): OrderLine {
  return {
    buyerItemCode: `BUY-${over.lineNumber}`,
    description: `Item ${over.lineNumber}`,
    quantity: 1,
    unitPrice: 10,
    confidence: 0.9,
    needsReview: false,
    supplierItemCode: null,
    aiSuggestion: null,
    ...over,
  };
}

function makeOrder(lines: OrderLine[]): Order {
  return {
    id: "ord-test",
    poNumber: "PO-TEST-1",
    supplierId: "sup-1",
    supplierName: "Test Supplier",
    buyerName: "Test Buyer",
    orderDate: "2026-06-11",
    currency: "EUR",
    status: "pending_review",
    createdAt: "2026-06-11T00:00:00Z",
    updatedAt: "2026-06-11T00:00:00Z",
    lines,
    artifacts: [],
  };
}

const rule = (fieldPath: string): AcceptanceRule => ({
  scope: "order",
  fieldPath,
  operator: "required",
  severity: "error",
  blockOnFail: true,
});

function makeValidation(
  failures: Array<{ fieldPath: string; lineNumber?: number; severity?: "error" | "warning"; passed?: boolean }>,
): OrderValidationResult {
  return {
    orderId: "ord-test",
    passed: failures.every(f => f.passed === true),
    results: failures.map(f => ({
      rule: rule(f.fieldPath),
      passed: f.passed ?? false,
      message: `msg ${f.fieldPath}`,
      lineNumber: f.lineNumber,
      severity: f.severity ?? "error",
    })),
  };
}

// Standard fixture: 1 AI-suggested, 1 missing-code, 1 flagged-with-code, 1 clean.
function standardLines(): OrderLine[] {
  return [
    makeLine({
      id: "l1", lineNumber: 1, needsReview: true,
      aiSuggestion: { supplierItemCode: "SUP-001", confidence: 0.93, reason: "exact match", provenance: "catalog" },
    }),
    makeLine({ id: "l2", lineNumber: 2, needsReview: true }),
    makeLine({ id: "l3", lineNumber: 3, needsReview: true, supplierItemCode: "SUP-303" }),
    makeLine({ id: "l4", lineNumber: 4, needsReview: false, supplierItemCode: "SUP-404" }),
  ];
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("buildFixQueue — blocker coverage (G3)", () => {
  it("queue length === needsReview lines + failing rule count", () => {
    const order = makeOrder(standardLines());
    const validation = makeValidation([
      { fieldPath: "Header.Currency" },                    // header-level failure
      { fieldPath: "Lines[].Quantity", lineNumber: 2 },    // line-level failure
      { fieldPath: "Header.PoNumber", passed: true },      // passed — NOT a card
    ]);

    const queue = buildFixQueue(order, validation);

    const needsReview = order.lines.filter(l => l.needsReview).length;          // 3
    const failingRules = validation.results.filter(r => !r.passed).length;      // 2
    expect(queue).toHaveLength(needsReview + failingRules);
    expect(openCardCount(queue)).toBe(needsReview + failingRules);
  });

  it("INCLUDES the flagged-with-code class (the invisible-blocker P0)", () => {
    const order = makeOrder(standardLines());
    const queue = buildFixQueue(order, null);

    const flagged = queue.find(c => c.lineId === "l3");
    expect(flagged).toBeDefined();
    expect(flagged!.kind).toBe("review-flag");
    expect(flagged!.detail).toBe("SUP-303"); // shows the code it already has
  });

  it("classifies the four kinds from server truth", () => {
    const order = makeOrder(standardLines());
    const validation = makeValidation([{ fieldPath: "Header.Currency" }]);
    const queue = buildFixQueue(order, validation);

    expect(queue.map(c => c.kind).sort()).toEqual(
      ["ai-suggestion", "manual-code", "review-flag", "rule-failure"].sort(),
    );
    const headerRow = queue.find(c => c.kind === "rule-failure");
    expect(headerRow!.headerLevel).toBe(true);
  });

  it("emits no cards for a clean, validated order", () => {
    const order = makeOrder([makeLine({ id: "l1", lineNumber: 1, supplierItemCode: "S-1" })]);
    const validation = makeValidation([{ fieldPath: "Header.Currency", passed: true }]);
    expect(buildFixQueue(order, validation)).toHaveLength(0);
  });
});

describe("buildFixQueue — initial ordering", () => {
  it("sorts severity-then-line on first build", () => {
    // Deliberately scrambled line order in the input.
    const order = makeOrder([
      makeLine({ id: "l9", lineNumber: 9, needsReview: true }),                                  // manual-code
      makeLine({ id: "l3", lineNumber: 3, needsReview: true, supplierItemCode: "S-3" }),         // review-flag
      makeLine({
        id: "l5", lineNumber: 5, needsReview: true,
        aiSuggestion: { supplierItemCode: "S-5", confidence: 0.8, reason: "r", provenance: "p" },
      }),                                                                                        // ai-suggestion
      makeLine({
        id: "l1", lineNumber: 1, needsReview: true,
        aiSuggestion: { supplierItemCode: "S-1", confidence: 0.8, reason: "r", provenance: "p" },
      }),                                                                                        // ai-suggestion
    ]);
    const validation = makeValidation([{ fieldPath: "Header.Currency", severity: "warning" }]);

    const queue = buildFixQueue(order, validation);

    expect(queue.map(c => c.key)).toEqual([
      "line:l1",                 // ai-suggestion, line 1
      "line:l5",                 // ai-suggestion, line 5
      "line:l9",                 // manual-code
      "line:l3",                 // review-flag
      "rule:Header.Currency:h",  // rule failure (warning) last
    ]);
  });
});

describe("buildFixQueue — frozen ordering against prevQueue", () => {
  it("a resolved card KEEPS its index and collapses in place", () => {
    const order1 = makeOrder(standardLines());
    const queue1 = buildFixQueue(order1, null);
    expect(queue1.map(c => c.key)).toEqual(["line:l1", "line:l2", "line:l3"]);

    // Resolve the MIDDLE card (l2 gets a code and clears needsReview on the server).
    const order2 = makeOrder(standardLines().map(l =>
      l.id === "l2" ? { ...l, needsReview: false, supplierItemCode: "S-2" } : l,
    ));
    const queue2 = buildFixQueue(order2, null, queue1);

    // Identical positions — nothing reshuffles under the operator's cursor.
    expect(queue2.map(c => c.key)).toEqual(["line:l1", "line:l2", "line:l3"]);
    expect(queue2[1].resolved).toBe(true);
    expect(queue2[0].resolved).toBe(false);
    expect(queue2[2].resolved).toBe(false);
    expect(openCardCount(queue2)).toBe(2);
  });

  it("a resolved card stays resolved at its index across further rebuilds", () => {
    const order1 = makeOrder(standardLines());
    const queue1 = buildFixQueue(order1, null);
    const order2 = makeOrder(standardLines().map(l =>
      l.id === "l1" ? { ...l, needsReview: false, supplierItemCode: "S-1" } : l,
    ));
    const queue2 = buildFixQueue(order2, null, queue1);
    const queue3 = buildFixQueue(order2, null, queue2);

    expect(queue3.map(c => c.key)).toEqual(["line:l1", "line:l2", "line:l3"]);
    expect(queue3[0].resolved).toBe(true);
  });

  it("newly flagged issues APPEND with isNew instead of re-sorting", () => {
    const order1 = makeOrder(standardLines());
    const queue1 = buildFixQueue(order1, null);

    // A NEW validation run flags an ERROR-severity rule. Severity-wise it would
    // sort before nothing-resolved? No — rule failures sort last anyway; use a
    // new LINE flag (severity 1, would sort to index 2 on a fresh build) to
    // prove the frozen list appends instead of re-sorting.
    const order2 = makeOrder([
      ...standardLines(),
      makeLine({ id: "l0", lineNumber: 0, needsReview: true }), // manual-code, line 0 — fresh sort would put it FIRST among manual
    ]);
    const queue2 = buildFixQueue(order2, null, queue1);

    expect(queue2.map(c => c.key)).toEqual(["line:l1", "line:l2", "line:l3", "line:l0"]);
    expect(queue2[3].isNew).toBe(true);
    expect(queue2[0].isNew).toBeUndefined();
  });

  it("an open card updates its content in place when its kind changes", () => {
    // l2 (manual-code) gains an AI suggestion on a later refetch — same key,
    // same index, updated kind.
    const order1 = makeOrder(standardLines());
    const queue1 = buildFixQueue(order1, null);

    const order2 = makeOrder(standardLines().map(l =>
      l.id === "l2"
        ? { ...l, aiSuggestion: { supplierItemCode: "S-2", confidence: 0.7, reason: "r", provenance: "p" } }
        : l,
    ));
    const queue2 = buildFixQueue(order2, null, queue1);

    expect(queue2.map(c => c.key)).toEqual(["line:l1", "line:l2", "line:l3"]);
    expect(queue2[1].kind).toBe("ai-suggestion");
    expect(queue2[1].resolved).toBe(false);
  });

  it("disambiguates repeated failing rules on the same fieldPath+line", () => {
    const order = makeOrder([]);
    const validation = makeValidation([
      { fieldPath: "Lines[].Quantity", lineNumber: 1 },
      { fieldPath: "Lines[].Quantity", lineNumber: 1 },
    ]);
    const queue = buildFixQueue(order, validation);
    const keys = queue.map(c => c.key);
    expect(new Set(keys).size).toBe(2);
  });
});

describe("adjacentOpenKey — focus auto-advance / skip / arrow navigation (Phase B)", () => {
  const card = (key: string, resolved = false): FixQueueCard => ({
    key, kind: "manual-code", severity: 1, title: "t", resolved,
  });

  it("returns the next open card after the anchor, skipping resolved ones", () => {
    const q = [card("a"), card("b", true), card("c")];
    expect(adjacentOpenKey(q, "a", 1)).toBe("c");
  });

  it("wraps around the end of the frozen queue", () => {
    const q = [card("a"), card("b", true), card("c")];
    expect(adjacentOpenKey(q, "c", 1)).toBe("a");
    expect(adjacentOpenKey(q, "a", -1)).toBe("c");
  });

  it("advances past a JUST-resolved anchor to the next open card", () => {
    // The exact auto-advance case: the selected card collapsed server-side.
    const q = [card("a", true), card("b"), card("c")];
    expect(adjacentOpenKey(q, "a", 1)).toBe("b");
  });

  it("returns the only open card even when it is the anchor (single-card skip)", () => {
    const q = [card("a"), card("b", true)];
    expect(adjacentOpenKey(q, "a", 1)).toBe("a");
  });

  it("returns null when nothing is open", () => {
    const q = [card("a", true), card("b", true)];
    expect(adjacentOpenKey(q, "a", 1)).toBeNull();
    expect(adjacentOpenKey(q, null, 1)).toBeNull();
    expect(adjacentOpenKey([], null, 1)).toBeNull();
  });

  it("anchors at the first/last open card when no anchor is given", () => {
    const q = [card("a", true), card("b"), card("c")];
    expect(adjacentOpenKey(q, null, 1)).toBe("b");
    expect(adjacentOpenKey(q, null, -1)).toBe("c");
    // Unknown anchor behaves like no anchor.
    expect(adjacentOpenKey(q, "zzz", 1)).toBe("b");
  });
});

describe("shouldRequireConfirmCheckbox — conditional confirm policy (Phase B)", () => {
  const clean = { exceptionCount: 0, failingRuleCount: 0, validationStale: false };

  it("ALWAYS requires the checkbox when the flag keeps current behaviour (default)", () => {
    expect(shouldRequireConfirmCheckbox(clean, true)).toBe(true);
    expect(shouldRequireConfirmCheckbox({ ...clean, exceptionCount: 3 }, true)).toBe(true);
  });

  it("conditional mode: hides the checkbox only on a fully clean order", () => {
    expect(shouldRequireConfirmCheckbox(clean, false)).toBe(false);
  });

  it("conditional mode: any exception, failing rule, or stale validation requires it", () => {
    expect(shouldRequireConfirmCheckbox({ ...clean, exceptionCount: 1 }, false)).toBe(true);
    expect(shouldRequireConfirmCheckbox({ ...clean, failingRuleCount: 2 }, false)).toBe(true);
    expect(shouldRequireConfirmCheckbox({ ...clean, validationStale: true }, false)).toBe(true);
  });
});

describe("bulkAcceptStats / bulkAcceptDisabledReason — 'Accept all ≥90%' (G8 bug E)", () => {
  const suggestion = (code: string, confidence: number) =>
    ({ supplierItemCode: code, confidence, reason: "r", provenance: "p" });

  it("counts eligible vs below-threshold open AI suggestions", () => {
    const order = makeOrder([
      makeLine({ id: "l1", lineNumber: 1, needsReview: true, aiSuggestion: suggestion("S-1", 0.95) }),
      makeLine({ id: "l2", lineNumber: 2, needsReview: true, aiSuggestion: suggestion("S-2", 0.9) }),  // boundary: ≥ counts
      makeLine({ id: "l3", lineNumber: 3, needsReview: true, aiSuggestion: suggestion("S-3", 0.7) }),
    ]);
    expect(bulkAcceptStats(order, 0.9)).toEqual({ eligible: 2, belowThreshold: 1 });
    expect(bulkAcceptDisabledReason(bulkAcceptStats(order, 0.9))).toBeNull();
  });

  it("ignores resolved lines, lines with a code, and lines without suggestions", () => {
    const order = makeOrder([
      makeLine({ id: "l1", lineNumber: 1, needsReview: false, aiSuggestion: suggestion("S-1", 0.99) }), // not flagged
      makeLine({ id: "l2", lineNumber: 2, needsReview: true, supplierItemCode: "S-2", aiSuggestion: suggestion("S-2", 0.99) }), // has a code
      makeLine({ id: "l3", lineNumber: 3, needsReview: true }), // no suggestion
    ]);
    expect(bulkAcceptStats(order, 0.9)).toEqual({ eligible: 0, belowThreshold: 0 });
  });

  it("reason distinguishes 'no suggestions at all' from 'all below the bar'", () => {
    expect(bulkAcceptDisabledReason({ eligible: 0, belowThreshold: 0 }))
      .toBe("No AI suggestions on this order");
    expect(bulkAcceptDisabledReason({ eligible: 0, belowThreshold: 1 }))
      .toBe("1 suggestion below 90% confidence");
    expect(bulkAcceptDisabledReason({ eligible: 0, belowThreshold: 3 }))
      .toBe("3 suggestions below 90% confidence");
  });
});

describe("bulkAcceptStats — V9 calibrated vs raw threshold", () => {
  // An over-confident RAW 0.92 that the backend calibrated DOWN to 0.6 must NOT
  // auto-qualify for ≥0.9 bulk accept — reality, not the model's estimate, drives it.
  it("thresholds calibrated suggestions on the CALIBRATED confidence", () => {
    const order = makeOrder([
      // raw 0.92 ≥ 0.9 but calibrated 0.60 < 0.9 → below threshold
      makeLine({
        id: "l1", lineNumber: 1, needsReview: true,
        aiSuggestion: { supplierItemCode: "S-1", confidence: 0.92, reason: "r", provenance: "p", calibratedConfidence: 0.6, isCalibrated: true },
      }),
      // raw 0.80 < 0.9 but calibrated 0.95 ≥ 0.9 → eligible (calibration can also raise it)
      makeLine({
        id: "l2", lineNumber: 2, needsReview: true,
        aiSuggestion: { supplierItemCode: "S-2", confidence: 0.80, reason: "r", provenance: "p", calibratedConfidence: 0.95, isCalibrated: true },
      }),
    ]);
    expect(bulkAcceptStats(order, 0.9)).toEqual({ eligible: 1, belowThreshold: 1 });
  });

  it("uses RAW confidence when a suggestion is not calibrated (isCalibrated false / absent)", () => {
    const order = makeOrder([
      // isCalibrated false → ignore the calibrated number, use raw 0.92 → eligible
      makeLine({
        id: "l1", lineNumber: 1, needsReview: true,
        aiSuggestion: { supplierItemCode: "S-1", confidence: 0.92, reason: "r", provenance: "p", calibratedConfidence: 0.4, isCalibrated: false },
      }),
      // pre-V9 order: no calibration fields → raw 0.7 → below threshold
      makeLine({
        id: "l2", lineNumber: 2, needsReview: true,
        aiSuggestion: { supplierItemCode: "S-2", confidence: 0.7, reason: "r", provenance: "p" },
      }),
    ]);
    expect(bulkAcceptStats(order, 0.9)).toEqual({ eligible: 1, belowThreshold: 1 });
  });
});

describe("buildFixQueue — purity", () => {
  it("does not mutate the previous queue", () => {
    const order = makeOrder(standardLines());
    const queue1 = buildFixQueue(order, null);
    const snapshot: FixQueueCard[] = JSON.parse(JSON.stringify(queue1));

    const order2 = makeOrder(standardLines().map(l =>
      l.id === "l1" ? { ...l, needsReview: false, supplierItemCode: "S-1" } : l,
    ));
    buildFixQueue(order2, null, queue1);

    expect(queue1).toEqual(snapshot);
  });
});
