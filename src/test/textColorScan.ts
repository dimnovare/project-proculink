/**
 * textColorScan.ts — "is this colour being used as TEXT?", answered from source.
 *
 * WHY IT IS NOT ONE REGEX ANY MORE.
 * The rule this replaces was repo-wide in FILE scope and narrow in SYNTAX scope:
 *
 *     /\b(?:color|fg)\s*:\s*(?:[^,;}\n]*\?\s*)?["'`](?:var\(--amber\)|#B36D14)["'`]/i
 *
 * It required the property name, then a QUOTE, then the literal, all ON ONE LINE.
 * Eight genuine spellings walked past it, each reproduced against a fixture:
 *
 *   1. variable indirection      const TONE = <banned>;  …  color: TONE
 *   2. a non-`fg` map key        { tone: <banned> }      …  color: t.tone
 *   3. a ternary's ELSE branch   color: on ? "#0B1A2F" : <banned>
 *   4. a token utility class     className="text-amber"
 *   5. an arbitrary class        className="text-[<banned>]"
 *   6. an SVG text fill          <text fill=<banned>>42</text>
 *   7. a template literal        style={`color:<banned>`}
 *   8. EVERY .css FILE           color: var(--amber);   ← CSS never quotes, and the
 *                                                        regex demanded a quote
 *
 * (8) is the one worth staring at: the rule was advertised as repo-wide, `.css` was
 * in the walked file set, and not one `.css` declaration could ever match it. File
 * scope and syntax scope are different things, and only one of them was checked.
 *
 * THIS MODULE HOLDS NO COLOUR LITERALS. Every value is a parameter. That is
 * deliberate and it is the TRAP-26 lesson generalised: a guard that spells out the
 * value it bans becomes a file that contains that value, and something else — a
 * compiler's content scanner, another guard's repo-wide sweep — will read it. The
 * literals live in the test that calls this, which every scanner already excludes.
 *
 * WHAT THIS SCANNER DOES NOT DO — read this before quoting a green run.
 *   1. IT DOES NOT FOLLOW A MAP THROUGH AN INDEX. `const TONES = { amber: <banned> }`
 *      followed by `color: TONES[tone]` is NOT caught. The binding is found, but the
 *      use site names `TONES`, not `amber`, and resolving which key a runtime index
 *      selects is data-flow analysis, not text matching. This is the single largest
 *      hole and it is where the app actually keeps its colours — so it is covered a
 *      different way: by RESOLVED-VALUE pair assertions in token-contrast.test.ts,
 *      which compute the ratio rather than guess the spelling.
 *   2. ONE LEVEL OF INDIRECTION ONLY. `a = banned; b = a; color: b` is missed.
 *   3. IT CANNOT SEE COMPOSITION. A colour assembled at runtime (`"#" + hex`,
 *      `` `#${x}` ``, `color-mix()`) is invisible to any source-text scanner.
 *   4. IT DOES NOT KNOW WHAT IS BEHIND THE TEXT. It answers "is this a text slot",
 *      never "does it pass". Contrast needs both colours; see token-contrast.test.ts.
 */

import { stripComments, syntaxFor } from "./sourceScan";

export interface ScanFile {
  rel: string;
  text: string;
}

/**
 * How much of the offending line a hit carries.
 *
 * EXPORTED because callers match exemptions against `hit.text`, and an exemption
 * anchor longer than this can never match — it silently stops forgiving the site
 * it was written for, which looks like a real failure and wastes the reader's
 * time on a phantom. Seen once: WP-27 lengthened two BridgeDashboard rows past
 * 120 characters and both exemptions went dark. A test asserts every anchor
 * stays under it.
 */
export const REPORT_LINE_CHARS = 120;

export interface TextColorHit {
  rel: string;
  /** 1-based. */
  line: number;
  /** Which detector fired — named so a failure says WHY, not just where. */
  spelling: string;
  /** The offending source line, trimmed to REPORT_LINE_CHARS. */
  text: string;
}

