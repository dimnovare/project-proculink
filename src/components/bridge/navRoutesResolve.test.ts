import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";

// WP-26 — "nothing may 404" as an executable invariant.
//
// The four-destination nav (Orders · Suppliers · Activity · Settings) reaches
// most of the product through hub tabs, and reaches the advanced surfaces
// through HIDDEN hub entries. That only stays honest if three things hold, and
// none of them is provable by reading the nav in isolation:
//
//   1. every page that exists on disk is reachable from the nav;
//   2. every href the nav points at is a page that exists on disk, or a path
//      covered by a permanent redirect (a nav item pointing at nothing is a
//      404 the moment a page is retired);
//   3. every permanent redirect lands on a page that exists AND that the new
//      nav can reach — otherwise a bookmark survives the move only to arrive
//      somewhere the four-item nav has no way back to.
//
// The route list is read from the filesystem rather than hand-maintained, so a
// new page cannot be added without either appearing in the nav tree or failing
// this suite. next.config.ts is read as TEXT: importing it would execute the
// MDX and Sentry wrappers, and the redirect table is a plain literal.

import { buildVisibleNav, PINNED_ACTION_HREF } from "./BridgeSidebar";
import { HUB_TABS, hubForPath, type HubKey } from "./layout/HubTabs";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const APP_DIR = path.join(REPO_ROOT, "src/app");

/** Next.js `pageExtensions` (next.config.ts) — .mdx pages are routes too. */
const PAGE_FILES = ["page.tsx", "page.ts", "page.mdx"];

/**
 * Every route under the (app) group, as a concrete pathname. Dynamic segments
 * are filled with a sample id so the result can be fed straight to hubForPath
 * and to the prefix checks the nav uses.
 */
function appRoutes(): string[] {
  const routes: string[] = [];
  const walk = (dir: string, segments: string[]) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const name = entry.name;
        // Route groups "(app)" and private folders "_x" add no path segment.
        if (name.startsWith("(") || name.startsWith("_")) {
          walk(path.join(dir, name), segments);
          continue;
        }
        // [id] / [[...slug]] → a sample value so the path is concrete.
        const segment = name.startsWith("[") ? "sample-id" : name;
        walk(path.join(dir, name), [...segments, segment]);
        continue;
      }
      if (PAGE_FILES.includes(entry.name)) routes.push("/" + segments.join("/"));
    }
  };
  walk(path.join(APP_DIR, "(app)"), []);
  return [...new Set(routes)].sort();
}

/** Does a pathname have a page on disk? Dynamic segments count as a match. */
function pageExistsFor(pathname: string): boolean {
  const wanted = pathname.split("/").filter(Boolean);
  const match = (dir: string, depth: number): boolean => {
    if (!existsSync(dir) || !statSync(dir).isDirectory()) return false;
    if (depth === wanted.length) {
      return PAGE_FILES.some((f) => existsSync(path.join(dir, f)));
    }
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const name = entry.name;
      if (name.startsWith("(") || name.startsWith("_")) {
        if (match(path.join(dir, name), depth)) return true;
        continue;
      }
      if (name === wanted[depth] || name.startsWith("[")) {
        if (match(path.join(dir, name), depth + 1)) return true;
      }
    }
    return false;
  };
  return match(APP_DIR, 0);
}

interface Redirect {
  source: string;
  destination: string;
  permanent: boolean;
}

/** The redirect table from next.config.ts, minus the cross-origin www rule. */
function redirects(): Redirect[] {
  const src = readFileSync(path.join(REPO_ROOT, "next.config.ts"), "utf8");
  const block = src.slice(src.indexOf("async redirects()"));
  const found: Redirect[] = [];
  const re =
    /source:\s*"([^"]+)"[\s\S]{0,400}?destination:\s*"([^"]+)"[\s\S]{0,120}?permanent:\s*(true|false)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block))) {
    if (m[2].startsWith("http")) continue; // apex-domain canonicalisation
    found.push({ source: m[1], destination: m[2], permanent: m[3] === "true" });
  }
  return found;
}

