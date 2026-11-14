// Pure helpers for the mapper's output-format notices. No React, no DOM — TDD'd.
//
// (2026-11-14: `shouldHonorFormat`, the exploratory format-toggle decision, went with the preview
// pane's toggle — the flow preview ignores the requested format, so the toggle changed nothing.)

import type { OutputFormatId } from "@/lib/api/types";

/**
 * The structured-standard output formats whose delivered document is produced by a dedicated FIXED
 * transformer — NOT by the OutputNode tree the visual mapper edits. For these, contact/addresses/
 * structure are filled AUTOMATICALLY from the extracted order; a manually ADDED or edited output
 * field in the mapper does NOT change the delivered bytes. Mirrors the backend truth
 * (the fixed-format transform: Format is CXml or X12; UBL is a structured override
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
