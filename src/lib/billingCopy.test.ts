import { describe, it, expect } from "vitest";
import { PLANS } from "@/lib/plans";
import { LIMIT_CODES, limitRefusalCopy } from "@/lib/limitRefusal";

// The plan allowance counts DOCUMENTS — an order counts once, and so will an invoice — so a
// sentence that states a limit must not call its unit "orders". A sentence states a limit when it
// carries a number or names the cap. "5 suppliers" is a different limit and passes untouched.
const LIMIT_SENTENCE = /\d|\blimit\b|\ballowance\b|\bthis month\b/i;
const SAYS_ORDERS = /\borders?\b/i;
const limitSentences = (text: string) =>
  text.split(/(?<=[.!?])\s+|\s+·\s+/).filter((s) => LIMIT_SENTENCE.test(s));

describe("billing copy", () => {
  it("billingCopy_SaysDocumentsNotOrders", () => {
    const refusals = [...LIMIT_CODES].flatMap((code) =>
      PLANS.map((p) => limitRefusalCopy({ code, plan: p.id, limit: null, raw: code })),
    );
    const checked = [
      ...PLANS.flatMap((p) => [...p.features, p.billingSummary]),
      ...refusals.flatMap((c) => [c.title, c.message]),
    ].flatMap(limitSentences);

    expect(checked.filter((s) => SAYS_ORDERS.test(s))).toEqual([]);
    expect(checked.length).toBeGreaterThanOrEqual(5);
    // The predicate bites on the shape this test retires.
    expect(limitSentences("Up to 150 orders / month · 5 suppliers").filter((s) => SAYS_ORDERS.test(s))).toHaveLength(1);
  });
});
