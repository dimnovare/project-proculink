"use client";

// TargetLane — the RIGHT pane of the unified three-pane mapper: the arbitrary OUTPUT schema.
//
// The old WireDragLayer hard-coded 7 output ids. Here the target field list is a PROP
// (`targetFields: TargetField[]`) so any supplier-specific output shape renders:
//   • inbox order path  → the host derives it from OrderMappingOverride.output via
//     deriveTargetFields() (defaults to the canonical spine on a fresh order).
//   • connection path   → the declared target schema from the revision's outputMappingJson.
//
// Each row is a wire DROP ZONE (a canonical node drags onto it). The lane registers each
// row's anchor element via `zoneRef(outputPath, el)` so the Task-6 engine can snap the
// canonical→target wire to it; the lane draws no SVG itself. Each row also exposes:
//   • the output-path label — read-only unless the host wires `onRenamePath` (connection
//     path), in which case it becomes inline-editable (rename a declared output column).
//     A rename control is NEVER shown when onRenamePath is absent (it would no-op).
//   • a slot for FieldBadges (Task 9) + manipulator pills (Task 9) — rendered by `badgeSlot`.
//   • a "Fixed value" affordance (a literal instead of a wired source).
//
// For variant="connection" a header offers "+ Add output field" + a schema-source picker
// (Standard / Sample / Import / Clone / AI). Only "Standard" acts now; the rest are visibly
// disabled "coming soon" until the Phase-2 declared-schema endpoints exist (offer⇔works).
//
// Presentational + prop-driven — NO data fetch here.

import { useState } from "react";
import type { TargetField } from "./types";
import { isTargetWired, isRenameAffordanceShown } from "./targetLaneModel";

export interface TargetLaneProps {
  variant: "order" | "connection";
  targetFields: TargetField[];
  /** outputPath → canonicalField (drives the wired indicator + source label). */
  outputConnections?: Partial<Record<string, string>>;
  /** outputPath → fixed literal value (a target with no wired source). */
  fixedValues?: Partial<Record<string, string>>;
  /** Register a row's drop-zone anchor for the wire engine. */
  zoneRef?: (outputPath: string, el: HTMLDivElement | null) => void;
  /** Hover a row (transient wire emphasis only). */
  onHover?: (outputPath: string | null) => void;
  /** Explicitly SELECT a row (click) — the host reflects this into the ?field= URL. */
  onSelect?: (outputPath: string) => void;
  hoveredId?: string | null;
  /** Disconnect the wired source on a row. */
  onDisconnect?: (outputPath: string) => void;
  /** Set/clear a fixed literal value (connection editor + order override). */
  onSetFixedValue?: (outputPath: string, value: string | null) => void;
  /** Rename a declared output path (connection editor only). */
  onRenamePath?: (oldPath: string, newPath: string) => void;
  /** Add a new declared output field (connection editor "Standard" source). */
  onAddField?: (outputPath: string, scope: TargetField["scope"]) => void;
  /** Per-row enrichment (badges + manipulator pills) rendered by the host. */
  badgeSlot?: (field: TargetField) => React.ReactNode;
  /** Published revision → fully read-only. */
  readOnly?: boolean;
}

/** Non-"Standard" schema sources are wired but disabled until Phase-2 lands (offer⇔works). */
const SCHEMA_SOURCES: { id: string; label: string; ready: boolean; note: string }[] = [
  { id: "standard", label: "Standard fields", ready: true, note: "Add a canonical output field" },
  { id: "sample", label: "From a sample file", ready: false, note: "Coming soon" },
  { id: "import", label: "Import a schema", ready: false, note: "Coming soon" },
  { id: "clone", label: "Clone another supplier", ready: false, note: "Coming soon" },
  { id: "ai", label: "AI-infer from a doc", ready: false, note: "Coming soon" },
];

