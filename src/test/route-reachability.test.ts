// ROUTE REACHABILITY GUARD — the teeth of plan rule R1, "no new surface
// without a consumer".
//
// A Next.js `page.tsx` is a live, navigable URL the moment the file exists.
// Nothing in the framework asks whether anything LINKS to it, so a route can
// ship, resolve, render, be crawled and bookmarked — and still be a surface no
// user can ever arrive at by using the product. Three such routes existed when
// this guard was written. This test makes that state impossible to reach again
// silently: adding a page.tsx that no navigation reaches turns the suite red.
//
// A route counts as REACHABLE when at least one of these is true:
//
//   1. nav registry  — it is an href in the sidebar nav that buildVisibleNav
//                      actually RENDERS, or the pinned primary action.
//   2. hub tab       — it is the `href` of a tab in HUB_TABS.
//   3. redirect      — a next.config.ts `destination`, or a redirect call in a
//                      route/middleware (`redirect()`, `NextResponse.redirect`,
//                      `router.replace`, a Clerk `*RedirectUrl` prop).
//   4. link          — some OTHER source file links to it (`next/link` href,
//                      an `href:` entry in a link registry, a `[label, href]`
//                      footer tuple, `router.push`, or an MDX markdown link).
//   5. allowlist     — it is in KNOWN_DEEP_LINK_ONLY *with a written reason*.
//
// Two deliberate asymmetries, both load-bearing:
//
//   • The sidebar is read through buildVisibleNav(), not off the raw NAV_MAIN
//     array, because a registry entry that the launch flags filter out is not a
//     link — it renders nowhere. /drafts is exactly this case: it sits in
//     NAV_MAIN but is absent from LAUNCH_CORE_HREFS, so no user has ever seen
//     it. Reading the raw array would have declared it reachable and this guard
//     would have been decorative.
//   • HUB_TABS is read for `href` only, never `match`. `match` is active-state
//     matching — it lights a tab up for a sub-route; it navigates nowhere.
//     /library/rule-definitions is exactly this case.
//
// Reachability here is FLAT, not transitive: a hub tab counts even if the hub
// itself is currently hidden by a launch flag. Flipping one flag is a config
// change; deleting the only link is a code change. This guard catches the
// second, which is the failure mode that actually strands a page.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildVisibleNav, PINNED_ACTION_HREF } from "@/components/bridge/BridgeSidebar";
import { HUB_TABS } from "@/components/bridge/layout/HubTabs";

// ─── Allowlist ────────────────────────────────────────────────────────────────
//
// A route may live here ONLY with a written reason. The value is the reason —
// the test rejects an empty or whitespace-only one, so "add the path to shut
// the guard up" is not a move that works. A second test rejects entries that no
// longer name a real route, so the list cannot rot after a page is deleted.

const RETIRED = "scheduled for deletion in WP-08 / WP-07 — retired by founder decision 2026-07-30";

export const KNOWN_DEEP_LINK_ONLY: Record<string, string> = {
  // ── Confirmed stranded, and going away. Recorded rather than deleted here so
  //    the guard keeps naming them until the packet that owns them lands.
  "/drafts": RETIRED,
  "/upload/preview/[orderId]": RETIRED,
  "/library/rule-definitions": RETIRED,

  // ── Reachable, but the referrer is outside this repo. A frontend-only guard
  //    is structurally blind to these; the reason is the evidence.
  "/welcome":
    "Reached from the BACKEND, not from this repo: Stripe checkout success_url is built as " +
    "`{frontendUrl}/welcome?upgraded={plan}&interval={interval}&session_id={CHECKOUT_SESSION_ID}` in " +
    "ProcuLink.Api/Services/StripeBillingService.cs:335. Every paying customer lands here after " +
    "checkout, which is why the page reads `?upgraded=` and is noindex + absent from the sitemap. " +
    "It is live billing infrastructure — do NOT delete it because nothing in this repo links to it.",

  // ── Deliberately deep-link-only, and honest about it.
  "/one-pager":
    "Print-friendly sales collateral, handed out as a URL rather than navigated to: no in-app entry " +
    "point by design. It is published for discovery via src/app/sitemap.ts, which this guard does not " +
    "count as navigation (counting the sitemap would mark most of the marketing site reachable and " +
    "blunt the guard). Wants either a real link or a deletion decision — but that is not this guard's call.",
};

