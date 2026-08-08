// ROUTE REACHABILITY GUARD — the teeth of plan rule R1, "no new surface
// without a consumer".
//
// A Next.js page file is a live, navigable URL the moment it exists. Nothing in
// the framework asks whether anything LINKS to it, so a route can ship,
// resolve, render, be crawled and bookmarked — and still be a surface no user
// can ever arrive at by using the product. This test makes that state
// impossible to reach again silently: adding a page that no navigation reaches
// turns the suite red.
//
// A ROUTE is any file Next.js treats as a page under the configured
// `pageExtensions` — `page.tsx` AND `page.mdx` (94 routes today: 49 tsx, 45
// mdx). Enumerating only `page.tsx` saw 52% of the app and left the entire help
// centre free to rot unlinked.
//
// A route counts as REACHABLE when at least one of these is true:
//
//   1. nav registry  — it is an href in the sidebar nav that buildVisibleNav
//                      actually RENDERS, or the pinned primary action.
//   2. hub tab       — it is the `href` of a tab in HUB_TABS.
//   3. content registry — it is a help article (rendered by /help) or a LIVE
//                      guide (rendered by GuideIndex), read through the export
//                      that reproduces the render-time filter.
//   4. redirect      — a next.config.ts `destination`, or a redirect call in a
//                      route/middleware (`redirect()`, `NextResponse.redirect`,
//                      `router.replace`, a Clerk `*RedirectUrl` prop).
//   5. link          — some OTHER source file links to it (`next/link` href,
//                      a `[label, href]` footer tuple, `router.push`, or an MDX
//                      markdown link).
//   6. allowlist     — it is in KNOWN_DEEP_LINK_ONLY *with a written reason*
//                      that cites something checkable.
//
// Deliberate asymmetries, all load-bearing:
//
//   • Registries are read through the code path that RENDERS them, never off
//     their raw text — see THE REGISTRY RULE below. The sidebar goes through
//     buildVisibleNav() (an href present in NAV_MAIN but absent from
//     LAUNCH_CORE_HREFS renders nowhere); guides.ts goes through
//     linkedGuides() (a `status: "planned"` guide renders as a "Coming soon"
//     <span>, never a <Link>); help-articles.ts is credited in full because
//     /help renders every entry unconditionally.
//   • HUB_TABS is read for `href` only, never `match`. `match` is active-state
//     matching — it lights a tab up for a sub-route; it navigates nowhere.
//
//     Both of those had a live example until FE #47: /drafts for the first,
//     /library/rule-definitions for the second. #47 deleted both pages and both
//     registry entries, so the rules are now pinned by fixtures instead — which
//     is the durable form. Do not re-derive them from whatever the registries
//     happen to contain today.
//   • Comments are stripped before extraction. A link that exists only in a
//     comment navigates nobody, and writing one is the cheapest possible way to
//     fake reachability past review.
//   • A page linking to ITSELF does not make itself reachable.
//
// Reachability here is FLAT, not transitive: a hub tab counts even if the hub
// itself is currently hidden by a launch flag. Flipping one flag is a config
// change; deleting the only link is a code change. This guard catches the
// second, which is the failure mode that actually strands a page.
//
// ── CORRECTION TO AN EARLIER REPORT ──────────────────────────────────────────
// /admin/guides/unfreeze-a-pilot-workspace was previously reported as a
// shipping 404. It is NOT. It is `status: "planned"` in src/lib/guides.ts:263,
// and GuideIndex.tsx:97 renders a non-live guide as a <span> plus a "Coming
// soon" badge — never a <Link>. No user-facing link points at it, and
// src/app/sitemap.ts filters on `status === "live"`, so no crawler is offered
// it either. There is a second, identical case at src/lib/guides.ts:74,
// /help/guides/set-up-your-workspace. NEITHER is a user-facing dead link.
//
// What they ARE is a phantom-target source: their hrefs sat in a file this
// guard was scanning as raw text, so creating a page at either path would have
// passed the guard on the strength of a link that is never rendered. That is
// the defect, and it is fixed by reading guides.ts through linkedGuides().
//
// ── MUTATION COVERAGE ────────────────────────────────────────────────────────
// Every decision above is pinned by a test that fails when the decision is
// removed. The decisions are: page-extension enumeration, the page-suffix
// strip, href-only hub tabs, comment stripping, the self-link exclusion, the
// registry-file exclusion, and two loosenings of the link-tuple pattern that
// would credit src/app/sitemap.ts as navigation.
//
// HOW TO RE-CHECK THAT, because you cannot take this paragraph's word for it.
// An earlier version of this comment credited "an out-of-tree harness that
// reverts each one in turn". That harness is not in this repo and not in the
// backend one — grep confirms the only occurrences of the phrase are this
// comment and a STATUS.md entry quoting it. A claim of coverage that nobody can
// re-run is not coverage, so the appeal to it is gone and the reproducible
// procedure is written down instead:
//
//   1. Revert ONE decision in place (e.g. make stripComments return `text`
//      unchanged for the "js" syntax).
//   2. Run this file AND src/test/link-crawl.test.ts.
//   3. Restore the file and confirm both are green again. Reverting the source
//      is enough here — unlike the .NET side there is no build output to stale.
//
// Done for comment stripping on 2026-07-30: both guards went red (3 failures
// here, 2 in the crawl), which is also what proves the shared module is really
// shared rather than a copy left behind.
//
// Three of those decisions — comment stripping and both link-tuple loosenings —
// now live in src/test/sourceScan.ts, shared with the OUTBOUND link crawl, so a
// revert there reddens BOTH guards. That is a stronger signal than before, but
// it does mean the target moved: mutate that module, not this file.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DESTINATION_ANCHOR,
  extractRaw,
  HREF_ANCHOR,
  LINK_TUPLE_RE,
  MD_LINK_RE,
  NAV_CALL_OR_NEW_URL_ANCHOR,
  REDIRECT_PROP_ANCHOR,
  syntaxFor,
  type Pattern,
  type SourceSyntax,
} from "./sourceScan";
import { buildVisibleNav, PINNED_ACTION_HREF } from "@/components/bridge/BridgeSidebar";
import { HUB_TABS, visibleHubTabs, type HubKey } from "@/components/bridge/layout/HubTabs";
import { HELP_ARTICLES } from "@/lib/help-articles";
import { GUIDES, linkedGuides } from "@/lib/guides";

// ─── Allowlist ────────────────────────────────────────────────────────────────
//
// A route may live here ONLY with a written reason, and the reason must cite
// something a reviewer can open — a file path, a URL, an ISO date, or a work
// packet (see rejectReason). "Long enough" is not a reason: the previous bar
// was `length > 15`, which "xxxxxxxxxxxxxxxxxx" clears. A second test rejects
// entries that no longer name a real route, so the list cannot rot after a page
// is deleted.
//
// This list SHRINKS. Adding to it is a decision with a name on it.

export const KNOWN_DEEP_LINK_ONLY: Record<string, string> = {
  // ── /drafts, /upload/preview/[orderId] and /library/rule-definitions were
  //    parked here as "confirmed stranded, going away when the packet that owns
  //    them lands". FE #47 landed and deleted all three pages, so the entries
  //    went with them — the allowlist is shrink-only, and
  //    `the allowlist cannot rot` below is what forced the deletion rather than
  //    leaving three names pointing at nothing.

  // ── Reachable, but the referrer is outside this repo. A frontend-only guard
  //    is structurally blind to these; the reason is the evidence.
  "/welcome":
    "Reached from the BACKEND, not from this repo: Stripe checkout success_url is built as " +
    "`{frontendUrl}/welcome?upgraded={plan}&interval={interval}&session_id={CHECKOUT_SESSION_ID}` in " +
    "ProcuLink.Api/Services/StripeBillingService.cs:335. Every paying customer lands here after " +
    "checkout, which is why the page reads `?upgraded=` and is noindex + absent from the sitemap. " +
    "It is live billing infrastructure — do NOT delete it because nothing in this repo links to it.",

  // ── /one-pager was the third entry, parked as "wants either a real link or a
  //    deletion decision". Founder decision 2026-07-30: link it. The marketing
  //    footer's Product column carries it (src/app/(marketing)/layout.tsx), so
  //    the page is now reachable on its own merits and the entry is gone —
  //    see "/one-pager is reached by a real link" below, which is what stops
  //    this from quietly reverting to an allowlist entry.
};

