"use client";

// MappingPanel — the AI-first center of the Order Workshop (spec §"Locked
// decisions" #3, mockup order_workshop_ai_mapping_focus).
//
//   • On load the AI has auto-mapped the easy ~90%. splitMappings() puts those
//     behind a collapsed "N mapped by AI · review" toggle (expand → the auto
//     rows). Only the ATTENTION rows show by default.
//   • Each attention row: received → output, confidence + provenance, and three
//     escapes — [Accept] (onAccept), a change-source <select> (onChangeSource),
//     and a drag handle. Drag-to-wire is the OPTIONAL manual override, so the
//     real wire engine (MapperWorkbench) is composed BELOW, never reimplemented.
//   • "+ Add output field" (onAddField) for flexible output.
//
// This panel is props-in/callbacks-out: it does NO data fetching. The
// orchestrator passes the suggestions (already split-able), the calibrated
// threshold, the source-field options for the dropdown, and the order/ids the
// composed MapperWorkbench needs. AI violet is used ONLY on the AI provenance
// chips (design system 09-trust-rules).

import { useState } from "react";
import { MapperWorkbench } from "../mapper/MapperWorkbench";
import type { IncomingOrderShape } from "../mapper/incomingFromOrder";
import { splitMappings, type MappingRow } from "./mappingListModel";

/** An attention/auto mapping row, carrying the provenance the workshop shows. */
export interface WorkshopMappingRow extends MappingRow {
  /** Human label of the output field (e.g. "Item code"). Falls back to outputField. */
  label?: string;
  /** Short provenance/reason for the AI suggestion (e.g. "catalog match"). */
  provenance?: string | null;
}

/** A pickable source field for the change-source dropdown (received fields + fixed value). */
export interface SourceOption {
  /** Stable source id used as the option value (token id / canonical key, or "" for none). */
  id: string;
  label: string;
}

export interface MappingCalibration {
  /** The calibrated trust threshold (0..1) — splits auto vs attention. */
  trustedThreshold: number;
}

export interface MappingPanelProps {
  /** All output-field mapping rows (auto + attention), pre-resolved by the orchestrator. */
  suggestions: WorkshopMappingRow[];
  /** Received fields offered in the change-source dropdown. */
  sourceOptions: SourceOption[];
  calibration: MappingCalibration;
  /** Commit the suggested source for an attention row. */
  onAccept: (row: WorkshopMappingRow) => void;
  /** Re-point an output field at a different source (dropdown). */
  onChangeSource: (outputField: string, sourceId: string) => void;
  /** Add a new output field to the mapping/output structure. */
  onAddField: () => void;

  // ── Props threaded to the composed MapperWorkbench (the drag surface) ──
  order: IncomingOrderShape | null;
  orderId: string;
  supplierId?: string;
  previewOrderId?: string | null;
  supplierName?: string;
  readOnly?: boolean;
}

const VIOLET = "#5E3DB0";

