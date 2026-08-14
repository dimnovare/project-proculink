import { describe, it, expect } from "vitest";
import { buildFixQueue } from "./buildFixQueue";
import type { Order, OrderLine } from "@/types/procurement";

// "AI suggestion to review" — for a database lookup.
//
// The fix-queue card title was the flat string "AI suggestion to review" for every unresolved
// line carrying a suggestion. The backend put three DIFFERENT producers behind that one field:
//
//   • an exact match of the line's manufacturer part number against the supplier's own catalog,
//   • a straight echo of a manufacturer part number the source document prints,
//   • and an actual model call.
//
// Only the third is AI. The first two are deterministic — one indexed query and one string copy —
// and both used to be stamped with a fabricated 0.95 confidence, which is how they came to look
// like model output all the way up the stack.
//
// The discriminator is whether a confidence was recorded. Since the deterministic producers stopped
// fabricating one, a number exists here only if a scorer produced it.

const line = (over: Partial<OrderLine> = {}): OrderLine => ({
  id: "l1",
  lineNumber: 1,
  buyerItemCode: "29954596",
  supplierItemCode: null,
  description: "QuickTrace scanner",
  quantity: 1,
  unitPrice: 10,
  confidence: 0,
  needsReview: true,
  ...over,
}) as OrderLine;

const order = (lines: OrderLine[]): Order => ({
  id: "ord-1",
  poNumber: "PO-1",
  status: "pending_review",
  lines,
}) as Order;

/** A deterministic catalog hit, as the API now sends it: a code, a provenance, and no number. */
const CATALOG_SUGGESTION = {
  supplierItemCode: "FAB-SCAN-77120",
  confidence: null,
  reason: "Manufacturer part number LTQ2500-BK-BTK1 matched the supplier catalog.",
  provenance: "catalog: manufacturer part number",
} as unknown as NonNullable<OrderLine["aiSuggestion"]>;

/** A real model suggestion, carrying the model's real score. */
const MODEL_SUGGESTION = {
  supplierItemCode: "SUP-FROM-MODEL",
  confidence: 0.82,
  reason: "fuzzy match on description",
  provenance: "OpenAI structured output",
} as unknown as NonNullable<OrderLine["aiSuggestion"]>;

function titleFor(aiSuggestion: NonNullable<OrderLine["aiSuggestion"]>): string {
  const cards = buildFixQueue(order([line({ aiSuggestion })]), null);
  const card = cards.find((c) => c.kind === "ai-suggestion");
  // Anti-vacuity: the card must exist, or every wording assertion below passes for free.
  expect(card, "an unresolved line with a suggestion must produce an ai-suggestion card").toBeTruthy();
  expect(card!.detail).toBe(aiSuggestion.supplierItemCode);
  return card!.title;
}

describe("fix queue — only a model suggestion is called an AI suggestion", () => {
  it("a deterministic catalog match is NOT announced as AI", () => {
    const title = titleFor(CATALOG_SUGGESTION);

    expect(title).not.toMatch(/\bAI\b/);
    expect(title).toBe("Suggested code to review");
  });

  it("CONTROL — a real model suggestion still is", () => {
    // Without this, the guard above is satisfiable by removing the AI wording everywhere.
    expect(titleFor(MODEL_SUGGESTION)).toBe("AI suggestion to review");
  });

  it("the suggestion itself is never withheld — only the attribution changes", () => {
    // The operator must still get the one-click accept for a catalog match; this fix removes a
    // claim, not an affordance.
    const cards = buildFixQueue(order([line({ aiSuggestion: CATALOG_SUGGESTION })]), null);
    const card = cards.find((c) => c.kind === "ai-suggestion")!;
    expect(card.detail).toBe("FAB-SCAN-77120");
    expect(card.lineId).toBe("l1");
  });
});
