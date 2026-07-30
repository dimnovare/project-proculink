import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

import nextConfig from "../../next.config";
import { RETIRED_ROUTES } from "@/lib/retired-routes";
import { ROOT, listAppRoutes, matchesAny, normalizePath } from "./appRoutes";

/**
 * The retirement gate.
 *
 * Deleting a page is only half the change. A bookmark, a help link or a search
 * result pointing at the old URL must still land somewhere useful, so every
 * entry in RETIRED_ROUTES has to satisfy all four of these at once:
 *
 *   1. the page is really gone from disk,
 *   2. a permanent (308) redirect is wired into next.config.ts,
 *   3. the destination is a page that really exists,
 *   4. nothing in the app still links to the dead path.
 *
 * Checking them together is the point: a redirect without the deletion is dead
 * code, and a deletion without the redirect is a 404 we promised not to ship.
 */

async function configuredRedirects() {
  const redirects = await nextConfig.redirects?.();
  return redirects ?? [];
}

describe("retired routes", () => {
  it("has something to retire", () => {
    expect(RETIRED_ROUTES.length).toBeGreaterThan(0);
  });

  describe.each(RETIRED_ROUTES)("$source", (retired) => {
    it("no longer has a page on disk", () => {
      const dir = join(ROOT, retired.deletedDir);
      expect(
        existsSync(dir),
        `${retired.deletedDir} still exists — the route was redirected but never deleted.`,
      ).toBe(false);
    });

    it("is not served by any App Router page", () => {
      // A literal probe path for the pattern: ":orderId" → a stand-in segment.
      const probe = retired.source.replace(/:[A-Za-z0-9_]+\*?/g, "probe-segment");
      expect(
        matchesAny(probe, listAppRoutes()),
        `${probe} still resolves to a page — visitors would never reach the redirect.`,
      ).toBe(false);
    });

    it("redirects permanently (308) to its replacement", async () => {
      const redirects = await configuredRedirects();
      const match = redirects.find((r) => r.source === retired.source);

      expect(match, `no redirect configured for ${retired.source}`).toBeDefined();
      // Next.js answers 308 Permanent Redirect for `permanent: true`.
      expect(match).toMatchObject({
        source: retired.source,
        destination: retired.destination,
        permanent: true,
      });
    });

    it("points at a destination that exists", () => {
      const probe = retired.destination.replace(/:[A-Za-z0-9_]+/g, "probe-segment");
      expect(
        matchesAny(probe, listAppRoutes()),
        `${retired.destination} is not a live route — the redirect would 404.`,
      ).toBe(true);
    });

    it("preserves every dynamic segment of the source", () => {
      const sourceParams = retired.source.match(/:[A-Za-z0-9_]+/g) ?? [];
      const destParams = retired.destination.match(/:[A-Za-z0-9_]+/g) ?? [];
      // Dropping the id would send someone who bookmarked one order to a list of
      // all of them, which reads as data loss even though nothing was lost.
      for (const param of sourceParams) {
        expect(destParams, `${retired.source} drops ${param} on the way to ${retired.destination}`)
          .toContain(param);
      }
    });

    it("explains itself", () => {
      expect(retired.why.length).toBeGreaterThan(40);
    });
  });

  it("leaves no link to a retired path anywhere in the app", () => {
    const deadPaths = RETIRED_ROUTES.map((r) => normalizePath(r.source.split("/:")[0]));
    const offenders: string[] = [];

    // The registries that put a path in front of a user: the sidebar, the hub
    // tab bars, the command palette, the per-screen guides, and the middleware
    // matcher. A retired route surviving in any of them is a visible dead end.
    const NAV_SOURCES = [
      "src/components/bridge/BridgeSidebar.tsx",
      "src/components/bridge/layout/HubTabs.tsx",
      "src/components/bridge/CommandPalette.tsx",
      "src/lib/section-guides.ts",
      "src/middleware.ts",
    ];

    for (const file of NAV_SOURCES) {
      const source = readFileSync(join(ROOT, file), "utf8");
      for (const dead of deadPaths) {
        // Quoted string only — a path inside a comment is documentation, not a link.
        const quoted = new RegExp(`["'\`]${dead}(?:[/"'\`?]|\\(\\.\\*\\))`);
        if (quoted.test(source)) offenders.push(`${file} → ${dead}`);
      }
    }

    expect(offenders, `retired paths still reachable:\n  ${offenders.join("\n  ")}`).toEqual([]);
  });
});
