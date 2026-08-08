import { test, expect } from "@playwright/test";

import { RETIRED_ROUTES } from "../../src/lib/retired-routes";

/**
 * The retirement promise, asserted against a real server.
 *
 * src/test/retired-routes.test.ts proves the config is right. This proves the
 * server behaves: a retired URL answers 308 Permanent Redirect with a Location
 * header pointing at its replacement, and following it lands on a page that
 * renders. Those are the two things a person with an old bookmark experiences,
 * and neither is observable from the config alone.
 *
 * 308 (not 301) is what Next.js emits for `permanent: true`, and it is the one
 * we want: 301 permits a client to rewrite the follow-up request to GET, 308
 * preserves the method.
 */

/** A retired `source` pattern turned into a URL you can actually request. */
function probeUrl(pattern: string): string {
  return pattern.replace(/:[A-Za-z0-9_]+/g, "ord-002");
}

/**
 * A redirect target reduced to the part that has to match: path AND query.
 *
 * Both assertions below used to get this wrong, in two different ways, and both
 * bugs were invisible until /operations/webhooks became the first retired route
 * whose destination carries a query string (`/settings?tab=connectors`):
 *
 *   1. the Location check compared `new URL(...).pathname`, which DROPS the
 *      query by definition — so it could never match a target that has one, and
 *      would equally have passed a redirect that silently lost `?tab=connectors`
 *      and dumped the visitor on the wrong Settings tab;
 *   2. the landing check built a RegExp by escaping only `/` and `-`. Every
 *      other metacharacter survived into the pattern with its regex meaning
 *      intact: `?` turned the preceding character into an optional one, so
 *      `/settings?tab=connectors` compiled to a pattern matching
 *      `/settingtab=connectors` — a string nothing produces.
 *
 * The second is the more dangerous shape. A hand-built regex that happens to
 * still match is a SILENT PASS: `.` matches any character, `+` and `*` quantify,
 * so a destination could differ from what was asserted and the test would stay
 * green. That is why this is string equality on a normalized value and not a
 * pattern at all — there is no metacharacter left to reinterpret. The pure test
 * at the bottom of this file pins that, including the `.`-as-wildcard case, so
 * reintroducing a regex here fails instead of quietly passing.
 *
 * Accepts an absolute URL or a bare path, so a Location header, a browser URL
 * and a RETIRED_ROUTES destination all reduce to the same comparable string —
 * and a proxy that adds an origin still compares equal.
 */
function targetOf(urlOrPath: string): string {
  const u = new URL(urlOrPath, "http://localhost");
  return `${u.pathname}${u.search}`;
}

test.describe("retired routes redirect instead of 404ing", () => {
  for (const retired of RETIRED_ROUTES) {
    const from = probeUrl(retired.source);
    const to = targetOf(probeUrl(retired.destination));

    test(`${retired.source} → 308 → ${retired.destination}`, async ({ request }) => {
      const res = await request.get(from, { maxRedirects: 0 });

      expect(res.status(), `${from} should be a permanent redirect`).toBe(308);
      const location = res.headers()["location"] ?? "";
      expect(
        targetOf(location),
        `${from} should redirect to ${to}, query included`,
      ).toBe(to);
    });

    test(`${retired.source} lands on a page that renders`, async ({ page }) => {
      test.setTimeout(90_000); // first hit may cold-compile the destination
      const response = await page.goto(from);

      expect(response?.status(), `${to} should render, not error`).toBeLessThan(400);
      // Polled rather than read once, so a destination that settles after a
      // client-side step still passes — and unlike a predicate passed to
      // toHaveURL, a mismatch prints both strings instead of "predicate failed".
      await expect
        .poll(() => targetOf(page.url()), {
          message: `${from} should land on ${to}, query included`,
        })
        .toBe(to);
      // Next's own 404 page — the exact thing a retirement must never produce.
      await expect(page.getByText(/this page could not be found/i)).toHaveCount(0);
    });
  }

  /**
   * The regression pin, deliberately independent of the fixture list.
   *
   * The two defects above shipped because every retired destination happened to
   * be a bare path, so nothing exercised the query branch. Pinning the shape
   * here rather than relying on a fixture means the next destination carrying
   * `&` or `=` — or a `.`, which is where a regex would go silently wrong — is
   * already covered on the day it is added.
   */
  test("targetOf keeps the query and compares literally, not as a pattern", () => {
    // Query-less destinations are unchanged — the two that shipped before this.
    expect(targetOf("/library/suppliers")).toBe("/library/suppliers");
    expect(targetOf("/inbox/ord-002")).toBe("/inbox/ord-002");

    // DEFECT 1: the query is part of the target, not decoration. `.pathname`
    // returns "/settings" here, which is what made the old assertion unmatchable.
    expect(targetOf("/settings?tab=connectors")).toBe("/settings?tab=connectors");
    expect(targetOf("/settings?tab=connectors")).not.toBe("/settings");
    // Multi-parameter targets survive whole, so `&`/`=` need no special handling.
    expect(targetOf("/settings?tab=connectors&filter=active")).toBe(
      "/settings?tab=connectors&filter=active",
    );

    // An absolute URL reduces to the same string, so header/browser/config forms
    // are interchangeable and a proxy-added origin cannot fail the comparison.
    expect(targetOf("http://localhost:8082/settings?tab=connectors")).toBe(
      "/settings?tab=connectors",
    );

    // DEFECT 2: comparison is literal. These are the strings the old hand-built
    // regex would have accepted — `?` quantifying the preceding character, and
    // `.` matching any character. A pattern-based check can pass while the real
    // URL differs; string equality cannot.
    expect(targetOf("/settings?tab=connectors")).not.toBe("/settingtab=connectors");
    expect(targetOf("/settings?tab=connectors")).not.toBe("/settingstab=connectors");
    expect(targetOf("/a.b")).not.toBe("/axb");

    // Live coverage, so the branches above are not the only thing exercising
    // this. If either side hits zero the harness still passes but has stopped
    // proving something — change this deliberately, do not delete it.
    const destinations = RETIRED_ROUTES.map((r) => r.destination);
    expect(
      destinations.filter((d) => d.includes("?")),
      "no retired route targets a query string any more — the query branch of " +
        "targetOf is no longer exercised end to end by any fixture",
    ).not.toHaveLength(0);
    expect(
      destinations.filter((d) => !d.includes("?")),
      "every retired route now carries a query — the bare-path branch is no " +
        "longer exercised end to end by any fixture",
    ).not.toHaveLength(0);
  });
});
