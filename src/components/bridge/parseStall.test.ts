import { describe, it, expect } from "vitest";
import { isParseStalled, PARSE_STALL_THRESHOLD_MS } from "./parseStall";

// Restored with WP-08. The original module was deleted correctly — its only importer was
// MagicMappingPreview, which was itself deleted — but the escalation it drove was not replaced, so
// the surviving parse gate (OrderWorkshop) polled forever with no way to say "this is taking too
// long". "Nothing happens" is this product's canonical symptom of a Worker outage, so an unbounded
// spinner is the worst possible rendering of it.
//
// The threshold is now 2 minutes, not the original 90s: that is the value useOrderReview was
// ALREADY using for its (unrendered) isStuck flag, and this module is now that flag's single source
// of truth. Keeping the live number rather than reinstating 90s means restoring the escalation is
// not also a silent timing change.

describe("isParseStalled", () => {
  it("does not escalate under the threshold", () => {
    expect(isParseStalled(0)).toBe(false);
    expect(isParseStalled(PARSE_STALL_THRESHOLD_MS - 1)).toBe(false);
  });

  it("does not escalate at exactly the threshold (strictly greater)", () => {
    expect(isParseStalled(PARSE_STALL_THRESHOLD_MS)).toBe(false);
  });

  it("escalates once the threshold is exceeded", () => {
    expect(isParseStalled(PARSE_STALL_THRESHOLD_MS + 1)).toBe(true);
    expect(isParseStalled(10 * 60_000)).toBe(true);
  });

  it("uses the 2-minute threshold useOrderReview already applied", () => {
    // Deliberately pinned: the backend StuckOrderDetectionJob only fires at 30 minutes, so this is
    // the number that decides how long a user stares at a spinner before being told anything.
    expect(PARSE_STALL_THRESHOLD_MS).toBe(2 * 60 * 1000);
  });

  it("never escalates on bad clock input", () => {
    // A clock skew must not manufacture an outage warning on a healthy parse.
    expect(isParseStalled(-1)).toBe(false);
    expect(isParseStalled(Number.NaN)).toBe(false);
    expect(isParseStalled(Number.POSITIVE_INFINITY)).toBe(false);
  });

  it("honours a custom threshold", () => {
    expect(isParseStalled(5_001, 5_000)).toBe(true);
    expect(isParseStalled(4_999, 5_000)).toBe(false);
  });
});