/**
 * THE SECOND LIST, AND IT IS NOT KNOWN_DEEP_LINK_ONLY.
 *
 * That list means "reachable, just not from this repo — here is the referrer".
 * This means "**no user can arrive here, and nobody has decided what to do about
 * it yet**". Both suppress the failure; only one of them is an answer. Keeping
 * them apart is the whole point, because an entry here is an open question with
 * a date on it, not a justification.
 *
 * All of them were invisible until FE #110 fixed two blind spots in the guard
 * itself. Every one is a live, rendering page that no user can reach by using
 * the product. The resolution for each is "build the entry point" or "delete the
 * page", and both are product calls, not a guard's.
 *
 * THE LIST SHRANK ONCE, WHICH IS THE POINT. It held four routes until
 * 2026-08-08, when the founder decided /connections and /connections/[connectionId]
 * were worth keeping and gave them a visible Suppliers hub tab ("Supplier
 * changes", HubTabs.tsx). Both dropped out of the walk on their own merits, so
 * their entries had to go — `anExcuseCannotOutliveItsReason` below is what
 * forced the deletion rather than leaving two stale excuses behind. Their
 * replacement is a POSITIVE assertion, `connectionsAreReachableThroughTheTab`,
 * which fails if the tab is ever hidden again.
 *
 * These entries PASS, on purpose. They were left failing at first, and the
 * consequence was a pipeline that could not go green until a product decision
 * arrived — which trains everyone to stop reading CI and then masks the next
 * real failure. A red nobody can clear today is noise with a good reason
 * attached. Three mechanisms stop "tracked" becoming "forgotten":
 *
 *   1. every entry carries its own reason, held to the same citation bar as
 *      KNOWN_DEEP_LINK_ONLY's;
 *   2. `printsTheStrandedSet` logs the count and the names on EVERY run, so the
 *      list appears in CI output rather than only in a file nobody opens;
 *   3. `theStrandedSetIsExactlyThis` fails when a THIRD route is stranded — a
 *      new gap cannot quietly join the list — and equally when one of these
 *      gains an entry point, so the list cannot rot into permanent cover.
 */
export const STRANDED_PENDING_DECISION: Record<string, string> = {
  "/operations/connectors":
    "PENDING A DECISION, 2026-08-06 — zero inbound links anywhere in src/. The HUB_TABS comment at HubTabs.tsx:95 claims it is " +
    "'Reached from a supplier's Delivery tab'; no such link exists — the connectors page links OUT " +
    "to /library/suppliers/{id}?tab=delivery and nothing links back.",
  "/operations/webhooks":
    "PENDING A DECISION, 2026-08-06 — zero inbound links anywhere in src/. HubTabs.tsx:106 says Settings owns this data, and " +
    "src/app/(app)/settings/page.tsx does render the same surface — but it does not link here, so " +
    "the page is a duplicate nobody can open. Delete or link, 2026-08-06.",
};

// ─── Route enumeration ────────────────────────────────────────────────────────

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const SRC_DIR = path.join(ROOT, "src");
const APP_DIR = path.join(SRC_DIR, "app");

/**
 * THE REGISTRY RULE — credit a registry through the code path the UI actually
 * renders, never through its raw text. (Formerly NAV_REGISTRY_FILES, when the
 * set held only the two nav files; the rule turned out to be general.)
 *
 * A text scan of a registry gets the answer wrong in BOTH directions:
 *
 *   • Too generous — a registry that carries an `href` for something it never
 *     renders as a link is a PHANTOM-TARGET SOURCE, not a dead link. Its href
 *     is a plan, not navigation. BridgeSidebar's NAV_MAIN holds /drafts, which
 *     LAUNCH_CORE_HREFS filters out so it renders nowhere; guides.ts holds
 *     hrefs for two `status: "planned"` guides that GuideIndex.tsx:97 renders
 *     as a <span> + "Coming soon" badge, never a <Link>. Scanning either file
 *     raw would credit a target no user can click, and a page created at that
 *     path would sail through this guard on the strength of a phantom.
 *   • Too stingy — a registry whose entries ARE all rendered as links, but
 *     through a COMPUTED href, is invisible to a text scan. help-articles.ts
 *     carries `slug` only; /help renders every entry as
 *     `<Link href={`/help/${article.slug}`}>` (help/page.tsx:362). Nothing in
 *     the repo writes `/help/inbox-basics` literally, yet a user reaches it in
 *     one click from the help centre index.
 *
 * So each registry below is EXCLUDED from the generic text scan and read
 * through an export that reproduces the render-time filter instead.
 */
