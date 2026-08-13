// Pure model for the OutgoingPane's "picker" mapping mode (the founder-chosen inline source picker
// per output row — drag-wires become optional). No React, no DOM — TDD'd in jsdom.
//
// In picker mode each OUTPUT row shows its SOURCE as a searchable dropdown: pick an incoming field
// (typeahead) to SET the mapping, with "Fixed value…", the AI suggestion (pre-filled), and "Clear"
// as first-class options. Picking a source reuses the EXISTING wire-connect dispatch — this model
// only derives WHAT to show; it never mutates the override. The save contract is unchanged.

import type { SourceField, TargetField } from "./types";
import type { OutgoingFieldStatus } from "./outgoingStatusModel";
import type { SuggestionBasis } from "./suggestionBasisModel";

/** One selectable source in an output row's picker. */
export interface SourcePickerOption {
  /** The incoming row id (canonical key or raw token id) — the dispatch sourceId. */
  id: string;
  /** Human label (the incoming field's label). */
  label: string;
  /** A short value preview (the incoming field's value), truncated by the view. */
  value: string;
  /** "header" | "parties" | "line" | "raw" — drives grouping in the dropdown. */
  group: SourceField["group"];
  /** True when this option is the suggested source for the row (badge + pre-fill). */
  suggested: boolean;
  /** The suggestion's score (0..1), or `null` when nothing scored it. Never a stand-in number. */
  confidence: number | null;
  /**
   * What produced the suggestion — "model" (a scorer ran) or "saved_mapping" (read back from
   * the supplier's saved PO mapping, which carries no score). Views must not print a
   * percentage for the latter; `suggestionConfidenceDisplay` decides.
   */
  basis: SuggestionBasis | null;
}

/**
 * The incoming fields offered as sources for ONE output field, filtered by a free-text query and
 * ordered: the AI suggestion first (if any), then header → parties → line → raw, stable within a
 * group. Matches the incoming field's label OR value (case-insensitive), like the incoming search.
 *
 * `suggestedSourceId` is the incoming id the AI proposed for THIS output (resolved by the caller
 * from the fields' `suggestedFor`), so the option is flagged + floated to the top.
 */
const GROUP_ORDER: Record<SourceField["group"], number> = { header: 0, parties: 1, line: 2, raw: 3 };

export function buildSourceOptions(
  incomingFields: ReadonlyArray<SourceField>,
  query: string,
  suggestedSourceId: string | null,
): SourcePickerOption[] {
  const q = query.trim().toLowerCase();
  const opts: SourcePickerOption[] = incomingFields
    .filter((f) => !q || f.label.toLowerCase().includes(q) || f.value.toLowerCase().includes(q))
    .map((f) => ({
      id: f.id,
      label: f.label,
      value: f.value,
      group: f.group,
      suggested: f.id === suggestedSourceId,
      confidence: f.id === suggestedSourceId ? f.suggestionConfidence ?? null : null,
      basis: f.id === suggestedSourceId ? f.suggestionBasis ?? null : null,
    }));
  return opts
    .map((o, i) => ({ o, i }))
    .sort((a, b) => {
      if (a.o.suggested !== b.o.suggested) return a.o.suggested ? -1 : 1;
      const ga = GROUP_ORDER[a.o.group], gb = GROUP_ORDER[b.o.group];
      if (ga !== gb) return ga - gb;
      return a.i - b.i; // stable within a group
    })
    .map((x) => x.o);
}

/** The incoming id suggested for an output path, or null. The suggestion lives on the
 *  incoming field (`suggestedFor === outputPath`); first match wins. `basis` travels with
 *  `confidence` so the caller can tell a real score from a saved-mapping read-back. */
export function suggestedSourceFor(
  outputPath: string,
  incomingFields: ReadonlyArray<SourceField>,
): { id: string; label: string; confidence: number | null; basis: SuggestionBasis | null } | null {
  for (const f of incomingFields) {
    if (f.suggestedFor === outputPath) {
      return {
        id: f.id,
        label: f.label,
        confidence: f.suggestionConfidence ?? null,
        basis: f.suggestionBasis ?? null,
      };
    }
  }
  return null;
}

/** The short label shown ON the picker chip for the row's CURRENT binding. Mirrors the honest
 *  status: wired → the source field; fixed → "= value"; auto → "auto (1:1)"; none → "Pick a field". */
export function currentSourceLabel(status: OutgoingFieldStatus): string {
  switch (status.kind) {
    case "wired":
      // status.source is "← Label"; strip the arrow for the chip.
      return status.source?.replace(/^←\s*/, "") ?? "Mapped";
    case "fixed":
      return status.source ?? "Fixed value";
    case "auto":
      return "Auto (1:1)";
    default:
      return "Pick a field";
  }
}

/** True when the row has NO source yet (the chip reads as a call-to-action, not a value). */
export function isUnsourced(status: OutgoingFieldStatus): boolean {
  return status.kind === "none";
}

/** Helper for the view: a per-field convenience bundle (kept tiny + pure). */
export function pickerRowModel(
  field: TargetField,
  status: OutgoingFieldStatus,
  incomingFields: ReadonlyArray<SourceField>,
): { suggested: ReturnType<typeof suggestedSourceFor>; currentLabel: string; unsourced: boolean } {
  return {
    suggested: suggestedSourceFor(field.outputPath, incomingFields),
    currentLabel: currentSourceLabel(status),
    unsourced: isUnsourced(status),
  };
}
