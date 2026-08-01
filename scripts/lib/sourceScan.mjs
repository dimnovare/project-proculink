// Literal reading and comment stripping — ONE copy, three consumers.
//
// WHY IT LIVES IN scripts/ RATHER THAN src/test/. The vocabulary gate
// (scripts/check-vocabulary.mjs) runs under bare `node`: package.json's `lint:vocab` is
// `node scripts/check-vocabulary.mjs --all`, and .github/workflows/ci.yml has NO
// `setup-node` step, so the gate executes on whatever node `ubuntu-latest` happens to
// ship. It therefore cannot import a `.ts` module — that would depend on
// `--experimental-strip-types` in a runtime nobody pinned. Plain ESM is the only form all
// three consumers can read.
//
// The alternative was a second copy of these functions, and this repo has already paid for
// that once: `9cea6e5` converged two independently-written source-link extractors onto one
// shared module precisely because a fix to one left the other blind. (`4c7350a` is the
// related lesson from the other direction — one copy, one wrong `prev !== ":"` test.) Two
// copies drift, and the one nobody fixes is the one still shipping the bug.
//
// `src/test/sourceScan.test.ts` asserts this file is the only definition of `stripComments`,
// `maskLiterals` and `readLiteral` under src/ and scripts/, so a re-duplication turns CI red.
//
// THE THREE CONSUMERS, and what each needs:
//
//   • src/test/route-reachability.test.ts (INBOUND — "does anything navigate TO this
//     page?") and src/test/link-crawl.test.ts (OUTBOUND — "does every link we ship land
//     somewhere?"), both via src/test/sourceScan.ts. They need comment stripping so a link
//     that exists only in a comment neither confers reachability nor is blamed for a 404,
//     and they need literal MASKING so `querySelector('a[href="/x"]')` is read as a
//     selector rather than as a link.
//
//   • scripts/check-vocabulary.mjs (the noun budget). `blockBody(src, NAME)` locates a
//     policed registry with `\bconst\s+NAME\b` and takes the FIRST match, so any earlier
//     occurrence of that token captures the anchor and every downstream read — including
//     the `registry-moved` failure that must fire when a registry is renamed or moved —
//     reads the wrong region. A COMMENT quoting the declaration disarmed it once (WP-29
//     wrote one, to explain the pinning no less). Comment stripping alone does not close
//     that: a STRING LITERAL or TEMPLATE LITERAL carrying the same token disarms it
//     identically, which is why the gate masks as well as strips.
//
// TYPES. The `SourceSyntax` union is declared here as a JSDoc `@typedef` rather than in
// the TypeScript re-export, so there is one definition rather than two that can drift.
// tsc reads it through `allowJs` (see tsconfig.json) and `src/test/sourceScan.ts`
// re-exports it, so `stripComments(text, "bogus")` is a type error in every TS consumer
// while bare node ignores the annotation entirely. `src/test/sourceScan.test.ts` pins that
// with a `@ts-expect-error`, which tsc reports as unused the moment the union widens back
// to `string`.

/**
 * The syntax mode a file is scanned in.
 *
 * @typedef {"js" | "mdx"} SourceSyntax
 */

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

/**
 * Read the string/template literal starting at `i`, or null if none starts there.
 *
 * @param {string} text
 * @param {number} i
 * @returns {{ value: string; end: number } | null}
 */
