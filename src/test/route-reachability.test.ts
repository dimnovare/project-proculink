import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { buildVisibleNav, PINNED_ACTION_HREF } from "@/components/bridge/BridgeSidebar";
import { HUB_TABS, type HubKey } from "@/components/bridge/layout/HubTabs";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  THE ORPHAN GUARD (frontend half)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Every `page.tsx` in the app is a route the router will happily serve. That is
 * not the same as a route a user can GET TO. A page nobody can reach is a page
 * nobody maintains: it drifts, it keeps its own stale copy of a flow that moved,
 * and it still answers on a URL — so it ships, forever, to anyone who finds it.
 *
 * `/upload/preview/[orderId]` is the live example. STRUCT-2 rerouted upload
 * straight to the Order Workshop (a strict superset), the preview screen kept
 * working, and every link to it disappeared. It has been unreachable in-product
 * since — reachable only by typing the URL, or by the Playwright specs that
 * navigate to it directly and therefore keep testing a screen no user sees.
 *
 * ─── The rule ────────────────────────────────────────────────────────────────
 * A route is reachable when something actually LINKS to it:
 *   1. a sidebar nav item href, or the pinned action href,
 *   2. a hub tab href,
 *   3. a permanent redirect in next.config.ts,
 *   4. real in-product navigation — `href=…`, `router.push/replace(…)`,
 *      `redirect(…)` — anywhere in src/,
 *   5. an entry in KNOWN_DEEP_LINK_ONLY with a written reason.
 *
 * ─── What deliberately does NOT count ────────────────────────────────────────
 * • **A HubTabs `match[]` entry.** `match` decides which tab LIGHTS UP once you
 *   are already on a page. It renders no link and takes nobody anywhere. This
 *   distinction is the whole point of this file: the previous reachability test
 *   in BridgeSidebar.test.tsx asked `hubForPath(route)`, which honours `match`,
 *   and so reported `/library/rule-definitions` — a page with no inbound link
 *   anywhere in the product — as reachable. It passed green while the route was
 *   orphaned.
 *
 * • **A hand-maintained route list.** That same test iterated a literal
 *   `LEGACY_ROUTES` array, so a new orphan was invisible until someone
 *   remembered to add it — the exact failure the guard exists to prevent. The
 *   route list here is globbed off disk.
 *
 * • **A `route:` field in a docs/registry object** (src/lib/section-guides.ts).
 *   Documenting that a page exists is not linking to it.
 *
 * • **A Playwright spec that navigates directly.** Tests are not users.
 *
 * ─── Launch flags ────────────────────────────────────────────────────────────
 * The nav is read with the flags OFF (`coreOnly: false`, `inboundEnabled: true`)
 * so the DECLARED registry is what gets checked. `/drafts` and the Inbound pages
 * are deliberately filtered out of the shipped sidebar by LAUNCH_CORE_HREFS —
 * they are gated, not orphaned: the registry entry exists and one flag restores
 * it. Judging them by the shipped flag state would report a product decision as
 * a defect.
 */

const SRC = path.resolve(__dirname, "..");
const APP = path.join(SRC, "app");
const REPO = path.resolve(SRC, "..");

// ─────────────────────────────────────────────────────────────────────────────
//  Allowlist. Reachable-by-design, but not by a link the scan can see.
//  An entry must say WHO navigates here and HOW. "It's fine" is not a reason.
//  `Allowlist_entries_are_not_stale` deletes the entry's cover once a real link
//  appears, so this cannot silently become a dumping ground.
// ─────────────────────────────────────────────────────────────────────────────
const KNOWN_DEEP_LINK_ONLY: Record<string, string> = {
  "/one-pager":
    "Deliberately a send-the-URL asset, not a site page: a print-friendly one-page "
    + "overview (it ships its own print.css) that sales links directly and prospects "
    + "print. It carries full SEO metadata and is published in src/app/sitemap.ts, "
    + "which is its distribution channel — an in-product link would be wrong, not missing.",
};

// ─────────────────────────────────────────────────────────────────────────────
//  Route discovery — globbed off disk, never hand-listed.
// ─────────────────────────────────────────────────────────────────────────────

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

interface Route {
  /** URL pattern, e.g. "/inbox/[orderId]". */
  pattern: string;
  /** Repo-relative path of the page.tsx. */
  file: string;
  /** Directory the page lives in — a page may not vouch for its own reachability. */
  dir: string;
}

