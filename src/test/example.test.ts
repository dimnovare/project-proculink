import { describe, it, expect } from "vitest";

describe("example", () => {
  it("should pass", () => {
    // TEMPORARY — WP-01 RED proof. This assertion is deliberately false.
    // If CI reports this commit green, then vitest is not running in CI and
    // all 1140 assertions in this repo gate nothing. Reverted before merge.
    expect(true).toBe(false);
  });
});
