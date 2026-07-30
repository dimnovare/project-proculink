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

test.describe("retired routes redirect instead of 404ing", () => {
  for (const retired of RETIRED_ROUTES) {
    const from = probeUrl(retired.source);
    const to = probeUrl(retired.destination);

    test(`${retired.source} → 308 → ${retired.destination}`, async ({ request }) => {
      const res = await request.get(from, { maxRedirects: 0 });

      expect(res.status(), `${from} should be a permanent redirect`).toBe(308);
      // Next serves the Location as a path; compare the path only so a proxy
      // adding an origin does not fail the assertion.
      const location = res.headers()["location"] ?? "";
      expect(new URL(location, "http://localhost").pathname).toBe(to);
    });

    test(`${retired.source} lands on a page that renders`, async ({ page }) => {
      test.setTimeout(90_000); // first hit may cold-compile the destination
      const response = await page.goto(from);

      expect(response?.status(), `${to} should render, not error`).toBeLessThan(400);
      await expect(page).toHaveURL(new RegExp(`${to.replace(/[/-]/g, "\\$&")}$`));
      // Next's own 404 page — the exact thing a retirement must never produce.
      await expect(page.getByText(/this page could not be found/i)).toHaveCount(0);
    });
  }
});
