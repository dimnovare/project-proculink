// Source scanning shared by the two link gates.
//
// Not a test file (no `.test.` in the name) so vitest treats it as a helper.
//
// WHY THIS EXISTS. Two guards read navigation out of raw source, and they ask OPPOSITE questions:
//
//   • src/test/route-reachability.test.ts — INBOUND. "Does anything navigate TO this page?"
//     A route that exists but nothing links to is a surface no user can arrive at.
//   • src/test/link-crawl.test.ts (via ./linkExtract) — OUTBOUND. "Does every link we ship land
//     somewhere?" A link that resolves to nothing is a 404 we hand a user.
//
// The questions differ; the READING does not. Both need the same four things, and each one is
// load-bearing — dropping any of them was a real observed defect, not a hypothetical:
//
//   • comment stripping (separate JS and MDX modes) — a link that exists only in a comment
//     navigates nobody, so it must neither confer reachability nor be blamed for a 404;
//   • string-literal masking — `querySelector('a[href="/x"]')` is a selector, not a link, and an
//     anchor-shaped substring inside a literal must not open a region;
//   • balanced value-region reading — `href={cond ? "/a" : "/b"}` yields BOTH, while
//     `href="/x" title="y"` yields exactly one and `{ href: "/a", other: "/b" }` stops at `/a`;
//   • the anchor patterns themselves.
//
// They were written independently — the reachability guard first (WP-04, `e8fff8b`), then the crawl
// widening while WP-04 was still unmerged, hence a reimplementation rather than an import. Once both
// were on main they were two near-identical copies of the same parser, free to drift in either
// direction: a fix to one silently leaving the other blind. This module is the single copy.
//
// WHAT STAYS OUT. Each guard keeps its own PATTERN SELECTION and its own NORMALISATION POLICY,
// because those encode the difference between the two questions rather than shared mechanics:
//
//   • Pattern selection. The reachability guard keeps LINK / REDIRECT / DESTINATION groups separate
//     so it can attribute reachability by kind ("reached via a redirect" is a different fact from
//     "reached via a link"). The crawl has one combined set — a dead link is dead however it is
//     written, and the kind buys it nothing.
//   • Normalisation. The reachability guard maps a computed segment to a `«dyn»` sentinel and
//     matches structurally, so `href={`/inbox/${o.id}`}` satisfies `/inbox/[orderId]`. The crawl
//     SKIPS computed paths entirely, and must: requiring a dynamic route segment would flag
//     `/help/${article.slug}` as a 404 when every article is its own static page, and accepting any
//     segment would make `/library/suppliers/${id}` resolve against anything. See the
//     `isVerifiablePath` doc in link-crawl.test.ts.
//
// Collapsing either of those would break one of the two guards, so they are deliberately not here.
//
// ONE DELIBERATE DUPLICATE. The nav-call anchor is exported in two forms because the guards
// currently disagree about `new URL(…)`: reachability counts it, the crawl does not. Both are
// exported and each guard picks. This module does not adjudicate that. The convergence it exists
// for was contracted to change NEITHER guard's behaviour, and collapsing the two sets would change
// one; which answer is right is a separate decision that needs its own test, and there is no
// evidence here for either. `sourceScan.test.ts` pins the difference so it cannot be "tidied" away
// by accident.

export type SourceSyntax = "js" | "mdx";

/** The syntax mode for a file path. */
export function syntaxFor(file: string): SourceSyntax {
  return file.endsWith(".mdx") ? "mdx" : "js";
}

// ─── Literal reading ──────────────────────────────────────────────────────────
//
// The link patterns used to require a quote IMMEDIATELY after `href=` / `push(`, which made every
// non-trivial expression invisible. The shipped counter-example is src/app/(app)/admin/page.tsx: its
// only internal link is
//   href={accessError.status === 401 ? "/sign-in?redirect_url=%2Fadmin" : "/bridge"}
// and its other two hrefs are external Stripe URLs, so the WHOLE FILE scored zero targets. Same
// shape at LaneDrawer.tsx:583, connectors/page.tsx:921, pricing/page.tsx:225.
//
// So an anchor (`href=`, `href:`, `router.push(`, …) opens a VALUE REGION, and every string literal
// inside that region is a candidate. The region is BOUNDED — it is not "every literal after the
// anchor" — which is what keeps a sibling object key or the next JSX attribute out.

