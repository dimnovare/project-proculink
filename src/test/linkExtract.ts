// Link extraction for the OUTBOUND link gate — "does every link we ship land somewhere?"
//
// Not a test file (no `.test.` in the name) so vitest treats it as a helper.
//
// WHY THIS EXISTS. The link crawl used five naive regexes over raw source and read only
// `(marketing)/help/**`, `(marketing)/**`, `(home)/**`, `components/marketing/**` and three nav
// files. Two guaranteed-404 links — one in a component under `src/components/bridge/`, one under
// `src/app/(app)/library/suppliers/` — were planted and the whole suite stayed green: every route
// under `src/app/(app)/**` and every non-marketing component was invisible to it, and the extractor
// could not see `href={"/x"}`, `router.replace()` or `redirect()` even where it did look. A gate
// that cannot fail on a planted 404 is documentation, not a gate.
//
// The reading machinery — comment stripping (js and mdx modes), string-literal masking, balanced
// value-region reading, and the anchor patterns — lives in `./sourceScan`, shared with the INBOUND
// route-reachability guard. That module's header explains what is shared, and what each guard keeps
// to itself and why.
//
// WHAT THIS FILE OWNS: the pattern SELECTION for the outbound question. One combined set, because a
// dead link is dead however it was written — the reachability guard splits its patterns into LINK /
// REDIRECT / DESTINATION groups so it can say HOW a page is reached, and that distinction buys the
// crawl nothing.
//
// The three decisions that keep this from over-reporting, each with a test in link-crawl.test.ts:
//   • comments are stripped — a link in a comment navigates nobody, so it must not be crawled
//     (and, symmetrically, must not be blamed for a 404);
//   • literals are masked before anchors are searched — `querySelector('a[href="/x"]')` is a
//     selector, not a link;
//   • an `href="/x" title="y"` region is exactly ONE literal, and `{ href: "/a", other: "/b" }`
//     stops at `/a` — widening either would swallow the next attribute or the sibling key.

import {
  extractRaw,
  HREF_ANCHOR,
  LINK_TUPLE_RE,
  MD_LINK_RE,
  NAV_CALL_ANCHOR,
  REDIRECT_PROP_ANCHOR,
  ROUTE_KEY_ANCHOR,
  type Pattern,
  type SourceSyntax,
} from "./sourceScan";

// Re-exported so the crawl reaches its whole reading surface through one import.
export { stripComments, syntaxFor } from "./sourceScan";
export type { SourceSyntax };

/**
 * Every anchor that puts a checkable internal path in shipped source.
 *
 * `NAV_CALL_ANCHOR` is the form WITHOUT `new URL(…)` — see ONE DELIBERATE DUPLICATE in
 * ./sourceScan for why the reachability guard uses the wider form and this one does not.
 */
const PATTERNS: Pattern[] = [
  { anchor: HREF_ANCHOR, mode: "value" },
  { anchor: NAV_CALL_ANCHOR, mode: "call" },
  { anchor: REDIRECT_PROP_ANCHOR, mode: "value" },
  { anchor: ROUTE_KEY_ANCHOR, mode: "value" },
  { re: LINK_TUPLE_RE, group: 3 },
  { re: MD_LINK_RE, group: 1 },
];

/**
 * Every path-shaped literal this source would navigate a user to. Callers filter to internal page
 * links (see `isInternalPageLink`) and resolve them against the route table.
 *
 * Computed paths come back verbatim, `${…}` and all: the crawl skips them rather than guess, and
 * asserts their registries exhaustively instead — see `isVerifiablePath` in link-crawl.test.ts for
 * why guessing is worse than skipping in BOTH directions.
 */
export function extractLinks(text: string, syntax: SourceSyntax = "js"): string[] {
  return extractRaw(text, PATTERNS, syntax);
}