export function TargetLane({
  variant,
  targetFields,
  outputConnections,
  fixedValues,
  zoneRef,
  onHover,
  onSelect,
  hoveredId,
  onDisconnect,
  onSetFixedValue,
  onRenamePath,
  onAddField,
  badgeSlot,
  readOnly,
}: TargetLaneProps) {
  const editable = variant === "connection" && !readOnly;
  // The rename control only renders when it's actually wired. The host (ThreePaneMapper)
  // currently mounts TargetLane WITHOUT onRenamePath, so an `editable`-only gate would show
  // a rename button that accepts input then silently reverts on Enter (onRenamePath?.() is a
  // no-op). Gate it on onRenamePath being a real function so a dead control never renders —
  // mirrors how "+ Add output field" already hides on `editable && onAddField`.
  const canRename = isRenameAffordanceShown(editable, onRenamePath);

  return (
    <div style={{ position: "relative", paddingRight: 2 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#1E6D29" }}>
          Output fields
        </span>
        {editable && onAddField && <AddOutputFieldMenu onAddField={onAddField} />}
      </div>

      {targetFields.length === 0 ? (
        <div style={{ padding: "10px 12px", borderRadius: 8, border: "1px dashed #D5DAE3", background: "#F6F7FA", fontSize: 10.5, color: "var(--ink-faint)", lineHeight: 1.45 }}>
          {editable
            ? "No output fields yet — add one to start shaping the delivered document."
            : "This output has no declared fields."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {targetFields.map((field) => (
            <TargetFieldRow
              key={field.outputPath}
              field={field}
              wiredSource={outputConnections?.[field.outputPath] ?? null}
              wired={isTargetWired(field.outputPath, outputConnections)}
              fixedValue={fixedValues?.[field.outputPath] ?? null}
              hovered={hoveredId === field.outputPath}
              editable={editable}
              canRename={canRename}
              readOnly={readOnly}
              zoneRef={zoneRef}
              onHover={onHover}
              onSelect={onSelect}
              onDisconnect={onDisconnect}
              onSetFixedValue={onSetFixedValue}
              onRenamePath={onRenamePath}
              badgeSlot={badgeSlot}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── A single output-field row (the drop zone) ────────────────────────────────
function TargetFieldRow({
  field,
  wiredSource,
  wired,
  fixedValue,
  hovered,
  editable,
  canRename,
  readOnly,
  zoneRef,
  onHover,
  onSelect,
  onDisconnect,
  onSetFixedValue,
  onRenamePath,
  badgeSlot,
}: {
  field: TargetField;
  wiredSource: string | null;
  wired: boolean;
  fixedValue: string | null;
  hovered: boolean;
  editable: boolean;
  /** The output-path rename control only renders when this is true (editable AND onRenamePath wired). */
  canRename: boolean;
  readOnly?: boolean;
  zoneRef?: (outputPath: string, el: HTMLDivElement | null) => void;
  onHover?: (outputPath: string | null) => void;
  onSelect?: (outputPath: string) => void;
  onDisconnect?: (outputPath: string) => void;
  onSetFixedValue?: (outputPath: string, value: string | null) => void;
  onRenamePath?: (oldPath: string, newPath: string) => void;
  badgeSlot?: (field: TargetField) => React.ReactNode;
}) {
  const [renaming, setRenaming] = useState(false);
  const [draftPath, setDraftPath] = useState(field.outputPath);
  const [fixedEditing, setFixedEditing] = useState(false);
  const [draftFixed, setDraftFixed] = useState(fixedValue ?? "");

  const accent = field.scope === "line" ? "#2E8E3A" : "#1E66C9";
  const hasFixed = fixedValue != null && fixedValue !== "";

  function commitRename() {
    const next = draftPath.trim();
    if (next && next !== field.outputPath) onRenamePath?.(field.outputPath, next);
    else setDraftPath(field.outputPath);
    setRenaming(false);
  }

  return (
    <div
      onMouseEnter={() => onHover?.(field.outputPath)}
      onMouseLeave={() => onHover?.(null)}
      onClick={() => onSelect?.(field.outputPath)}
      style={{
        borderRadius: 7,
        border: `1px solid ${hovered ? "#A9D3AF" : wired ? "#CDE7D1" : "#E2E6EE"}`,
        borderRight: `3px solid ${wired ? "#2E8E3A" : accent}`,
        background: hovered ? "rgba(46,142,58,0.05)" : "#FFFFFF",
        padding: "7px 9px",
        transition: "background 120ms, border-color 120ms",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
        {/* Drop-zone anchor — the wire engine snaps the canonical→target wire here. */}
        <div
          ref={(el) => zoneRef?.(field.outputPath, el)}
          aria-hidden
          className="rounded-full bg-white"
          style={{ width: 11, height: 11, border: `2.5px solid ${wired ? "#2E8E3A" : accent}`, flexShrink: 0 }}
        />

        {renaming ? (
          <input
            type="text"
            value={draftPath}
            autoFocus
            onChange={(e) => setDraftPath(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") { setDraftPath(field.outputPath); setRenaming(false); }
            }}
            aria-label={`Rename output field ${field.outputPath}`}
            style={{
              flex: 1, minWidth: 0, boxSizing: "border-box", padding: "3px 6px",
              borderRadius: 5, border: "1px solid #A9D3AF", fontSize: 11,
              fontFamily: "'JetBrains Mono',monospace", color: "#0B1A2F",
            }}
          />
        ) : (
          <button
            type="button"
            disabled={!canRename}
            onClick={() => canRename && setRenaming(true)}
            title={canRename ? "Rename output field" : field.outputPath}
            style={{
              flex: 1, minWidth: 0, textAlign: "left", border: "none", background: "none",
              cursor: canRename ? "text" : "default", padding: 0,
              display: "flex", flexDirection: "column", gap: 1,
            }}
          >
            <span style={{ fontSize: 11, fontWeight: 700, color: "#0B1A2F", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {field.outputPath}
            </span>
            {field.label !== field.outputPath && (
              <span style={{ fontSize: 9.5, color: "var(--ink-faint)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {field.label}
              </span>
            )}
          </button>
        )}

        {/* Wired source / fixed-value / unmapped indicator. */}
        {wired ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
            <span style={{ fontSize: 9, fontFamily: "'JetBrains Mono',monospace", color: "#1E6D29", maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              ← {wiredSource}
            </span>
            {!readOnly && onDisconnect && (
              <button
                type="button"
                aria-label={`Disconnect ${field.outputPath}`}
                onClick={() => onDisconnect(field.outputPath)}
                style={{ border: "none", background: "none", cursor: "pointer", color: "var(--ink-faint)", fontSize: 11, lineHeight: 1, padding: "0 2px" }}
              >
                ✕
              </button>
            )}
          </span>
        ) : hasFixed ? (
          <span
            title={`Fixed value: ${fixedValue}`}
            style={{ fontSize: 9, fontWeight: 700, color: "#5E3DB0", background: "#F4EFFC", border: "1px solid #E2D6F6", borderRadius: 4, padding: "1px 5px", flexShrink: 0, maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >
            = {fixedValue}
          </span>
        ) : (
          <span style={{ fontSize: 9, fontWeight: 700, color: "#C0392B", flexShrink: 0 }}>unmapped</span>
        )}
      </div>

      {/* Enrichment slot: catalog/validation badges + manipulator pills (Task 9). */}
      {badgeSlot && <div style={{ marginTop: 5 }}>{badgeSlot(field)}</div>}

      {/* Fixed-value affordance — set a literal instead of (or absent) a wired source. */}
      {!readOnly && !wired && onSetFixedValue && (
        <div style={{ marginTop: 5 }}>
          {fixedEditing ? (
            <div style={{ display: "flex", gap: 5 }}>
              <input
                type="text"
                value={draftFixed}
                autoFocus
                onChange={(e) => setDraftFixed(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { onSetFixedValue(field.outputPath, draftFixed || null); setFixedEditing(false); }
                  if (e.key === "Escape") { setDraftFixed(fixedValue ?? ""); setFixedEditing(false); }
                }}
                placeholder="Fixed value"
                aria-label={`Fixed value for ${field.outputPath}`}
                style={{ flex: 1, minWidth: 0, boxSizing: "border-box", padding: "3px 6px", borderRadius: 5, border: "1px solid #DCE0E8", fontSize: 10.5, color: "#0B1A2F" }}
              />
              <button
                type="button"
                onClick={() => { onSetFixedValue(field.outputPath, draftFixed || null); setFixedEditing(false); }}
                style={{ border: "1px solid #6F4FCE", background: "#6F4FCE", color: "#FFFFFF", borderRadius: 5, padding: "0 8px", fontSize: 10, fontWeight: 700, cursor: "pointer" }}
              >
                Set
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => { setDraftFixed(fixedValue ?? ""); setFixedEditing(true); }}
              style={{ border: "none", background: "none", cursor: "pointer", color: "#5E3DB0", fontSize: 10, fontWeight: 700, padding: 0 }}
            >
              {hasFixed ? "Edit fixed value" : "+ Fixed value"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── "+ Add output field" with the schema-source picker ───────────────────────
function AddOutputFieldMenu({
  onAddField,
}: {
  onAddField: (outputPath: string, scope: TargetField["scope"]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<TargetField["scope"]>("header");

  function submit() {
    const path = name.trim();
    if (!path) return;
    onAddField(path, scope);
    setName("");
    setAdding(false);
    setOpen(false);
  }

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => { setOpen((o) => !o); setAdding(false); }}
        style={{
          display: "inline-flex", alignItems: "center", gap: 4,
          border: "1px dashed #A9D3AF", background: "#F4FBF5", color: "#1E6D29",
          borderRadius: 7, padding: "3px 9px", fontSize: 10.5, fontWeight: 700, cursor: "pointer",
        }}
      >
        <span aria-hidden style={{ fontSize: 12, lineHeight: 1 }}>+</span>
        Add output field
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: "absolute", right: 0, top: "100%", marginTop: 4, zIndex: 20, width: 220,
            background: "#FFFFFF", border: "1px solid #E2E6EE", borderRadius: 8,
            boxShadow: "0 6px 18px rgba(11,26,47,0.14)", padding: 6,
          }}
        >
          {adding ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: 2 }}>
              <input
                type="text"
                value={name}
                autoFocus
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submit();
                  if (e.key === "Escape") { setAdding(false); }
                }}
                placeholder="Output field name"
                aria-label="New output field name"
                style={{ boxSizing: "border-box", padding: "5px 7px", borderRadius: 6, border: "1px solid #DCE0E8", fontSize: 11, color: "#0B1A2F" }}
              />
              <select
                value={scope}
                onChange={(e) => setScope(e.target.value as TargetField["scope"])}
                aria-label="New output field scope"
                style={{ boxSizing: "border-box", padding: "5px 7px", borderRadius: 6, border: "1px solid #DCE0E8", fontSize: 11, color: "#0B1A2F", background: "#FFFFFF" }}
              >
                <option value="header">Header</option>
                <option value="line">Line</option>
              </select>
              <div style={{ display: "flex", gap: 5, justifyContent: "flex-end" }}>
                <button
                  type="button"
                  onClick={() => setAdding(false)}
                  style={{ border: "1px solid #DCE0E8", background: "#FFFFFF", color: "var(--ink-faint)", borderRadius: 5, padding: "4px 8px", fontSize: 10.5, fontWeight: 700, cursor: "pointer" }}
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={submit}
                  disabled={!name.trim()}
                  style={{ border: "1px solid #2E8E3A", background: name.trim() ? "#2E8E3A" : "#A9D3AF", color: "#FFFFFF", borderRadius: 5, padding: "4px 10px", fontSize: 10.5, fontWeight: 700, cursor: name.trim() ? "pointer" : "default" }}
                >
                  Add
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
              <div style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--ink-faint)", padding: "2px 6px 4px" }}>
                Where from?
              </div>
              {SCHEMA_SOURCES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  role="menuitem"
                  disabled={!s.ready}
                  title={s.note}
                  onClick={() => { if (s.ready) setAdding(true); }}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    width: "100%", textAlign: "left", border: "none", background: "none",
                    cursor: s.ready ? "pointer" : "not-allowed", opacity: s.ready ? 1 : 0.5,
                    fontSize: 11, fontWeight: 600, color: "#0B1A2F", padding: "5px 6px", borderRadius: 5,
                  }}
                >
                  {s.label}
                  {!s.ready && <span style={{ fontSize: 8.5, fontWeight: 700, color: "var(--ink-faint)", textTransform: "uppercase", letterSpacing: "0.04em" }}>soon</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
