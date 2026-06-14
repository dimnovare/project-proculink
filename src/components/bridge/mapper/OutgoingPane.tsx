"use client";

// OutgoingPane — the RIGHT column of the redesigned 2-column mapper. It reworks TargetLane to
// render an HONEST per-output STATUS instead of the old "every row shouts red unmapped":
//
//   • MAPPED   → the resolved VALUE PREVIEW (mono) + a small source tag ("← PO number",
//                "= EUR fixed", "auto").
//   • AUTO     → a 1:1 pass-through default. Muted "auto" tag — NOT an error.
//   • UNMAPPED → quiet. Loud amber "needs a source" ONLY on REQUIRED outputs; optional
//                unmapped outputs stay neutral/silent.
//
// The per-row status is computed by the pure computeOutgoingStatus (vitest-tested); the value
// preview chases the override projections the engine already builds. The fixed-value + transform
// affordances are kept but rendered as REAL controls: when the host doesn't wire a handler yet,
// the control renders DISABLED with a reason tooltip — never dead-but-enabled (the interaction
// agent wires the handlers).
//
// Drop-zone anchors (zoneRef) + the connection-variant "+ Add output field" menu carry over from
// TargetLane unchanged so the wire engine + schema authoring keep working.
//
// Presentational + prop-driven. No data fetch here.

import { useState } from "react";
import type { TargetField } from "./types";
import { isTargetWired, isRenameAffordanceShown } from "./targetLaneModel";
import { computeOutgoingStatus, type OutgoingStatusInput, type OutgoingFieldStatus } from "./outgoingStatusModel";

