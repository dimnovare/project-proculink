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
// VISUAL REDESIGN (2026-06-15): the "Edit fixed value" and "+ Transform" controls used to sit on
// a SEPARATE second line below each row, reading as disconnected — the founder flagged it twice.
// They now live INLINE in the row's right-hand action cluster, next to the status tag (revealed
// quietly at rest, full on hover/focus/active so they're discoverable but calm). The fixed-value
// status chip is itself the "edit" affordance (click the value to edit it — direct manipulation).
//
// "Add output field" is now a REAL, fully usable combobox (offer⇔works): a searchable canonical-
// field picker (system + custom, grouped header/line, already-present fields filtered out) PLUS
// an "create custom field" footer for an arbitrary name + scope. The dead "soon" schema-source
// menu (sample / import / clone / AI-infer — none backed by anything) is gone.
//
// The per-row status is computed by the pure computeOutgoingStatus (vitest-tested); the value
// preview chases the override projections the engine already builds.
//
// Presentational + prop-driven. No data fetch here.

import { useEffect, useMemo, useState } from "react";
import type { ManipulatorEntry, OutputFormatId } from "@/lib/api/types";
import type { CanonicalNode, SourceField, TargetField } from "./types";
import { isTargetWired, isRenameAffordanceShown } from "./targetLaneModel";
import { ignoresManualOutputFields, structuredFormatLabel } from "./previewFormatModel";
import { computeOutgoingStatus, type OutgoingStatusInput, type OutgoingFieldStatus } from "./outgoingStatusModel";
import { TransformPopover } from "./TransformPopover";
import { SourcePickerChip } from "./SourcePickerChip";
import { suggestedSourceFor } from "./sourcePickerModel";
import { ConfidenceChip } from "./ConfidenceChip";

export interface OutgoingPaneProps {
  variant: "order" | "connection";
  targetFields: TargetField[];
  /** outputPath → canonicalField (the canonical→output wire). */
  outputConnections?: Partial<Record<string, string>>;
  /** outputPath → fixed literal value (a target with no wired source). */
  fixedValues?: Partial<Record<string, string>>;
  /** Inputs for the honest value-preview computation (built by the host from the model). */
  statusInput: OutgoingStatusInput;
  /** Register a row's LEFT-edge drop PORT element for the wire engine. */
  portRef?: (outputPath: string, el: HTMLDivElement | null) => void;
  onHover?: (outputPath: string | null) => void;
  onSelect?: (outputPath: string) => void;
  hoveredId?: string | null;
  /** The hovered id plus its wire-linked counterparts → cross-column highlight
      (a row lights when it OR its linked source/target is hovered). */
  activeIds?: Set<string>;
  /** Output path currently snap-highlighted under a drag (drives the drop-target glow). */
  snapTarget?: string | null;
  onDisconnect?: (outputPath: string) => void;
  /** Set/clear a fixed literal (real control; disabled-with-reason when absent). */
  onSetFixedValue?: (outputPath: string, value: string | null) => void;
  /** Rename a declared output path (connection editor only; hidden when absent). */
  onRenamePath?: (oldPath: string, newPath: string) => void;
  /** Add a new declared output field (both variants). */
  onAddField?: (outputPath: string, scope: TargetField["scope"]) => void;
  /**
   * The canonical fields the add-field picker offers (system spine + custom). The picker filters
   * out fields already present in the output so it only ever offers something new.
   */
  canonicalOptions?: CanonicalNode[];
  /** Per-row enrichment (badges + manipulator pills) rendered by the host. */
  badgeSlot?: (field: TargetField) => React.ReactNode;
  /**
   * The field's current transform (manipulator) chain — feeds the "Transform" popover.
   * Absent → the transform control renders DISABLED with a reason (never dead-but-enabled).
   */
  manipulatorsOf?: (field: TargetField) => ManipulatorEntry[];
  /** Replace a field's transform chain (persists via the model). Required to enable transforms. */
  onFieldManipulatorsChange?: (outputPath: string, next: ManipulatorEntry[], scope: "header" | "line") => void;
  /**
   * Mapping interaction mode. "wires" (default) = today's drag-to-connect behavior, UNCHANGED.
   * "picker" = each row's source is an inline searchable dropdown (no dragging) — the founder's
   * simpler alternative, used by the Order Workshop. Workshop-gated, so the classic screen and the
   * connection editor stay on "wires".
   */
  mappingMode?: "picker" | "wires";
  /** The incoming fields offered as sources in picker mode (the model's sourceFields). */
  incomingFields?: ReadonlyArray<SourceField>;
  /**
   * Picker mode: bind an output path to an incoming source id. The host routes this through the
   * SAME wire-connect dispatch the drag path uses (onWireConnect → onTargetConnect/onSetFixedValue),
   * so the save contract is identical.
   */
  onPickSource?: (outputPath: string, sourceId: string) => void;
  /**
   * The format the supplier actually RECEIVES for this output (same source the preview pane uses:
   * the order's delivered format, then the connection's outputFormat). When it's a structured-
   * standard format (cXML / X12 / UBL) the delivered document is produced by a dedicated fixed
   * transformer that IGNORES manually-added output fields — so we show a calm notice and stop the
   * pane from implying that adding a field changes what's sent. Absent/flat formats → unchanged.
   */
  outputFormat?: OutputFormatId | null;
  /**
   * The order's auto-filled address + contact fields. For structured formats (cXML / X12 / UBL) the
   * backend writer emits these blocks automatically from the order's canonical fields — they appear
   * in the live preview but are NOT editable here. When present (and the format is structured) we
   * render them as a READ-ONLY "Filled automatically from the order" section so the user can SEE and
   * verify what's being sent. Optional + every field nullable — render nothing when absent (graceful
   * before the backend that supplies them is deployed). Flat formats ignore this entirely.
   */
  autoFilledFields?: AutoFilledFields | null;
  /**
   * The supplier/connection display name — drives the B3 plain-language sub-header
   * ("The output the {supplier} receives…"). Falls back to "supplier" when absent.
   */
  supplierName?: string;
  readOnly?: boolean;
}

/**
 * The auto-filled address/contact values surfaced read-only for structured formats. Every field is
 * optional + nullable — the component omits any that are null/empty and shows nothing if all absent.
 */
