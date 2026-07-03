// The workshop header's "buyer → supplier · total" value — founder bug: order
// 31f72daf (Rheinbahn) showed "€ 0.00" although its one line was qty 2 × 376.20
// = 752.40 EUR. Root cause: the backend-extracted grandTotal was stored as 0
// ("not captured"), and `order.grandTotal ?? lineSum` keeps a 0, so the honest
// line-sum fallback never ran; formatMoney also hardcoded the € symbol.
// Contract under test (orderDisplay):
//   1. a stored 0 / absent grandTotal falls back to the SAME sum the inbox
//      Value column shows (Sum(quantity × unitPrice)),
//   2. the label uses the order's currency CODE + amount ("EUR 752.40"), and
//   3. when no total is knowable (no priced lines yet) the label is "" so the
//      header renders NOTHING — never a fake zero.
import { describe, test, expect } from "vitest";
import type { Order, OrderLine } from "@/types/procurement";
import {
  orderTotal,
  resolvedGrandTotal,
  formatMoney,
  orderGrandTotalLabel,
} from "../review/orderDisplay";

const makeLine = (over: Partial<OrderLine> = {}): OrderLine => ({
  id: "l1",
  lineNumber: 1,
  buyerItemCode: "B-1",
  supplierItemCode: null,
  description: "Widget",
  quantity: 1,
  unitPrice: 10,
  confidence: 1,
  needsReview: false,
  ...over,
});

const makeOrder = (over: Partial<Order> = {}): Order => ({
  id: "31f72daf",
  poNumber: "PO-1",
  supplierId: "s1",
  supplierName: "Rheinbahn AG",
  orderDate: "2026-07-01",
  currency: "EUR",
  status: "pending_review",
  createdAt: "2026-07-01T00:00:00Z",
  updatedAt: "2026-07-01T00:00:00Z",
  lines: [],
  artifacts: [],
  ...over,
});

describe("orderGrandTotalLabel — the workshop header total", () => {
  test("REGRESSION 31f72daf: extracted grandTotal of 0 falls back to the line sum, not '€ 0.00'", () => {
    const order = makeOrder({
      grandTotal: 0, // backend stored 0 = "not captured"
      lines: [makeLine({ quantity: 2, unitPrice: 376.2 })],
    });
    expect(resolvedGrandTotal(order)).toBeCloseTo(752.4, 2);
    expect(orderGrandTotalLabel(order)).toBe("EUR 752.40");
  });

  test("absent grandTotal (null/undefined) computes from lines — same derivation as the inbox Value column", () => {
    const lines = [
      makeLine({ id: "l1", quantity: 2, unitPrice: 376.2 }),
      makeLine({ id: "l2", lineNumber: 2, quantity: 3, unitPrice: 25.2 }),
    ];
    expect(orderTotal(makeOrder({ lines }))).toBeCloseTo(828.0, 2);
    expect(orderGrandTotalLabel(makeOrder({ grandTotal: null, lines }))).toBe("EUR 828.00");
    expect(orderGrandTotalLabel(makeOrder({ lines }))).toBe("EUR 828.00");
  });

  test("a real extracted grandTotal wins over the line sum and formats with the order's currency code", () => {
    const order = makeOrder({
      currency: "PLN",
      grandTotal: 1469,
      lines: [makeLine({ quantity: 1, unitPrice: 999 })],
    });
    expect(orderGrandTotalLabel(order)).toBe("PLN 1,469.00");
  });

  test("unknown total (no lines yet — e.g. still parsing) hides the value entirely", () => {
    expect(resolvedGrandTotal(makeOrder({ status: "parsing" }))).toBeNull();
    expect(orderGrandTotalLabel(makeOrder({ status: "parsing" }))).toBe("");
  });

  test("unknown total (grandTotal 0 AND zero-priced lines) hides the value — never a fake zero", () => {
    const order = makeOrder({
      grandTotal: 0,
      lines: [makeLine({ quantity: 2, unitPrice: 0 })],
    });
    expect(resolvedGrandTotal(order)).toBeNull();
    expect(orderGrandTotalLabel(order)).toBe("");
  });

  test("formatMoney uses code + amount (inbox format), not a hardcoded symbol", () => {
    expect(formatMoney("EUR", 752.4)).toBe("EUR 752.40");
    expect(formatMoney("SEK", 828.2)).toBe("SEK 828.20");
    expect(formatMoney("USD", 120)).toBe("USD 120.00");
  });
});
