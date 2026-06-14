import { describe, it, expect } from "vitest";
import {
  indexValidation,
  indexCatalogHints,
  hasBlockingReview,
  blockingReviewCount,
  formatMoney,
  formatVariance,
  catalogActionLabel,
} from "./fieldBadgesModel";
import type { FieldValidationState, CatalogPriceHint } from "@/lib/api/types";

const states: FieldValidationState[] = [
  { key: "PoNumber", state: "valid" },
  { key: "City", state: "review", reason: "looks like a label: 'UIDNr'", blocking: false },
  { key: "SupplierItemCode", state: "review", reason: "no catalog match", blocking: true },
];

const hints: CatalogPriceHint[] = [
  { lineKey: "line:1", catalogCode: "ABC-1", catalogPrice: 12.5, poPrice: 11, variancePercent: 13.6, currency: "EUR" },
  { lineKey: "line:2", catalogCode: "XYZ-9", catalogPrice: null, poPrice: 9, variancePercent: null, currency: "EUR" },
];

describe("indexValidation / indexCatalogHints", () => {
  it("maps by key/lineKey", () => {
    expect(indexValidation(states).get("City")?.reason).toContain("UIDNr");
    expect(indexCatalogHints(hints).get("line:1")?.catalogCode).toBe("ABC-1");
  });
});

describe("hasBlockingReview / blockingReviewCount", () => {
  it("true only for blocking reviews", () => {
    expect(hasBlockingReview(states)).toBe(true);
    expect(blockingReviewCount(states)).toBe(1);
    expect(hasBlockingReview([{ key: "x", state: "review", blocking: false }])).toBe(false);
    expect(hasBlockingReview([{ key: "x", state: "valid" }])).toBe(false);
  });
});

describe("formatMoney", () => {
  it("uses the currency symbol and trims whole numbers", () => {
    expect(formatMoney(12, "EUR")).toBe("€12");
    expect(formatMoney(12.5, "EUR")).toBe("€12.50");
    expect(formatMoney(9.9, "USD")).toBe("$9.90");
  });
  it("renders a dash for missing amounts", () => {
    expect(formatMoney(null, "EUR")).toBe("—");
  });
});

describe("formatVariance", () => {
  it("signs and rounds", () => {
    expect(formatVariance(13.6)).toBe("+14%");
    expect(formatVariance(-3.2)).toBe("-3%");
    expect(formatVariance(null)).toBe("");
  });
});

describe("catalogActionLabel", () => {
  it("builds the full Use-catalog label with PO + variance", () => {
    expect(catalogActionLabel(hints[0])).toBe("Use catalog €12.50 (PO €11, +14%)");
  });
  it("returns null when there is no catalog price to suggest", () => {
    expect(catalogActionLabel(hints[1])).toBeNull();
    expect(catalogActionLabel(undefined)).toBeNull();
  });
});