export interface OutgoingPaneProps {
  variant: "order" | "connection";
  targetFields: TargetField[];
  /** outputPath → canonicalField (the canonical→output wire). */
  outputConnections?: Partial<Record<string, string>>;
  /** outputPath → fixed literal value (a target with no wired source). */
  fixedValues?: Partial<Record<string, string>>;
  /** Inputs for the honest value-preview computation (built by the host from the model). */
  statusInput: OutgoingStatusInput;
  /** Register a row's drop-zone anchor for the wire engine. */
  zoneRef?: (outputPath: string, el: HTMLDivElement | null) => void;
  onHover?: (outputPath: string | null) => void;
  onSelect?: (outputPath: string) => void;
  hoveredId?: string | null;
  onDisconnect?: (outputPath: string) => void;
  /** Set/clear a fixed literal (real control; disabled-with-reason when absent). */
  onSetFixedValue?: (outputPath: string, value: string | null) => void;
  /** Rename a declared output path (connection editor only; hidden when absent). */
  onRenamePath?: (oldPath: string, newPath: string) => void;
  /** Add a new declared output field (connection editor "Standard" source). */
  onAddField?: (outputPath: string, scope: TargetField["scope"]) => void;
  /** Per-row enrichment (badges + manipulator pills) rendered by the host. */
  badgeSlot?: (field: TargetField) => React.ReactNode;
  /**
   * SEAM (interaction agent): open the transform editor for an output row. When absent the
   * "+ transform" control renders DISABLED with a "coming soon" reason — never dead-but-enabled.
   */
  onEditTransform?: (outputPath: string) => void;
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

export function OutgoingPane({
  variant,
  targetFields,
  outputConnections,
  fixedValues,
  statusInput,
  zoneRef,
  onHover,
  onSelect,
  hoveredId,
  onDisconnect,
  onSetFixedValue,
  onRenamePath,
  onAddField,
  badgeSlot,
  onEditTransform,
  readOnly,
}: OutgoingPaneProps) {
  const editable = variant === "connection" && !readOnly;
  const canRename = isRenameAffordanceShown(editable, onRenamePath);

  return (
    <div style={{ borderRadius: 12, border: "1px solid var(--line, #E2E6EE)", background: "#FBFBFD", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "9px 12px", borderBottom: "1px solid #EEF0F4" }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "#1E6D29" }}>
          Outgoing document
        </span>
        {editable && onAddField && <AddOutputFieldMenu onAddField={onAddField} />}
      </div>

      {targetFields.length === 0 ? (
        <div style={{ padding: "12px", fontSize: 11.5, color: "var(--ink-faint)", lineHeight: 1.5 }}>
          {editable
            ? "No output fields yet — add one to start shaping the delivered document."
            : "This output has no declared fields."}
        </div>
      ) : (
        <div style={{ padding: "10px", display: "flex", flexDirection: "column", gap: 6 }}>
          {targetFields.map((field) => (
            <OutgoingRow
              key={field.outputPath}
              field={field}
              status={computeOutgoingStatus(field, statusInput)}
              wired={isTargetWired(field.outputPath, outputConnections)}
              fixedValue={fixedValues?.[field.outputPath] ?? null}
              hovered={hoveredId === field.outputPath}
              canRename={canRename}
              readOnly={readOnly}
              zoneRef={zoneRef}
              onHover={onHover}
              onSelect={onSelect}
              onDisconnect={onDisconnect}
              onSetFixedValue={onSetFixedValue}
              onRenamePath={onRenamePath}
              onEditTransform={onEditTransform}
              badgeSlot={badgeSlot}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── A single output-field row (the drop zone + honest status) ─────────────────
function OutgoingRow({
  field, status, wired, fixedValue, hovered, canRename, readOnly,
  zoneRef, onHover, onSelect, onDisconnect, onSetFixedValue, onRenamePath, onEditTransform, badgeSlot,
}: {
  field: TargetField;
  status: OutgoingFieldStatus;
  wired: boolean;
  fixedValue: string | null;
  hovered: boolean;
  canRename: boolean;
  readOnly?: boolean;
  zoneRef?: (outputPath: string, el: HTMLDivElement | null) => void;
  onHover?: (outputPath: string | null) => void;
  onSelect?: (outputPath: string) => void;
  onDisconnect?: (outputPath: string) => void;
  onSetFixedValue?: (outputPath: string, value: string | null) => void;
  onRenamePath?: (oldPath: string, newPath: string) => void;
  onEditTransform?: (outputPath: string) => void;
  badgeSlot?: (field: TargetField) => React.ReactNode;
}) {
  const [renaming, setRenaming] = useState(false);
  const [draftPath, setDraftPath] = useState(field.outputPath);
  const [fixedEditing, setFixedEditing] = useState(false);
  const [draftFixed, setDraftFixed] = useState(fixedValue ?? "");

  const accent = field.scope === "line" ? "#2E8E3A" : "#1E66C9";
  // Loud ONLY when required AND genuinely unmapped (no value resolves). Optional unmapped = quiet.
  const needsSource = status.required && !status.mapped;

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
        borderRadius: 8,
        border: `1px solid ${needsSource ? "#F1E2BE" : hovered ? "#A9D3AF" : status.mapped ? "#D7E7DA" : "var(--line, #E2E6EE)"}`,
        borderRight: `3px solid ${status.mapped ? "#2E8E3A" : needsSource ? "#E0B23C" : accent}`,
        background: needsSource ? "#FFFCF4" : hovered ? "rgba(46,142,58,0.05)" : "#FFFFFF",
        padding: "8px 10px",
        transition: "background 120ms, border-color 120ms",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        {/* Drop-zone anchor — the wire engine snaps the canonical→target wire here. */}
        <div
          ref={(el) => zoneRef?.(field.outputPath, el)}
          aria-hidden
          className="rounded-full bg-white"
          style={{ width: 11, height: 11, border: `2.5px solid ${status.mapped ? "#2E8E3A" : accent}`, flexShrink: 0 }}
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
              borderRadius: 5, border: "1px solid #A9D3AF", fontSize: 11.5,
              fontFamily: "'JetBrains Mono',monospace", color: "var(--ink, #0B1A2F)",
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
              cursor: canRename ? "text" : "default", padding: 0, display: "flex", flexDirection: "column", gap: 1,
            }}
          >
            <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--ink, #0B1A2F)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {field.outputPath}
            </span>
            {field.label !== field.outputPath && (
              <span style={{ fontSize: 9.5, color: "var(--ink-faint)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {field.label}
              </span>
            )}
          </button>
        )}

        {/* Honest right-side status. */}
        <OutgoingStatusTag status={status} onDisconnect={!readOnly && wired ? onDisconnect : undefined} />
      </div>

      {/* Resolved value preview (mono) — the real delivered value as far as it's known. */}
      {status.mapped && (
        <div style={{ marginTop: 5, marginLeft: 19, display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          <span style={{ fontSize: 8.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--ink-faint)", flexShrink: 0 }}>
            →
          </span>
          <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: status.valuePreview ? "var(--ink, #0B1A2F)" : "#AEB6C4", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {status.valuePreview ?? "—"}
          </span>
        </div>
      )}

      {/* Enrichment slot: catalog/validation badges + manipulator pills (Task 9). */}
      {badgeSlot && <div style={{ marginTop: 5 }}>{badgeSlot(field)}</div>}

      {/* Power controls row — fixed value + transform. Real controls; disabled-with-reason when
          the host hasn't wired the handler yet (never dead-but-enabled). */}
      {!readOnly && (
        <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {/* Fixed value — only meaningful when not wired to a canonical source. */}
          {!wired && (
            onSetFixedValue ? (
              fixedEditing ? (
                <div style={{ display: "flex", gap: 5, flex: 1, minWidth: 160 }}>
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
                    style={{ flex: 1, minWidth: 0, boxSizing: "border-box", padding: "3px 6px", borderRadius: 5, border: "1px solid var(--line, #DCE0E8)", fontSize: 11, color: "var(--ink, #0B1A2F)" }}
                  />
                  <button
                    type="button"
                    onClick={() => { onSetFixedValue(field.outputPath, draftFixed || null); setFixedEditing(false); }}
                    style={{ border: "1px solid #6F4FCE", background: "#6F4FCE", color: "#FFFFFF", borderRadius: 5, padding: "0 9px", fontSize: 10, fontWeight: 700, cursor: "pointer" }}
                  >
                    Set
                  </button>
                </div>
              ) : (
                <PowerLink onClick={() => { setDraftFixed(fixedValue ?? ""); setFixedEditing(true); }}>
                  {status.kind === "fixed" ? "Edit fixed value" : "+ Fixed value"}
                </PowerLink>
              )
            ) : (
              <PowerLink disabled reason="Fixed values land with the interaction pass">+ Fixed value</PowerLink>
            )
          )}

          {/* Transform — real handler when wired; disabled-with-reason otherwise. */}
          {onEditTransform ? (
            <PowerLink onClick={() => onEditTransform(field.outputPath)}>+ Transform</PowerLink>
          ) : (
            <PowerLink disabled reason="Transforms land with the interaction pass">+ Transform</PowerLink>
          )}
        </div>
      )}
    </div>
  );
}

// ── The honest right-side status tag ──────────────────────────────────────────
function OutgoingStatusTag({
  status, onDisconnect,
}: {
  status: OutgoingFieldStatus;
  onDisconnect?: (outputPath: string) => void;
}) {
  if (status.kind === "wired") {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
        <span style={{ fontSize: 9.5, fontWeight: 700, color: "#1E6D29", maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {status.source}
        </span>
        {onDisconnect && (
          <button
            type="button"
            aria-label={`Disconnect ${status.outputPath}`}
            onClick={(e) => { e.stopPropagation(); onDisconnect(status.outputPath); }}
            style={{ border: "none", background: "none", cursor: "pointer", color: "var(--ink-faint)", fontSize: 11, lineHeight: 1, padding: "0 2px" }}
          >
            ✕
          </button>
        )}
      </span>
    );
  }
  if (status.kind === "fixed") {
    return (
      <span title={`Fixed value`} style={{ fontSize: 9, fontWeight: 700, color: "#5E3DB0", background: "#F4EFFC", border: "1px solid #E2D6F6", borderRadius: 4, padding: "1px 6px", flexShrink: 0, maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {status.source}
      </span>
    );
  }
  if (status.kind === "auto") {
    return (
      <span title="Carried straight through by the default transform" style={{ fontSize: 8.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#9AA3B2", flexShrink: 0 }}>
        auto
      </span>
    );
  }
  // Unmapped: loud amber ONLY when required; otherwise neutral + quiet.
  if (status.required) {
    return (
      <span title="This field is required by the supplier — wire a source or set a fixed value" style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 9, fontWeight: 700, color: "#9A6B00", background: "#FFF7E6", border: "1px solid #F1E2BE", borderRadius: 4, padding: "1px 6px", flexShrink: 0 }}>
        needs a source
      </span>
    );
  }
  return (
    <span style={{ fontSize: 9, fontWeight: 600, color: "#AEB6C4", flexShrink: 0 }}>not set</span>
  );
}

// ── Small power-link (fixed value / transform) ────────────────────────────────
function PowerLink({
  children, onClick, disabled, reason,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  reason?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={disabled ? reason : undefined}
      style={{
        border: "none", background: "none", padding: 0,
        cursor: disabled ? "not-allowed" : "pointer",
        color: disabled ? "#AEB6C4" : "#5E3DB0",
        fontSize: 10, fontWeight: 700,
        opacity: disabled ? 0.7 : 1,
      }}
    >
      {children}
    </button>
  );
}

// ── "+ Add output field" with the schema-source picker (carried from TargetLane) ──
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
