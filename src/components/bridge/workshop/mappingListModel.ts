// mappingListModel — PURE split of the AI-first mapping list into `auto`
// (mapped-by-AI, collapsed behind the "N mapped by AI · review" toggle) and
// `attention` (the few rows the operator must actually touch). No React, TDD'd.
//
// AI-first contract (spec §"Mapping contract"):
//   • A row is `auto` when it is already committed (`accepted`) OR the AI is
//     confident enough to pre-map it (`confidence >= trustedThreshold`) AND it
//     actually has a source to commit (`source != null`).
//   • Everything else is `attention`: unmapped, or below the calibrated trust
//     threshold — the only rows surfaced for Accept / change-source / drag.
//   • Nothing low-confidence is treated as auto (no silent auto-apply).
//
// `trustedThreshold` comes from the backend calibration response (the lowest
// trusted bucket's lower bound). It is passed in — this module never invents a
// confidence number. Default 0.85 mirrors the spec example.

/** A single output field's mapping state, as the workshop reads it. */
export interface MappingRow {
  /** Output field path being mapped (e.g. "orderNumber", "items[].sku"). */
  outputField: string;
  /** The chosen/suggested source field id or value; null = unmapped. */
  source: string | null;
  /** AI confidence for the suggested source, 0..1 (0 when there is none). */
  confidence: number;
  /** True once the mapping is committed (wired / Accepted / fixed). */
  accepted: boolean;
}

export interface SplitMappingsOptions {
  /** The calibrated trust threshold (0..1). Rows at/above it auto-map. */
  trustedThreshold?: number;
}

export interface SplitMappingsResult<T extends MappingRow> {
  /** Mapped-by-AI rows — collapsed behind the "N mapped by AI" toggle. */
  auto: T[];
  /** Rows that need the operator: unmapped or below the trust threshold. */
  attention: T[];
}

const DEFAULT_TRUSTED_THRESHOLD = 0.85;

/** Is this row confident enough to pre-map without the operator's touch? */
export function isAutoMapped(row: MappingRow, trustedThreshold: number): boolean {
  if (row.accepted) return true;
  // High confidence alone is not enough — there must be a source to commit.
  return row.source != null && row.confidence >= trustedThreshold;
}

/**
 * Split mapping rows into `auto` (collapsed) and `attention` (surfaced), keeping
 * input order within each bucket. Generic over `MappingRow` so the caller can
 * carry extra per-row fields (provenance, reason, scope) through unchanged.
 */
export function splitMappings<T extends MappingRow>(
  suggestions: readonly T[],
  options: SplitMappingsOptions = {},
): SplitMappingsResult<T> {
  const trustedThreshold = options.trustedThreshold ?? DEFAULT_TRUSTED_THRESHOLD;
  const auto: T[] = [];
  const attention: T[] = [];
  for (const row of suggestions) {
    if (isAutoMapped(row, trustedThreshold)) auto.push(row);
    else attention.push(row);
  }
  return { auto, attention };
}