/** Read the string/template literal starting at `i`, or null if none starts there. */
export function readLiteral(text: string, i: number): { value: string; end: number } | null {
  const q = text[i];
  if (q !== '"' && q !== "'" && q !== "`") return null;
  let value = "";
  let j = i + 1;
  while (j < text.length) {
    const ch = text[j];
    if (ch === "\\") {
      value += text.slice(j, j + 2);
      j += 2;
      continue;
    }
    if (ch === q) return { value, end: j + 1 };
    value += ch;
    j++;
  }
  return null; // unterminated — not a literal
}

/**
 * Blank out the CONTENTS of every string literal, preserving length and the quote characters.
 * Anchors are then searched in this masked copy, so an anchor-shaped substring that is really DATA
 * cannot open a region: `querySelector('a[href="/x"]')` is a selector, and the query string in
 * `"/sign-in?redirect_url=%2Fadmin"` is a parameter, not a redirect prop. Offsets are identical in
 * both copies, so a match found in the masked text indexes straight back into the real one.
 */
export function maskLiterals(code: string): string {
  let out = "";
  let i = 0;
  while (i < code.length) {
    const lit = readLiteral(code, i);
    if (lit) {
      out += code[i] + " ".repeat(Math.max(0, lit.end - i - 2)) + code[lit.end - 1];
      i = lit.end;
      continue;
    }
    out += code[i];
    i++;
  }
  return out;
}

const OPENERS = "([{";
const CLOSERS = ")]}";

/**
 * Every string literal in the value region that begins at `at`.
 *
 *   • `call`  — the anchor consumed the `(`; the region is the argument list, to the matching `)`.
 *   • `value` — an `href=` / `href:` value. If it opens with a quote the region is exactly ONE
 *               literal (otherwise `href="/x" title="y"` swallows the next JSX attribute); if it
 *               opens with `{` the region is the balanced brace expression; anything else (a bare
 *               ternary after `href:`) runs to the first `,` `;` or closer at depth zero, which
 *               stops `{ href: "/a", other: "/b" }` at `/a`.
 */
export function literalsInRegion(code: string, at: number, mode: "call" | "value"): string[] {
  let i = at;
  while (i < code.length && /\s/.test(code[i])) i++;

  if (mode === "value") {
    const lit = readLiteral(code, i);
    if (lit) return [lit.value];
  }

  const values: string[] = [];
  let depth = mode === "call" ? 1 : 0;
  if (mode === "value" && code[i] === "{") {
    depth = 1;
    i++;
  }
  while (i < code.length) {
    const lit = readLiteral(code, i);
    if (lit) {
      values.push(lit.value);
      i = lit.end;
      continue;
    }
    const ch = code[i];
    if (OPENERS.includes(ch)) depth++;
    else if (CLOSERS.includes(ch)) {
      depth--;
      if (depth <= 0) break;
    } else if (depth === 0 && (ch === "," || ch === ";")) break;
    i++;
  }
  return values;
}

// ─── Comment stripping ────────────────────────────────────────────────────────
//
// The implementation moved to scripts/lib/stripComments.mjs and is re-exported here so every
// existing importer is unchanged. It moved because a THIRD consumer appeared — the vocabulary
// gate's `blockBody`, which was anchoring on a comment that mentioned `const FILTER_CHIPS` and
// so stopped firing `registry-moved` — and that gate runs under bare `node`, which cannot
// import a .ts module. One copy, three consumers; see the header of the .mjs for why a second
// copy is the failure mode being avoided.

import { stripComments } from "../../scripts/lib/stripComments.mjs";

export { stripComments };

// ─── Anchors ──────────────────────────────────────────────────────────────────
//
// Every anchor either guard uses. Each guard selects the subset that answers ITS question; nothing
// here is switched on by being defined.

