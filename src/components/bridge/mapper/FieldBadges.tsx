"use client";

// FieldBadges — the per-output-row enrichment strip (Task 9): catalog/validation badges,
// the catalog-price inline action, and the manipulator (fx) pill cluster. Rendered by
// TargetLane's `badgeSlot` so each output field shows, inline and on demand:
//
//   • teal "catalog" chip   — this line's value is enriched from the supplier catalog
//     (tooltip shows the catalog code). Drawn when a CatalogPriceHint exists for the line.
//   • green ✓ validated      — the field passed validation (compact dot, no noise).
//   • amber ⚠ review         — validation flagged it; tooltip shows the reason. A BLOCKING
//     review gates the Deliver button (the shell reads hasBlockingReview()).
//   • catalog-price action   — "Use catalog €X (PO €Y, +Z%)" one-click button that appends a
//     fixed-value manipulator (a SUGGESTION, never silent — spec Decision 6).
//   • manipulator pills      — the field's fieldManipulators as editable pills + a
//     "+ transform" dropdown, lifted from OutputMappingEditor (ManipChip semantics).
//
// ManipPill is declared at MODULE scope (not inside the component) — the documented
// focus-loss bug: a sub-component re-declared on each render gets a new identity and
// remounts its <input>, losing focus on every keystroke.

import type { ManipulatorEntry, FieldValidationState, CatalogPriceHint } from "@/lib/api/types";
import { MANIPULATOR_TYPES } from "@/lib/api/types";
import { catalogActionLabel } from "./fieldBadgesModel";

// ── Module-scope manipulator pill (stable identity → inputs keep focus) ─────────
function ManipPill({ entry, onChange, onRemove }: {
  entry: ManipulatorEntry; onChange: (e: ManipulatorEntry) => void; onRemove: () => void;
}) {
  const spec = MANIPULATOR_TYPES.find((t) => t.type === entry.type);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "#EEE7FB", border: "1px solid #DACEF3", borderRadius: 6, padding: "2px 5px" }}>
      <span title={spec?.hint} style={{ fontSize: 10, fontWeight: 700, color: "#5E3DB0" }}>{entry.type}</span>
      {(spec?.params ?? []).map((p, i) => (
        <input
          key={i}
          value={entry.params[i] ?? ""}
          onChange={(e) => { const params = [...entry.params]; params[i] = e.target.value; onChange({ ...entry, params }); }}
          placeholder={p}
          aria-label={`${entry.type} ${p}`}
          style={{ width: 56, minHeight: 22, border: "1px solid #C4ABE8", borderRadius: 4, padding: "1px 4px", fontSize: 10, fontFamily: "'JetBrains Mono',monospace" }}
        />
      ))}
      <button type="button" onClick={onRemove} aria-label={`Remove ${entry.type}`} style={{ border: "none", background: "transparent", color: "#8E7CB8", cursor: "pointer", fontSize: 11, lineHeight: 1 }}>✕</button>
    </span>
  );
}

export interface FieldBadgesProps {
  /** Validation outcome for this field key/path, or null when clean/unknown. */
  validation?: FieldValidationState | null;
  /** Catalog variance hint for this field's line, or null when none. */
  catalogHint?: CatalogPriceHint | null;
  /** The field's current manipulator chain (the fx applied before delivery). */
  manipulators?: ManipulatorEntry[];
  /** Replace the field's manipulator chain (persists via the model). */
  onManipulatorsChange?: (next: ManipulatorEntry[]) => void;
  /** Apply the catalog-price suggestion (the host writes a fixed-value/Multiply manipulator). */
  onUseCatalogPrice?: (hint: CatalogPriceHint) => void;
  readOnly?: boolean;
}

export function FieldBadges({
  validation,
  catalogHint,
  manipulators = [],
  onManipulatorsChange,
  onUseCatalogPrice,
  readOnly,
}: FieldBadgesProps) {
  const showReview = validation?.state === "review";
  const showValid = validation?.state === "valid";
  const showCatalogChip = !!catalogHint;
  const actionLabel = catalogActionLabel(catalogHint);
  const canEditManips = !readOnly && !!onManipulatorsChange;
  const hasAnything = showReview || showValid || showCatalogChip || !!actionLabel || manipulators.length > 0 || canEditManips;

  if (!hasAnything) return null;

  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 5 }}>
      {/* Validation badge */}
      {showReview && (
        <span
          title={validation?.reason ?? "Needs review"}
          style={{
            display: "inline-flex", alignItems: "center", gap: 3, fontSize: 9.5, fontWeight: 700,
            color: "#9A6B00", background: "#FFF7E6", border: "1px solid #F1E2BE", borderRadius: 4, padding: "1px 6px",
          }}
        >
          <span aria-hidden>⚠</span>
          {validation?.blocking ? "Review (blocks)" : "Review"}
        </span>
      )}
      {showValid && (
        <span
          title="Validated"
          aria-label="Validated"
          style={{
            display: "inline-flex", alignItems: "center", gap: 3, fontSize: 9.5, fontWeight: 700,
            color: "#1E6D29", background: "#EAF6EC", border: "1px solid #CDE7D1", borderRadius: 4, padding: "1px 6px",
          }}
        >
          <span aria-hidden>✓</span>
          Validated
        </span>
      )}

      {/* Teal catalog chip */}
      {showCatalogChip && (
        <span
          title={`From catalog: ${catalogHint?.catalogCode}`}
          style={{
            display: "inline-flex", alignItems: "center", gap: 3, fontSize: 9.5, fontWeight: 700,
            color: "#0E6E73", background: "#E2F4F4", border: "1px solid #BBE3E3", borderRadius: 4, padding: "1px 6px",
            fontFamily: "'JetBrains Mono',monospace",
          }}
        >
          catalog · {catalogHint?.catalogCode}
        </span>
      )}

      {/* Catalog-price inline action (a suggestion, never silent) */}
      {actionLabel && onUseCatalogPrice && !readOnly && (
        <button
          type="button"
          onClick={() => catalogHint && onUseCatalogPrice(catalogHint)}
          style={{
            display: "inline-flex", alignItems: "center", gap: 3, fontSize: 9.5, fontWeight: 700,
            color: "#1E66C9", background: "#FFFFFF", border: "1px solid #BBD2F2", borderRadius: 4,
            padding: "2px 7px", cursor: "pointer",
          }}
        >
          {actionLabel}
        </button>
      )}

      {/* Manipulator (fx) pills + the + transform dropdown */}
      {manipulators.map((m, mi) => (
        <ManipPill
          key={mi}
          entry={m}
          onChange={(next) => onManipulatorsChange?.(manipulators.map((x, i) => (i === mi ? next : x)))}
          onRemove={() => onManipulatorsChange?.(manipulators.filter((_, i) => i !== mi))}
        />
      ))}
      {canEditManips && (
        <select
          value=""
          aria-label="Add a transform"
          onChange={(e) => {
            const t = MANIPULATOR_TYPES.find((x) => x.type === e.target.value);
            if (!t) return;
            onManipulatorsChange?.([...manipulators, { type: t.type, params: t.params.map(() => "") }]);
          }}
          style={{ minHeight: 24, border: "1px dashed #C6CDDA", borderRadius: 6, padding: "1px 5px", fontSize: 10, color: "#56627A", background: "#F6F7FA" }}
        >
          <option value="">+ transform</option>
          {MANIPULATOR_TYPES.map((t) => (
            <option key={t.type} value={t.type} title={t.hint}>{t.type}</option>
          ))}
        </select>
      )}
    </div>
  );
}
