// Pure model for the INCOMING pane (the NEW left column that replaces SourceUniverse).
// No React, no DOM — TDD'd in jsdom.
//
// The structural redesign's core idea: the left pane shows the order's ACTUAL INCOMING DATA
// (real values), not an abstract "source fields" list that is empty for API-ingress orders.
// Those values are exactly the order's SourceToken set — the backend already derives that set
// from the order's canonical values (+ the Phase-1 SourceCapture raw bag), so it is NEVER
// empty when the order has parsed data.
//
// This module reuses the shipped sourceUniverseModel grouping/filter/relevance logic verbatim
// (so search + the filter chips behave identically) and only re-labels the four groups for the
// incoming framing (Header / Parties / Line items / Raw extras). Each row keeps its stable
// `id` (the SourceToken id) — the interaction agent uses it as the wire anchor `sourceId`.

import type { SourceField, FieldFilter } from "./types";
import {
  groupSourceFields,
  filterSourceFields,
  filterCounts,
  relevanceSort,
  type SourceGroup,
  type GroupedSource,
} from "./sourceUniverseModel";

/** Incoming-framed group labels + default-collapsed flags (Raw extras collapsed). */
export const INCOMING_GROUP_META: Record<SourceGroup, { label: string; defaultCollapsed: boolean }> = {
  header: { label: "Header", defaultCollapsed: false },
  parties: { label: "Parties", defaultCollapsed: false },
  line: { label: "Line items", defaultCollapsed: false },
  raw: { label: "Raw extras", defaultCollapsed: true },
};

export type { SourceGroup, GroupedSource };

/**
 * The grouped, filtered, relevance-sorted rows the IncomingPane renders. A thin wrapper over
 * the source-universe pipeline so the two stay behaviourally identical (the redesign changes
 * the VIEW, not the filter semantics). Empty groups are dropped; Raw extras is last.
 */
export function buildIncomingGroups(
  fields: SourceField[],
  query: string,
  filter: FieldFilter,
): GroupedSource[] {
  const filtered = filterSourceFields(fields, query, filter);
  return groupSourceFields(filtered);
}

/** Filter-chip counts (computed over the UNsearched set) — reused verbatim. */
export function incomingFilterCounts(fields: SourceField[]): Record<FieldFilter, number> {
  return filterCounts(fields);
}

/** Re-export for the rare caller that needs a flat relevance-sorted list (e.g. a11y order). */
export { relevanceSort };

/**
 * Whether the incoming pane has ANY value-bearing rows. Drives the honest empty state: an
 * order with parsed data always has tokens; only a truly source-less order (rare) is empty.
 */
export function hasIncomingData(fields: SourceField[]): boolean {
  return fields.length > 0;
}

/**
 * A stable per-row anchor id the interaction agent wires against. Today it IS the token id;
 * kept as a named helper so a future change of address scheme touches one place.
 */
export function incomingAnchorId(field: SourceField): string {
  return field.id;
}