export function readLiteral(text, i) {
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
 *
 * OFFSET PRESERVATION IS THE CONTRACT, not an implementation detail. Each literal is re-emitted as
 * its opening quote + (length - 2) spaces + its closing quote, so `masked.length === code.length`
 * and every index means the same thing in both. Both callers depend on it: `extractRaw` finds an
 * anchor in the masked copy and then reads literals out of the UNMASKED one at that offset, and
 * `blockBody` in scripts/check-vocabulary.mjs finds a declaration and balances brackets in the
 * masked copy but slices its result out of the unmasked one — because its callers need the literal
 * CONTENTS that masking blanks.
 *
 * @param {string} code
 * @returns {string}
 */
export function maskLiterals(code) {
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

// ─── Comment stripping ────────────────────────────────────────────────────────

/**
 * A `/` may begin a regex literal only where a VALUE may begin. This is the standard
 * disambiguation heuristic; it exists so `const re = /\/\//g` is not mistaken for a line comment
 * and used to swallow the rest of the line.
 */
const REGEX_MAY_START_AFTER = /^$|^[(,=:[!&|?{};+\-*%~^<>]$/;

/**
 * A slash pair continues a URL scheme rather than opening a comment ONLY when the colon is
 * IMMEDIATELY adjacent to it and terminates a scheme-shaped identifier — `https://`, `sftp://`,
 * `mailto:` in bare JSX prose.
 *
 * This test used to be `prev !== ":"`, and `prev` is the last NON-WHITESPACE character emitted.
 * Every colon in the language therefore exempted the rest of its line from stripping: `key: // note`,
 * `case "x": // note`, a ternary's `:` and a TS type annotation all left their comment standing, and
 * both link guards then read that comment as live code. A `<Link href="/somewhere">` written in a
 * comment after a colon conferred reachability on a page nothing navigates to — the exact defect
 * stripping exists to prevent, and the shape is idiomatic enough that the repo already carries it
 * (`catalogSourceHelpers.ts`, `sourcePickerModel.ts` — neither currently holding a link).
 *
 * Matched against the RAW text preceding the slash pair, so intervening whitespace defeats it:
 * `https://x` is a scheme, `ready: // x` is a comment.
 */
const URL_SCHEME_COLON = /(?:^|[^A-Za-z0-9+.-])[A-Za-z][A-Za-z0-9+.-]*:$/;

/**
 * Remove comments, so that a link existing ONLY IN A COMMENT can neither confer reachability nor be
 * blamed for a 404.
 *
 * Without this, the cheapest way to fake a link is to write one in a comment: it reads as harmless
 * context in review, and it navigates nobody. The repo already did it by accident —
 * UserChipMenu.tsx:10 is a `//` line describing `signOut({ redirectUrl: "/" })`, and the
 * redirect-prop pattern was scoring it as a real link to `/`.
 *
 * Three things must survive stripping, all data rather than comments: a `//` inside a string
 * literal (`"https://…"` is everywhere), a `://` scheme in bare prose, and a regex literal
 * containing an escaped slash pair (`/\/\//g`).
 *
 * STRING AND TEMPLATE LITERALS SURVIVE BY DESIGN — the link guards read their contents, and that is
 * the whole point of the value regions. It also means stripping is NOT sufficient to tell code from
 * data: a caller that needs "is this token a real declaration" must compose this with
 * `maskLiterals`. See the gate's `blockBody`.
 *
 * MDX gets a narrower treatment: in MDX, `//` is prose — a URL, a fraction, a path in a table cell
 * — and the ONLY comment forms are the JSX expression container (a braced `{/*` block) and the HTML
 * comment. Running the JS stripper over MDX would silently delete the tail of any prose line
 * containing a slash pair, which is the help centre's own copy.
 *
 * @param {string} text
 * @param {SourceSyntax} [syntax]
 * @returns {string}
 */
export function stripComments(text, syntax = "js") {
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

    // String / template literal — copied verbatim. A slash pair inside one is data, and the
    // literal itself is what the link patterns need to read.
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

    // Line comment. `://` is a URL scheme, never a comment — see URL_SCHEME_COLON for why the
    // adjacency matters and why the old `prev !== ":"` form exempted far more than URLs.
    if (c === "/" && next === "/" && !URL_SCHEME_COLON.test(text.slice(Math.max(0, i - 64), i))) {
      while (i < n && text[i] !== "\n") i++;
      continue;
    }

    // Block comment. Newlines are preserved so line-oriented patterns and any future line
    // reporting stay aligned with the real file.
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
        if (ch === "\n") break; // regex literals do not span lines — bail out
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