const REGISTRY_FILES = new Set(
  [
    path.join(SRC_DIR, "components", "bridge", "BridgeSidebar.tsx"),
    path.join(SRC_DIR, "components", "bridge", "layout", "HubTabs.tsx"),
    path.join(SRC_DIR, "lib", "guides.ts"),
    path.join(SRC_DIR, "lib", "help-articles.ts"),
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
 * Every filename Next.js treats as a page, derived from the SAME list the
 * framework is configured with: next.config.ts:20 sets
 * `pageExtensions: ["ts", "tsx", "mdx"]`. Filtering on `page.tsx` alone saw 49
 * of 94 routes — the entire help centre (45 `page.mdx` files: every article and
 * every written guide) was invisible, so any of them could be unlinked forever
 * and this guard would stay green.
 *
 * `page.ts` is listed because pageExtensions permits it, not because the repo
 * uses it; enumerating it costs nothing and stops a future `page.ts` from being
 * a blind spot.
 */
const PAGE_FILE_RE = /^page\.(tsx?|mdx)$/;
/** Same set, as the trailing path chunk fileToRoute must strip. */
const PAGE_SUFFIX_RE = /\/page\.(tsx?|mdx)$/;

/** `[[...slug]]` — serves the parent URL AND any depth beneath it. */
const isOptionalCatchAllSegment = (s: string) => /^\[\[\.\.\..+\]\]$/.test(s);
/** Parallel-route slot `@modal` — a slot name, contributing no URL segment. */
const isParallelSlotSegment = (s: string) => /^@./.test(s);
/**
 * Intercepting-route markers: `(.)photo`, `(..)photo`, `(..)(..)photo`,
 * `(...)photo`. These deliberately do NOT match the route-group test
 * `^\(.+\)$` — a route group is parens and nothing else, while an interceptor
 * carries a name after the closing paren.
 */
export const isInterceptingSegment = (s: string) => /^(?:\(\.{1,3}\))+.+/.test(s);

/**
 * `src/app/(app)/inbox/[orderId]/page.tsx` → `/inbox/[orderId]`.
 * Route groups `(app)`, private folders `_foo`, parallel slots `@modal` and
 * optional catch-alls `[[...sign-in]]` contribute no URL segment.
 */
export function fileToRoute(pageFile: string): string {
  const rel = path.relative(APP_DIR, pageFile).split(path.sep).join("/");
  const segments = rel
    .replace(PAGE_SUFFIX_RE, "")
    .split("/")
    .filter(Boolean)
    .filter((s) => !/^\(.+\)$/.test(s)) // route group
    .filter((s) => !/^_/.test(s)) // private folder
    .filter((s) => !isParallelSlotSegment(s)) // parallel slot
    .filter((s) => !isOptionalCatchAllSegment(s)); // optional catch-all
  return "/" + segments.join("/");
}

export interface EnumeratedRoute {
  route: string;
  file: string;
  /**
   * Set when the page sits behind an optional catch-all. `/docs/[[...slug]]`
   * has the canonical URL `/docs`, but the same file also serves
   * `/docs/getting-started`, so a link to the deeper path DOES reach it.
   * Without this the guard demands a link to the bare parent and reports a
   * genuinely-linked page as stranded — a permanent false RED.
   */
  acceptsDescendants?: boolean;
}

/**
 * None of the three segment kinds handled here exists in this repo today. They
 * are handled anyway because each one fails SILENTLY and in the dangerous
 * direction the first time someone uses it — the guard would either strand a
 * real page or demand a link to a string that is not a URL, and the natural fix
 * under deadline is to allowlist it, which is how a guard becomes decorative.
 *
 * An intercepting route is skipped outright rather than enumerated: it is not
 * an independent URL but an alternate rendering of a route that must ALSO exist
 * as a real page elsewhere in the tree (Next.js needs it for hard navigation
 * and reload). That real route is enumerated on its own and must be reachable
 * on its own, so nothing is lost — whereas enumerating the interceptor would
 * demand a link to `/feed/(..)photo`, which can never be written.
 */
export function enumerateRoutes(): EnumeratedRoute[] {
  return walk(APP_DIR)
    .filter((f) => PAGE_FILE_RE.test(path.basename(f)))
    .map((file) => ({ file, segments: path.relative(APP_DIR, file).split(path.sep) }))
    .filter(({ segments }) => !segments.some(isInterceptingSegment))
    .map(({ file, segments }) => ({
      route: fileToRoute(file),
      file: path.normalize(file),
      ...(segments.some(isOptionalCatchAllSegment) ? { acceptsDescendants: true } : {}),
    }))
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

// ─── Pattern groups ───────────────────────────────────────────────────────────
//
// The reading machinery — comment stripping (js and mdx modes), string-literal
// masking, and balanced value-region reading — lives in src/test/sourceScan.ts,
// shared with the OUTBOUND link crawl (src/test/linkExtract.ts). That module's
// header records what is shared, and what each guard keeps to itself and why.
// The short version: the mechanics were identical, the two policies below are
// not.
//
// WHAT THIS GUARD OWNS, 1 of 2 — the pattern groups stay SEPARATE, so a target
// can be attributed by KIND. "Reached via a redirect" is a materially different
// fact from "reached via a link": a redirect destination is reachable, but has
// no clickable entry point anywhere. It is also what lets next.config.ts be
// scanned for `destination:` and nothing else. The crawl combines its patterns
// instead, because a dead link is dead however it was written.
//
// `NAV_CALL_OR_NEW_URL_ANCHOR` is the WIDER of the two nav-call forms; the crawl
// uses the narrower one. See ONE DELIBERATE DUPLICATE in ./sourceScan — the two
// guards disagree about `new URL(…)`, and the convergence pinned that
// disagreement rather than resolving it, because resolving it would have changed
// one guard's behaviour.

const LINK_PATTERNS: Pattern[] = [
  { anchor: HREF_ANCHOR, mode: "value" },
  { re: LINK_TUPLE_RE, group: 3 },
  { re: MD_LINK_RE, group: 1 },
];
const REDIRECT_PATTERNS: Pattern[] = [
  { anchor: NAV_CALL_OR_NEW_URL_ANCHOR, mode: "call" },
  { anchor: REDIRECT_PROP_ANCHOR, mode: "value" },
];
const DESTINATION_PATTERNS: Pattern[] = [{ anchor: DESTINATION_ANCHOR, mode: "value" }];

/**
 * WHAT THIS GUARD OWNS, 2 of 2 — normalisation. Every raw literal goes through
 * `normalizeTarget`, which drops anything that is not an internal path and maps
 * a computed segment to the `«dyn»` sentinel, so `targetSatisfiesRoute` can
 * match `` href={`/inbox/${o.id}`} `` against `/inbox/[orderId]` structurally.
 * The crawl SKIPS computed paths instead, and has to: requiring a dynamic route
 * segment there would flag `/help/${article.slug}` as a 404 when every article
 * is its own static page.
 *
 * Extraction is over TEXT rather than a path, so the patterns can be
 * unit-tested against hand-written fixtures (see "only genuine link sources
 * count").
 */
export function extractTargets(
  text: string,
  kind: LinkKind,
  source: string,
  patterns: Pattern[],
  syntax: SourceSyntax = "js",
): LinkTarget[] {
  const found: LinkTarget[] = [];
  for (const raw of extractRaw(text, patterns, syntax)) {
    const normalized = normalizeTarget(raw);
    if (normalized) found.push({ path: normalized, kind, source });
  }
  return found;
}

function scanFile(file: string, kind: LinkKind, patterns: Pattern[]): LinkTarget[] {
  return extractTargets(fs.readFileSync(file, "utf8"), kind, file, patterns, syntaxFor(file));
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

  // HUB_TABS goes through visibleHubTabs() — THE REGISTRY RULE, which this guard
  // was violating on its own registry. A `hidden: true` entry is "reachable, not
  // switchable": it is stripped from the strip, from hubShowsTabs, from the
  // sidebar item's href (hubHome) and from its tooltip, so its `href` renders
  // nowhere and is a plan, not navigation — exactly the phantom-target shape the
  // rule exists for. Four entries carry it (five until /connections earned a
  // visible tab), and crediting them hid every route behind them.
  //
  // `inboundEnabled: true` is passed for the SAME reason `isAdmin: true` is passed
  // to buildVisibleNav: a launch flag is config, and this guard is stated to be
  // flat across flags ("flipping one flag is a config change; deleting the only
  // link is a code change"). `hidden` is not a flag — it is permanent.
  for (const hub of Object.keys(HUB_TABS) as HubKey[]) {
    for (const tab of visibleHubTabs(hub, { inboundEnabled: true })) {
      targets.push({ path: tab.href, kind: "hub-tab", source: "<HubTabs via visibleHubTabs>" });
    }
  }

  // The help-centre index renders EVERY registry entry as a link, with a
  // computed href — `<Link href={`/help/${article.slug}`}>` at
  // src/app/(marketing)/help/page.tsx:362, inside ArticleRow, with no status or
  // visibility filter in front of it. So the registry IS the link list, and it
  // is credited in full. (See THE REGISTRY RULE above: unlike guides.ts, this
  // registry has no unrendered entries, so there is no filter to reproduce —
  // if one is ever added, mirror it here or the guard starts lying.)
  for (const article of HELP_ARTICLES) {
    targets.push({ path: `/help/${article.slug}`, kind: "link", source: "<HELP_ARTICLES via /help index>" });
  }

  // The guide registry, read through linkedGuides() — the SAME `status ===
  // "live"` filter GuideIndex applies before it reaches for <Link>. A planned
  // guide's href never becomes navigation, so it never becomes a target here.
  for (const guide of linkedGuides()) {
    targets.push({ path: guide.href, kind: "link", source: "<linkedGuides via GuideIndex>" });
  }

  // 3 — next.config.ts redirect destinations.
  targets.push(
    ...scanFile(path.join(ROOT, "next.config.ts"), "redirect", DESTINATION_PATTERNS),
  );

  // 4 — every other source file under src/. Tests are excluded: a route that
  // only a test navigates to is not reachable by a user.
  for (const file of walk(SRC_DIR)) {
    if (!/\.(ts|tsx|mdx)$/.test(file)) continue;
    if (isTestFile(file)) continue;
    if (file.startsWith(path.join(SRC_DIR, "test") + path.sep)) continue;
    if (REGISTRY_FILES.has(path.normalize(file))) continue;
    targets.push(
      ...scanFile(path.normalize(file), "link", LINK_PATTERNS),
      ...scanFile(path.normalize(file), "redirect", REDIRECT_PATTERNS),
    );
  }

  return targets;
}

// ─── The detection function ───────────────────────────────────────────────────

export type UnreachableRoute = EnumeratedRoute;

/** `/docs` is satisfied by `/docs/getting-started` only for a catch-all page. */
function targetIsUnder(route: string, target: string): boolean {
  const r = segmentsOf(route);
  const t = segmentsOf(target);
  if (t.length < r.length) return false;
  return r.every((seg, i) => (isDynamicRouteSegment(seg) ? t[i] !== undefined : seg === t[i]));
}

// ─── Whose link is it? ────────────────────────────────────────────────────────
//
// THE CLOSED-CYCLE HOLE. The self-link exclusion below used to compare against
// the page FILE — so a page's own components were "somewhere else", and TWO
// pages that link only to each other cleared one another. /connections and
// /connections/[connectionId] were exactly that: ConnectionsList.tsx pushes to
// the detail route, ConnectionDetail.tsx links back to the list, both files are
// imported by nothing but those two pages, and no third thing anywhere in the
// product pointed at either. Two live pages, zero ways in, guard green.
//
// That pair now has a door — a visible Suppliers hub tab — so the cycle is no
// longer the live example, and the mechanism is pinned by the `/island` fixture
// below instead. Do not re-derive the rule from whatever routes happen to be
// cyclic today; the fixture is the durable form.
//
// A page is not one file, it is the tree of modules it renders. So a route's OWN
// files are its page file plus everything that file transitively imports, and a
// link only confers reachability when it comes from a source that is LIVE:
// either it belongs to no route at all (chrome — layouts, middleware, the nav
// registries, which render regardless), or it belongs to a route already proven
// reachable. Then the fixpoint runs until nothing new is reached, and an island
// with no entry point stays unreached however densely it links to itself.
//
// This is a narrow loosening of "FLAT, not transitive" and the header's argument
// for flatness survives intact: a hub tab still counts even when its hub is
// hidden behind a launch flag, because a registry is not a route and is never
// claimed by one. What is no longer flat is a link between two PAGES, which is
// the only place a cycle can form.

const IMPORT_SPECIFIER_RE = /\bfrom\s*["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']|\brequire\(\s*["']([^"']+)["']/g;

/** `@/x` and `./x` to a real file under src/, or null for a package import. */
function resolveSpecifier(fromFile: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(SRC_DIR, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(fromFile), spec);
  else return null;
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.mdx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return path.normalize(candidate);
  }
  return null;
}

/**
 * Every module a page renders, transitively.
 *
 * Deliberately read off RAW text rather than comment-stripped: over-connecting
 * only ever makes MORE sources live, which loses a strand rather than inventing
 * one. This graph decides who is silenced, so it errs toward silencing nobody.
 */
export function moduleSubtree(pageFile: string): Set<string> {
  const seen = new Set<string>();
  const stack = [path.normalize(pageFile)];
  while (stack.length > 0) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const imported of importsOf(file)) {
      if (!seen.has(imported)) stack.push(imported);
    }
  }
  return seen;
}

