// Reading C# string literals out of backend source — ONE copy, two consumers.
//
// WHY IT MOVED HERE. This reader was written for src/test/backendMirror.test.ts (#121), to
// pin the frontend's transform-failure matchers against the sentences
// `OrderTransformService.cs` really writes. It stayed inside that test file because it had
// one caller.
//
// It now has two. src/test/backendCopyVocabulary.test.ts needs the identical reader for a
// different question — not "does this pattern still match" but "does this sentence use a
// word ProcuLink does not ship to users" — over a wider set of C# files. Copying it would
// have re-created the two-strippers hazard scripts/lib/sourceScan.mjs exists to end.
//
// WHY A `grep` CANNOT DO THIS JOB, restated because it is the reason the reader exists at
// all. The messages are written four different ways: a `const string` split across two
// `+`-concatenated literals, `$"…{hole}…"` interpolations, bare literals in ternary
// branches, and wrappers ending in `: {ex.Message}`. Worse, an interpolation hole may
// contain a string literal of its own — `$"lines {string.Join(", ", numbers)} still need
// review."` ends at the `", "` for any naive scanner, which reports two fragments and
// misses the sentence. A substring search would also need the sentence retyped on this
// side, which is the defect these guards exist to catch rather than a way to catch it.

/**
 * One string literal in C# source: its text, and where it sat.
 *
 * `text` is normalised: every interpolation hole becomes `{}` (so `{ex.Message}`
 * and `{effectiveFormat}` read the same), `""` in a verbatim string and `\"` in a
 * regular one become `"`, and `{{` / `}}` become single braces.
 */
export interface CsLiteral {
  text: string;
  start: number;
  end: number;
}

/** Reads ONE literal starting at `start` (which may point at a `$`/`@` prefix). */
export function readCsLiteral(cs: string, start: number): CsLiteral | null {
  let p = start;
  let interpolated = false;
  let verbatim = false;
  while (p < cs.length && (cs[p] === "$" || cs[p] === "@")) {
    if (cs[p] === "$") interpolated = true;
    else verbatim = true;
    p += 1;
  }
  if (cs[p] !== '"') return null;
  p += 1;

  let text = "";
  // Interpolation holes nest, and they can contain string literals of their own —
  // `{string.Join(", ", unresolved)}` is the reason a naive scanner ends the
  // sentence at `", "` and reports two fragments instead of one message.
  let depth = 0;

  while (p < cs.length) {
    const c = cs[p];

    if (depth > 0) {
      if (c === '"') {
        const nested = readCsLiteral(cs, p);
        if (!nested) return null;
        p = nested.end;
        continue;
      }
      if (c === "'") {
        p += 1;
        while (p < cs.length && cs[p] !== "'") p += cs[p] === "\\" ? 2 : 1;
        p += 1;
        continue;
      }
      if (c === "{") depth += 1;
      else if (c === "}") depth -= 1;
      p += 1;
      continue;
    }

    if (c === '"') {
      if (verbatim && cs[p + 1] === '"') {
        text += '"';
        p += 2;
        continue;
      }
      return { text, start, end: p + 1 };
    }
    if (!verbatim && c === "\\") {
      const esc = cs[p + 1];
      text += esc === "n" ? "\n" : esc === "t" ? "\t" : esc === "r" ? "\r" : esc;
      p += 2;
      continue;
    }
    if (interpolated && (c === "{" || c === "}")) {
      if (cs[p + 1] === c) {
        text += c;
        p += 2;
        continue;
      }
      if (c === "{") {
        text += "{}";
        depth = 1;
        p += 1;
        continue;
      }
    }
    text += c;
    p += 1;
  }
  return null; // unterminated
}

/**
 * Every string EXPRESSION in C# source, with `+`-concatenated runs joined.
 *
 * Comments are skipped rather than collected, which is load-bearing: the backend's own C#
 * quotes old messages in its comments, so a reader that collected them would report a
 * reworded sentence as still present and go green on the exact drift it was added to
 * catch. Char literals are skipped for the same reason an apostrophe must not open a
 * string.
 */
export function parseCsStringExpressions(cs: string): string[] {
  return parseCsStringExpressionsWithOffsets(cs).map((e) => e.text);
}

/**
 * As `parseCsStringExpressions`, but each joined run keeps the offset of its FIRST
 * literal so a caller can report `file:line`.
 *
 * Split out rather than folded in because the vocabulary scanner has to print a
 * copy-pasteable `file:line` for every violation it finds — a list of sentences with no
 * locations is not something a backend packet can act on — while the mirror check only
 * ever asks whether a sentence exists.
 */
export function parseCsStringExpressionsWithOffsets(cs: string): { text: string; start: number }[] {
  const literals: CsLiteral[] = [];
  let i = 0;
  while (i < cs.length) {
    const c = cs[i];
    if (c === "/" && cs[i + 1] === "/") {
      while (i < cs.length && cs[i] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && cs[i + 1] === "*") {
      i += 2;
      while (i < cs.length && !(cs[i] === "*" && cs[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    if (c === "'") {
      i += 1;
      while (i < cs.length && cs[i] !== "'") i += cs[i] === "\\" ? 2 : 1;
      i += 1;
      continue;
    }
    if (c === '"' || ((c === "$" || c === "@") && /^[$@]*"/.test(cs.slice(i, i + 3)))) {
      const lit = readCsLiteral(cs, i);
      if (lit) {
        literals.push(lit);
        i = lit.end;
        continue;
      }
    }
    i += 1;
  }

  const joined: { text: string; start: number }[] = [];
  for (let a = 0; a < literals.length; ) {
    let text = literals[a].text;
    let b = a;
    while (b + 1 < literals.length && /^\s*\+\s*$/.test(cs.slice(literals[b].end, literals[b + 1].start))) {
      b += 1;
      text += literals[b].text;
    }
    joined.push({ text, start: literals[a].start });
    a = b + 1;
  }
  return joined;
}

/** The 1-based line number of a character offset. */
export function lineOf(cs: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < cs.length; i += 1) if (cs[i] === "\n") line += 1;
  return line;
}
