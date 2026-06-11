// buildFixQueue unit tests — parity gate G3 for the spine redesign (batch 9
// Phase A). Proves: queue length === server needsReview lines + failing rules
// (INCLUDING the flagged-with-code class), frozen ordering on resolve, and
// append-only insertion of newly flagged issues.

import { describe, it, expect } from "vitest";
import { buildFixQueue, openCardCount, type FixQueueCard } from "./buildFixQueue";
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