/**
 * Resolved imports of one file, memoised. Ninety-four pages share most of
 * src/components between them, so without this every shared module is re-read
 * and re-parsed once per page and the guard takes seven seconds.
 */
const IMPORTS_CACHE = new Map<string, string[]>();
function importsOf(file: string): string[] {
  const cached = IMPORTS_CACHE.get(file);
  if (cached) return cached;
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    IMPORTS_CACHE.set(file, []); // a fixture path, not a real file
    return [];
  }
  const out: string[] = [];
  for (const m of text.matchAll(IMPORT_SPECIFIER_RE)) {
    const spec = m[1] ?? m[2] ?? m[3];
    const resolved = spec ? resolveSpecifier(file, spec) : null;
    if (resolved) out.push(resolved);
  }
  IMPORTS_CACHE.set(file, out);
  return out;
}

/**
 * The whole guard in one pure function, so the synthetic-fixture test can push
 * a route that provably nothing links to through the SAME code path the real
 * assertion uses. A guard that is only ever exercised on data that passes is
 * not a guard.
 *
 * `ownFiles` defaults to "the page file alone", which is the pre-cycle-fix
 * behaviour — the fixture tests below pass routes whose `file` is not a real
 * path, and they exercise the matching rules, not the import graph.
 */
export function findUnreachableRoutes(
  routes: EnumeratedRoute[],
  targets: LinkTarget[],
  allowlist: Record<string, string> = {},
  ownFiles: (route: EnumeratedRoute) => Set<string> = (r) => new Set([r.file]),
): UnreachableRoute[] {
  const own = new Map(routes.map((r) => [r.route, ownFiles(r)] as const));

  // source file → the routes that render it. A file in nobody's map is chrome.
  const owners = new Map<string, string[]>();
  for (const [route, files] of own) {
    for (const file of files) {
      const list = owners.get(file);
      if (list) list.push(route);
      else owners.set(file, [route]);
    }
  }

  const reachable = new Set<string>();
  const isLive = (source: string): boolean => {
    const claimedBy = owners.get(source);
    if (claimedBy === undefined) return true; // chrome / registry / fixture referrer
    return claimedBy.some((route) => reachable.has(route));
  };

  let changed = true;
  while (changed) {
    changed = false;
    for (const { route, acceptsDescendants } of routes) {
      if (reachable.has(route)) continue;
      if (Object.prototype.hasOwnProperty.call(allowlist, route)) {
        reachable.add(route);
        changed = true;
        continue;
      }
      const mine = own.get(route)!;
      const hit = targets.some(
        (t) =>
          // A page linking to itself — or to a sibling out of its own render
          // tree — does not make itself reachable.
          !mine.has(t.source) &&
          isLive(t.source) &&
          (targetSatisfiesRoute(route, t.path) ||
            (acceptsDescendants === true && targetIsUnder(route, t.path))),
      );
      if (hit) {
        reachable.add(route);
        changed = true;
      }
    }
  }

  return routes.filter((r) => !reachable.has(r.route));
}