function discoverRoutes(): Route[] {
  return walk(APP)
    .filter((f) => path.basename(f) === "page.tsx")
    .map((f) => {
      const rel = path.relative(APP, f).replace(/\\/g, "/");
      const segments = rel
        .replace(/\/page\.tsx$/, "")
        .split("/")
        .filter(Boolean)
        // Route groups — "(app)", "(marketing)" — are organisational, not URL.
        .filter((s) => !(s.startsWith("(") && s.endsWith(")")))
        // Optional catch-alls "[[...sign-in]]" contribute nothing to the base URL.
        .filter((s) => !s.startsWith("[["));

      return {
        pattern: "/" + segments.join("/"),
        file: path.relative(REPO, f).replace(/\\/g, "/"),
        dir: path.dirname(f),
      };
    })
    .filter((r) => r.pattern !== "/")
    .sort((a, b) => a.pattern.localeCompare(b.pattern));
}

// ─────────────────────────────────────────────────────────────────────────────
//  Link sources
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every navigation target a source file emits. Template literals contribute the
 * static prefix before the first `${`, which is exactly what a dynamic route
 * needs: `router.push(`/connections/${id}`)` proves `/connections/[id]` is
 * reachable.
 */
function extractLinks(text: string): string[] {
  const found: string[] = [];
  const patterns = [
    // href="/x"  ·  href={"/x"}  ·  href: "/x"   (nav registries name the field `href`)
    /href\s*[=:]\s*\{?\s*["'](\/[^"'\s]*)["']/g,
    // href={`/x/${id}`}
    /href\s*[=:]\s*\{?\s*`(\/[^`$]*)/g,
    // router.push("/x") · router.replace("/x") · redirect("/x")
    /(?:router\s*\.\s*(?:push|replace)|redirect|permanentRedirect)\s*\(\s*["'](\/[^"']*)["']/g,
    // router.push(`/x/${id}`)
    /(?:router\s*\.\s*(?:push|replace)|redirect|permanentRedirect)\s*\(\s*`(\/[^`$]*)/g,
    // Footer/nav registries built as [label, href] tuples — the marketing footer's
    // shape: { h: "Company", links: [["Customers", "/customers"], …] }.
    // A LABEL plus a destination is a link. A bare one-element array of paths
    // (HubTabs `match: ["/library/rule-definitions"]`) is not, and must not match.
    /\[\s*["'][^"']*["']\s*,\s*["'](\/[^"']*)["']/g,
    // Any *Url prop given a path: Clerk's fallbackRedirectUrl / afterSignOutUrl /
    // signUpFallbackRedirectUrl. Clerk performs the navigation, so there is no
    // <Link> to find — but the destination is declared right here in our markup.
    /[A-Za-z]*[Uu]rl\s*=\s*\{?\s*["'](\/[^"']*)["']/g,
    // Middleware + route handlers: NextResponse.redirect(new URL("/x", req.url)).
    /new\s+URL\s*\(\s*["'](\/[^"']*)["']/g,
  ];

  for (const re of patterns) {
    for (const m of text.matchAll(re)) found.push(m[1]);
  }
  return found;
}

/** Every link emitted anywhere in src/, tagged with the directory that emitted it. */
function collectProductLinks(): { href: string; dir: string; file: string }[] {
  return walk(SRC)
    .filter((f) => /\.(ts|tsx)$/.test(f))
    .filter((f) => !/\.(test|spec)\.tsx?$/.test(f))
    .flatMap((f) => {
      const dir = path.dirname(f);
      const file = path.relative(REPO, f).replace(/\\/g, "/");
      return extractLinks(fs.readFileSync(f, "utf8")).map((href) => ({ href, dir, file }));
    });
}

function collectRedirectDestinations(): string[] {
  const config = fs.readFileSync(path.join(REPO, "next.config.ts"), "utf8");
  return [...config.matchAll(/destination:\s*["'](\/[^"']*)["']/g)].map((m) => m[1]);
}

function navHrefs(): string[] {
  // Flags OFF: check the DECLARED registry, not the currently-shipped subset.
  const nav = buildVisibleNav("Suppliers", true, { coreOnly: false, inboundEnabled: true });
  const items = [...nav.main.flatMap((s) => s.items), ...nav.tail];
  return [...items.map((i) => i.href), PINNED_ACTION_HREF];
}

function hubTabHrefs(): string[] {
  // `.href` only. `match[]` is active-state, not a link — see the header comment.
  return (Object.keys(HUB_TABS) as HubKey[]).flatMap((k) => HUB_TABS[k].map((t) => t.href));
}

// ─────────────────────────────────────────────────────────────────────────────
//  Reachability
// ─────────────────────────────────────────────────────────────────────────────

const stripQuery = (href: string) => href.split("?")[0].split("#")[0];

/**
 * Does `href` land on `route`? Dynamic routes match on their static prefix.
 *
 * The trailing slash is load-bearing here and must NOT be normalised away: a
 * template literal contributes exactly `"/connections/"`, and that slash is the
 * entire proof that the link continues into the dynamic segment rather than
 * stopping at the list page.
 */
export function linkSatisfiesRoute(href: string, pattern: string): boolean {
  const target = stripQuery(href);
  const dynamicAt = pattern.indexOf("/[");

  if (dynamicAt === -1) return (target.replace(/\/$/, "") || "/") === pattern;

  const prefix = pattern.slice(0, dynamicAt + 1); // "/inbox/[orderId]" → "/inbox/"
  return target.startsWith(prefix);
}

interface Verdict {
  route: Route;
  reachable: boolean;
  via: string;
}

function judge(route: Route, links: ReturnType<typeof collectProductLinks>,
               redirects: string[], nav: string[], tabs: string[]): Verdict {
  const hit = (href: string) => linkSatisfiesRoute(href, route.pattern);

  if (nav.some(hit)) return { route, reachable: true, via: "sidebar nav" };
  if (tabs.some(hit)) return { route, reachable: true, via: "hub tab" };
  if (redirects.some(hit)) return { route, reachable: true, via: "next.config redirect" };

  // A page cannot vouch for its own reachability: a filter/pagination link back
  // to itself is not a way IN.
  const inbound = links.filter((l) => hit(l.href) && l.dir !== route.dir);
  if (inbound.length > 0) {
    return { route, reachable: true, via: `linked from ${path.basename(inbound[0].file)}` };
  }

  return { route, reachable: false, via: "" };
}

function analyse() {
  const links = collectProductLinks();
  const redirects = collectRedirectDestinations();
  const nav = navHrefs();
  const tabs = hubTabHrefs();
  return discoverRoutes().map((r) => judge(r, links, redirects, nav, tabs));
}

// ═════════════════════════════════════════════════════════════════════════════
//  THE GUARD
// ═════════════════════════════════════════════════════════════════════════════

describe("route reachability — no page without a way in", () => {
  it("every page.tsx route is reachable from the nav registry, a hub tab, a redirect, or a real link", () => {
    const verdicts = analyse();

    expect(verdicts.length).toBeGreaterThan(30); // the glob must actually find the app

    const orphans = verdicts
      .filter((v) => !v.reachable)
      .filter((v) => !(v.route.pattern in KNOWN_DEEP_LINK_ONLY));

    const report = orphans
      .map((v) => `  • ${v.route.pattern}\n      ${v.route.file}\n      nothing in src/ links here — no nav item, no hub tab, no redirect, no href, no router.push`)
      .join("\n");

    expect(
      orphans.map((v) => v.route.pattern),
      orphans.length === 0
        ? ""
        : `${orphans.length} route(s) ship with no way in:\n\n${report}\n\n`
            + "Each is a live URL the router serves and no user can find. Link it, delete it\n"
            + "(with a permanent redirect), or add it to KNOWN_DEEP_LINK_ONLY with a reason\n"
            + "naming who navigates there. Do NOT allowlist one just to go green.\n",
    ).toEqual([]);
  });

  it("allowlist entries are not stale and carry a written reason", () => {
    const verdicts = analyse();
    const known = new Set(verdicts.map((v) => v.route.pattern));

    for (const [pattern, reason] of Object.entries(KNOWN_DEEP_LINK_ONLY)) {
      expect(known, `KNOWN_DEEP_LINK_ONLY["${pattern}"] names a route that no longer exists`).toContain(pattern);
      expect(reason.trim().length, `KNOWN_DEEP_LINK_ONLY["${pattern}"] must carry a written reason`).toBeGreaterThan(40);

      const v = verdicts.find((x) => x.route.pattern === pattern)!;
      expect(
        v.reachable,
        `KNOWN_DEEP_LINK_ONLY["${pattern}"] is stale — it is now reachable via ${v.via}. Delete the entry.`,
      ).toBe(false);
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  //  Regression tests for the detector itself.
  //  These pin the exact ways the previous guard produced a false green.
  // ───────────────────────────────────────────────────────────────────────────

  it("a HubTabs match[] entry does not make a route reachable (regression: /library/rule-definitions)", () => {
    // `match` lights the Rules tab when you are already on /library/rule-definitions.
    // It is not a link, and it must never be read as one.
    const matchOnly = HUB_TABS["rules-formats"].flatMap((t) => t.match ?? []);
    expect(matchOnly).toContain("/library/rule-definitions");
    expect(hubTabHrefs()).not.toContain("/library/rule-definitions");
  });

  it("the route list is globbed from disk, not hand-maintained", () => {
    const patterns = discoverRoutes().map((r) => r.pattern);
    // Sanity: routes that exist only on disk, in three different route groups.
    expect(patterns).toContain("/inbox/[orderId]");
    expect(patterns).toContain("/upload/preview/[orderId]");
    expect(patterns).toContain("/pricing");
    expect(new Set(patterns).size).toBe(patterns.length);
    // Route groups are stripped: no "(app)" or "(marketing)" leaks into a URL.
    expect(patterns.some((p) => p.includes("("))).toBe(false);
  });

  it("a dynamic route is satisfied by a template-literal link to its static prefix", () => {
    expect(linkSatisfiesRoute("/connections/abc", "/connections/[connectionId]")).toBe(true);
    // `router.push(`/connections/${id}`)` yields exactly this. The trailing slash is
    // the proof the link continues into the dynamic segment — an earlier draft of
    // this file normalised it off and reported four live detail pages as orphans.
    expect(linkSatisfiesRoute("/connections/", "/connections/[connectionId]")).toBe(true);
    // …but a link to the LIST page is not a link to a detail page.
    expect(linkSatisfiesRoute("/connections", "/connections/[connectionId]")).toBe(false);
  });

  it("a link to a child route does not make its parent reachable", () => {
    // /inbox/abc is a way into the order workshop, not into the inbox list.
    expect(linkSatisfiesRoute("/inbox/abc", "/inbox")).toBe(false);
    expect(linkSatisfiesRoute("/inbox", "/inbox")).toBe(true);
    expect(linkSatisfiesRoute("/inbox?status=review", "/inbox")).toBe(true);
  });

  it("extractLinks reads links, not registry metadata (regression: section-guides route: fields)", () => {
    expect(extractLinks(`<Link href="/library/standards">`)).toEqual(["/library/standards"]);
    expect(extractLinks("router.push(`/inbox/${id}`)")).toEqual(["/inbox/"]);
    expect(extractLinks(`{ href: "/admin/guides/onboard-a-new-client" }`)).toEqual([
      "/admin/guides/onboard-a-new-client",
    ]);
    // A docs registry that merely NAMES a route is not a way to reach it.
    expect(extractLinks(`{ route: "/library/rule-definitions", title: "Rule definitions" }`)).toEqual([]);
    expect(extractLinks(`match: ["/library/rule-definitions"]`)).toEqual([]);
  });

  it("detects a synthetic orphan route and clears it once something links there", () => {
    const orphan: Route = { pattern: "/synthetic/probe", file: "src/app/(app)/synthetic/probe/page.tsx", dir: "/app/synthetic/probe" };
    const noLinks: ReturnType<typeof collectProductLinks> = [];
    const withLink = [{ href: "/synthetic/probe", dir: "/components", file: "src/components/Nav.tsx" }];
    const selfLink = [{ href: "/synthetic/probe", dir: "/app/synthetic/probe", file: "src/app/(app)/synthetic/probe/page.tsx" }];

    expect(judge(orphan, noLinks, [], [], []).reachable).toBe(false);
    expect(judge(orphan, withLink, [], [], []).reachable).toBe(true);
    // A page linking to itself is not a way in.
    expect(judge(orphan, selfLink, [], [], []).reachable).toBe(false);
    // A permanent redirect IS a way in — that is what a deleted route ships with.
    expect(judge(orphan, noLinks, ["/synthetic/probe"], [], []).via).toBe("next.config redirect");
  });
});
