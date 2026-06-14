// Pure helper for the live-preview "just-changed line" highlight. No React, no DOM — TDD'd.
//
// The mapper passes the LAST-TOUCHED field key (e.g. "PoNumber" or an output path like
// "SupplierSKU"). We want the rendered output line that mentions that field to flash so the
// user SEES their edit land. The rendered document rarely contains the canonical KEY verbatim
// (CSV has values only; XML has the output path as a tag) — so we match the line that contains
// EITHER the key/path OR its resolved value. This returns the [start,end) char range of the
// matching LINE (the whole line, so the highlight reads as "this row changed"), or null.

/**
 * Find the character range of the first output LINE that mentions `needle`. Returns null when
 * `needle` is empty or not found. The range spans the whole line (newline-to-newline) so the
 * caller can wrap it as one highlighted block.
 */
export function findHighlightRange(content: string, needle: string | null): { start: number; end: number } | null {
  if (!content || !needle) return null;
  const idx = content.indexOf(needle);
  if (idx < 0) return null;
  // Expand to line boundaries.
  let start = content.lastIndexOf("\n", idx);
  start = start < 0 ? 0 : start + 1;
  let end = content.indexOf("\n", idx);
  if (end < 0) end = content.length;
  return { start, end };
}

/**
 * Split `content` into [before, match, after] around the highlighted line. When there's no
 * match, `match` is "" and `before` holds the whole content. Pure string slicing — no regex,
 * no injection risk.
 */
export function splitForHighlight(
  content: string | null,
  needle: string | null,
): { before: string; match: string; after: string } {
  if (content == null) return { before: "", match: "", after: "" };
  const range = findHighlightRange(content, needle);
  if (!range) return { before: content, match: "", after: "" };
  return {
    before: content.slice(0, range.start),
    match: content.slice(range.start, range.end),
    after: content.slice(range.end),
  };
}
