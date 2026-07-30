import { describe, expect, it } from "vitest";

import { extractLinks } from "./linkExtract";
import { extractRaw, NAV_CALL_ANCHOR, NAV_CALL_OR_NEW_URL_ANCHOR } from "./sourceScan";

/**
 * The shared source-scanning module (./sourceScan) is exercised end to end by BOTH guards that
 * import it — route-reachability.test.ts and link-crawl.test.ts each pin its extraction decisions
 * against hand-written fixtures, from opposite directions. Re-asserting comment stripping or region
 * bounds a third time here would just be a third copy of the same test.
 *
 * What neither guard can pin is the one place they deliberately DISAGREE: the nav-call anchor is
 * exported in two forms, and the wider one carries `new URL(…)`.
 *
 * That asymmetry is invisible to both suites. Widening the crawl's anchor to include `new URL` does
 * not obviously break anything — it just quietly starts demanding that paths which were never links
 * resolve. Narrowing the reachability guard's anchor does not obviously break anything either — it
 * just quietly stops crediting a real referrer. Either edit reads as a tidy-up, so the difference is
 * pinned here: the convergence that produced ./sourceScan was contracted to change NEITHER guard's
 * behaviour, and collapsing these two sets would have changed one.
 *
 * If the two should agree, that is a decision on its own merits with its own test. There is no
 * evidence in this repo for which answer is right, so this test asserts only that they still differ
 * exactly as they did before the convergence.
 */
describe("sourceScan — the two nav-call anchors differ by exactly `new URL`", () => {
  /** `.test()` on a /g regex advances lastIndex, so reset before every probe. */
  const matches = (re: RegExp, text: string) => {
    re.lastIndex = 0;
    return re.test(text);
  };

  it("both forms match the calls the two guards agree on", () => {
    for (const re of [NAV_CALL_ANCHOR, NAV_CALL_OR_NEW_URL_ANCHOR]) {
      expect(matches(re, 'router.push("/inbox")')).toBe(true);
      expect(matches(re, 'router.replace("/inbox")')).toBe(true);
      expect(matches(re, 'redirect("/bridge")')).toBe(true);
    }
  });

  it("only the wider form matches `new URL(`", () => {
    expect(matches(NAV_CALL_OR_NEW_URL_ANCHOR, 'new URL("/x", base)')).toBe(true);
    expect(matches(NAV_CALL_ANCHOR, 'new URL("/x", base)')).toBe(false);
  });

  it("the difference survives into what each guard actually extracts", () => {
    // The reachability guard's redirect group uses the wider anchor, so a `new URL` path IS a
    // referrer for it.
    expect(
      extractRaw('new URL("/welcome", req.url)', [{ anchor: NAV_CALL_OR_NEW_URL_ANCHOR, mode: "call" }]),
    ).toContain("/welcome");

    // The crawl uses the narrower one, so the same source yields no outbound link to check. This is
    // the assertion that fails if someone shares a single anchor between the two guards.
    expect(extractLinks('new URL("/welcome", req.url)')).toEqual([]);

    // …and the crawl has NOT gone blind to the calls both guards do agree on.
    expect(extractLinks('router.push("/inbox")')).toContain("/inbox");
    expect(extractLinks('redirect("/operations/health")')).toContain("/operations/health");
  });
});