export interface AutoFilledFields {
  shipToName?: string | null;
  shipToStreet?: string | null;
  shipToCity?: string | null;
  shipToPostalCode?: string | null;
  shipToCountry?: string | null;
  shipToDeliverTo?: string | null;
  billToName?: string | null;
  billToDeliverTo?: string | null;
  billToStreet?: string | null;
  billToCity?: string | null;
  billToPostalCode?: string | null;
  billToCountry?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  buyerTaxId?: string | null;
}

export function OutgoingPane({
  variant,
  targetFields,
  outputConnections,
  fixedValues,
  statusInput,
  portRef,
  onHover,
  onSelect,
  hoveredId,
  activeIds,
  snapTarget,
  onDisconnect,
  onSetFixedValue,
  onRenamePath,
  onAddField,
  canonicalOptions,
  badgeSlot,
  manipulatorsOf,
  onFieldManipulatorsChange,
  mappingMode = "wires",
  incomingFields,
  onPickSource,
  outputFormat,
  autoFilledFields,
  supplierName,
  readOnly,
}: OutgoingPaneProps) {
  const editable = variant === "connection" && !readOnly;
  // B3 sub-header: plain-language framing of the output column + the * required marker.
  const supplierLabel = supplierName?.trim() || "supplier";
  const pickerMode = mappingMode === "picker" && !readOnly && typeof onPickSource === "function";
  // Structured-standard formats (cXML / X12 / UBL) are produced by a dedicated FIXED transformer
  // that ignores manually-added output fields — contact/addresses/structure come automatically from
  // the extracted order. We surface a calm notice and suppress the "+ Add output field" control so
  // the pane never implies a manual field edit changes what's delivered. Flat formats are unaffected.
  const structuredFixedFormat = ignoresManualOutputFields(outputFormat);
  // RENAME stays connection-only (an order can't rename a supplier's declared schema), but ADDING
  // an output field is allowed in BOTH variants — an order may need to inject a field the default
  // schema lacks (e.g. credentials). Gate "add" on a real onAddField handler + not-read-only, not
  // on the variant. Without this the order mapper could never add an output field at all.
  const canRename = isRenameAffordanceShown(editable, onRenamePath);
  // Adding an output field is meaningless for a structured-standard format (the fixed transformer
  // ignores it), so hide the control there — the notice below explains why — rather than offer a
  // dead action (offer⇔works). Flat formats keep the real combobox.
  const canAddField = !readOnly && !structuredFixedFormat && typeof onAddField === "function";

  // The output paths already present — the picker only ever offers something NEW.
  const existingPaths = useMemo(
    () => new Set(targetFields.map((f) => f.outputPath.toLowerCase())),
    [targetFields],
  );

  // Split the rows into NEEDS-ATTENTION (required + genuinely unmapped — the loud blockers the
  // honest status model already flags) shown at the top, and the AUTO-MAPPED rest folded behind a
  // collapsible summary. "Needs attention" is derived from the SAME per-row status the row renders
  // (status.required && !status.mapped) — never a fabricated status. Optional unmapped outputs stay
  // quiet/inline with the auto group, exactly as before.
  const rows = useMemo(
    () => targetFields.map((field) => ({ field, status: computeOutgoingStatus(field, statusInput) })),
    [targetFields, statusInput],
  );
  const needsRows = useMemo(() => rows.filter((r) => r.status.required && !r.status.mapped), [rows]);
  const autoRows = useMemo(() => rows.filter((r) => !(r.status.required && !r.status.mapped)), [rows]);
  const allReady = needsRows.length === 0;

  // The auto-mapped group is COLLAPSED while any row needs attention; it AUTO-EXPANDS once nothing
  // is blocking so the pane never reads as empty. Seeded from allReady + re-synced when readiness
  // flips (e.g. the operator applies the last fix and clears the final blocker).
  const [showAuto, setShowAuto] = useState(allReady);
  useEffect(() => { if (allReady) setShowAuto(true); }, [allReady]);

  // One row renderer reused by both layouts (the v3 needs/auto split in picker mode, and the
  // classic flat list everywhere else) so the row markup + wiring lives in ONE place.
  const renderRow = (field: TargetField, status: ReturnType<typeof computeOutgoingStatus>) => (
    <OutgoingRow
      key={field.outputPath}
      field={field}
      status={status}
      wired={isTargetWired(field.outputPath, outputConnections)}
      fixedValue={fixedValues?.[field.outputPath] ?? null}
      hovered={activeIds ? activeIds.has(field.outputPath) : hoveredId === field.outputPath}
      snapped={snapTarget === field.outputPath}
      canRename={canRename}
      readOnly={readOnly}
      portRef={portRef}
      onHover={onHover}
      onSelect={onSelect}
      onDisconnect={onDisconnect}
      onSetFixedValue={onSetFixedValue}
      onRenamePath={onRenamePath}
      manipulators={manipulatorsOf?.(field)}
      onFieldManipulatorsChange={onFieldManipulatorsChange}
      badgeSlot={badgeSlot}
      pickerMode={pickerMode}
      incomingFields={incomingFields}
      onPickSource={onPickSource}
    />
  );

  return (
    <div style={{ border: "1px solid var(--line, #E5E8EE)", background: "linear-gradient(180deg,#F1F3F755,#F6F7FA)", overflow: "hidden", height: "100%", display: "flex", flexDirection: "column" }}>
      {/* CSS-driven hovers (replaces imperative onMouseEnter/Leave style toggles) — same visible result. */}
      <style>{`
        .mapper-aifix-apply:hover { background: #1E6D29; }
        .mapper-add-field-item:hover { background: #F4FBF5; }
      `}</style>
      {/* app.jsx ColHead (supplier): 52px, faint green tint, 9px dot, title-case display title. */}
      <div style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", height: 52, gap: 10, padding: "0 18px", borderBottom: "1px solid #E5E8EE", background: "#E9F1EA44" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <span aria-hidden style={{ flexShrink: 0, width: 9, height: 9, borderRadius: "50%", background: "#2E8E3A", boxShadow: "0 0 0 3px #E9F1EA" }} />
          <span style={{ fontFamily: "var(--font-display, 'Bricolage Grotesque', Inter, sans-serif)", fontSize: 13.5, fontWeight: 700, letterSpacing: "-0.01em", color: "#0B1A2F" }}>
            What we&rsquo;ll send
          </span>
        </span>
        {canAddField && onAddField && (
          <AddOutputFieldMenu
            onAddField={onAddField}
            canonicalOptions={canonicalOptions ?? []}
            existingPaths={existingPaths}
          />
        )}
      </div>

      {/* B3 sub-header — plain-language framing of the output column: what it is, how to
          fill each field, and what the * marker means. Calm + muted, under the pane head. */}
      <div style={{ flexShrink: 0, padding: "10px 18px 0", fontSize: 11.5, color: "var(--ink-faint)", lineHeight: 1.5 }}>
        The output the {supplierLabel} receives. Map an incoming field to each one (drag from the left), or set a fixed value. Fields marked <span style={{ color: "#B36D14", fontWeight: 700 }}>*</span> are required.
      </div>

      {/* Structured-standard formats (cXML / X12 / UBL) are built by a fixed transformer that fills
          contact + addresses + structure automatically from the order — manual field edits here
          don't change the delivered document. A calm, single-sentence explanation + a soft hint;
          uses the pane's existing muted-note styling. Flat formats never render this. */}
      {structuredFixedFormat && outputFormat && (
        <div
          role="note"
          style={{
            padding: "9px 12px", borderBottom: "1px solid #EEF0F4",
            background: "#F6F8FC", color: "#5E6779", fontSize: 11.5, lineHeight: 1.5,
          }}
        >
          This supplier uses a structured format ({structuredFormatLabel(outputFormat)}). Fields like
          contact and addresses are filled in automatically from the order — adding or editing fields
          here won&rsquo;t change what&rsquo;s sent.{" "}
          <span style={{ color: "#7A8395" }}>
            To change the structure, edit the supplier&rsquo;s output setup.
          </span>
        </div>
      )}

      {/* Read-only "what's filled automatically" — for structured formats only, listing the order's
          auto-emitted address + contact values so the user can SEE/verify what's being sent (they're
          not editable here; the note above explains why). Renders nothing when no fields are present
          (e.g. the backend that supplies them isn't deployed yet) — graceful, never crashes. */}
      {structuredFixedFormat && <AutoFilledSection fields={autoFilledFields} />}

      {targetFields.length === 0 ? (
        <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "12px", fontSize: 11.5, color: "var(--ink-faint)", lineHeight: 1.5 }}>
          {canAddField
            ? "No output fields yet — add one to start shaping the delivered document."
            : "This output has no declared fields."}
        </div>
      ) : pickerMode ? (
        <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "10px", display: "flex", flexDirection: "column", gap: 6 }}>
          {/* Rows that NEED ATTENTION first (required + unmapped), each carrying its own inline AI fix. */}
          {needsRows.map(({ field, status }) => (
            <OutgoingRow
              key={field.outputPath}
              field={field}
              status={status}
              wired={isTargetWired(field.outputPath, outputConnections)}
              fixedValue={fixedValues?.[field.outputPath] ?? null}
              hovered={activeIds ? activeIds.has(field.outputPath) : hoveredId === field.outputPath}
              snapped={snapTarget === field.outputPath}
              canRename={canRename}
              readOnly={readOnly}
              portRef={portRef}
              onHover={onHover}
              onSelect={onSelect}
              onDisconnect={onDisconnect}
              onSetFixedValue={onSetFixedValue}
              onRenamePath={onRenamePath}
              manipulators={manipulatorsOf?.(field)}
              onFieldManipulatorsChange={onFieldManipulatorsChange}
              badgeSlot={badgeSlot}
              pickerMode={pickerMode}
              incomingFields={incomingFields}
              onPickSource={onPickSource}
            />
          ))}

          {/* The auto-mapped group: a full-width collapsible summary, then the rows when open.
              Hidden entirely when there's nothing auto-mapped (e.g. every field needs attention). */}
          {autoRows.length > 0 && (
            <>
              <AutoMappedSummary count={autoRows.length} open={showAuto} onToggle={() => setShowAuto((o) => !o)} />
              {showAuto && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {autoRows.map(({ field, status }) => (
                    <OutgoingRow
                      key={field.outputPath}
                      field={field}
                      status={status}
                      wired={isTargetWired(field.outputPath, outputConnections)}
                      fixedValue={fixedValues?.[field.outputPath] ?? null}
                      hovered={activeIds ? activeIds.has(field.outputPath) : hoveredId === field.outputPath}
                      snapped={snapTarget === field.outputPath}
                      canRename={canRename}
                      readOnly={readOnly}
                      portRef={portRef}
                      onHover={onHover}
                      onSelect={onSelect}
                      onDisconnect={onDisconnect}
                      onSetFixedValue={onSetFixedValue}
                      onRenamePath={onRenamePath}
                      manipulators={manipulatorsOf?.(field)}
                      onFieldManipulatorsChange={onFieldManipulatorsChange}
                      badgeSlot={badgeSlot}
                      pickerMode={pickerMode}
                      incomingFields={incomingFields}
                      onPickSource={onPickSource}
                    />
                  ))}
                </div>
              )}
            </>
          )}
          {/* Bottom "+ Add output field" — same affordance as the header, at the END of the list
              (design parity). Full-width dashed; opens the same searchable picker. */}
          {canAddField && onAddField && (
            <div style={{ marginTop: 2 }}>
              <AddOutputFieldMenu fullWidth onAddField={onAddField} canonicalOptions={canonicalOptions ?? []} existingPaths={existingPaths} />
            </div>
          )}
        </div>
      ) : (
        // Classic (wires): every output row, flat, in declared order — unchanged from before v3.
        <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "10px", display: "flex", flexDirection: "column", gap: 6 }}>
          {rows.map(({ field, status }) => renderRow(field, status))}
          {canAddField && onAddField && (
            <div style={{ marginTop: 2 }}>
              <AddOutputFieldMenu fullWidth onAddField={onAddField} canonicalOptions={canonicalOptions ?? []} existingPaths={existingPaths} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Read-only "Filled automatically from the order" — address + contact blocks ──
// For structured formats the backend writer emits these from the order's canonical fields; they
// show in the live preview but aren't editable here. We list the PRESENT ones (muted, no controls)
// so the user can see exactly what's being sent. Renders nothing when nothing is present.
function AutoFilledSection({ fields }: { fields?: AutoFilledFields | null }) {
  // Join a party's name + address lines into the non-empty parts only (optional-chain everything so
  // an absent DTO can never crash). A trailing city/postcode/country line is collapsed to one row.
  const present = (v?: string | null) => typeof v === "string" && v.trim().length > 0;

  const shipLines = [
    fields?.shipToName,
    fields?.shipToDeliverTo,
    fields?.shipToStreet,
    [fields?.shipToPostalCode, fields?.shipToCity].filter(present).join(" ") || null,
    fields?.shipToCountry,
  ].filter(present) as string[];

  const billLines = [
    fields?.billToName,
    fields?.billToDeliverTo,
    fields?.billToStreet,
    [fields?.billToPostalCode, fields?.billToCity].filter(present).join(" ") || null,
    fields?.billToCountry,
  ].filter(present) as string[];

  const contactLines = [
    fields?.contactName,
    fields?.contactEmail,
    fields?.contactPhone,
  ].filter(present) as string[];

  const taxId = present(fields?.buyerTaxId) ? fields!.buyerTaxId! : null;

  const blocks: { label: string; lines: string[] }[] = [];
  if (shipLines.length) blocks.push({ label: "Ship to", lines: shipLines });
  if (billLines.length) blocks.push({ label: "Bill to", lines: billLines });
  if (contactLines.length) blocks.push({ label: "Contact", lines: contactLines });
  if (taxId) blocks.push({ label: "Buyer tax ID", lines: [taxId] });

  // Nothing extracted (or the backend doesn't supply these yet) → render nothing; the note above
  // already explains that these fields are filled automatically.
  if (blocks.length === 0) return null;

  return (
    <div style={{ padding: "10px 12px", borderBottom: "1px solid #EEF0F4", background: "#FBFBFD" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#5E6779" }}>
          Filled automatically from the order
        </span>
        <span
          title="These come straight from the order and can't be edited here."
          style={{ fontSize: 9.5, fontWeight: 700, color: "#6B7585", background: "#F1F3F7", border: "1px solid #E5E8EE", borderRadius: 4, padding: "1px 6px", letterSpacing: "0.02em" }}
        >
          read-only
        </span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
        {blocks.map((b) => (
          <div key={b.label} style={{ minWidth: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#7A8395", marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.04em" }}>
              {b.label}
            </div>
            {b.lines.map((line, i) => (
              <div
                key={i}
                style={{ fontSize: 11.5, color: "#3C4658", lineHeight: 1.45, overflowWrap: "anywhere" }}
              >
                {line}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── A single output-field row (the LEFT-edge drop PORT + honest status + INLINE controls) ──
function OutgoingRow({
  field, status, wired, fixedValue, hovered, snapped, canRename, readOnly,
  portRef, onHover, onSelect, onDisconnect, onSetFixedValue, onRenamePath, manipulators, onFieldManipulatorsChange, badgeSlot,
  pickerMode, incomingFields, onPickSource,
}: {
  field: TargetField;
  status: OutgoingFieldStatus;
  wired: boolean;
  fixedValue: string | null;
  hovered: boolean;
  snapped?: boolean;
  canRename: boolean;
  readOnly?: boolean;
  portRef?: (outputPath: string, el: HTMLDivElement | null) => void;
  onHover?: (outputPath: string | null) => void;
  onSelect?: (outputPath: string) => void;
  onDisconnect?: (outputPath: string) => void;
  onSetFixedValue?: (outputPath: string, value: string | null) => void;
  onRenamePath?: (oldPath: string, newPath: string) => void;
  manipulators?: ManipulatorEntry[];
  onFieldManipulatorsChange?: (outputPath: string, next: ManipulatorEntry[], scope: "header" | "line") => void;
  badgeSlot?: (field: TargetField) => React.ReactNode;
  pickerMode?: boolean;
  incomingFields?: ReadonlyArray<SourceField>;
  onPickSource?: (outputPath: string, sourceId: string) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [draftPath, setDraftPath] = useState(field.outputPath);
  const [fixedEditing, setFixedEditing] = useState(false);
  const [draftFixed, setDraftFixed] = useState(fixedValue ?? "");
  const [transformOpen, setTransformOpen] = useState(false);
  // The ƒx trigger element — the transform popover anchors to it (portal + fixed position) so it
  // floats clean above the dense column instead of clipping/overlapping sibling rows (bug 7).
  const [fxAnchor, setFxAnchor] = useState<HTMLButtonElement | null>(null);
  const [focusWithin, setFocusWithin] = useState(false);
  const chain = manipulators ?? [];
  const canEditTransform = !!onFieldManipulatorsChange;

  const accent = field.scope === "line" ? "#2E8E3A" : "#1E66C9";
  // Loud ONLY when required AND genuinely unmapped (no value resolves). Optional unmapped = quiet.
  const needsSource = status.required && !status.mapped;

  // INLINE AI FIX — reuse the EXISTING suggestion model (suggestedSourceFor). The suggested VALUE is
  // the suggested incoming field's own value (looked up by id); the rationale is "from {label}"
  // (SourceField carries no richer reason field, so we degrade gracefully — never fabricate one).
  // Apply routes through the SAME onPickSource dispatch the picker uses, so it actually maps the
  // field and clears the blocker. Rendered ONLY on a needs-source row that HAS a suggestion.
  const aiFix = useMemo(() => {
    if (!needsSource) return null;
    const sug = suggestedSourceFor(field.outputPath, incomingFields ?? []);
    if (!sug || !onPickSource || readOnly) return null;
    const src = (incomingFields ?? []).find((f) => f.id === sug.id);
    return {
      sourceId: sug.id,
      value: src?.value ?? "",
      rationale: `from ${sug.label}`,
      confidence: sug.confidence,
    };
  }, [needsSource, field.outputPath, incomingFields, onPickSource, readOnly]);
  // The inline action affordances are quiet at rest, full on hover / keyboard focus / when active,
  // so they're always discoverable (never hover-ONLY) but don't clutter a dense column.
  const actionsLit = hovered || focusWithin || transformOpen || fixedEditing || chain.length > 0;

  function commitRename() {
    const next = draftPath.trim();
    if (next && next !== field.outputPath) onRenamePath?.(field.outputPath, next);
    else setDraftPath(field.outputPath);
    setRenaming(false);
  }

  function startFixedEdit() {
    setDraftFixed(fixedValue ?? "");
    setFixedEditing(true);
  }
  function commitFixedEdit() {
    onSetFixedValue?.(field.outputPath, draftFixed.trim() || null);
    setFixedEditing(false);
  }

  return (
    <div
      data-mapper-row
      onMouseEnter={() => onHover?.(field.outputPath)}
      onMouseLeave={() => onHover?.(null)}
      onFocusCapture={() => setFocusWithin(true)}
      onBlurCapture={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setFocusWithin(false); }}
      onClick={() => onSelect?.(field.outputPath)}
      style={{
        position: "relative",
        borderRadius: 10,
        // app.jsx OutputRow hover: a HOVERED "what we'll send" card lights with a CRISP green
        // border (#2E8E3A, not the washed-out #A9D3AF), a clearly-visible greenSoft (#E9F1EA)
        // fill, a green left bar, and a soft green shadow — mirroring the received card's blue
        // hover so the whole received↔wire↔send↔preview chain visibly lights together. Issue
        // states (needsSource amber / snapped violet) still take precedence.
        // NB: per-side longhand (not the `border` shorthand + a separate `borderLeft`) so React
        // never warns about mixing shorthand/longhand for the same value on the hover rerender.
        borderStyle: "solid",
        borderTopWidth: 1, borderRightWidth: 1, borderBottomWidth: 1, borderLeftWidth: 3,
        borderTopColor: snapped ? "#6F4FCE" : needsSource ? "#F1E2BE" : hovered ? "#2E8E3A" : status.mapped ? "#D7E7DA" : "#E5E8EE",
        borderRightColor: snapped ? "#6F4FCE" : needsSource ? "#F1E2BE" : hovered ? "#2E8E3A" : status.mapped ? "#D7E7DA" : "#E5E8EE",
        borderBottomColor: snapped ? "#6F4FCE" : needsSource ? "#F1E2BE" : hovered ? "#2E8E3A" : status.mapped ? "#D7E7DA" : "#E5E8EE",
        borderLeftColor: snapped ? "#6F4FCE" : needsSource ? "#E0B23C" : hovered ? "#2E8E3A" : status.mapped ? "#2E8E3A" : accent,
        background: snapped ? "#F4EFFC" : needsSource ? "#FFFCF4" : hovered ? "#E9F1EA" : "#FFFFFF",
        padding: "11px 12px 11px 13px",
        boxShadow: snapped ? "0 0 0 2px rgba(111,79,206,0.18)" : hovered ? "0 2px 12px rgba(46,142,58,0.12)" : undefined,
        transition: "background 120ms, border-color 120ms, box-shadow 120ms",
      }}
    >
      {/* LEFT-edge drop PORT — the wire engine snaps the incoming→output wire here. Sits on the
          row's left edge facing the gutter so wires land on the left, never over the text. */}
      <div
        ref={(el) => portRef?.(field.outputPath, el)}
        aria-hidden
        className="rounded-full"
        style={{
          position: "absolute", left: -7, top: "50%", transform: "translateY(-50%)",
          width: 13, height: 13, borderRadius: 999,
          // Output connection port — GREEN ring (app.jsx); fills SOLID green on hover/snap.
          background: (hovered || snapped) ? "#2E8E3A" : "#FFFFFF",
          border: "2px solid #2E8E3A",
          boxShadow: snapped ? "0 0 0 3px rgba(46,142,58,0.18)" : undefined,
          flexShrink: 0, transition: "border-color 120ms, box-shadow 120ms",
        }}
      />

      {/* HEADER ROW — the §7.2 TOP LINE: ONE inline flex row of three columns —
          (a) field path [flex-basis ~38%]  ·  (b) source/value [flex 1, shrinks first]  ·
          (c) toggle chips group [rigid, right]. The source/value column is its OWN flex child
          (NOT bundled into the rigid chip cluster), so when the picker pill + value get wide they
          absorb the slack / ellipsize instead of shoving the chips onto a disconnected second
          line (bug 7). align-items center keeps everything on the single baseline; gap 12 per §7.2. */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
        {/* (a) Field path — flex-basis ~38%, shrinkable; the name itself ellipsizes. */}
        {renaming ? (
          <input
            type="text"
            value={draftPath}
            autoFocus
            onChange={(e) => setDraftPath(e.target.value)}
            onBlur={commitRename}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") { setDraftPath(field.outputPath); setRenaming(false); }
            }}
            aria-label={`Rename output field ${field.outputPath}`}
            style={{
              flex: "0 1 38%", minWidth: 0, boxSizing: "border-box", padding: "3px 6px",
              borderRadius: 5, border: "1px solid #A9D3AF", fontSize: 11.5,
              fontFamily: "'JetBrains Mono',monospace", color: "var(--ink, #0B1A2F)",
            }}
          />
        ) : (
          <button
            type="button"
            disabled={!canRename}
            onClick={(e) => { if (canRename) { e.stopPropagation(); setRenaming(true); } }}
            title={canRename ? "Rename output field" : field.outputPath}
            style={{
              flex: "0 1 38%", minWidth: 0, textAlign: "left", border: "none", background: "none",
              cursor: canRename ? "text" : "default", padding: 0, display: "flex", flexDirection: "column", gap: 1,
            }}
          >
            {/* M1: lead with the HUMAN label (readable to a coordinator); the machine
                output path (cbc:ID / BEG03 / OrderRequestHeader@orderID) drops to a quiet,
                smaller monospace second line. Fall back to the path as primary when there is
                no human label, so the headline is never blank. Display only — outputPath is
                still the row key / wire anchor / what gets written. */}
            <span style={{ fontSize: 12.5, fontWeight: 650, color: "var(--ink, #0B1A2F)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {field.label || field.outputPath}
            </span>
            {field.label && field.label !== field.outputPath && (
              <span style={{ fontSize: 10.5, fontFamily: "'JetBrains Mono',monospace", color: "#7A8395", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {field.outputPath}
              </span>
            )}
          </button>
        )}

        {/* (b) SOURCE / VALUE column. PICKER mode: flex 1 so the wide source picker pill absorbs the
            row's slack and ellipsizes instead of shoving the chips onto a second line (bug 7 — §7.2
            column b is flex 1). WIRES mode (classic /inbox): shrink-to-content + margin-left:auto so
            the short status tag stays clustered immediately left of the chips, RIGHT-aligned, exactly
            as before — the classic screen is visually unchanged. */}
        <div style={pickerMode
          ? { display: "flex", alignItems: "center", flex: "0 1 auto", minWidth: 0, marginLeft: "auto" }
          : { display: "flex", alignItems: "center", marginLeft: "auto", minWidth: 0 }}>

          {pickerMode && onPickSource ? (
            // PICKER mode — the row's source is an inline searchable dropdown (no dragging). Picking
            // routes through the host's onPickSource (→ the same wire-connect dispatch).
            <SourcePickerChip
              outputPath={field.outputPath}
              status={status}
              incomingFields={incomingFields ?? []}
              onPickSource={(sourceId) => onPickSource(field.outputPath, sourceId)}
              onPickFixed={startFixedEdit}
              onClear={() => {
                if (wired) onDisconnect?.(field.outputPath);
                else if (status.kind === "fixed") onSetFixedValue?.(field.outputPath, null);
              }}
              readOnly={readOnly}
            />
          ) : (
            <OutgoingStatusTag
              status={status}
              onDisconnect={!readOnly && wired ? onDisconnect : undefined}
              onEditFixed={!readOnly && status.kind === "fixed" && onSetFixedValue ? startFixedEdit : undefined}
            />
          )}
        </div>

        {/* (c) TOGGLE CHIPS group — "= value" + "ƒx", gap 5px, rigid + right-aligned on the SAME top
            line. flexShrink:0 keeps them intact; the source/value column (b) absorbs the slack so
            the chips never wrap to a disconnected second line (bug 7). */}
        <div style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
          {/* Fixed value — meaningful only when not wired and not already a fixed chip (that chip
              is itself the edit affordance). In picker mode the chip's footer owns "= Fixed value…",
              so the inline chip is hidden there. Real control, or disabled-with-reason. */}
          {!readOnly && !pickerMode && !wired && status.kind !== "fixed" && (
            onSetFixedValue ? (
              <RowChipButton
                label="= value"
                title="Set a fixed value to send for this field"
                lit={actionsLit}
                onClick={(e) => { e.stopPropagation(); startFixedEdit(); }}
              />
            ) : (
              <RowChipButton label="= value" lit={actionsLit} disabled reason="Fixed values need an editable mapping" />
            )
          )}

          {/* Transform — opens the manipulator-chain popover (real handler) or disabled-with-reason. */}
          {!readOnly && (
            <div style={{ position: "relative", flexShrink: 0 }}>
              {canEditTransform ? (
                <RowChipButton
                  buttonRef={setFxAnchor}
                  label={chain.length > 0 ? `Edit value · ${chain.length}` : "Edit value"}
                  title={chain.length > 0 ? `${chain.length} adjustment${chain.length === 1 ? "" : "s"} applied — clean up, reformat or recalculate this value before sending` : "Adjust this value — clean up, reformat or recalculate it before sending"}
                  lit={actionsLit}
                  active={chain.length > 0}
                  onClick={(e) => { e.stopPropagation(); setTransformOpen((o) => !o); }}
                />
              ) : (
                <RowChipButton label="Edit value" lit={actionsLit} disabled reason="Editing the value needs an editable mapping (open the order or a draft revision)" />
              )}
              {transformOpen && (
                <TransformPopover
                  outputPath={field.outputPath}
                  manipulators={chain}
                  onChange={(next) => onFieldManipulatorsChange?.(field.outputPath, next, field.scope)}
                  onClose={() => setTransformOpen(false)}
                  anchorEl={fxAnchor}
                />
              )}
            </div>
          )}
        </div>
      </div>

      {/* Resolved value preview (mono) — the real delivered value as far as it's known. */}
      {status.mapped && !fixedEditing && (
        <div style={{ marginTop: 5, display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          <span aria-hidden style={{ fontSize: 8.5, fontWeight: 800, color: "#9AA3B2", flexShrink: 0 }}>
            →
          </span>
          <span style={{ fontFamily: "'JetBrains Mono',monospace", fontVariantNumeric: "tabular-nums", fontSize: 12, fontWeight: 600, color: status.valuePreview ? "#1E6D29" : "#AEB6C4", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {status.valuePreview ?? "—"}
          </span>
        </div>
      )}

      {/* Inline fixed-value editor (transient) — appears under the header while editing, never as a
          permanent disconnected control. */}
      {fixedEditing && (
        <div style={{ marginTop: 6, display: "flex", gap: 5, alignItems: "center" }} onClick={(e) => e.stopPropagation()}>
          <input
            type="text"
            value={draftFixed}
            autoFocus
            onChange={(e) => setDraftFixed(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitFixedEdit();
              if (e.key === "Escape") { setDraftFixed(fixedValue ?? ""); setFixedEditing(false); }
            }}
            placeholder="Fixed value sent for this field"
            aria-label={`Fixed value for ${field.outputPath}`}
            style={{ flex: 1, minWidth: 0, boxSizing: "border-box", padding: "4px 7px", borderRadius: 5, border: "1px solid #C4ABE8", fontSize: 11, color: "var(--ink, #0B1A2F)" }}
          />
          <button
            type="button"
            onClick={commitFixedEdit}
            style={{ border: "1px solid #6F4FCE", background: "#6F4FCE", color: "#FFFFFF", borderRadius: 5, padding: "0 10px", minHeight: 26, fontSize: 10, fontWeight: 700, cursor: "pointer" }}
          >
            Set
          </button>
          {fixedValue != null && (
            <button
              type="button"
              onClick={() => { onSetFixedValue?.(field.outputPath, null); setFixedEditing(false); }}
              title="Clear the fixed value"
              style={{ border: "1px solid #DCE0E8", background: "#FFFFFF", color: "var(--ink-faint)", borderRadius: 5, padding: "0 9px", minHeight: 26, fontSize: 10, fontWeight: 700, cursor: "pointer" }}
            >
              Clear
            </button>
          )}
        </div>
      )}

      {/* INLINE AI-FIX STRIP — a second line inside this same card. Only on a needs-source row that
          has an AI suggestion; otherwise the row keeps just its "pick a field" trigger. */}
      {aiFix && pickerMode && !fixedEditing && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            marginTop: 8,
            marginLeft: -16, marginRight: -10, marginBottom: -8,
            borderTop: "1px solid #F0E7D1",
            background: "#FCFAF4",
            padding: "9px 13px 11px 15px",
            display: "flex", alignItems: "center", gap: 10, minWidth: 0,
            borderBottomLeftRadius: 8, borderBottomRightRadius: 8,
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 9, fontWeight: 800, letterSpacing: "0.03em", color: "#6F4FCE", flexShrink: 0 }}>
            <span aria-hidden style={{ fontSize: 9, lineHeight: 1 }}>✦</span>
            SUGGESTED
          </span>
          {aiFix.value && (
            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontVariantNumeric: "tabular-nums", fontSize: 11.5, fontWeight: 700, color: "#0B1A2F", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flexShrink: 0, maxWidth: 140 }}>
              {aiFix.value}
            </span>
          )}
          <span title={aiFix.rationale} style={{ fontSize: 10.5, color: "#5E6779", flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {aiFix.rationale}
          </span>
          {aiFix.confidence != null && <ConfidenceChip value={aiFix.confidence} sm />}
          <button
            type="button"
            className="mapper-aifix-apply"
            onClick={(e) => { e.stopPropagation(); onPickSource?.(field.outputPath, aiFix.sourceId); }}
            style={{
              height: 26, padding: "0 12px", borderRadius: 6, fontSize: 11, fontWeight: 700,
              color: "#FFFFFF", background: "#2E8E3A", border: "1px solid #1E6D29",
              cursor: "pointer", flexShrink: 0, transition: "background 120ms",
            }}
          >
            Apply
          </button>
        </div>
      )}

      {/* Enrichment slot: catalog/validation badges. */}
      {badgeSlot && (() => { const b = badgeSlot(field); return b ? <div style={{ marginTop: 5 }}>{b}</div> : null; })()}
    </div>
  );
}

// ── Full-width "N fields ready · mapped automatically" collapsible summary ─────
function AutoMappedSummary({ count, open, onToggle }: { count: number; open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      style={{
        // app.jsx OutputColumn summary: white surface + crisp border (not a flat grey pill),
        // greenSoft check chip, "N fields ready · mapped automatically".
        width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
        borderRadius: 10, border: "1px solid #E5E8EE", background: "#FFFFFF", color: "#5E6779", cursor: "pointer",
        textAlign: "left",
      }}
    >
      <span style={{ width: 20, height: 20, borderRadius: "50%", background: "#E9F1EA", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
          <path d="M2.5 6.2 5 8.7l4.5-5" stroke="#1E6D29" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span style={{ fontSize: 12.5, fontWeight: 650, color: "#0B1A2F" }}>
        {count} field{count === 1 ? "" : "s"} ready
      </span>
      <span style={{ fontSize: 11.5 }}>· mapped automatically</span>
      <span aria-hidden style={{ marginLeft: "auto", display: "inline-flex", transform: open ? "rotate(90deg)" : "none", transition: "transform 120ms", color: "#98A0AE" }}>
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
          <path d="M4.5 2.5 8 6l-3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </button>
  );
}

// ── The honest right-side status tag ──────────────────────────────────────────
function OutgoingStatusTag({
  status, onDisconnect, onEditFixed,
}: {
  status: OutgoingFieldStatus;
  onDisconnect?: (outputPath: string) => void;
  /** When set, the fixed-value chip becomes a click-to-edit affordance (direct manipulation). */
  onEditFixed?: () => void;
}) {
  if (status.kind === "wired") {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0, minWidth: 0 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#1E6D29", maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
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
      <button
        type="button"
        onClick={onEditFixed ? (e) => { e.stopPropagation(); onEditFixed(); } : undefined}
        title={onEditFixed ? "Click to edit the fixed value" : "Fixed value"}
        style={{
          display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700, color: "#5E3DB0",
          background: "#F4EFFC", border: "1px solid #E2D6F6", borderRadius: 4, padding: "1px 6px",
          flexShrink: 0, maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          cursor: onEditFixed ? "pointer" : "default",
        }}
      >
        {status.source}
        {onEditFixed && <span aria-hidden style={{ fontSize: 9, opacity: 0.7 }}>✎</span>}
      </button>
    );
  }
  if (status.kind === "auto") {
    return (
      <span title="Filled automatically — carried straight through by the default transform" style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#6B7585", flexShrink: 0 }}>
        auto
      </span>
    );
  }
  // Unmapped: loud amber ONLY when required; otherwise neutral + quiet.
  if (status.required) {
    return (
      <span title="This field must be set before going live — map an incoming field to it or enter a fixed value." style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, fontWeight: 700, color: "#8A6000", background: "#FFF7E6", border: "1px solid #F1E2BE", borderRadius: 4, padding: "1px 6px", flexShrink: 0 }}>
        needs a value
      </span>
    );
  }
  return (
    <span style={{ fontSize: 11, fontWeight: 600, color: "#6B7585", flexShrink: 0 }}>not set</span>
  );
}

// ── Small inline row-action chip (fixed value / transform) ────────────────────
function RowChipButton({
  label, title, onClick, lit, active, disabled, reason, buttonRef,
}: {
  label: string;
  title?: string;
  onClick?: (e: React.MouseEvent) => void;
  /** Quiet at rest, full when the row is hovered/focused or the control is active. */
  lit?: boolean;
  active?: boolean;
  disabled?: boolean;
  reason?: string;
  /** Receives the underlying <button> element — used to anchor the portaled transform popover. */
  buttonRef?: (el: HTMLButtonElement | null) => void;
}) {
  const isDisabled = disabled || !onClick;
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onClick}
      disabled={isDisabled}
      title={isDisabled ? reason : title}
      style={{
        display: "inline-flex", alignItems: "center", gap: 3, height: 26, padding: "0 11px",
        borderRadius: 7, fontSize: 13, fontWeight: 700, letterSpacing: "0.01em",
        whiteSpace: "nowrap", flexShrink: 0,
        border: `1px solid ${active ? "#C4ABE8" : "#E7DEF6"}`,
        background: active ? "#F4EFFC" : "transparent",
        color: isDisabled ? "#C2C8D2" : "#1E66C9",
        opacity: isDisabled ? 0.7 : lit || active ? 1 : 0.55,
        cursor: isDisabled ? "not-allowed" : "pointer",
        transition: "opacity 120ms, background 120ms, border-color 120ms",
      }}
    >
      {label}
    </button>
  );
}

// ── "+ Add output field" — a REAL combobox: searchable canonical picker + custom-field create ──
function AddOutputFieldMenu({
  onAddField, canonicalOptions, existingPaths, fullWidth,
}: {
  onAddField: (outputPath: string, scope: TargetField["scope"]) => void;
  canonicalOptions: CanonicalNode[];
  existingPaths: Set<string>;
  /** Render the trigger as a full-width dashed button (the bottom-of-list "add" affordance). */
  fullWidth?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [customScope, setCustomScope] = useState<TargetField["scope"]>("header");

  // Canonical fields not yet in the output, filtered by the query, grouped header → line.
  const available = useMemo(
    () => canonicalOptions.filter((n) => !existingPaths.has(n.id.toLowerCase())),
    [canonicalOptions, existingPaths],
  );
  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    const filtered = q
      ? available.filter((n) => n.id.toLowerCase().includes(q) || n.label.toLowerCase().includes(q))
      : available;
    return {
      header: filtered.filter((n) => n.scope === "header"),
      line: filtered.filter((n) => n.scope === "line"),
    };
  }, [available, q]);

  const trimmed = query.trim();
  // Offer "create custom" only when the typed name isn't already an exact canonical/existing key.
  const exactExists =
    !!trimmed &&
    (existingPaths.has(trimmed.toLowerCase()) || canonicalOptions.some((n) => n.id.toLowerCase() === trimmed.toLowerCase()));
  const canCreateCustom = !!trimmed && !exactExists;

  function close() {
    setOpen(false);
    setQuery("");
  }
  function addCanonical(node: CanonicalNode) {
    onAddField(node.id, node.scope);
    close();
  }
  function addCustom() {
    if (!canCreateCustom) return;
    onAddField(trimmed, customScope);
    close();
  }

  return (
    <div style={{ position: "relative", ...(fullWidth ? { width: "100%" } : {}) }}>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => { setOpen((o) => !o); setQuery(""); }}
        style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
          border: "1px dashed #A9D3AF", background: "#F4FBF5", color: "#1E6D29",
          borderRadius: 7, padding: "6px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer",
          ...(fullWidth ? { width: "100%", padding: "11px 14px" } : {}),
        }}
      >
        <span aria-hidden style={{ fontSize: 17, lineHeight: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", width: 14, height: 14, marginTop: -1 }}>+</span>
        Add output field
      </button>

      {open && (
        <>
          {/* Click-away scrim (transparent) so the panel closes on outside click. */}
          <div style={{ position: "fixed", inset: 0, zIndex: 30 }} onClick={close} aria-hidden />
          <div
            role="dialog"
            aria-label="Add an output field"
            style={{
              position: "absolute", right: 0, zIndex: 31, width: 340,
              // The bottom (full-width) button sits at the end of the scrollable list, so its panel
              // opens UPWARD to stay in view instead of being clipped below the scroller.
              ...(fullWidth ? { bottom: "100%", marginBottom: 6 } : { top: "100%", marginTop: 6 }),
              background: "#FFFFFF", border: "1px solid #E5E8EE", borderRadius: 10,
              boxShadow: "0 12px 30px rgba(11,26,47,0.16)", overflow: "hidden",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ padding: 8, borderBottom: "1px solid #EEF0F4" }}>
              <input
                type="text"
                value={query}
                autoFocus
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") close();
                  if (e.key === "Enter") {
                    // Enter adds the single canonical match if there's exactly one, else creates custom.
                    const only = [...matches.header, ...matches.line];
                    if (only.length === 1) addCanonical(only[0]);
                    else if (canCreateCustom) addCustom();
                  }
                }}
                placeholder="Search fields, or type a new name…"
                aria-label="Search output fields or type a new field name"
                style={{ width: "100%", boxSizing: "border-box", padding: "6px 9px", borderRadius: 7, border: "1px solid #DCE0E8", fontSize: 11.5, color: "#0B1A2F" }}
              />
            </div>

            <div style={{ maxHeight: 360, overflowY: "auto", padding: 6 }}>
              {matches.header.length === 0 && matches.line.length === 0 ? (
                <div style={{ padding: "8px 6px", fontSize: 10.5, color: "var(--ink-faint)", lineHeight: 1.5 }}>
                  {available.length === 0
                    ? "Every standard field is already in the output. Type a name below to add a custom field."
                    : "No standard field matches. Add it as a custom field below."}
                </div>
              ) : (
                <>
                  {matches.header.length > 0 && (
                    <PickerGroup label="Header fields">
                      {matches.header.map((n) => <PickerItem key={n.id} node={n} onPick={() => addCanonical(n)} />)}
                    </PickerGroup>
                  )}
                  {matches.line.length > 0 && (
                    <PickerGroup label="Line fields">
                      {matches.line.map((n) => <PickerItem key={n.id} node={n} onPick={() => addCanonical(n)} />)}
                    </PickerGroup>
                  )}
                </>
              )}
            </div>

            {/* Custom-create footer — an arbitrary field name + scope (header/line). */}
            {canCreateCustom && (
              <div style={{ borderTop: "1px solid #EEF0F4", padding: 8, display: "flex", flexDirection: "column", gap: 7, background: "#FBFBFD" }}>
                <ScopeToggle scope={customScope} onChange={setCustomScope} />
                <button
                  type="button"
                  onClick={addCustom}
                  style={{
                    display: "flex", alignItems: "center", gap: 6, width: "100%", justifyContent: "center",
                    border: "1px solid #2E8E3A", background: "#2E8E3A", color: "#FFFFFF",
                    borderRadius: 6, padding: "6px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer",
                  }}
                >
                  <span aria-hidden style={{ fontSize: 12, lineHeight: 1 }}>+</span>
                  Add custom field “{trimmed}”
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function PickerGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 4 }}>
      <div style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--ink-faint)", padding: "4px 6px 3px" }}>
        {label}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>{children}</div>
    </div>
  );
}

function PickerItem({ node, onPick }: { node: CanonicalNode; onPick: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      className="mapper-add-field-item"
      onClick={onPick}
      title={node.standardsRef ? `Maps to ${node.standardsRef}` : `Add ${node.label}`}
      style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
        width: "100%", textAlign: "left", border: "none", background: "none", cursor: "pointer",
        padding: "5px 6px", borderRadius: 6,
      }}
    >
      <span style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
        <span style={{ fontSize: 11.5, fontWeight: 600, color: "#0B1A2F", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {node.label}
        </span>
        <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9.5, color: "var(--ink-faint)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {node.id}
        </span>
      </span>
      <span aria-hidden style={{ fontSize: 13, fontWeight: 700, color: "#2E8E3A", flexShrink: 0 }}>+</span>
    </button>
  );
}

function ScopeToggle({ scope, onChange }: { scope: TargetField["scope"]; onChange: (s: TargetField["scope"]) => void }) {
  return (
    <div role="group" aria-label="New field scope" style={{ display: "inline-flex", alignSelf: "flex-start", borderRadius: 6, border: "1px solid #E5E8EE", overflow: "hidden" }}>
      {(["header", "line"] as const).map((s) => {
        const active = scope === s;
        return (
          <button
            key={s}
            type="button"
            onClick={() => onChange(s)}
            aria-pressed={active}
            style={{
              fontSize: 10, fontWeight: 700, textTransform: "capitalize", padding: "3px 10px",
              border: "none", cursor: "pointer",
              background: active ? "#0B1A2F" : "#FFFFFF", color: active ? "#FFFFFF" : "#5E6779",
            }}
          >
            {s}
          </button>
        );
      })}
    </div>
  );
}
