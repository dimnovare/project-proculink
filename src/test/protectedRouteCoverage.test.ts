// Protected-route coverage — the edge guard vs. the route tree.
//
// THE DEFECT THIS EXISTS FOR (A-F1, 2026-08-15). `isProtectedRoute` in
// src/middleware.ts was a hand-maintained list of URL prefixes. Nothing tied it to
// the pages that actually exist, so when `/connections` and `/inbound/*` shipped
// under src/app/(app)/ nobody added them, and both stayed publicly routable for
// months. `/connections` was not even obscure: it is a VISIBLE tab on the Suppliers
// hub strip (HubTabs.tsx, "Supplier changes"). A signed-out visitor who clicked it
// got the full app shell and the sentence "No connections yet" — asserted with
// confidence, because a TanStack v5 query with `enabled: false` reports
// `isLoading === false`, so "we never asked" renders identically to "there is
// nothing".
//
// The finding is NOT "two routes were forgotten". It is that the correspondence
// between routable app pages and the matcher had no enforcement. This file is that
// enforcement, and it runs in both directions:
//
//   1. every page under src/app/(app)/ is claimed by the matcher;
//   2. every pattern in the matcher corresponds to a real directory under (app),
//      so a prefix left behind by a deleted surface is caught too;
//   3. no route OUTSIDE (app) is claimed — marketing, sign-in/up and the
//      /onboarding/select-organization gate must stay reachable signed out, and
//      the org gate self-loops if its own route is ever protected.
//
// ANTI-VACUITY. Every walk below is floored. A tree walk that finds nothing makes
// `.every()` return true and turns this whole file green while enforcing zero — the
// failure mode this repo has already paid for. Each direction asserts a minimum
// population AND names sentinel routes that must be present, so a broken walk fails
// loudly instead of passing silently.
//
// It asserts against the REAL matcher (`isProtectedPath`, which calls the same
// `createRouteMatcher` instance the middleware runs), never a copy rebuilt from the
// exported pattern list — a check fed its own inputs cannot fail.

import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { isProtectedPath, PROTECTED_ROUTE_PATTERNS } from "../middleware";
import { listAppRoutes, ROOT } from "./appRoutes";

const APP_GROUP_DIR = join(ROOT, "src", "app", "(app)");
const APP_DIR = join(ROOT, "src", "app");

/**
 * Turn a route pattern into one concrete URL the matcher can be asked about:
 * "/inbox/[orderId]" -> "/inbox/sample", "/sign-in/[[...sign-in]]" -> "/sign-in".
 */
function concretePath(pattern: string): string {
  const path = pattern
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      if (/^\[\[\.\.\..+\]\]$/.test(segment)) return null; // optional catch-all
      if (/^\[\.\.\..+\]$/.test(segment)) return "sample";
      if (/^\[.+\]$/.test(segment)) return "sample";
      return segment;
    })
    .filter((s): s is string => s !== null)
    .join("/");
  return `/${path}`;
}

/** Pages served from src/app/(app)/ — the tenant-scoped workspace. */
const APP_GROUP_ROUTES = listAppRoutes(APP_GROUP_DIR).sort();

/** Everything else the App Router serves: marketing, home, auth, the org gate. */
const NON_APP_ROUTES = listAppRoutes(APP_DIR)
  .filter((r) => !APP_GROUP_ROUTES.includes(r))
  .sort();

describe("the route walk is not vacuous", () => {
  // Nothing below can mean anything if these are wrong. 20 routes existed under
  // (app) when this guard was written; the floors sit under both counts with room
  // for deletions, and are not a moving target to be raised on every new page.
  it("finds a real population of (app) routes", () => {
    expect(APP_GROUP_ROUTES.length).toBeGreaterThanOrEqual(15);
  });

  it("finds a real population of routes outside (app)", () => {
    expect(NON_APP_ROUTES.length).toBeGreaterThanOrEqual(10);
  });

  it("finds the specific routes it is supposed to be walking over", () => {
    // Sentinels, not a full list: a walk that silently stopped one directory short
    // (or resolved the wrong tree entirely) still clears a bare count.
    for (const route of [
      "/bridge",
      "/inbox",
      "/inbox/[orderId]",
      "/settings",
      "/upload",
      "/library/suppliers",
      "/operations/log",
      "/admin",
    ]) {
      expect(APP_GROUP_ROUTES).toContain(route);
    }

    for (const route of ["/", "/pricing", "/sign-in/[[...sign-in]]", "/onboarding/select-organization"]) {
      expect(NON_APP_ROUTES).toContain(route);
    }
  });

  it("keeps the two halves disjoint", () => {
    expect(APP_GROUP_ROUTES.filter((r) => NON_APP_ROUTES.includes(r))).toEqual([]);
  });
});

describe("every page under src/app/(app)/ is behind the edge guard", () => {
  it.each(APP_GROUP_ROUTES)("%s requires sign-in", (route) => {
    expect(isProtectedPath(concretePath(route))).toBe(true);
  });

  // The original defect, verbatim, so the regression is pinned by name and not
  // only by the walk that would have caught it.
  it("claims /connections and its detail page — the A-F1 finding", () => {
    expect(isProtectedPath("/connections")).toBe(true);
    expect(isProtectedPath("/connections/conn-123")).toBe(true);
  });

  it("claims /inbound/invoices and /inbound/asns — the A-F1 finding", () => {
    expect(isProtectedPath("/inbound/invoices")).toBe(true);
    expect(isProtectedPath("/inbound/asns")).toBe(true);
  });
});

describe("the guard claims nothing outside src/app/(app)/", () => {
  it.each(NON_APP_ROUTES)("%s stays reachable signed out", (route) => {
    expect(isProtectedPath(concretePath(route))).toBe(false);
  });

  // Named separately because protecting this one does not merely over-block: the
  // org gate redirects TO it, so claiming it would make the redirect self-loop.
  it("never claims the organisation gate it redirects to", () => {
    expect(isProtectedPath("/onboarding/select-organization")).toBe(false);
  });
});

describe("no pattern outlives the surface it protected", () => {
  it.each([...PROTECTED_ROUTE_PATTERNS])(
    "%s corresponds to a live route under (app)",
    (pattern) => {
      // "/library(.*)" -> "/library"; the prefix must own at least one real page.
      const prefix = pattern.replace(/\(\.\*\)$/, "");
      const owned = APP_GROUP_ROUTES.filter(
        (r) => r === prefix || r.startsWith(`${prefix}/`),
      );
      expect(owned.length).toBeGreaterThan(0);
    },
  );
});