/**
 * A banned value in every notation source can spell it.
 * `hex` is the literal; `cssVar` is the custom property that resolves to it (omit
 * when there is none); `utility` is the Tailwind colour-key (`amber` matches
 * `text-amber` but never `text-amber-text`).
 */
export interface BannedValue {
  hex: string;
  cssVar?: string;
  utility?: string;
}

/** Regex-escape a literal. */
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Alternation matching any spelling of the value itself: the hex, or `var(--x)`
 * with the whitespace CSS permits inside the parens.
 */
function valuePattern(v: BannedValue): string {
  const parts = [esc(v.hex)];
  if (v.cssVar) parts.push(`var\\(\\s*${esc(v.cssVar)}\\s*\\)`);
  return `(?:${parts.join("|")})`;
}

/**
 * Property names whose value IS the glyph colour.
 *
 * `fg` is this repo's own convention for "the foreground half of a tone pair" and
 * lands in `color:` at the render site. The lookbehind is what keeps `borderColor`
 * and `backgroundColor` out: in `borderColor` the character before `Color` is a
 * word character, so the slot does not open. That distinction is load-bearing —
 * this value is LEGAL as a border, a dot and a stroke (it clears the 3:1 non-text
 * floor); it is only banned as text.
 */
const TEXT_PROP = "(?<![\\w-])(?:color|fg|textColor|textFillColor)\\s*:";

/**
 * Everything from the colon up to the value. `[^,;}\n]*` is what admits the
 * spellings the quoted version demanded:
 *   • no quote at all       → `.notice { color: var(--amber); }` in a .css file
 *   • either ternary branch → `color: on ? "#0B1A2F" : <banned>`  (a ternary has
 *                             no comma, so the class never has to cross one)
 *   • a template literal    → style={`color:<banned>`}
 * Stopping at `,` `;` `}` and the newline is what keeps
 * `{ color: "#111827", background: <banned> }` from reading as a hit: the scan
 * cannot walk out of one property's value and into the next.
 */
const UP_TO_VALUE = "[^,;}\\n]*";

/** `<text>`/`<tspan>` opening tags, brace- and quote-aware.
 *
 *  A regex cannot find these alone — `>` occurs inside JSX expressions
 *  (`x={a > b}`) and inside quoted attributes (`aria-label="a > b"`), and either
 *  ends the tag early, before the scan ever reaches `fill`. Brace depth AND quote
 *  state are both tracked, the same way scripts/check-tokens.mjs finds `<button`
 *  tags, and for the same reason: the first version of that one let a real
 *  violation straight through. */
export function svgTextTags(src: string): Array<{ tag: string; line: number }> {
  const out: Array<{ tag: string; line: number }> = [];
  const re = /<(?:text|tspan)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    let depth = 0;
    let quote: string | null = null;
    let end = -1;
    for (let i = m.index; i < src.length; i += 1) {
      const ch = src[i];
      if (quote !== null) {
        if (ch === "\\") i += 1;
        else if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") quote = ch;
      else if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
      else if (ch === ">" && depth === 0) {
        end = i;
        break;
      }
    }
    if (end === -1) continue;
    out.push({ tag: src.slice(m.index, end + 1), line: src.slice(0, m.index).split("\n").length });
  }
  return out;
}

/**
 * Identifiers and CSS custom properties BOUND to the banned value in this file:
 *   `const TONE = <banned>` / `let` / `var`
 *   `tone: <banned>`            — an object property, whatever its key is called
 *   `--my-amber: <banned>`      — a CSS custom property aliasing another
 * Returned as regex-ready alternatives so the slot detectors can be re-run
 * against the NAME instead of the value. One level; see the header.
 */
