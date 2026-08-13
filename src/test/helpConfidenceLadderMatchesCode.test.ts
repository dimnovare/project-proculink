import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { confidenceTier } from "@/lib/ds-tokens";

/**
 * The help article that explains what a confidence percentage means must describe the ramp the
 * product actually renders.
 *
 * It did not. `help/ai-suggestions` documented a retired 85/70 ladder — "the review screen reads
 * 85%+ as high confidence, 70-84% as a good match, and anything lower as low confidence" — while
 * the shipped ramp has been 90/75 (`confidenceTier`, pinned at every boundary by
 * ConfidenceChip.test.tsx). Following the doc, an operator reading an 87% as "high confidence"
 * saw it render AMBER, and a 72% called "a good match" rendered RED. Both examples are asserted
 * below so the mismatch cannot come back as prose.
 *
 * The expected numbers are DERIVED from `confidenceTier`, never typed here: if someone moves a
 * threshold, this fails and names the doc, rather than silently agreeing with a stale sentence.
 */

const ARTICLE = join(
  process.cwd(),
  "src/app/(marketing)/help/ai-suggestions/page.mdx",
);

/** Lowest whole percent in each tier, found by asking the shipped function. */
function tierFloor(tier: "ok" | "warn"): number {
  for (let pct = 0; pct <= 100; pct++) {
    if (confidenceTier(pct) === tier) return pct;
  }
  throw new Error(`no percent tiers as ${tier}`);
}

describe("help/ai-suggestions describes the ramp the code renders", () => {
  const body = readFileSync(ARTICLE, "utf8");
  const greenFloor = tierFloor("ok"); // 90
  const amberFloor = tierFloor("warn"); // 75

  it("states the green and amber floors that confidenceTier actually uses", () => {
    expect(body).toContain(`green at ${greenFloor}%`);
    expect(body).toContain(`${amberFloor}% to ${greenFloor - 1}%`);
    expect(body).toContain(`below ${amberFloor}%`);
  });

  it("no longer states the retired 85/70 ladder", () => {
    expect(body).not.toContain("85%+ as high confidence");
    expect(body).not.toContain("70–84%");
    expect(body).not.toContain("70-84%");
  });

  it("the two examples the old copy got wrong now agree with the code", () => {
    // The doc called 87% "high confidence"; the product paints it amber.
    expect(confidenceTier(87)).toBe("warn");
    // The doc called 72% "a good match"; the product paints it red.
    expect(confidenceTier(72)).toBe("danger");
  });
});
