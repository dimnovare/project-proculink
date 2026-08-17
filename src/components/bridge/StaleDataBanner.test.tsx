import { describe, it, expect } from "vitest";
import { staleAgeSentence } from "./StaleDataBanner";

// The age sentence is the only part of the banner that makes a factual claim, so
// it is tested on its own rather than through a page render. The `now` parameter
// exists for exactly this: an age phrase read off `Date.now()` inside the
// component would be untestable, and an untestable claim is how "showing the
// last successful check" becomes another sentence nobody ever checked.

describe("staleAgeSentence", () => {
  it("does not print a number it cannot justify", () => {
    // `dataUpdatedAt` is 0 for a query that never resolved. That case should not
    // reach the banner at all (no data → blocking card), but if it ever does,
    // vagueness beats "from 56 years ago".
    expect(staleAgeSentence(0, Date.now())).toBe("from an earlier check");
    expect(staleAgeSentence(Number.NaN, Date.now())).toBe("from an earlier check");
  });

  it("does not claim data is from the future when clocks disagree", () => {
    const now = 1_700_000_000_000;
    expect(staleAgeSentence(now + 5_000, now)).toBe("from an earlier check");
  });

  it("scales from seconds to days", () => {
    const now = 1_700_000_000_000;
    expect(staleAgeSentence(now - 5_000, now)).toBe("from a few seconds ago");
    expect(staleAgeSentence(now - 60_000, now)).toBe("from 1 minute ago");
    expect(staleAgeSentence(now - 120_000, now)).toBe("from 2 minutes ago");
    expect(staleAgeSentence(now - 3_600_000, now)).toBe("from 1 hour ago");
    expect(staleAgeSentence(now - 7_200_000, now)).toBe("from 2 hours ago");
    expect(staleAgeSentence(now - 86_400_000, now)).toBe("from 1 day ago");
  });

  it("keeps singular and plural apart at every unit (anti-vacuity control)", () => {
    // Without this, `${n} minutes ago` for n === 1 would pass every assertion
    // above that only checks for a substring.
    const now = 1_700_000_000_000;
    expect(staleAgeSentence(now - 60_000, now)).not.toContain("1 minutes");
    expect(staleAgeSentence(now - 3_600_000, now)).not.toContain("1 hours");
    expect(staleAgeSentence(now - 86_400_000, now)).not.toContain("1 days");
  });
});