function boundNames(text: string, value: string): string[] {
  const names = new Set<string>();
  const decl = new RegExp(`\\b(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*(?::[^=]*)?=\\s*["'\`]?${value}`, "g");
  const prop = new RegExp(`([A-Za-z_$][\\w$]*)\\s*:\\s*["'\`]?${value}`, "g");
  const cssv = new RegExp(`(--[a-z0-9-]+)\\s*:\\s*${value}`, "gi");
  for (const re of [decl, prop]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      // A one-character name is too weak to match on without noise.
      if (m[1].length >= 2) names.add(`\\b${esc(m[1])}\\b`);
    }
  }
  let m: RegExpExecArray | null;
  while ((m = cssv.exec(text)) !== null) {
    names.add(`var\\(\\s*${esc(m[1])}\\s*\\)`);
  }
  return [...names];
}

/**
 * Every text-slot use of `banned` across `files`.
 *
 * `allow` is a predicate over `rel` for files that legitimately name the value
 * (a token DEFINITION file cannot avoid it). It is deliberately a predicate and
 * not a path list, so an exemption has to be written as a rule with a reason.
 */
export function scanTextColorUses(
  files: ScanFile[],
  banned: BannedValue,
  allow: (rel: string) => boolean = () => false,
): TextColorHit[] {
  const value = valuePattern(banned);
  const out: TextColorHit[] = [];

  for (const source of files) {
    const { rel } = source;
    if (allow(rel)) continue;
    // COMMENTS ARE STRIPPED, and that is the OPPOSITE of what
    // scripts/check-tokens.mjs does — deliberately, because the two rules ask
    // different questions. That gate asks "is a banned literal written down
    // anywhere", where a stale palette comment is itself the drift it hunts.
    // This one asks "does this RENDER as text", and a comment renders nothing.
    // Without the strip, this module's own header — which has to describe the
    // spellings it catches — is six violations of its own rule.
    // stripComments keeps newlines and copies string literals verbatim, so
    // reported line numbers stay aligned with the real file and a fixture
    // string is still visible.
    const text = stripComments(source.text, syntaxFor(rel));
    const lines = text.split(/\r?\n/);

    // The value itself, plus anything this file binds it to. Both go through the
    // SAME slot detectors — the indirection is in what is matched, never in a
    // second, weaker rule.
    const targets: Array<[string, string]> = [[value, "literal"]];
    for (const name of boundNames(text, value)) targets.push([name, "indirect"]);

    const push = (line: number, spelling: string) =>
      out.push({ rel, line, spelling, text: (lines[line - 1] ?? "").trim().slice(0, REPORT_LINE_CHARS) });

    for (const [target, kind] of targets) {
      const declSlot = new RegExp(`${TEXT_PROP}${UP_TO_VALUE}${target}`, "i");
      lines.forEach((line, i) => {
        if (declSlot.test(line)) push(i + 1, `${kind} in a text property (color:/fg:)`);
      });

      // An SVG <text>/<tspan> fill or stroke IS the glyph colour. Checked over the
      // whole tag, because a JSX tag is routinely spread across many lines.
      for (const { tag, line } of svgTextTags(text)) {
        if (new RegExp(`(?:fill|stroke)\\s*=\\s*[^\\s>]*${target}`, "i").test(tag)) {
          push(line, `${kind} as the fill/stroke of an SVG <text>`);
        }
      }
    }

    // Tailwind text utilities. `text-amber` must match `hover:text-amber` and
    // `md:text-amber` but NEVER `text-amber-text` / `text-amber-soft`, which are
    // the CORRECT tokens — hence the trailing lookahead.
    if (banned.utility) {
      const util = new RegExp(`(?<![\\w-])text-${esc(banned.utility)}(?![\\w-])`, "");
      const arb = new RegExp(`(?<![\\w-])text-\\[\\s*${esc(banned.hex)}\\s*\\]`, "i");
      lines.forEach((line, i) => {
        if (util.test(line)) push(i + 1, `the text-${banned.utility} utility class`);
        if (arb.test(line)) push(i + 1, "an arbitrary text-[…] class");
      });
    }
  }

  // One line can trip two detectors; report each site once.
  const seen = new Set<string>();
  return out.filter((h) => {
    const key = `${h.rel}:${h.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
