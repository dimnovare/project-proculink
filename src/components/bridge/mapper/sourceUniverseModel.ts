// Pure grouping / filter / relevance helpers for the SourceUniverse pane. No React,
// no DOM — TDD'd in jsdom via sourceUniverseModel-style tests. The rendering component
// (SourceUniverse.tsx) is a thin presentational consumer of these.

import type { SourceField, FieldFilter } from "./types";

/** Display order of the four source groups. Raw (the Phase-1 lossless bag) is LAST. */
const GROUP_ORDER = ["header", "parties", "line", "raw"] as const;

export type SourceGroup = SourceField["group"];

/** Human label + whether the group is collapsed by default (Raw is). */
export const GROUP_META: Record<SourceGroup, { label: string; defaultCollapsed: boolean }> = {
  header: { label: "Header", defaultCollapsed: false },
  parties: { label: "Parties", defaultCollapsed: false },
  line: { label: "Line fields", defaultCollapsed: true },
  raw: { label: "Raw", defaultCollapsed: true },
};

export interface GroupedSource {
  group: SourceGroup;
  fields: SourceField[];
}

/**
 * Bucket fields into the fixed group order, dropping empty groups. Within each group,
 * AI-suggested fields are pinned to the top (relevance ordering) but otherwise stable.
 */
export function groupSourceFields(fields: SourceField[]): GroupedSource[] {
  return GROUP_ORDER.map((group) => ({
    group,
    fields: relevanceSort(fields.filter((f) => f.group === group)),
  })).filter((g) => g.fields.length > 0);
}

/**
 * Stable relevance ordering: AI-suggested fields first (highest confidence first),
 * then the rest in their original order. Pure + total (no mutation of the input).
 */
export function relevanceSort(fields: SourceField[]): SourceField[] {
  return fields
    .map((f, i) => ({ f, i }))
    .sort((a, b) => {
      const aAi = a.f.suggestedFor != null;
      const bAi = b.f.suggestedFor != null;
      if (aAi !== bAi) return aAi ? -1 : 1;
      if (aAi && bAi) {
        const ac = a.f.suggestionConfidence ?? 0;
        const bc = b.f.suggestionConfidence ?? 0;
        if (ac !== bc) return bc - ac;
      }
      return a.i - b.i; // stable
    })
    .map((x) => x.f);
}

/**
 * Filter a field list by a free-text query (matches label OR value, case-insensitive)
 * AND a chip filter. Search is independent of group — a query reveals matching raw/line
 * fields that are otherwise collapsed.
 */
export function filterSourceFields(fields: SourceField[], query: string, filter: FieldFilter): SourceField[] {
  const q = query.trim().toLowerCase();
  return fields.filter((f) => {
    if (q && !(f.label.toLowerCase().includes(q) || f.value.toLowerCase().includes(q))) return false;
    switch (filter) {
      case "mapped":
        return f.mapped;
      case "unmapped":
        return !f.mapped;
      case "ai":
        return f.suggestedFor != null;
      case "hasValue":
        return f.value.trim().length > 0;
      default:
        return true;
    }
  });
}

/** Counts shown on the filter chips (computed over the UNsearched set). */
export function filterCounts(fields: SourceField[]): Record<FieldFilter, number> {
  return {
    all: fields.length,
    unmapped: fields.filter((f) => !f.mapped).length,
    mapped: fields.filter((f) => f.mapped).length,
    ai: fields.filter((f) => f.suggestedFor != null).length,
    hasValue: fields.filter((f) => f.value.trim().length > 0).length,
  };
}