/** `/orders/:id` → `/orders/sample-id`, so a redirect can be checked concretely. */
const concrete = (p: string) => p.replace(/:[^/*]+\*?/g, "sample-id");

const NAV = buildVisibleNav("Suppliers", true);
const NAV_ITEMS = [...NAV.main.flatMap((s) => s.items), ...NAV.tail];
const HUBS = Object.keys(HUB_TABS) as HubKey[];

/** The nav's own reachability rule, applied to any pathname. */
function reachableFromNav(route: string): boolean {
  const direct = NAV_ITEMS.some((i) => route === i.href || route.startsWith(i.href + "/"));
  const viaHub = NAV_ITEMS.some((i) => i.hub && hubForPath(route) === i.hub);
  const viaPinned = route === PINNED_ACTION_HREF || route.startsWith(PINNED_ACTION_HREF + "/");
  return direct || viaHub || viaPinned;
}

describe("nav routes resolve — nothing 404s, nothing is stranded", () => {
  it("finds the app routes on disk (the list is derived, not hand-written)", () => {
    const routes = appRoutes();
    // Sanity: the walker really found the tree, so an empty list can't make the
    // assertions below pass vacuously.
    expect(routes.length).toBeGreaterThan(20);
    expect(routes).toContain("/inbox");
    expect(routes).toContain("/library/suppliers/sample-id");
    expect(routes).toContain("/operations/health");
  });

  it("reaches every page that exists on disk from the four-item nav", () => {
    const unreachable = appRoutes().filter((r) => !reachableFromNav(r));
    expect(unreachable, "every (app) route must be reachable from the nav").toEqual([]);
  });

  it("points every nav href and every hub tab at a page that exists", () => {
    const targets = [
      ...NAV_ITEMS.map((i) => i.href),
      PINNED_ACTION_HREF,
      ...HUBS.flatMap((h) => HUB_TABS[h].map((t) => t.href)),
      // `match` aliases are advertised as belonging to the hub, so they must
      // resolve too — a stale alias silently lights a tab for a dead URL.
      ...HUBS.flatMap((h) => HUB_TABS[h].flatMap((t) => t.match ?? [])),
    ];
    const redirected = new Set(redirects().filter((r) => r.permanent).map((r) => r.source));
    const dead = [...new Set(targets)].filter(
      // /help lives in the (marketing) group, so pageExistsFor walks all of src/app.
      (href) => !pageExistsFor(href) && !redirected.has(href),
    );
    expect(dead, "a nav destination with no page and no redirect is a 404").toEqual([]);
  });

  it("keeps every permanent redirect landing on a live page the new nav can reach", () => {
    for (const r of redirects()) {
      expect(r.permanent, `${r.source} must be a permanent (308) redirect`).toBe(true);
      const dest = concrete(r.destination);
      expect(pageExistsFor(dest), `${r.source} → ${r.destination} must land on a real page`).toBe(true);
      // Help articles live outside the app shell; the nav reaches them via /help.
      if (dest.startsWith("/help")) continue;
      expect(
        reachableFromNav(dest),
        `${r.source} → ${r.destination} must land somewhere the nav can reach`,
      ).toBe(true);
    }
  });

  it("pins the moved app routes retired before this restructure", () => {
    const bySource = Object.fromEntries(redirects().map((r) => [r.source, r]));
    // These five URLs were the pre-Bridge views. The nav restructure re-points
    // what they land on, so each pairing is asserted explicitly rather than
    // only through the generic loop above.
    expect(bySource["/dashboard"]?.destination).toBe("/bridge");
    expect(bySource["/orders"]?.destination).toBe("/inbox");
    expect(bySource["/orders/:id"]?.destination).toBe("/inbox/:id");
    expect(bySource["/suppliers"]?.destination).toBe("/library/suppliers");
    expect(bySource["/mappings"]?.destination).toBe("/library/mappings");
    // …and each destination is a tab in the hub the four-item nav teaches.
    expect(hubForPath("/bridge")).toBe("activity");
    expect(hubForPath("/inbox")).toBe("orders");
    expect(hubForPath("/inbox/sample-id")).toBe("orders");
    expect(hubForPath("/library/suppliers")).toBe("suppliers");
    expect(hubForPath("/library/mappings")).toBe("suppliers");
  });
});