/** `findUnreachableRoutes` over the real app, with real import subtrees. */
export function findUnreachableAppRoutes(
  routes: EnumeratedRoute[],
  targets: LinkTarget[],
  allowlist: Record<string, string> = {},
): UnreachableRoute[] {
  const cache = new Map<string, Set<string>>();
  return findUnreachableRoutes(routes, targets, allowlist, (r) => {
    let files = cache.get(r.file);
    if (!files) {
      files = moduleSubtree(r.file);
      cache.set(r.file, files);
    }
    return files;
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

const ROUTES = enumerateRoutes();
const TARGETS = collectLinkTargets();
/**
 * Every route the guard will not fail on. A derived union rather than one
 * hand-maintained map, so the two categories cannot be merged by accident:
 * "reachable, the referrer is elsewhere" and "nobody can reach this and nobody
 * has decided" are different claims, and a reader must be able to tell them apart.
 */
export const ACCOUNTED_FOR: Record<string, string> = {
  ...KNOWN_DEEP_LINK_ONLY,
  ...STRANDED_PENDING_DECISION,
};

/**
 * Computed ONCE — several assertions read it, and the import walk is not free.
 * Resolved against KNOWN_DEEP_LINK_ONLY ALONE, so the pending set is still
 * computed rather than assumed: `theStrandedSetIsExactlyThis` compares this to
 * STRANDED_PENDING_DECISION, and a route that gains an entry point drops out of
 * here and fails there.
 */
const UNREACHABLE = findUnreachableAppRoutes(ROUTES, TARGETS, KNOWN_DEEP_LINK_ONLY);

/**
 * The same walk with NO allowlist at all — every route nothing navigates to,
 * including the ones both lists excuse.
 *
 * Needed because an allowlisted route never appears in `UNREACHABLE`: the
 * allowlist is applied inside the walk, so "is this entry still needed?" cannot
 * be asked of a result the entry itself shaped. The second run is cheap — the
 * import subtrees are already in IMPORTS_CACHE.
 */
const UNREACHABLE_UNEXCUSED = new Set(
  findUnreachableAppRoutes(ROUTES, TARGETS, {}).map((u) => u.route),
);

describe("route reachability (plan rule R1 — no new surface without a consumer)", () => {
  it("finds the app's page routes at all", () => {
    // Sanity floor: if the walker breaks, every later assertion passes vacuously.
    expect(ROUTES.length).toBeGreaterThan(80);
    expect(ROUTES.map((r) => r.route)).toContain("/inbox/[orderId]");
    expect(TARGETS.length).toBeGreaterThan(50);
  });

  it("the import graph resolves — a page really does claim its own components", () => {
    // Anti-vacuity for the cycle fix. If resolveSpecifier stopped resolving, every
    // subtree would collapse to one file, every component would read as chrome,
    // and the guard would silently return to crediting closed cycles.
    const inbox = ROUTES.find((r) => r.route === "/inbox")!;
    const subtree = moduleSubtree(inbox.file);
    expect(subtree.size, "a page's module subtree collapsed to its own file").toBeGreaterThan(10);
    expect(
      [...subtree].some((f) => f.includes(`${path.sep}components${path.sep}`)),
      "no component resolved from a page — the @/ alias stopped resolving",
    ).toBe(true);
  });

  it("every page route is accounted for — reachable, explained, or tracked", () => {
    const unreachable = findUnreachableAppRoutes(ROUTES, TARGETS, ACCOUNTED_FOR);
    const report = unreachable
      .map((u) => `  ${u.route}\n      ${path.relative(ROOT, u.file).split(path.sep).join("/")}`)
      .join("\n");
    expect(
      unreachable,
      unreachable.length === 0
        ? ""
        : `\n${unreachable.length} route(s) exist but nothing navigates to them:\n${report}\n\n` +
            `Link one from the sidebar, a hub tab, a redirect or another page — or account for it\n` +
            `in this file WITH a written reason: KNOWN_DEEP_LINK_ONLY if the referrer is real but\n` +
            `outside this repo, STRANDED_PENDING_DECISION if it is an unresolved gap.\n`,
    ).toEqual([]);
  });

  it("the stranded set is exactly the two on the record", () => {
    // The mechanism that stops "tracked" turning into "forgotten". A THIRD strand
    // fails here rather than quietly joining the list, and a route that gets its
    // entry point built drops out of UNREACHABLE and must be deleted from
    // STRANDED_PENDING_DECISION rather than left as a stale excuse — which is
    // exactly what happened to the two /connections routes on 2026-08-08.
    const unreachable = UNREACHABLE.map((u) => u.route);
    expect(
      unreachable.sort(),
      "a route is stranded and not on the record — link it, or add it to " +
        "STRANDED_PENDING_DECISION with a reason",
    ).toEqual(Object.keys(STRANDED_PENDING_DECISION).sort());
    // Each is a real page, and each reason cites something openable — the same
    // bar the allowlist reasons must clear, because these are the harder claim.
    const real = new Set(ROUTES.map((r) => r.route));
    for (const [route, reason] of Object.entries(STRANDED_PENDING_DECISION)) {
      expect(real.has(route), `${route}: named as stranded but is not a route`).toBe(true);
      expect(rejectReason(reason), `${route}: ${rejectReason(reason)}`).toBeNull();
      // A pending reason must SAY it is pending, so it can never be mistaken for
      // KNOWN_DEEP_LINK_ONLY's "reachable, the referrer is just elsewhere".
      expect(reason, `${route}: a pending reason must declare itself pending`).toMatch(
        /PENDING A DECISION/,
      );
    }
    // …and the two lists must not blur into each other.
    const explained = new Set(Object.keys(KNOWN_DEEP_LINK_ONLY));
    expect(Object.keys(STRANDED_PENDING_DECISION).filter((r) => explained.has(r))).toEqual([]);
    for (const [route, reason] of Object.entries(KNOWN_DEEP_LINK_ONLY)) {
      expect(reason, `${route}: an explained route must not carry a pending reason`).not.toMatch(
        /PENDING A DECISION/,
      );
    }
  });

  it("prints the stranded set, so it lands in CI output and not only in a file", () => {
    // A tracked gap nobody reads is an untracked gap. This is the only assertion
    // here whose job is to TALK: it puts the count and the names in front of
    // anyone watching a green run.
    const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join("/");
    const fileFor = (route: string) => ROUTES.find((r) => r.route === route)?.file;
    const routes = Object.keys(STRANDED_PENDING_DECISION).sort();
    console.log(
      `\n${"─".repeat(78)}\n` +
        `${routes.length} page route(s) render but NO user can navigate to them, and they are\n` +
        `awaiting a product decision (build the entry point, or delete the page):\n\n` +
        routes
          .map((r) => {
            const file = fileFor(r);
            return `  ${r}${file ? `\n  — ${rel(file)}` : ""}`;
          })
          .join("\n") +
        `\n\nSee STRANDED_PENDING_DECISION in src/test/route-reachability.test.ts for the\n` +
        `evidence on each. These are NOT the same as KNOWN_DEEP_LINK_ONLY, which is\n` +
        `${Object.keys(KNOWN_DEEP_LINK_ONLY).length} route(s) something outside this repo genuinely links to.\n` +
        `${"─".repeat(78)}\n`,
    );
    expect(routes.length).toBeGreaterThan(0);
  });

  it("/connections and its detail page are reached by the tab a user actually clicks", () => {
    // THE DEFECT, VERBATIM. Both routes rendered, resolved and were bookmarkable
    // while no user could arrive at either. /connections reached the registry
    // ONLY as a `hidden: true` HUB_TABS entry, and a hidden entry is stripped by
    // visibleHubTabs — so the tab strip never printed it, the sidebar's hub
    // tooltip never named it, and the two pages linked to nothing but each
    // other (the closed cycle above). This guard credited HUB_TABS raw and
    // therefore reported the route as covered, which is precisely how it stayed
    // invisible; FE #110 fixed the guard, and this pins the route that motivated
    // the fix.
    //
    // Everything below resolves through visibleHubTabs() — what the strip
    // RENDERS — and never through Object.values(HUB_TABS). Reading the registry
    // raw is the old blindness, and it would call this fixed with `hidden: true`
    // back in place.
    const rendered = (Object.keys(HUB_TABS) as HubKey[]).flatMap((hub) =>
      visibleHubTabs(hub, { inboundEnabled: true }).map((t) => t.href),
    );

    // ANTI-VACUITY FLOOR. A sweep that collapses to nothing passes every
    // `toContain` below by never running, so the size is asserted, not just
    // non-emptiness: 4 Orders tabs (inbound on) + 3 Suppliers + 3 Activity.
    expect(rendered.length, "no hub tab resolved — the sweep is vacuous").toBe(10);
    expect(new Set(rendered).size, "a tab href is duplicated across the strip").toBe(10);
    // A control that was visible before and after, so a change that empties the
    // Suppliers hub cannot pass by emptying everything.
    expect(rendered).toContain("/library/suppliers");

    // The route itself, on the strip.
    expect(
      rendered,
      "/connections is off the rendered tab strip again — an operator cannot see " +
        "the record that decides what their suppliers receive",
    ).toContain("/connections");

    // Both pages exist, and neither is stranded under the FULL app walk with
    // BOTH lists passed empty — so this cannot pass on the strength of an
    // allowlist entry or a pending-decision excuse.
    expect(ROUTES.map((r) => r.route).filter((r) => r.startsWith("/connections"))).toEqual([
      "/connections",
      "/connections/[connectionId]",
    ]);
    for (const route of ["/connections", "/connections/[connectionId]"]) {
      expect(UNREACHABLE_UNEXCUSED.has(route), `${route} is stranded again`).toBe(false);
      expect(Object.keys(ACCOUNTED_FOR), `${route} must not need an excuse`).not.toContain(route);
    }

    // The detail page is reached THROUGH the list, which is the whole reason the
    // hub tab has to stay visible: the list is the only live source that links
    // to it, so hiding the tab strands both halves at once.
    const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join("/");
    expect(
      TARGETS.filter((t) => targetSatisfiesRoute("/connections/[connectionId]", t.path)).map((t) =>
        rel(t.source),
      ),
    ).toContain("src/components/connections/ConnectionsList.tsx");
  });

  it("/one-pager is reached by a real link, and no longer by the allowlist", () => {
    // Founder decision, 2026-07-30: the print one-pager is real sales
    // collateral with real content — the only thing wrong with it was that
    // nothing linked to it. So it is linked instead of deleted, and its
    // allowlist entry (which said, in as many words, "wants either a real link
    // or a deletion decision") is gone. The escape hatch closing is the point:
    // an allowlisted route is a route this guard has stopped guarding.
    const onePager = ROUTES.filter((r) => r.route === "/one-pager");
    expect(onePager, "/one-pager must still exist as a page").toHaveLength(1);
    expect(Object.keys(KNOWN_DEEP_LINK_ONLY)).not.toContain("/one-pager");

    // Cleared with the allowlist passed as EMPTY, so this cannot pass on the
    // strength of the hatch it just gave up.
    expect(findUnreachableRoutes(onePager, TARGETS, {}).map((u) => u.route)).toEqual([]);

    // Exactly ONE inbound link, and it is the marketing footer — which renders
    // under every marketing page, so a prospect reading /pricing or /customers
    // has it in front of them. src/app/sitemap.ts also names the path, and is
    // deliberately NOT counted here (see "a sitemap array is NOT navigation");
    // if that ever changes, this assertion sees two sources and fails.
    const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join("/");
    expect(TARGETS.filter((t) => t.path === "/one-pager").map((t) => rel(t.source))).toEqual([
      "src/app/(marketing)/layout.tsx",
    ]);
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

  it("two pages that link only to each other are BOTH stranded", () => {
    // The closed-cycle hole, as a fixture. Each page's link lives in a component
    // the OTHER page does not render, so under the old file-level self-link rule
    // each one cleared the other and the island passed. Reachability now walks
    // out from chrome, so a cycle with no entry point stays unreached.
    const listPage = "<pages/list>";
    const detailPage = "<pages/detail>";
    const listComponent = "<components/List>";
    const detailComponent = "<components/Detail>";
    const routes: EnumeratedRoute[] = [
      { route: "/island", file: listPage },
      { route: "/island/[id]", file: detailPage },
    ];
    const subtree = (r: EnumeratedRoute) =>
      r.file === listPage
        ? new Set([listPage, listComponent])
        : new Set([detailPage, detailComponent]);
    const mutual: LinkTarget[] = [
      { path: `/island/${DYN}`, kind: "link", source: listComponent },
      { path: "/island", kind: "link", source: detailComponent },
    ];

    expect(findUnreachableRoutes(routes, mutual, {}, subtree).map((u) => u.route)).toEqual([
      "/island",
      "/island/[id]",
    ]);

    // ONE real entry point rescues the whole island — the guard reports a
    // missing door, not a missing link, so it must go quiet the moment a door
    // exists. Without this half it would flag every cycle forever.
    const withNav: LinkTarget[] = [...mutual, { path: "/island", kind: "nav", source: "<BridgeSidebar nav>" }];
    expect(findUnreachableRoutes(routes, withNav, {}, subtree)).toEqual([]);
  });

  it("a page linking to itself does not make itself reachable", () => {
    // The self-link exclusion is the difference between "something navigates
    // here" and "this file mentions its own path". Stranded pages very often
    // DO link to themselves — a canonical <link>, a tab strip, a "copy link"
    // button, a breadcrumb head — so without this the guard would clear exactly
    // the pages it exists to catch. Pinned with a fixture because the real app
    // has no self-only route, which is why removing the exclusion used to be
    // an invisible change.
    const self = "<self>";
    const routes = [{ route: "/lonely", file: self }];
    expect(
      findUnreachableRoutes(routes, [{ path: "/lonely", kind: "link", source: self }]).map((u) => u.route),
    ).toEqual(["/lonely"]);
    // A link from ANY other file does reach it — the exclusion is about the
    // source, not about the path.
    expect(findUnreachableRoutes(routes, [{ path: "/lonely", kind: "link", source: "<other>" }])).toEqual([]);
  });

  it("reads the sidebar through what it renders, not through NAV_MAIN's text", () => {
    // What survives of the old "/drafts shape" test. It pinned two live
    // examples of a registry href that is never rendered as a link: /drafts
    // (in NAV_MAIN, filtered out by LAUNCH_CORE_HREFS) and
    // /library/rule-definitions (a `match`-only HUB_TABS entry). FE #47 deleted
    // both pages and both registry entries, so those assertions started
    // asserting nothing — `expected [] to include '/library/rule-definitions'`.
    //
    // The mechanism they guarded is NOT lost: "a registry href for something
    // never rendered as a link is a phantom target" covers it with a fixture,
    // which is the form that does not decay when the app's registries change.
    // Kept here only is the positive half, which still has teeth: the sidebar
    // must actually BE read, or every route would look stranded and the guard
    // would flip from useful to noise.
    const paths = new Set(TARGETS.map((t) => t.path));
    expect(paths.has("/inbox")).toBe(true);
    expect(paths.has(PINNED_ACTION_HREF)).toBe(true);

    // HUB_TABS is credited for `href` and never for `match`. Asserted as an
    // invariant over whatever the registry currently holds, so re-introducing a
    // `match`-only entry cannot smuggle in a phantom target.
    const tabs = Object.values(HUB_TABS).flat();
    const hubMatchOnly = tabs
      .flatMap((t) => t.match ?? [])
      .filter((m) => !tabs.some((t) => t.href === m));
    for (const m of hubMatchOnly) expect(paths.has(m)).toBe(false);
    expect(paths.has("/library/suppliers")).toBe(true); // a real tab href
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

  it("reads every string literal inside an href={…} / router.push(…) expression", () => {
    const ex = (text: string) => extractTargets(text, "link", "<fixture>", LINK_PATTERNS).map((t) => t.path);
    const rx = (text: string) =>
      extractTargets(text, "redirect", "<fixture>", REDIRECT_PATTERNS).map((t) => t.path);

    // Shipped shapes. Requiring a quote IMMEDIATELY after `href=` / `push(`
    // made a ternary invisible — and src/app/(app)/admin/page.tsx has exactly
    // three hrefs, one ternary and two external, so the whole file scored zero.
    expect(ex(`<Link href={accessError.status === 401 ? "/sign-in?redirect_url=%2Fadmin" : "/bridge"}>`)).toEqual([
      "/sign-in",
      "/bridge",
    ]);
    // operations/connectors/page.tsx:921 — literal and interpolated in one expr.
    expect(
      ex('<Link href={isNew ? "/library/suppliers" : `/library/suppliers/${connector.id}?tab=delivery`}>'),
    ).toEqual(["/library/suppliers", `/library/suppliers/${DYN}`]);
    // LaneDrawer.tsx:583 — the same shape inside router.push().
    expect(rx('router.push(supplierId ? `/library/suppliers/${supplierId}` : "/library/suppliers")')).toEqual([
      `/library/suppliers/${DYN}`,
      "/library/suppliers",
    ]);

    // Real file, not a fixture: the admin page must now contribute targets.
    const adminPage = path.normalize(path.join(APP_DIR, "(app)", "admin", "page.tsx"));
    const fromAdmin = TARGETS.filter((t) => t.source === adminPage).map((t) => t.path);
    expect(fromAdmin).toContain("/bridge");
    expect(fromAdmin).toContain("/sign-in");

    // Still TIGHT. An object literal's `href:` is ONE value, not the whole
    // object — widening to "every literal after href" would credit siblings.
    expect(ex(`{ href: "/a", other: "/b" }`)).toEqual(["/a"]);
    // A wholly external target contributes nothing, however it is assembled.
    expect(ex("<a href={`${STRIPE_CUSTOMER_BASE}${org.stripeCustomerId}`}>")).toEqual([]);
  });

  it("a registry href for something never rendered as a link is a phantom target", () => {
    // guides.ts is the SECOND launch-filtered registry, and it was being swept
    // raw. GuideIndex.tsx:97 renders a `status !== "live"` guide as a <span> +
    // "Coming soon" badge — never a <Link> — so its `href` is a plan, not
    // navigation. Creating a page at that path used to pass this guard on the
    // strength of a target no user can click.
    const paths = new Set(TARGETS.map((t) => t.path));

    // Planned — phantom. Must NOT be credited.
    expect(paths.has("/admin/guides/unfreeze-a-pilot-workspace")).toBe(false);
    expect(paths.has("/help/guides/set-up-your-workspace")).toBe(false);
    // Live — genuinely rendered as a <Link>. MUST still be credited, or the
    // exclusion has simply blinded the guard instead of sharpening it.
    expect(paths.has("/admin/guides/onboard-a-new-client")).toBe(true);
    expect(paths.has("/help/guides/first-order-end-to-end")).toBe(true);

    // The registry must agree with what is asserted above, so this test cannot
    // rot into a tautology if a guide's status flips.
    expect(GUIDES.find((g) => g.slug === "unfreeze-a-pilot-workspace")?.status).toBe("planned");
    expect(GUIDES.find((g) => g.slug === "onboard-a-new-client")?.status).toBe("live");
  });

  it("a link that exists only inside a comment confers no reachability", () => {
    const ex = (text: string) => extractTargets(text, "link", "<fixture>", LINK_PATTERNS).map((t) => t.path);
    const rx = (text: string) =>
      extractTargets(text, "redirect", "<fixture>", REDIRECT_PATTERNS).map((t) => t.path);

    // Commented-out code is the single cheapest way to fake reachability: it
    // survives review as "context", and it navigates nobody.
    expect(ex(`// TODO(WP-09): we considered <Link href="/orphan-comment">Orphan</Link> here.`)).toEqual([]);
    expect(ex(`/* <Link href="/orphan-block">Orphan</Link> */`)).toEqual([]);
    expect(ex(`/**\n * an href="/orphan-jsdoc" in a doc block is prose, not navigation\n */`)).toEqual([]);
    // MDX comments are the JSX container and the HTML comment; "//" is prose
    // there, so the MDX path must strip those two forms and nothing else.
    const exMdx = (t: string) => extractTargets(t, "link", "<fixture>", LINK_PATTERNS, "mdx").map((x) => x.path);
    expect(exMdx(`{/* [old](/orphan-mdx-comment) */}`)).toEqual([]);
    expect(exMdx(`<!-- [old](/orphan-html-comment) -->`)).toEqual([]);
    // …and MUST NOT eat prose: a slash pair in help copy is not a comment.
    expect(exMdx(`Use sftp://host/path. See the [inbox guide](/help/inbox-basics).`)).toEqual([
      "/help/inbox-basics",
    ]);
    // This shape is live in the repo today: UserChipMenu.tsx:10 credits "/"
    // from a `//` comment describing signOut({ redirectUrl: "/" }).
    expect(rx(`// (signOut({ redirectUrl: "/" })). The design's item is`)).toEqual([]);

    // A "//" written after a COLON is still a comment. The scheme exemption exists for
    // "https://", but it used to be spelled `prev !== ":"` against the last NON-WHITESPACE
    // character emitted — which exempted every colon in the language. An object key, a `case`
    // label, a ternary and a type annotation all left their comment standing and readable as
    // live code, and a commented-out <Link> after any of them cleared a genuinely orphaned page
    // through BOTH guards. Reproduced end-to-end before the fix; these are the four shapes.
    expect(ex(`const m = { ready: // <Link href="/orphan-obj-key">x</Link>`)).toEqual([]);
    expect(ex(`case "ready": // <Link href="/orphan-case">x</Link>`)).toEqual([]);
    expect(ex(`const v = cond ? a : // <Link href="/orphan-ternary">x</Link>`)).toEqual([]);
    expect(ex(`type T = { a: // <Link href="/orphan-type">x</Link>`)).toEqual([]);
    // …while an ADJACENT scheme colon still is one. This is the over-correction guard: drop the
    // exemption entirely and the rest of this prose line is swallowed, taking the real link.
    expect(ex(`<p>See https://example.com/docs</p><Link href="/real-scheme">R</Link>`)).toEqual([
      "/real-scheme",
    ]);

    // Stripping must not eat real code. A "//" inside a string literal is not a
    // comment — protocol-relative URLs and https:// literals are everywhere.
    expect(ex(`const doc = "https://example.com/x"; <Link href="/real">R</Link>`)).toEqual(["/real"]);
    expect(ex(`<Link href="/real-2">R</Link> // linked above`)).toEqual(["/real-2"]);
    // …nor a regex literal that happens to contain a slash pair.
    expect(ex(`const re = /\\/\\//g; <Link href="/real-3">R</Link>`)).toEqual(["/real-3"]);
  });

  it("enumerates page.mdx routes too — pageExtensions makes them live URLs", () => {
    // next.config.ts:20 sets pageExtensions: ["ts", "tsx", "mdx"]. The help
    // centre is written as MDX: 45 page.mdx files against 49 page.tsx. A guard
    // that filters on `page.tsx` sees 52% of the app, and every help article is
    // free to rot unlinked.
    const routes = ROUTES.map((r) => r.route);
    expect(routes).toContain("/help/troubleshooting"); // page.mdx
    expect(routes).toContain("/help/guides/first-order-end-to-end"); // page.mdx
    expect(ROUTES.length).toBeGreaterThan(80);
    // Widening the filter without widening fileToRoute yields "/help/x/page.mdx".
    expect(routes.filter((r) => /page\.(tsx|mdx)$/.test(r))).toEqual([]);
  });

  it("flags an orphaned .mdx route — an MDX page is a URL, not a document", () => {
    const orphanFile = path.join(APP_DIR, "(marketing)", "orphan-mdx", "page.mdx");
    expect(fileToRoute(orphanFile)).toBe("/orphan-mdx");
    const flagged = findUnreachableRoutes(
      [{ route: fileToRoute(orphanFile), file: orphanFile }],
      TARGETS,
      KNOWN_DEEP_LINK_ONLY,
    ).map((u) => u.route);
    expect(flagged).toEqual(["/orphan-mdx"]);
  });

  it("handles the segment kinds this repo does not use yet (no permanent false RED)", () => {
    const j = (...p: string[]) => path.join(APP_DIR, ...p);

    // OPTIONAL CATCH-ALL. `/docs/[[...slug]]` serves `/docs` AND every depth
    // beneath it, so a link to `/docs/getting-started` reaches that file. The
    // route string stays `/docs` (that is the canonical URL); the flag is what
    // lets a deeper link satisfy it.
    const docs = j("docs", "[[...slug]]", "page.tsx");
    expect(fileToRoute(docs)).toBe("/docs");
    expect(
      findUnreachableRoutes(
        [{ route: "/docs", file: docs, acceptsDescendants: true }],
        [{ path: "/docs/getting-started", kind: "link", source: "<ref>" }],
      ),
    ).toEqual([]);
    // …and the flag is not a blanket pass: an ordinary route is unmoved by a
    // link to something beneath it.
    expect(
      findUnreachableRoutes(
        [{ route: "/docs", file: docs }],
        [{ path: "/docs/getting-started", kind: "link", source: "<ref>" }],
      ).map((u) => u.route),
    ).toEqual(["/docs"]);

    // PARALLEL SLOT. `@modal` is a slot name, not a URL segment.
    expect(fileToRoute(j("(app)", "inbox", "@modal", "preview", "page.tsx"))).toBe("/inbox/preview");

    // INTERCEPTING ROUTE. `(.)photo` does NOT match the route-group test
    // `^\(.+\)$` — it carries a name after the closing paren — so it used to
    // survive into the route string as `/feed/(..)photo`, a path no link can
    // ever be written to: a permanent false RED. It is skipped instead; see
    // enumerateRoutes for why that loses nothing.
    expect(isInterceptingSegment("(.)photo")).toBe(true);
    expect(isInterceptingSegment("(..)photo")).toBe(true);
    expect(isInterceptingSegment("(...)photo")).toBe(true);
    expect(isInterceptingSegment("(..)(..)photo")).toBe(true);
    expect(isInterceptingSegment("(app)")).toBe(false); // plain route group
    expect(isInterceptingSegment("inbox")).toBe(false);
  });

  it("strips route groups and optional catch-alls when deriving a route", () => {
    const j = (...p: string[]) => path.join(APP_DIR, ...p);
    expect(fileToRoute(j("(app)", "inbox", "[orderId]", "page.tsx"))).toBe("/inbox/[orderId]");
    expect(fileToRoute(j("(marketing)", "pricing", "page.tsx"))).toBe("/pricing");
    expect(fileToRoute(j("(home)", "page.tsx"))).toBe("/");
    expect(fileToRoute(j("sign-in", "[[...sign-in]]", "page.tsx"))).toBe("/sign-in");
  });
});

// ─── Allowlist reason quality ─────────────────────────────────────────────────
//
// The allowlist is this guard's only escape hatch, so the cost of using it has
// to exceed the cost of silencing it. The original bar was `length > 15`, which
// "xxxxxxxxxxxxxxxxxx" clears — i.e. the hatch was open to anyone willing to
// hold down a key.
//
// No string test can establish that a reason is TRUE. What it can require is
// that the reason be CHECKABLE: prose, plus a citation a reviewer can go and
// open. All three shipped entries already work this way — they name
// StripeBillingService.cs:335, src/app/sitemap.ts, a founder decision date, and
// the packet that deletes the page. That is the bar, made explicit: name a
// file, a URL, a date or a work packet, and the next person can verify or
// refute you in one step instead of taking your word for it.

/** A citation a reviewer can open: a repo file, a URL, an ISO date, a packet id. */
const EVIDENCE_ANCHOR =
  /[\w./-]+\.(?:tsx?|mdx?|cs|jsx?|json|ya?ml|mjs|cjs)\b|https?:\/\/|\b\d{4}-\d{2}-\d{2}\b|\bWP-\d+\b/;

const WORD_RE = /[A-Za-z][A-Za-z'’-]*/g;

/** Null when the reason is acceptable; otherwise what is wrong with it. */
export function rejectReason(reason: string): string | null {
  const trimmed = reason.trim();
  if (trimmed.length < 40) return "a reason must be a sentence, not a label (min 40 characters)";
  const words = trimmed.match(WORD_RE) ?? [];
  if (words.length < 8) return `a reason must explain, not name (min 8 words, found ${words.length})`;
  const distinct = new Set(words.map((w) => w.toLowerCase()));
  if (distinct.size < 6) return `a reason must not be padding (min 6 distinct words, found ${distinct.size})`;
  if (!EVIDENCE_ANCHOR.test(trimmed)) {
    return (
      "a reason must cite something checkable — a file path, a URL, an ISO date, or a WP-nn packet — " +
      "so the next reader can verify it instead of trusting it"
    );
  }
  return null;
}

describe("KNOWN_DEEP_LINK_ONLY allowlist hygiene", () => {
  it("every entry carries a written reason", () => {
    for (const [route, reason] of Object.entries(KNOWN_DEEP_LINK_ONLY)) {
      expect(typeof reason, `${route}: reason must be a string`).toBe("string");
      expect(rejectReason(reason), `${route}: ${rejectReason(reason)}`).toBeNull();
    }
  });

  it("a reason must be an explanation, not merely long", () => {
    // The bar used to be `length > 15`, which "xxxxxxxxxxxxxxxxxx" clears. The
    // allowlist is the guard's only escape hatch, so the cost of using it has
    // to be higher than the cost of writing eighteen characters.
    expect(rejectReason("xxxxxxxxxxxxxxxxxx")).not.toBeNull();
    expect(rejectReason("deep link only")).not.toBeNull();
    expect(rejectReason("   ")).not.toBeNull();
    // Prose alone is not enough either — it must cite something a reviewer can
    // go and open.
    expect(
      rejectReason("This page is deliberately not linked from anywhere in the product right now."),
    ).not.toBeNull();
    // Citing a file, a date or a work packet is what makes it checkable.
    expect(
      rejectReason("Not linked in-app: the only referrer is src/app/sitemap.ts, which is a crawler hint."),
    ).toBeNull();
    expect(rejectReason("Retired by founder decision on 2026-07-30; the page is deleted in WP-08.")).toBeNull();

    // Every shipped entry clears the bar for a real reason, not by accident.
    for (const reason of Object.values(KNOWN_DEEP_LINK_ONLY)) {
      expect(EVIDENCE_ANCHOR.test(reason)).toBe(true);
    }
  });

  it("every entry in BOTH lists still corresponds to a real route (neither can rot)", () => {
    const real = new Set(ROUTES.map((r) => r.route));
    const stale = Object.keys(ACCOUNTED_FOR).filter((route) => !real.has(route));
    expect(
      stale,
      stale.length === 0
        ? ""
        : `\nAn allowlist names route(s) that no longer exist:\n${stale
            .map((s) => `  ${s}`)
            .join("\n")}\nThe page was deleted — delete the entry too.\n`,
    ).toEqual([]);
  });

  it("every entry in BOTH lists is still unreachable (an excuse cannot outlive its reason)", () => {
    // The counterpart to the same test in endpoint-reachability.test.ts, which
    // earned its keep by rejecting a wrong entry during development. An entry
    // whose route has since gained a real in-app link is cover for nothing, and
    // it hides the fact that the page is now guarded on its own merits — which
    // is exactly how /one-pager stopped being an allowlist entry.
    //
    // Asked of UNREACHABLE_UNEXCUSED, not UNREACHABLE: an allowlisted route is
    // removed by its own entry before the walk finishes, so asking the excused
    // result whether the excuse is needed always answers "no".
    const obsolete = Object.keys(ACCOUNTED_FOR).filter((route) => !UNREACHABLE_UNEXCUSED.has(route));
    expect(
      obsolete,
      obsolete.length === 0
        ? ""
        : `\nAn allowlist names route(s) that are now reachable on their own merits:\n` +
            `${obsolete.map((s) => `  ${s}`).join("\n")}\nDelete the entry — the guard covers them now.\n`,
    ).toEqual([]);
  });
});