/** `href="/x"` · `href: "/x"` · `href={…any expression…}` */
export const HREF_ANCHOR = /\bhref\s*[:=]/g;
/** router.push(…) · router.replace(…) · redirect(…) — a navigation the user never clicks. */
export const NAV_CALL_ANCHOR = /\b(?:router\.(?:push|replace)|redirect)\s*\(/g;
/**
 * The same set plus `new URL(…)`. Used by the reachability guard only — see ONE DELIBERATE
 * DUPLICATE at the top of this file. Do not merge the two without a decision and a test.
 */
export const NAV_CALL_OR_NEW_URL_ANCHOR = /\b(?:router\.(?:push|replace)|redirect|new URL)\s*\(/g;
/** Clerk / Next redirect props: fallbackRedirectUrl="/x", forceRedirectUrl={…} */
export const REDIRECT_PROP_ANCHOR = /\b\w*[Rr]edirect(?:Url|_url)\s*[:=]/g;
/** next.config.ts redirects(): destination: "/x" */
export const DESTINATION_ANCHOR = /\bdestination\s*:/g;
/**
 * The per-screen guide registry's `route: "/x"`. Used by the crawl only: a guide attached to a
 * route must NAME a screen that exists, so in the outbound direction it is a checkable target.
 * Deliberately NOT a reachability source — a guide attached to a route is not a way of reaching it,
 * and reachability has a fixture pinning `{ route: "/drafts" }` as contributing nothing.
 */
export const ROUTE_KEY_ANCHOR = /\broute\s*:/g;

/**
 * The repo's footer link-registry idiom: a `[label, href]` 2-tuple destructured into a link —
 * `{ links: [["Customers", "/customers"], …] }` in both (marketing)/layout.tsx and the home page,
 * rendered as `col.links.map(([label, href]) => <a href={href}>)`. There is no literal
 * `href="/customers"` anywhere, so without this pattern /customers, /changelog and /book-demo read
 * as stranded when all three sit in the footer of every marketing page.
 *
 * This pattern is deliberately NOT "any two adjacent string literals in an array". That looser form
 * credits src/app/sitemap.ts — a bare `["/", "/how-it-works", "/pricing", …]` list — as
 * navigation, which it is not: a sitemap tells a crawler a URL exists, it does not give a user a
 * way to arrive. Both the `/` prefix on the SECOND element and the immediately-following `]` are
 * what keep a sitemap out, and both guards have assertions pinning it.
 */
export const LINK_TUPLE_RE = /\[\s*(["'`])[^"'`]*\1\s*,\s*(["'`])(\/[^"'`]*)\2\s*\]/g;
/** MDX / markdown body link: `[text](/help/x)` */
export const MD_LINK_RE = /\]\((\/[^)\s]*)\)/g;

/**
 * Two extractor shapes. `re`/`group` reads a whole literal out of one regex match (tuples, markdown
 * links). `anchor`/`mode` opens a value region at the anchor and reads every literal inside it.
 */
export type Pattern = { re: RegExp; group: number } | { anchor: RegExp; mode: "call" | "value" };

/**
 * Every path-shaped literal `patterns` finds in `text`, in pattern order, RAW — no filtering and no
 * normalisation, because the two guards normalise differently (see WHAT STAYS OUT above).
 *
 * Extraction is over TEXT rather than a path so the patterns can be unit-tested against
 * hand-written fixtures, which is where both guards pin their extraction decisions.
 *
 * The anchor regexes are module-level and carry `/g`, so `lastIndex` is reset before every scan.
 * That reset is what makes them safe to share: vitest gives each test file its own module registry,
 * files run sequentially within a worker, and extraction is synchronous — but the reset means none
 * of that has to hold.
 */
export function extractRaw(text: string, patterns: Pattern[], syntax: SourceSyntax = "js"): string[] {
  const code = stripComments(text, syntax);
  const masked = maskLiterals(code);
  const found: string[] = [];

  for (const pattern of patterns) {
    if ("re" in pattern) {
      pattern.re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = pattern.re.exec(code)) !== null) found.push(m[pattern.group]);
      continue;
    }
    // Anchors are searched in the MASKED copy so an anchor inside a string is not mistaken for
    // code; offsets index back into the real text.
    pattern.anchor.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.anchor.exec(masked)) !== null) {
      found.push(...literalsInRegion(code, m.index + m[0].length, pattern.mode));
    }
  }
  return found;
}