export function MappingPanel({
  suggestions,
  sourceOptions,
  calibration,
  onAccept,
  onChangeSource,
  onAddField,
  order,
  orderId,
  supplierId,
  previewOrderId,
  supplierName,
  readOnly,
}: MappingPanelProps) {
  const { auto, attention } = splitMappings(suggestions, {
    trustedThreshold: calibration.trustedThreshold,
  });
  const [autoExpanded, setAutoExpanded] = useState(false);

  return (
    <div data-testid="mapping-panel" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* ── Collapsed "N mapped by AI · review" block ───────────────────────── */}
      {auto.length > 0 && (
        <div style={{ borderRadius: 10, background: "#FFFFFF", border: "1px solid #E2D6F6", overflow: "hidden" }}>
          <button
            type="button"
            data-testid="auto-toggle"
            onClick={() => setAutoExpanded((v) => !v)}
            aria-expanded={autoExpanded}
            style={{
              display: "flex",
              width: "100%",
              alignItems: "center",
              gap: 8,
              padding: "9px 12px",
              border: "none",
              background: "#F4EFFC",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <span aria-hidden style={{ color: VIOLET, fontSize: 13 }}>✦</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: VIOLET }}>
              {auto.length} mapped by AI
            </span>
            <span style={{ fontSize: 11, color: "#7A6AA8", fontWeight: 500 }}>· review</span>
            <span aria-hidden style={{ marginLeft: "auto", fontSize: 10, color: VIOLET, transition: "transform 150ms", transform: autoExpanded ? "rotate(180deg)" : "none" }}>
              ▾
            </span>
          </button>
          {autoExpanded && (
            <ul role="list" aria-label="Mapped by AI" style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {auto.map((row) => (
                <li
                  key={row.outputField}
                  data-testid="auto-row"
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderTop: "1px solid #EFE9F8" }}
                >
                  <span style={{ fontSize: 11.5, fontWeight: 600, color: "#0B1A2F", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {row.label ?? row.outputField}
                  </span>
                  <span aria-hidden style={{ color: "#A8B0BF", fontSize: 11 }}>←</span>
                  <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10.5, color: VIOLET, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {row.source ?? "—"}
                  </span>
                  <span style={{ marginLeft: "auto", flexShrink: 0, fontSize: 9.5, fontWeight: 700, color: VIOLET }}>
                    {Math.round(row.confidence * 100)}%
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ── Attention rows — the only thing the operator must touch ──────────── */}
      <div style={{ borderRadius: 10, background: "#FFFFFF", border: "1px solid #E5E8EE", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderBottom: "1px solid #EEF0F4" }}>
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#0B1A2F" }}>
            Needs you
          </span>
          <span role="status" aria-live="polite" style={{ fontSize: 11, color: "var(--ink-faint)" }}>
            {attention.length} {attention.length === 1 ? "field" : "fields"}
          </span>
          <button
            type="button"
            data-testid="add-output-field"
            onClick={onAddField}
            disabled={readOnly}
            title="Add a new output field to the supplier's document"
            style={{
              marginLeft: "auto",
              height: 26,
              padding: "0 10px",
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 700,
              border: "1px solid #DCE0E8",
              background: readOnly ? "#F6F7FA" : "#FFFFFF",
              color: readOnly ? "#AEB6C4" : "#345470",
              cursor: readOnly ? "not-allowed" : "pointer",
              whiteSpace: "nowrap",
            }}
          >
            + Add output field
          </button>
        </div>

        {attention.length === 0 ? (
          <div style={{ padding: "14px 12px", fontSize: 12, color: "var(--ink-faint)" }}>
            Nothing needs your attention — the AI mapped every field. Expand &ldquo;mapped by AI&rdquo; to review, or
            drag to re-map any field below.
          </div>
        ) : (
          <ul role="list" aria-label="Fields that need attention" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {attention.map((row) => (
              <AttentionRow
                key={row.outputField}
                row={row}
                sourceOptions={sourceOptions}
                onAccept={onAccept}
                onChangeSource={onChangeSource}
                readOnly={readOnly}
              />
            ))}
          </ul>
        )}
      </div>

      {/* ── The drag surface — the real wire engine, composed (not reimplemented) ── */}
      <div data-testid="mapper-drag-surface" style={{ borderTop: "1px solid #EEF0F4", paddingTop: 12 }}>
        <MapperWorkbench
          variant="order"
          orderId={orderId}
          supplierId={supplierId}
          previewOrderId={previewOrderId}
          supplierName={supplierName}
          order={order}
          readOnly={readOnly}
        />
      </div>
    </div>
  );
}

// ── One attention row: received → output, confidence + provenance, Accept /
//    change-source <select> / drag handle ──────────────────────────────────────

function AttentionRow({
  row,
  sourceOptions,
  onAccept,
  onChangeSource,
  readOnly,
}: {
  row: WorkshopMappingRow;
  sourceOptions: SourceOption[];
  onAccept: (row: WorkshopMappingRow) => void;
  onChangeSource: (outputField: string, sourceId: string) => void;
  readOnly?: boolean;
}) {
  const hasSuggestion = row.source != null;
  return (
    <li
      role="listitem"
      data-testid="attention-row"
      style={{ display: "flex", flexDirection: "column", gap: 7, padding: "10px 12px", borderTop: "1px solid #F5F6F9" }}
    >
      {/* received → output + confidence */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          aria-hidden
          data-testid="drag-handle"
          title="Drag to map this field manually"
          style={{ flexShrink: 0, cursor: readOnly ? "default" : "grab", color: "#A8B0BF", fontSize: 13, lineHeight: 1 }}
        >
          ⠿
        </span>
        <span style={{ fontSize: 12, fontWeight: 600, color: "#0B1A2F", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {row.label ?? row.outputField}
        </span>
        <span aria-hidden style={{ color: "#A8B0BF", fontSize: 11 }}>←</span>
        <span
          style={{
            fontFamily: "'JetBrains Mono',monospace",
            fontSize: 10.5,
            color: hasSuggestion ? "#345470" : "#B36D14",
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {row.source ?? "unmapped"}
        </span>
        {hasSuggestion && (
          <span
            data-testid="ai-confidence"
            className="workshop-ai-chip"
            style={{ marginLeft: "auto", flexShrink: 0, fontSize: 9.5, fontWeight: 700, color: VIOLET, background: "#F4EFFC", border: "1px solid #E2D6F6", borderRadius: 4, padding: "1px 6px" }}
          >
            {Math.round(row.confidence * 100)}%
          </span>
        )}
      </div>

      {/* provenance */}
      {row.provenance && (
        <div style={{ fontSize: 10.5, color: "#7A6AA8", paddingLeft: 21 }}>{row.provenance}</div>
      )}

      {/* actions: Accept · change source */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, paddingLeft: 21 }}>
        <button
          type="button"
          onClick={() => onAccept(row)}
          disabled={readOnly || !hasSuggestion}
          title={hasSuggestion ? "Accept this suggested source" : "No suggestion to accept — pick a source"}
          style={{
            height: 28,
            padding: "0 12px",
            borderRadius: 6,
            fontSize: 11.5,
            fontWeight: 700,
            border: "none",
            background: readOnly || !hasSuggestion ? "#C9BCE8" : VIOLET,
            color: "#FFFFFF",
            cursor: readOnly || !hasSuggestion ? "not-allowed" : "pointer",
          }}
        >
          Accept
        </button>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: "#5E6779" }}>
          <span>or use</span>
          <select
            aria-label={`Source for ${row.label ?? row.outputField}`}
            value={row.source ?? ""}
            disabled={readOnly}
            onChange={(e) => onChangeSource(row.outputField, e.target.value)}
            style={{
              height: 28,
              borderRadius: 6,
              border: "1px solid #DCE0E8",
              background: "#FFFFFF",
              color: "#0B1A2F",
              fontSize: 11.5,
              padding: "0 6px",
              maxWidth: 200,
            }}
          >
            <option value="">— pick a source —</option>
            {sourceOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </li>
  );
}
