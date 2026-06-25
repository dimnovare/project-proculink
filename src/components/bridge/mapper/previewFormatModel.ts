// Pure helpers for the live-preview EXPLORATORY format toggle. No React, no DOM — TDD'd.
//
// The mapper preview has two modes:
//   • DEFAULT (delivered bytes) — the toggle sits on the connection's real delivered format (or we
//     don't yet know it). The backend renders exactly what the supplier receives (revision authority
//     swaps a pinned connection's format regardless of the toggle).
//   • EXPLORATORY ("what would this order look like as X") — the user picked a format DIFFERENT from
//     the connection's delivered one. We send honorFormat=true so the backend skips the swap and
//     renders the requested format from the canonical order. This is read-only — delivery is
//     unaffected — and the UI labels it clearly as "not the delivered format".
//
// `connectionFormat` is the connection's REAL delivered format, learned authoritatively from a
// default-mode server response. Null until known (e.g. an unpinned order with no defaultFormat) — in
// which case the toggle IS the delivered format and we never explore (default path, byte-identical).

import type { OutputFormatId } from "@/lib/api/types";

/**
 * The structured-standard output formats whose delivered document is produced by a dedicated FIXED
 * transformer — NOT by the OutputNode tree the visual mapper edits. For these, contact/addresses/
 * structure are filled AUTOMATICALLY from the extracted order; a manually ADDED or edited output
 * field in the mapper does NOT change the delivered bytes. Mirrors the backend truth
 * (OrderTransformService: treeIsFixedFormat = Format is CXml or X12; UBL is a structured override
 * where manually-added fields don't reliably land either). The flat formats (csv / json /
 * xml-via-OutputNode) DO honor the mapper and are intentionally excluded.
 */
const STRUCTURED_STANDARD_FORMATS: ReadonlySet<OutputFormatId> = new Set<OutputFormatId>(["cxml", "x12", "ubl"]);

/**
 * Whether the given delivered format is a structured-standard one that ignores the mapper's
 * manually-added/edited output fields (cXML / X12 / UBL). Null/undefined → false (unknown format →
 * assume the mapper is honored, matching today's behavior). Drives the calm "fields are filled
 * automatically" notice in the outgoing pane.
 */
export function ignoresManualOutputFields(format: OutputFormatId | null | undefined): boolean {
  return format != null && STRUCTURED_STANDARD_FORMATS.has(format);
}

/**
 * The display label for a structured-standard format in the notice copy
 * ("a structured format (cXML)"). Falls back to the upper-cased id.
 */
export function structuredFormatLabel(format: OutputFormatId): string {
  switch (format) {
    case "cxml": return "cXML";
    case "x12": return "X12";
    case "ubl": return "UBL";
    default: return (format as string).toUpperCase();
  }
}

/**
 * Decide whether to request EXPLORATORY rendering (honorFormat=true). True only when we KNOW a
 * delivered format AND the chosen toggle differs from it — otherwise the toggle is (or stands in
 * for) the delivered format and the default delivered-bytes path applies.
 */
export function shouldHonorFormat(
  selected: OutputFormatId,
  connectionFormat: OutputFormatId | null,
): boolean {
  return connectionFormat != null && selected !== connectionFormat;
}

/**
 * The honest info-note copy for the preview pane. Returns:
 *   • EXPLORATORY → "Preview as X · not the delivered format (the supplier receives Y)."
 *   • DEFAULT but the server swapped (a pinned connection differs from the toggle, no error/warning)
 *     → the calm "this connection delivers Y …" note.
 *   • otherwise null (no note — the toggle matches the delivered bytes, or a harder warning/error is
 *     already shown).
 *
 * `honored` = whether honorFormat was sent for this render. `selected` = the toggle. `delivered` =
 * the format the server reported rendering. `connectionFormat` = the known delivered format (for the
 * exploratory "supplier receives" naming; falls back to `delivered` if somehow unknown).
 * `hasHarderMessage` = an error/warning is already being shown (suppress the calm default note).
 */
export function previewInfoNote(args: {
  honored: boolean;
  selected: OutputFormatId;
  delivered: OutputFormatId;
  connectionFormat: OutputFormatId | null;
  hasHarderMessage: boolean;
}): string | null {
  const { honored, selected, delivered, connectionFormat, hasHarderMessage } = args;
  if (honored) {
    const supplierGets = (connectionFormat ?? delivered).toUpperCase();
    return `Preview as ${selected.toUpperCase()} · not the delivered format (the supplier receives ${supplierGets}).`;
  }
  if (delivered !== selected && !hasHarderMessage) {
    return `This connection delivers ${delivered.toUpperCase()} — the output format is set by the published revision, so the preview shows ${delivered.toUpperCase()} unless you explore another format.`;
  }
  return null;
}
