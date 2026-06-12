import { describe, it, expect } from "vitest";
import { shouldShowCatalogHint } from "./catalogHint";

describe("shouldShowCatalogHint", () => {
  it("shows when there are unresolved lines, nothing resolved, and the catalog is known empty", () => {
    expect(
      shouldShowCatalogHint({
        hasUnresolvedLines: true,
        anyLineResolved: false,
        catalogState: "known-empty",
      }),
    ).toBe(true);
  });

  it("renders nothing while the catalog probe is unknown (loading or error)", () => {
    expect(
      shouldShowCatalogHint({
        hasUnresolvedLines: true,
        anyLineResolved: false,
        catalogState: "unknown",
      }),
    ).toBe(false);
  });

  it("self-resolves once the supplier has catalog rows", () => {
    expect(
      shouldShowCatalogHint({
        hasUnresolvedLines: true,
        anyLineResolved: false,
        catalogState: "has-rows",
      }),
    ).toBe(false);
  });

  it("hides when a mapping or manual entry already resolved a line", () => {
    expect(
      shouldShowCatalogHint({
        hasUnresolvedLines: true,
        anyLineResolved: true,
        catalogState: "known-empty",
      }),
    ).toBe(false);
  });

  it("hides when all lines are resolved", () => {
    expect(
      shouldShowCatalogHint({
        hasUnresolvedLines: false,
        anyLineResolved: true,
        catalogState: "known-empty",
      }),
    ).toBe(false);
  });
});
