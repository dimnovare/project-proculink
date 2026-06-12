import { describe, it, expect } from "vitest";
import { isParseStalled, PARSE_STALL_THRESHOLD_MS } from "./parseStall";

describe("isParseStalled", () => {
  it("does not escalate under the 90s threshold", () => {
    expect(isParseStalled(0)).toBe(false);
    expect(isParseStalled(89_999)).toBe(false);
  });

  it("does not escalate at exactly the threshold (strictly greater)", () => {
    expect(isParseStalled(PARSE_STALL_THRESHOLD_MS)).toBe(false);
  });

  it("escalates once the threshold is exceeded", () => {
    expect(isParseStalled(PARSE_STALL_THRESHOLD_MS + 1)).toBe(true);
    expect(isParseStalled(10 * 60_000)).toBe(true);
  });

  it("uses the 90s default threshold", () => {
    expect(PARSE_STALL_THRESHOLD_MS).toBe(90_000);
  });

  it("never escalates on bad clock input", () => {
    expect(isParseStalled(-1)).toBe(false);
    expect(isParseStalled(Number.NaN)).toBe(false);
    expect(isParseStalled(Number.POSITIVE_INFINITY)).toBe(false);
  });

  it("honours a custom threshold", () => {
    expect(isParseStalled(5_001, 5_000)).toBe(true);
    expect(isParseStalled(4_999, 5_000)).toBe(false);
  });
});
