// Link extraction for the source-scanning link gates.
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
// APPROACH. Lifted from the route-reachability guard on branch `wp04/route-reachability-fe`, which
// solves the INVERSE problem ("does anything navigate TO this page?") and had already paid for this
// machinery: comment stripping (separate JS and MDX modes), string-literal masking so an
// anchor-shaped substring inside a literal cannot open a region, and balanced value-region reading
// so `href={cond ? "/a" : "/b"}` yields both. Reimplemented here rather than imported because that
// branch is unmerged; when it lands, its extractor should be deleted in favour of this module
// instead of the two drifting apart.
//
// The three decisions that keep this from over-reporting, each with a test in link-crawl.test.ts:
//   • comments are stripped — a link in a comment navigates nobody, so it must not be crawled
//     (and, symmetrically, must not be blamed for a 404);
//   • literals are masked before anchors are searched — `querySelector('a[href="/x"]')` is a
//     selector, not a link;
//   • an `href="/x" title="y"` region is exactly ONE literal, and `{ href: "/a", other: "/b" }`
//     stops at `/a` — widening either would swallow the next attribute or the sibling key.

export type SourceSyntax = "js" | "mdx";

/** Read the string/template literal starting at `i`, or null if none starts there. */
function readLiteral(text: string, i: number): { value: string; end: number } | null {
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
 * Anchors are searched in this masked copy, so an anchor-shaped substring that is really DATA
 * cannot open a region. Offsets are identical in both copies.
 */
function maskLiterals(code: string): string {
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
 *   • `value` — an `href=` / `href:` value. A quote means exactly ONE literal (otherwise
 *               `href="/x" title="y"` swallows the next JSX attribute); a `{` means the balanced
 *               brace expression; anything else runs to the first `,` `;` or closer at depth zero.
 */
function literalsInRegion(code: string, at: number, mode: "call" | "value"): string[] {
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

/** A `/` may begin a regex literal only where a VALUE may begin. */
const REGEX_MAY_START_AFTER = /^$|^[(,=:[!&|?{};+\-*%~^<>]$/;

/**
 * Remove comments so a link that exists only in a comment is neither crawled nor blamed.
 *
 * Three things must survive: a `//` inside a string literal (`"https://…"`), a `://` scheme in
 * prose, and a regex literal containing an escaped slash pair (`/\/\//g`).
 *
 * MDX gets a narrower treatment: there, `//` is prose (a URL, a path in a table cell), and the only
 * comment forms are the braced JSX expression container and the HTML comment. Running the JS
 * stripper over MDX would silently delete the tail of any help-centre line containing a slash pair.
 */
export function stripComments(text: string, syntax: SourceSyntax = "js"): string {
  if (syntax === "mdx") {
    return text.replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ").replace(/<!--[\s\S]*?-->/g, " ");
  }

  let out = "";
  let prev = ""; // last non-whitespace character emitted
  let i = 0;
  const n = text.length;

  while (i < n) {
    const c = text[i];
    const next = text[i + 1];

    // String / template literal — copied verbatim.
    if (c === '"' || c === "'" || c === "`") {
      out += c;
      i++;
      while (i < n) {
        if (text[i] === "\\") {
          out += text.slice(i, i + 2);
          i += 2;
          continue;
        }
        const ch = text[i];
        out += ch;
        i++;
        if (ch === c) break;
      }
      prev = c;
      continue;
    }

    // Line comment. `://` is a URL scheme, never a comment.
    if (c === "/" && next === "/" && prev !== ":") {
      while (i < n && text[i] !== "\n") i++;
      continue;
    }

    // Block comment. Newlines preserved so offsets stay roughly aligned with the real file.
    if (c === "/" && next === "*") {
      i += 2;
      while (i < n && !(text[i] === "*" && text[i + 1] === "/")) {
        if (text[i] === "\n") out += "\n";
        i++;
      }
      i += 2;
      continue;
    }

    // Regex literal — consumed whole so its contents cannot be re-read as a comment opener.
    if (c === "/" && REGEX_MAY_START_AFTER.test(prev)) {
      out += c;
      i++;
      let inClass = false;
      while (i < n) {
        if (text[i] === "\\") {
          out += text.slice(i, i + 2);
          i += 2;
          continue;
        }
        const ch = text[i];
        if (ch === "\n") break; // regex literals do not span lines
        out += ch;
        i++;
        if (ch === "[") inClass = true;
        else if (ch === "]") inClass = false;
        else if (ch === "/" && !inClass) break;
      }
      prev = "/";
      continue;
    }

    out += c;
    if (!/\s/.test(c)) prev = c;
    i++;
  }

  return out;
}

/** `href="/x"` · `href: "/x"` · `href={…any expression…}` */
const HREF_ANCHOR = /\bhref\s*[:=]/g;
/** router.push(…) · router.replace(…) · redirect(…) — a navigation the user never clicks. */
const NAV_CALL_ANCHOR = /\b(?:router\.(?:push|replace)|redirect)\s*\(/g;
/** Clerk / Next redirect props: fallbackRedirectUrl="/x", forceRedirectUrl={…} */
const REDIRECT_PROP_ANCHOR = /\b\w*[Rr]edirect(?:Url|_url)\s*[:=]/g;
/** The per-screen guide registry's `route: "/x"`, which must name a screen that exists. */
const ROUTE_KEY_ANCHOR = /\broute\s*:/g;

/** The footer's `[label, href]` 2-tuple idiom — there is no literal `href=` anywhere for these. */
const LINK_TUPLE_RE = /\[\s*(["'`])[^"'`]*\1\s*,\s*(["'`])(\/[^"'`]*)\2\s*\]/g;
/** MDX / markdown body link: `[text](/help/x)` */
const MD_LINK_RE = /\]\((\/[^)\s]*)\)/g;

type Pattern =
  | { re: RegExp; group: number }
  | { anchor: RegExp; mode: "call" | "value" };

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
 */
export function extractLinks(text: string, syntax: SourceSyntax = "js"): string[] {
  const code = stripComments(text, syntax);
  const masked = maskLiterals(code);
  const found: string[] = [];

  for (const pattern of PATTERNS) {
    if ("re" in pattern) {
      pattern.re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = pattern.re.exec(code)) !== null) found.push(m[pattern.group]);
      continue;
    }
    pattern.anchor.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.anchor.exec(masked)) !== null) {
      found.push(...literalsInRegion(code, m.index + m[0].length, pattern.mode));
    }
  }
  return found;
}

/** The syntax mode for a file path. */
export function syntaxFor(file: string): SourceSyntax {
  return file.endsWith(".mdx") ? "mdx" : "js";
}
