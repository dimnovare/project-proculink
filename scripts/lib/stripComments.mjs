// The JS/MDX comment stripper — ONE copy, imported by both consumers.
//
// It lives in scripts/ rather than in src/test/ for a single reason: the vocabulary gate
// (scripts/check-vocabulary.mjs) runs under bare `node`, so it cannot import a .ts module.
// The alternative was a second stripper, and a second stripper is exactly what 4c7350a had
// to fix once already — the "a comment after a colon is still a comment" defect lived in one
// copy while the other was correct.
//
// WHY THE GATE NEEDS IT. `blockBody(src, NAME)` locates a policed registry with
// `new RegExp("\bconst\s+" + NAME + "\b").exec(src)` and takes the FIRST match. A COMMENT
// mentioning `const NAME` above the declaration therefore captures the anchor, and everything
// downstream — including the `registry-moved` failure that is supposed to fire when a registry
// is renamed or moved out of its pinned file — reads the wrong region. WP-29 wrote such a
// comment (to explain the pinning, no less) and disarmed the guard on the one registry it was
// adding a label to: renaming the declaration went from exit 1 to exit 0.
//
// WHY THE LINK GUARDS NEED IT. A link that exists only in a comment navigates nobody, so it
// must neither confer reachability nor be blamed for a 404. See src/test/sourceScan.ts.
//
// Kept in sync by src/test/sourceScan.test.ts (behaviour) and src/lib/vocabulary.test.ts
// (the gate's use of it, against the real registry files).

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
 * MDX gets a narrower treatment: in MDX, `//` is prose — a URL, a fraction, a path in a table cell
 * — and the ONLY comment forms are the JSX expression container (a braced `{/*` block) and the HTML
 * comment. Running the JS stripper over MDX would silently delete the tail of any prose line
 * containing a slash pair, which is the help centre's own copy.
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