// ─── Route enumeration ────────────────────────────────────────────────────────

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const SRC_DIR = path.join(ROOT, "src");
const APP_DIR = path.join(SRC_DIR, "app");

/**
 * The two nav registries are read through their EXPORTS (above), so their
 * source files must not also be swept by the generic text scan — a raw `href:`
 * in BridgeSidebar.tsx would smuggle a launch-flag-filtered entry back in as if
 * it were a link, which is precisely what this guard exists to catch.
 */
const NAV_REGISTRY_FILES = new Set(
  [
    path.join(SRC_DIR, "components", "bridge", "BridgeSidebar.tsx"),
    path.join(SRC_DIR, "components", "bridge", "layout", "HubTabs.tsx"),
  ].map((p) => path.normalize(p)),
);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "__tests__") continue;
      walk(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

const isTestFile = (f: string) => /\.(test|spec)\.(ts|tsx)$/.test(f);

/**
 * `src/app/(app)/inbox/[orderId]/page.tsx` → `/inbox/[orderId]`.
 * Route groups `(app)`, private folders `_foo` and optional catch-alls
 * `[[...sign-in]]` contribute no URL segment.
 */
export function fileToRoute(pageFile: string): string {
  const rel = path.relative(APP_DIR, pageFile).split(path.sep).join("/");
  const segments = rel
    .replace(/\/page\.tsx$/, "")
    .split("/")
    .filter(Boolean)
    .filter((s) => !/^\(.+\)$/.test(s)) // route group
    .filter((s) => !/^_/.test(s)) // private folder
    .filter((s) => !/^\[\[\.\.\..+\]\]$/.test(s)); // optional catch-all
  return "/" + segments.join("/");
}

export function enumerateRoutes(): { route: string; file: string }[] {
  return walk(APP_DIR)
    .filter((f) => path.basename(f) === "page.tsx")
    .map((file) => ({ route: fileToRoute(file), file: path.normalize(file) }))
    .sort((a, b) => a.route.localeCompare(b.route));
}

// ─── Link-target collection ───────────────────────────────────────────────────

export type LinkKind = "nav" | "hub-tab" | "redirect" | "link";
export interface LinkTarget {
  /** Normalized path, with interpolated segments replaced by DYN. */
  path: string;
  kind: LinkKind;
  /** Absolute file the target was found in — used to ignore self-links. */
  source: string;
}

/** Sentinel for a link segment whose value is computed (`${id}`, `:id`). */
const DYN = "«dyn»";

/**
 * `/inbox/${o.id}?tab=x` → `/inbox/«dyn»`. Returns null for anything that is
 * not an internal path (external URLs, anchors, mailto:, bare variables).
 */
export function normalizeTarget(raw: string): string | null {
  const cleaned = raw.split("?")[0].split("#")[0].trim();
  if (!cleaned.startsWith("/")) return null;
  if (cleaned.startsWith("//")) return null; // protocol-relative external
  const segments = cleaned
    .split("/")
    .filter(Boolean)
    .map((s) => (s.includes("${") || s.startsWith(":") ? DYN : s));
  return "/" + segments.join("/");
}

const segmentsOf = (p: string) => p.split("/").filter(Boolean);
const isDynamicRouteSegment = (s: string) => /^\[.+\]$/.test(s);
const isCatchAllRouteSegment = (s: string) => /^\[\.\.\..+\]$/.test(s);

/**
 * Structural match. A link to `/inbox/${order.id}` satisfies `/inbox/[orderId]`
 * without any literal string equality.
 *
 * A dynamic ROUTE segment accepts any single link segment. A literal route
 * segment requires a literal, equal link segment — a computed link segment does
 * NOT satisfy it, otherwise a single `` href={`/${a}/${b}`} `` would silently
 * mark half the app reachable.
 */
export function targetSatisfiesRoute(route: string, target: string): boolean {
  const r = segmentsOf(route);
  const t = segmentsOf(target);
  for (let i = 0; i < r.length; i++) {
    if (isCatchAllRouteSegment(r[i])) return t.length >= i + 1;
    const ts = t[i];
    if (ts === undefined) return false;
    if (isDynamicRouteSegment(r[i])) continue;
    if (ts === DYN) return false;
    if (r[i] !== ts) return false;
  }
  return t.length === r.length;
}

// `href="/x"` · `href: "/x"` · `href={"/x"}` · href={`/inbox/${id}`}
const HREF_RE = /\bhref\s*[:=]\s*\{?\s*(["'`])([^"'`]*)\1/g;
// router.push("/x") · router.replace(`/x`) · redirect("/x") · new URL("/x", …)
const NAV_CALL_RE = /\b(?:router\.(?:push|replace)|redirect|new URL)\s*\(\s*(["'`])([^"'`]*)\1/g;
// Clerk / Next redirect props: fallbackRedirectUrl="/x", forceRedirectUrl={…}
const REDIRECT_PROP_RE = /\b\w*[Rr]edirect(?:Url|_url)\s*[:=]\s*\{?\s*(["'`])([^"'`]*)\1/g;
// next.config.ts redirects(): destination: "/x"
const DESTINATION_RE = /\bdestination\s*:\s*(["'`])([^"'`]*)\1/g;
// The repo's footer link-registry idiom: a `[label, href]` 2-tuple destructured
// into a link — `{ links: [["Customers", "/customers"], …] }` in both
// (marketing)/layout.tsx and the home page, rendered as
// `col.links.map(([label, href]) => <a href={href}>)`. There is no literal
// `href="/customers"` anywhere, so without this pattern the guard reported
// /customers, /changelog and /book-demo as stranded when all three sit in the
// footer of every marketing page. The closing `]` is required so this matches a
// 2-tuple only, not any longer data row that happens to contain a path.
//
// This pattern is deliberately NOT "any two adjacent string literals in an
// array". That looser form credits src/app/sitemap.ts — a bare `["/", "/how-it-
// works", "/pricing", …]` list — as navigation, which it is not: a sitemap
// tells a crawler a URL exists, it does not give a user a way to arrive. Every
// marketing route would then pass the guard for free. Both the `/` prefix on
// the SECOND element and the immediately-following `]` are what keep a sitemap
// out; `assertions below pin this.
const LINK_TUPLE_RE = /\[\s*(["'`])[^"'`]*\1\s*,\s*(["'`])(\/[^"'`]*)\2\s*\]/g;
// MDX body link: [text](/help/x)
const MD_LINK_RE = /\]\((\/[^)\s]*)\)/g;

const LINK_PATTERNS = [
  { re: HREF_RE, group: 2 },
  { re: LINK_TUPLE_RE, group: 3 },
  { re: MD_LINK_RE, group: 1 },
];
const REDIRECT_PATTERNS = [
  { re: NAV_CALL_RE, group: 2 },
  { re: REDIRECT_PROP_RE, group: 2 },
];

/**
 * Extraction over TEXT rather than a path, so the patterns can be unit-tested
 * against hand-written fixtures (see "only genuine link sources count").
 */
export function extractTargets(
  text: string,
  kind: LinkKind,
  source: string,
  regexes: { re: RegExp; group: number }[],
): LinkTarget[] {
  const found: LinkTarget[] = [];
  for (const { re, group } of regexes) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const normalized = normalizeTarget(m[group]);
      if (normalized) found.push({ path: normalized, kind, source });
    }
  }
  return found;
}

function scanFile(file: string, kind: LinkKind, regexes: { re: RegExp; group: number }[]): LinkTarget[] {
  return extractTargets(fs.readFileSync(file, "utf8"), kind, file, regexes);
}

export function collectLinkTargets(): LinkTarget[] {
  const targets: LinkTarget[] = [];

  // 1 + 2 — the nav registries, read through their exports so launch-flag
  // filtering is respected. isAdmin: true because admins are real users and the
  // /admin route is genuinely reachable for them.
  const nav = buildVisibleNav("Suppliers", true);
  for (const section of nav.main) {
    for (const item of section.items) targets.push({ path: item.href, kind: "nav", source: "<BridgeSidebar nav>" });
  }
  for (const item of nav.tail) targets.push({ path: item.href, kind: "nav", source: "<BridgeSidebar nav>" });
  targets.push({ path: PINNED_ACTION_HREF, kind: "nav", source: "<BridgeSidebar pinned action>" });

  for (const tabs of Object.values(HUB_TABS)) {
    for (const tab of tabs) targets.push({ path: tab.href, kind: "hub-tab", source: "<HubTabs>" });
  }

  // 3 — next.config.ts redirect destinations.
  targets.push(
    ...scanFile(path.join(ROOT, "next.config.ts"), "redirect", [{ re: DESTINATION_RE, group: 2 }]),
  );

  // 4 — every other source file under src/. Tests are excluded: a route that
  // only a test navigates to is not reachable by a user.
  for (const file of walk(SRC_DIR)) {
    if (!/\.(ts|tsx|mdx)$/.test(file)) continue;
    if (isTestFile(file)) continue;
    if (file.startsWith(path.join(SRC_DIR, "test") + path.sep)) continue;
    if (NAV_REGISTRY_FILES.has(path.normalize(file))) continue;
    targets.push(
      ...scanFile(path.normalize(file), "link", LINK_PATTERNS),
      ...scanFile(path.normalize(file), "redirect", REDIRECT_PATTERNS),
    );
  }

  return targets;
}

// ─── The detection function ───────────────────────────────────────────────────

export interface UnreachableRoute {
  route: string;
  file: string;
}

/**
 * The whole guard in one pure function, so the synthetic-fixture test can push
 * a route that provably nothing links to through the SAME code path the real
 * assertion uses. A guard that is only ever exercised on data that passes is
 * not a guard.
 */
export function findUnreachableRoutes(
  routes: { route: string; file: string }[],
  targets: LinkTarget[],
  allowlist: Record<string, string> = {},
): UnreachableRoute[] {
  return routes.filter(({ route, file }) => {
    if (Object.prototype.hasOwnProperty.call(allowlist, route)) return false;
    // A page linking to itself does not make itself reachable.
    const external = targets.filter((t) => t.source !== file);
    return !external.some((t) => targetSatisfiesRoute(route, t.path));
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

const ROUTES = enumerateRoutes();
const TARGETS = collectLinkTargets();

describe("route reachability (plan rule R1 — no new surface without a consumer)", () => {
  it("finds the app's page routes at all", () => {
    // Sanity floor: if the walker breaks, every later assertion passes vacuously.
    expect(ROUTES.length).toBeGreaterThan(20);
    expect(ROUTES.map((r) => r.route)).toContain("/inbox/[orderId]");
    expect(TARGETS.length).toBeGreaterThan(50);
  });

  it("every page.tsx route is reachable from nav, a hub tab, a redirect, or a link", () => {
    const unreachable = findUnreachableRoutes(ROUTES, TARGETS, KNOWN_DEEP_LINK_ONLY);
    const report = unreachable
      .map((u) => `  ${u.route}\n      ${path.relative(ROOT, u.file).split(path.sep).join("/")}`)
      .join("\n");
    expect(
      unreachable,
      unreachable.length === 0
        ? ""
        : `\n${unreachable.length} route(s) exist but nothing navigates to them:\n${report}\n\n` +
            `Link one from the sidebar, a hub tab, a redirect or another page — or add it to\n` +
            `KNOWN_DEEP_LINK_ONLY in this file WITH a written reason.\n`,
    ).toEqual([]);
  });

  it("catches a synthetic unreachable route (proves the guard is not vacuous)", () => {
    // Not a real page — a fixture pushed through the same detection function, so
    // this test proves detection works without stranding a dead page in the app.
    const fixtureUnlinked = { route: "/__fixture__/nothing-links-here", file: "<fixture>" };
    const fixtureLinked = { route: "/__fixture__/linked", file: "<fixture>" };
    const withFixtureLink: LinkTarget[] = [
      ...TARGETS,
      { path: "/__fixture__/linked", kind: "link", source: "<fixture-referrer>" },
    ];

    const flagged = findUnreachableRoutes(
      [fixtureUnlinked, fixtureLinked],
      withFixtureLink,
      KNOWN_DEEP_LINK_ONLY,
    ).map((u) => u.route);

    // Negative control: the unlinked fixture is reported.
    expect(flagged).toContain("/__fixture__/nothing-links-here");
    // Positive control: the linked fixture is NOT reported — the guard
    // discriminates, rather than flagging everything it is handed.
    expect(flagged).not.toContain("/__fixture__/linked");
  });

  it("matches dynamic segments structurally, not by literal string", () => {
    expect(targetSatisfiesRoute("/inbox/[orderId]", `/inbox/${DYN}`)).toBe(true);
    expect(targetSatisfiesRoute("/inbox/[orderId]", "/inbox/some-literal-id")).toBe(true);
    expect(targetSatisfiesRoute("/inbox/[orderId]", "/inbox")).toBe(false);
    expect(targetSatisfiesRoute("/inbox", `/inbox/${DYN}`)).toBe(false);
    // A wholly computed link must NOT satisfy a literal route segment.
    expect(targetSatisfiesRoute("/library/suppliers", `/${DYN}/${DYN}`)).toBe(false);
    expect(normalizeTarget("/inbox/${order.id}?tab=items")).toBe(`/inbox/${DYN}`);
    expect(normalizeTarget("/orders/:id")).toBe(`/orders/${DYN}`);
    expect(normalizeTarget("https://example.com/x")).toBeNull();
    expect(normalizeTarget("#anchor")).toBeNull();
  });

  it("counts only genuine link sources — a sitemap array is NOT navigation", () => {
    const ex = (text: string) => extractTargets(text, "link", "<fixture>", LINK_PATTERNS).map((t) => t.path);

    // src/app/sitemap.ts, verbatim in shape: a bare list of path literals. A
    // sitemap tells a crawler a URL exists; it gives no user a way to arrive.
    // If this ever starts returning paths, every marketing route passes the
    // guard for free and the guard is worthless.
    expect(
      ex(`const routes = [
            "/",
            "/how-it-works",
            "/formats",
            "/pricing",
            "/one-pager",
          ];`),
    ).toEqual([]);

    // Neither is a non-link data row that merely contains a path-shaped string.
    expect(ex(`const rows = [["PO number", "PO-2026-008412", "OrderRequest/OrderID"]];`)).toEqual([]);
    // Nor a registry keyed by `route:` (src/lib/section-guides.ts) — a guide
    // ATTACHED to a route is not a way of reaching it.
    expect(ex(`{ route: "/drafts", title: "Drafts" }`)).toEqual([]);

    // What DOES count: real link shapes.
    expect(ex(`<Link href="/pricing">Pricing</Link>`)).toEqual(["/pricing"]);
    expect(ex(`{ links: [["Customers", "/customers"], ["Changelog", "/changelog"]] }`)).toEqual([
      "/customers",
      "/changelog",
    ]);
    expect(ex("<Link href={`/inbox/${order.id}`}>")).toEqual([`/inbox/${DYN}`]);
    expect(ex(`See the [pricing page](/pricing).`)).toEqual(["/pricing"]);
    expect(extractTargets(`router.push("/bridge")`, "redirect", "<fixture>", REDIRECT_PATTERNS).map((t) => t.path))
      .toEqual(["/bridge"]);
  });

  it("strips route groups and optional catch-alls when deriving a route", () => {
    const j = (...p: string[]) => path.join(APP_DIR, ...p);
    expect(fileToRoute(j("(app)", "inbox", "[orderId]", "page.tsx"))).toBe("/inbox/[orderId]");
    expect(fileToRoute(j("(marketing)", "pricing", "page.tsx"))).toBe("/pricing");
    expect(fileToRoute(j("(home)", "page.tsx"))).toBe("/");
    expect(fileToRoute(j("sign-in", "[[...sign-in]]", "page.tsx"))).toBe("/sign-in");
  });
});

describe("KNOWN_DEEP_LINK_ONLY allowlist hygiene", () => {
  it("every entry carries a written reason", () => {
    for (const [route, reason] of Object.entries(KNOWN_DEEP_LINK_ONLY)) {
      expect(typeof reason, `${route}: reason must be a string`).toBe("string");
      expect(
        reason.trim().length,
        `${route}: allowlisting a route requires a written reason, not an empty string`,
      ).toBeGreaterThan(15);
    }
  });

  it("every entry still corresponds to a real route (the allowlist cannot rot)", () => {
    const real = new Set(ROUTES.map((r) => r.route));
    const stale = Object.keys(KNOWN_DEEP_LINK_ONLY).filter((route) => !real.has(route));
    expect(
      stale,
      stale.length === 0
        ? ""
        : `\nKNOWN_DEEP_LINK_ONLY names route(s) that no longer exist:\n${stale
            .map((s) => `  ${s}`)
            .join("\n")}\nThe page was deleted — delete the allowlist entry too.\n`,
    ).toEqual([]);
  });
});
