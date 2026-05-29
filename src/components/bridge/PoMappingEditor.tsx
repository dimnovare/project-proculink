"use client";

// PO Mapping Editor — "auto-map" connect view.
// Detects the supplier's source columns, suggests canonical-field mappings, and
// lets the operator confirm/override each one. Persists through the unchanged
// upsertPoMapping contract (PoMappingConfig). See src/lib/api/mapping.ts.

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode, KeyboardEvent as ReactKeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import type { PoMappingConfig, FieldMappingEntry } from "@/lib/api/types";
import {
  getMappingSourceColumns,
  suggestMappingFields,
  type FieldSuggestion,
} from "@/lib/api/mapping";

// ─── Palette (Bridge Layer tokens) ──────────────────────────────────────────
const NAVY = "#0B1A2F";
const BLUE = "#1E66C9";
const BLUE_DEEP = "#0F4FA8";
const BLUE_SOFT = "#E3EDFB";
const GREEN = "#2E8E3A";
const GREEN_DEEP = "#1E6D29";
const GREEN_SOFT = "#E2F1E2";
const BORDER = "#E2E6EE";
const INPUT_BORDER = "#D5DAEA";
const MUTED = "#56627A";
const FAINT = "#8A93A5";
const BG = "#F6F7FA";
const SURFACE = "#FFFFFF";
const SURFACE2 = "#EFF2F7";
const AMBER = "#C97A14";
const AMBER_SOFT = "#FAEFD6";
const AI = "#6F4FCE";
const AI_SOFT = "#EEE7FB";
const DANGER = "#C53A3A";

const ADOPT_THRESHOLD = 0.5; // confidence at/above which a suggestion is pre-filled

// ─── Canonical model ─────────────────────────────────────────────────────────
const CANONICAL_HEADER_FIELDS = ["PoNumber", "OrderDate", "BuyerName", "Currency"] as const;
const CANONICAL_LINE_FIELDS = [
  "LineNumber", "BuyerItemCode", "Description", "Quantity", "Unit", "UnitPrice",
] as const;

type Section = "header" | "lines";

const FIELD_HINT: Record<string, string> = {
  PoNumber: "Purchase order number",
  OrderDate: "Order / document date",
  BuyerName: "Ordering buyer or company",
  Currency: "ISO currency code",
  LineNumber: "Line position",
  BuyerItemCode: "Buyer's item / SKU code",
  Description: "Item description",
  Quantity: "Quantity ordered",
  Unit: "Unit of measure",
  UnitPrice: "Price per unit",
};

// Common cross-standard mapping per canonical field (shown on the std chip).
const FIELD_STANDARDS: Record<string, { ubl: string; x12: string; edifact: string; cxml: string }> = {
  PoNumber:      { ubl: "cbc:ID", x12: "BEG02", edifact: "BGM+220", cxml: "OrderRequestHeader/@orderID" },
  OrderDate:     { ubl: "cbc:IssueDate", x12: "BEG05", edifact: "DTM+137", cxml: "@orderDate" },
  BuyerName:     { ubl: "cac:BuyerCustomerParty", x12: "N1*BY", edifact: "NAD+BY", cxml: "Contact role=buyer" },
  Currency:      { ubl: "cbc:DocumentCurrencyCode", x12: "CUR01", edifact: "CUX", cxml: "Money/@currency" },
  LineNumber:    { ubl: "cac:LineItem/cbc:ID", x12: "PO101", edifact: "LIN", cxml: "ItemOut/@lineNumber" },
  BuyerItemCode: { ubl: "cac:BuyersItemIdentification/cbc:ID", x12: "PO1 (IN)", edifact: "PIA+1", cxml: "SupplierPartAuxiliaryID" },
  Description:   { ubl: "cac:Item/cbc:Description", x12: "PID05", edifact: "IMD+F", cxml: "ItemDetail/Description" },
  Quantity:      { ubl: "cbc:Quantity", x12: "PO102", edifact: "QTY+21", cxml: "ItemOut/@quantity" },
  Unit:          { ubl: "cbc:Quantity/@unitCode", x12: "PO103", edifact: "QTY (UoM)", cxml: "UnitOfMeasure" },
  UnitPrice:     { ubl: "cac:Price/cbc:PriceAmount", x12: "PO104", edifact: "PRI+AAA", cxml: "ItemDetail/UnitPrice/Money" },
};

const fieldsFor = (s: Section) =>
  s === "header" ? CANONICAL_HEADER_FIELDS : CANONICAL_LINE_FIELDS;
const fk = (s: Section, field: string) => `${s}.${field}`;

type Origin = "manual" | "suggested" | "empty";
interface Effective {
  externalField?: string;
  fixedValue?: string;
  fieldManipulators?: FieldMappingEntry["fieldManipulators"];
  origin: Origin;
  confidence?: number;
  reason?: string;
}

interface PoMappingEditorProps {
  supplierId: string;
  initialConfig: PoMappingConfig | null;
  onSave: (config: PoMappingConfig) => Promise<void>;
  onDelete?: () => Promise<void>;
  saving?: boolean;
}

export function PoMappingEditor({
  supplierId,
  initialConfig,
  onSave,
  onDelete,
  saving = false,
}: PoMappingEditorProps) {
  const [activeSection, setActiveSection] = useState<Section>("header");
  const [sourceOpts, setSourceOpts] = useState(() => ({
    hasHeaderRecord: initialConfig?.hasHeaderRecord ?? true,
    separator: initialConfig?.separator ?? ",",
  }));

  // User's explicit choices, keyed by `${section}.${field}`. Presence === touched.
  const [overrides, setOverrides] = useState<Record<string, FieldMappingEntry>>(() =>
    seedFromConfig(initialConfig).overrides
  );
  const [fieldMode, setFieldMode] = useState<Record<string, "column" | "fixed">>(() =>
    seedFromConfig(initialConfig).modes
  );

  const [saveState, setSaveState] = useState<
    { status: "idle" | "saving" | "saved" | "error"; message?: string }
  >({ status: "idle" });
  const [autoNote, setAutoNote] = useState<string | null>(null);
  const autoNoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Detected source columns ──
  const sourceQuery = useQuery({
    queryKey: ["po-mapping-source-columns", supplierId],
    queryFn: () => getMappingSourceColumns(supplierId),
    staleTime: 60_000,
  });
  const detectedColumns = useMemo(() => sourceQuery.data?.columns ?? [], [sourceQuery.data]);
  const sample = sourceQuery.data?.sample;

  // ── Suggestions (real endpoint → falls back to client heuristic) ──
  const suggestQuery = useQuery({
    queryKey: ["po-mapping-suggest", supplierId, detectedColumns],
    queryFn: () => suggestMappingFields(supplierId, detectedColumns),
    enabled: detectedColumns.length > 0,
    staleTime: 60_000,
  });
  const suggestionByField = useMemo(() => {
    const map: Record<string, FieldSuggestion> = {};
    for (const s of suggestQuery.data ?? []) map[s.canonicalField] = s;
    return map;
  }, [suggestQuery.data]);

  // All columns offered by the dropdown: detected + anything the user has typed.
  const allColumns = useMemo(() => {
    const set = new Set<string>(detectedColumns);
    for (const entry of Object.values(overrides)) {
      if (entry.externalField) set.add(entry.externalField);
    }
    return Array.from(set);
  }, [detectedColumns, overrides]);

  useEffect(() => () => {
    if (autoNoteTimer.current) clearTimeout(autoNoteTimer.current);
  }, []);

  function flashNote(msg: string) {
    setAutoNote(msg);
    if (autoNoteTimer.current) clearTimeout(autoNoteTimer.current);
    autoNoteTimer.current = setTimeout(() => setAutoNote(null), 4000);
  }

  // ── Effective value model: override → suggestion → empty ──
  function effective(s: Section, field: string): Effective {
    const key = fk(s, field);
    const ov = overrides[key];
    if (ov !== undefined) {
      const mode = fieldMode[key] ?? (ov.fixedValue && !ov.externalField ? "fixed" : "column");
      if (mode === "fixed") {
        return {
          fixedValue: ov.fixedValue ?? "",
          fieldManipulators: ov.fieldManipulators,
          origin: ov.fixedValue ? "manual" : "empty",
        };
      }
      return {
        externalField: ov.externalField ?? "",
        fieldManipulators: ov.fieldManipulators,
        origin: ov.externalField ? "manual" : "empty",
      };
    }
    const sug = suggestionByField[field];
    if (sug?.suggestedColumn && sug.confidence >= ADOPT_THRESHOLD) {
      return {
        externalField: sug.suggestedColumn,
        origin: "suggested",
        confidence: sug.confidence,
        reason: sug.reason,
      };
    }
    return { origin: "empty" };
  }

  function setOverride(s: Section, field: string, entry: FieldMappingEntry | null) {
    const key = fk(s, field);
    setOverrides((prev) => {
      const next = { ...prev };
      if (entry === null) delete next[key];
      else next[key] = entry;
      return next;
    });
    setSaveState({ status: "idle" });
  }

  function setMode(s: Section, field: string, mode: "column" | "fixed") {
    const key = fk(s, field);
    setFieldMode((prev) => ({ ...prev, [key]: mode }));
    if (mode === "fixed") {
      const eff = effective(s, field);
      setOverride(s, field, { fixedValue: eff.fixedValue ?? "" });
    } else {
      // Drop the override so the field re-adopts its suggestion.
      setOverride(s, field, null);
    }
  }

  function autoMapAll() {
    const next = { ...overrides };
    const modes = { ...fieldMode };
    let filled = 0;
    for (const s of ["header", "lines"] as Section[]) {
      for (const field of fieldsFor(s)) {
        const sug = suggestionByField[field];
        if (sug?.suggestedColumn && sug.confidence >= ADOPT_THRESHOLD) {
          next[fk(s, field)] = { externalField: sug.suggestedColumn };
          modes[fk(s, field)] = "column";
          filled++;
        }
      }
    }
    setOverrides(next);
    setFieldMode(modes);
    setSaveState({ status: "idle" });
    flashNote(filled ? `Auto-mapped ${filled} field${filled === 1 ? "" : "s"}.` : "No confident matches to auto-map.");
  }

  function resetToSuggestions() {
    setOverrides({});
    setFieldMode({});
    setSaveState({ status: "idle" });
    flashNote("Reset to detected suggestions.");
  }

  function buildConfig(): PoMappingConfig {
    const build = (s: Section) => {
      const out: Record<string, FieldMappingEntry> = {};
      for (const field of fieldsFor(s)) {
        const eff = effective(s, field);
        if (eff.origin === "empty") continue;
        const entry: FieldMappingEntry = {};
        if (eff.fixedValue) entry.fixedValue = eff.fixedValue;
        else if (eff.externalField) entry.externalField = eff.externalField;
        else continue;
        if (eff.fieldManipulators?.length) entry.fieldManipulators = eff.fieldManipulators;
        out[field] = entry;
      }
      return out;
    };
    return {
      hasHeaderRecord: sourceOpts.hasHeaderRecord,
      separator: sourceOpts.separator,
      header: build("header"),
      lines: build("lines"),
    };
  }

  async function handleSave() {
    const built = buildConfig();
    setSaveState({ status: "saving" });
    try {
      await onSave(built);
      // Fold the saved mapping into overrides so confirmed fields read as
      // "Manual" (grey) rather than lingering as AI suggestions.
      const nextOv: Record<string, FieldMappingEntry> = {};
      const nextModes: Record<string, "column" | "fixed"> = {};
      for (const s of ["header", "lines"] as Section[]) {
        for (const [field, entry] of Object.entries(built[s])) {
          nextOv[fk(s, field)] = entry;
          if (entry.fixedValue && !entry.externalField) nextModes[fk(s, field)] = "fixed";
        }
      }
      setOverrides(nextOv);
      setFieldMode(nextModes);
      setSaveState({ status: "saved" });
    } catch (e) {
      setSaveState({ status: "error", message: e instanceof Error ? e.message : "Save failed" });
    }
  }

  const isSaving = saving || saveState.status === "saving";
  const mappedCount = useMemo(() => {
    let n = 0;
    for (const s of ["header", "lines"] as Section[])
      for (const field of fieldsFor(s)) if (effective(s, field).origin !== "empty") n++;
    return n;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overrides, fieldMode, suggestionByField]);
  const totalFields = CANONICAL_HEADER_FIELDS.length + CANONICAL_LINE_FIELDS.length;

  const fmt = sourceQuery.data?.format || "";
  const hint = sourceQuery.data?.hint;
  const manualMode = !sourceQuery.isLoading && detectedColumns.length === 0;

  return (
    <div
      className="rounded-[8px] overflow-hidden"
      style={{ border: `1px solid ${BORDER}`, background: SURFACE, boxShadow: "0 1px 2px rgba(11,26,47,0.04)" }}
    >
      {/* Cross-section bridge edge */}
      <div style={{ height: 3, background: `linear-gradient(90deg, ${BLUE}, ${GREEN})` }} />

      {/* Title + source detection */}
      <div className="px-4 py-3.5 sm:px-5" style={{ borderBottom: `1px solid ${BORDER}` }}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h3
              className="text-[15px] font-semibold"
              style={{ color: NAVY, fontFamily: "Bricolage Grotesque, sans-serif", letterSpacing: "-0.01em" }}
            >
              PO field mapping
            </h3>
            <p className="mt-0.5 text-[12.5px]" style={{ color: MUTED }}>
              Connect this supplier&apos;s source columns to the canonical order.
            </p>
          </div>
          <SourceStatus
            loading={sourceQuery.isLoading}
            format={fmt}
            columnCount={detectedColumns.length}
            sourceOrderId={sourceQuery.data?.sourceOrderId ?? null}
            hint={manualMode ? hint : undefined}
            onRedetect={() => sourceQuery.refetch()}
          />
        </div>

        {/* Auto-map controls */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={autoMapAll}
            disabled={detectedColumns.length === 0 || suggestQuery.isFetching}
            className="inline-flex items-center gap-1.5 rounded-[6px] px-3 py-1.5 text-[12px] font-semibold transition-colors"
            style={{
              background: detectedColumns.length === 0 ? SURFACE2 : AI_SOFT,
              color: detectedColumns.length === 0 ? FAINT : AI,
              border: `1px solid ${detectedColumns.length === 0 ? BORDER : "#D9CEF6"}`,
              cursor: detectedColumns.length === 0 ? "not-allowed" : "pointer",
            }}
          >
            <ConnectGlyph color={detectedColumns.length === 0 ? FAINT : AI} />
            {suggestQuery.isFetching ? "Matching…" : "Auto-map all"}
          </button>
          <button
            type="button"
            onClick={resetToSuggestions}
            className="rounded-[6px] px-2.5 py-1.5 text-[12px] font-medium transition-colors"
            style={{ background: "transparent", color: MUTED, border: `1px solid ${BORDER}` }}
          >
            Reset
          </button>
          <span className="text-[12px]" style={{ color: FAINT }}>
            {mappedCount}/{totalFields} fields mapped
          </span>
          {autoNote && (
            <span
              className="rounded-[5px] px-2 py-0.5 text-[11.5px] font-medium"
              style={{ background: BLUE_SOFT, color: BLUE_DEEP }}
            >
              {autoNote}
            </span>
          )}
        </div>

        {manualMode && hint && (
          <div
            className="mt-3 rounded-[6px] px-3 py-2 text-[12px]"
            style={{ background: AMBER_SOFT, color: "#8A5A12", border: "1px solid #EAD9B0" }}
          >
            {hint}
          </div>
        )}
      </div>

      {/* Section toggle + source options */}
      <div
        className="flex flex-col items-stretch gap-3 px-4 py-2.5 sm:px-5 md:flex-row md:items-center md:justify-between"
        style={{ borderBottom: `1px solid ${BORDER}`, background: BG }}
      >
        <div className="flex rounded-[6px] overflow-hidden" style={{ border: `1px solid ${INPUT_BORDER}` }}>
          {(["header", "lines"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setActiveSection(s)}
              className="flex-1 px-3.5 py-1.5 text-[12px] font-medium transition-colors md:flex-none"
              style={{
                background: activeSection === s ? NAVY : SURFACE,
                color: activeSection === s ? "#FFF" : MUTED,
              }}
            >
              {s === "header" ? "Order header" : "Order lines"}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5 text-[12px]" style={{ color: MUTED }}>
            <span>Separator</span>
            <select
              value={sourceOpts.separator}
              onChange={(e) => {
                setSourceOpts((p) => ({ ...p, separator: e.target.value }));
                setSaveState({ status: "idle" });
              }}
              className="rounded-[5px] px-2 py-1 text-[12px]"
              style={{ border: `1px solid ${INPUT_BORDER}`, background: SURFACE, color: NAVY }}
            >
              <option value=",">, (comma)</option>
              <option value=";">; (semicolon)</option>
              <option value={"\t"}>tab</option>
              <option value="|">| (pipe)</option>
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-[12px]" style={{ color: MUTED }}>
            <input
              type="checkbox"
              checked={sourceOpts.hasHeaderRecord}
              onChange={(e) => {
                setSourceOpts((p) => ({ ...p, hasHeaderRecord: e.target.checked }));
                setSaveState({ status: "idle" });
              }}
            />
            Has header row
          </label>
        </div>
      </div>

      {/* Connect view + live preview */}
      <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* Mapping rows */}
        <div className="px-4 py-3 sm:px-5" style={{ borderRight: `1px solid ${BORDER}` }}>
          <div
            className="hidden px-1 pb-2 text-[10.5px] font-semibold uppercase tracking-wide md:grid md:grid-cols-[180px_minmax(0,1fr)]"
            style={{ color: FAINT }}
          >
            <span>Canonical field</span>
            <span>Source column</span>
          </div>
          <div className="flex flex-col">
            {fieldsFor(activeSection).map((field) => {
              const eff = effective(activeSection, field);
              const mode =
                fieldMode[fk(activeSection, field)] ??
                (eff.fixedValue && !eff.externalField ? "fixed" : "column");
              return (
                <FieldRow
                  key={field}
                  field={field}
                  eff={eff}
                  mode={mode}
                  columns={allColumns}
                  weakSuggestion={suggestionByField[field]}
                  onColumnChange={(col) => setOverride(activeSection, field, { externalField: col })}
                  onFixedChange={(val) => setOverride(activeSection, field, { fixedValue: val })}
                  onSetMode={(m) => setMode(activeSection, field, m)}
                  onClear={() => setOverride(activeSection, field, { externalField: "" })}
                />
              );
            })}
          </div>
        </div>

        {/* Live preview */}
        <LivePreview effective={effective} sample={sample} hasSample={!!sample} />
      </div>

      {/* Footer */}
      <div
        className="flex flex-col items-stretch gap-3 px-4 py-3 sm:px-5 sm:flex-row sm:items-center"
        style={{ borderTop: `1px solid ${BORDER}`, background: BG }}
      >
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="text-[12px] font-medium text-left"
            style={{ color: DANGER, background: "none", border: "none", cursor: "pointer" }}
          >
            Delete mapping
          </button>
        )}
        <div className="hidden flex-1 sm:block" />
        <SaveFeedback state={saveState} />
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          className="inline-flex items-center justify-center rounded-[6px] px-4 text-[13px] font-semibold transition-colors"
          style={{ height: 34, background: isSaving ? FAINT : NAVY, color: "#FFF", border: "none", cursor: isSaving ? "default" : "pointer" }}
        >
          {isSaving ? "Saving…" : "Save mapping"}
        </button>
      </div>
    </div>
  );
}

// ─── Source detection status ─────────────────────────────────────────────────
function SourceStatus({
  loading,
  format,
  columnCount,
  sourceOrderId,
  hint,
  onRedetect,
}: {
  loading: boolean;
  format: string;
  columnCount: number;
  sourceOrderId: string | null;
  hint?: string;
  onRedetect: () => void;
}) {
  return (
    <div className="flex items-center gap-2 flex-shrink-0">
      {loading ? (
        <span className="text-[12px]" style={{ color: FAINT }}>Detecting columns…</span>
      ) : columnCount > 0 ? (
        <div className="flex items-center gap-2">
          {format && (
            <span
              className="rounded-[4px] px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide font-mono"
              style={{ background: BLUE_SOFT, color: BLUE_DEEP }}
            >
              {format}
            </span>
          )}
          <span className="text-[12px]" style={{ color: MUTED }}>
            {columnCount} columns
            {sourceOrderId ? <span style={{ color: FAINT }}> · from {sourceOrderId}</span> : null}
          </span>
        </div>
      ) : (
        <span className="text-[12px]" style={{ color: AMBER }} title={hint}>No sample detected</span>
      )}
      <button
        type="button"
        onClick={onRedetect}
        className="rounded-[5px] px-2 py-1 text-[11.5px] font-medium"
        style={{ background: SURFACE, color: BLUE, border: `1px solid ${BORDER}` }}
      >
        Re-detect
      </button>
    </div>
  );
}

// ─── A single canonical-field row ─────────────────────────────────────────────
function FieldRow({
  field,
  eff,
  mode,
  columns,
  weakSuggestion,
  onColumnChange,
  onFixedChange,
  onSetMode,
  onClear,
}: {
  field: string;
  eff: Effective;
  mode: "column" | "fixed";
  columns: string[];
  weakSuggestion?: FieldSuggestion;
  onColumnChange: (col: string) => void;
  onFixedChange: (val: string) => void;
  onSetMode: (m: "column" | "fixed") => void;
  onClear: () => void;
}) {
  const std = FIELD_STANDARDS[field];
  const stdTitle = std
    ? `Common standard mapping for ${field}\nUBL  ${std.ubl}\nX12  ${std.x12}\nEDIFACT  ${std.edifact}\ncXML  ${std.cxml}`
    : undefined;

  // A below-threshold suggestion the user could still apply.
  const showWeak =
    eff.origin === "empty" &&
    mode === "column" &&
    weakSuggestion?.suggestedColumn != null &&
    weakSuggestion.confidence > 0 &&
    weakSuggestion.confidence < ADOPT_THRESHOLD;

  return (
    <div
      className="grid gap-2 py-2.5 md:grid-cols-[180px_minmax(0,1fr)] md:items-start md:gap-3"
      style={{ borderTop: `1px solid #F0F2F7` }}
    >
      {/* Canonical field */}
      <div className="flex items-center gap-2 md:pt-1.5">
        <span className="text-[12.5px] font-medium font-mono" style={{ color: NAVY }}>{field}</span>
        {std && (
          <span
            title={stdTitle}
            className="cursor-help rounded-[3px] px-1 text-[9px] font-semibold uppercase tracking-wide"
            style={{ background: SURFACE2, color: FAINT, borderBottom: `1px dotted ${FAINT}` }}
          >
            std
          </span>
        )}
        <span className="hidden text-[11px] lg:inline" style={{ color: FAINT }}>{FIELD_HINT[field]}</span>
      </div>

      {/* Value control */}
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            {mode === "fixed" ? (
              <input
                type="text"
                value={eff.fixedValue ?? ""}
                placeholder="Fixed value"
                onChange={(e) => onFixedChange(e.target.value)}
                className="w-full rounded-[5px] px-2.5 py-1.5 text-[12px]"
                style={{ border: `1px solid ${INPUT_BORDER}`, color: NAVY, background: SURFACE }}
              />
            ) : (
              <ColumnCombobox
                value={eff.externalField ?? ""}
                options={columns}
                suggested={eff.origin === "suggested"}
                placeholder={columns.length ? "Pick or type a column" : "Type a column name"}
                onChange={onColumnChange}
              />
            )}
          </div>
          <Badge eff={eff} mode={mode} />
        </div>

        {/* Sub-row: mode switch · reason · weak suggestion */}
        <div className="mt-1 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => onSetMode(mode === "fixed" ? "column" : "fixed")}
            className="text-[11px] font-medium"
            style={{ color: BLUE, background: "none", border: "none", cursor: "pointer", padding: 0 }}
          >
            {mode === "fixed" ? "Use source column" : "Use fixed value"}
          </button>
          {eff.origin === "suggested" && eff.reason && (
            <span className="truncate text-[11px]" style={{ color: AI }} title={eff.reason}>
              {eff.reason}
            </span>
          )}
          {eff.origin === "manual" && mode === "column" && eff.externalField && (
            <button
              type="button"
              onClick={onClear}
              className="text-[11px]"
              style={{ color: FAINT, background: "none", border: "none", cursor: "pointer", padding: 0 }}
            >
              Clear
            </button>
          )}
        </div>

        {showWeak && weakSuggestion?.suggestedColumn && (
          <button
            type="button"
            onClick={() => onColumnChange(weakSuggestion.suggestedColumn as string)}
            className="mt-1 inline-flex items-center gap-1 text-[11px]"
            style={{ color: AI, background: "none", border: "none", cursor: "pointer", padding: 0 }}
            title={weakSuggestion.reason}
          >
            <span className="font-semibold">AI</span>
            <span style={{ color: MUTED }}>
              try “{weakSuggestion.suggestedColumn}” ({Math.round(weakSuggestion.confidence * 100)}%)
            </span>
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Confidence / origin badge ────────────────────────────────────────────────
function Badge({ eff, mode }: { eff: Effective; mode: "column" | "fixed" }) {
  if (mode === "fixed") {
    return (
      <span
        className="flex-shrink-0 rounded-[4px] px-1.5 py-0.5 text-[10.5px] font-semibold"
        style={{ background: SURFACE2, color: MUTED }}
      >
        Fixed
      </span>
    );
  }
  if (eff.origin === "suggested" && eff.confidence != null) {
    const pct = Math.round(eff.confidence * 100);
    const strong = eff.confidence >= 0.8;
    return (
      <span className="flex flex-shrink-0 items-center gap-1">
        <span className="text-[9.5px] font-bold" style={{ color: AI }}>AI</span>
        <span
          className="rounded-[4px] px-1.5 py-0.5 text-[10.5px] font-semibold"
          style={{
            background: strong ? GREEN_SOFT : AMBER_SOFT,
            color: strong ? GREEN_DEEP : AMBER,
          }}
        >
          {pct}%
        </span>
      </span>
    );
  }
  if (eff.origin === "manual") {
    return (
      <span
        className="flex-shrink-0 rounded-[4px] px-1.5 py-0.5 text-[10.5px] font-semibold"
        style={{ background: SURFACE2, color: MUTED }}
      >
        Manual
      </span>
    );
  }
  return (
    <span className="flex-shrink-0 text-[10.5px] font-medium" style={{ color: FAINT }}>
      Unmapped
    </span>
  );
}

// ─── Live preview of a sample crossing ────────────────────────────────────────
function LivePreview({
  effective,
  sample,
  hasSample,
}: {
  effective: (s: Section, field: string) => Effective;
  sample?: Record<string, string>;
  hasSample: boolean;
}) {
  function resolve(s: Section, field: string): { node: ReactNode; muted: boolean } {
    const eff = effective(s, field);
    if (eff.fixedValue) return { node: eff.fixedValue, muted: false };
    if (eff.externalField) {
      const val = sample?.[eff.externalField];
      if (val != null) return { node: val, muted: false };
      return { node: <span style={{ color: BLUE }}>‹{eff.externalField}›</span>, muted: true };
    }
    return { node: "—", muted: true };
  }

  return (
    <div className="px-4 py-3 sm:px-5" style={{ background: BG }}>
      <div className="flex items-center gap-1.5">
        <Dot />
        <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: MUTED }}>
          Live preview
        </span>
      </div>
      <p className="mt-1 text-[11px]" style={{ color: FAINT }}>
        {hasSample ? "Sample crossing mapped to canonical values." : "Connect a sample to preview values — showing mapped columns."}
      </p>

      <div
        className="mt-2.5 rounded-[6px] p-3"
        style={{ background: SURFACE, border: `1px solid ${BORDER}` }}
      >
        <div className="text-[9.5px] font-semibold uppercase tracking-wide" style={{ color: BLUE_DEEP }}>
          Header
        </div>
        <dl className="mt-1.5 flex flex-col gap-1">
          {CANONICAL_HEADER_FIELDS.map((field) => {
            const r = resolve("header", field);
            return (
              <div key={field} className="flex items-baseline justify-between gap-3">
                <dt className="text-[11px] font-mono" style={{ color: MUTED }}>{field}</dt>
                <dd className="truncate text-[11.5px] font-mono text-right" style={{ color: r.muted ? FAINT : NAVY }} title={typeof r.node === "string" ? r.node : undefined}>
                  {r.node}
                </dd>
              </div>
            );
          })}
        </dl>

        <div className="mt-3 text-[9.5px] font-semibold uppercase tracking-wide" style={{ color: GREEN_DEEP }}>
          Line 1
        </div>
        <dl className="mt-1.5 flex flex-col gap-1">
          {CANONICAL_LINE_FIELDS.map((field) => {
            const r = resolve("lines", field);
            return (
              <div key={field} className="flex items-baseline justify-between gap-3">
                <dt className="text-[11px] font-mono" style={{ color: MUTED }}>{field}</dt>
                <dd className="truncate text-[11.5px] font-mono text-right" style={{ color: r.muted ? FAINT : NAVY }} title={typeof r.node === "string" ? r.node : undefined}>
                  {r.node}
                </dd>
              </div>
            );
          })}
        </dl>
      </div>
    </div>
  );
}

// ─── Save feedback ─────────────────────────────────────────────────────────────
function SaveFeedback({ state }: { state: { status: string; message?: string } }) {
  if (state.status === "saved") {
    return (
      <span className="flex items-center gap-1.5 text-[12px] font-medium" style={{ color: GREEN_DEEP }}>
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="M3 8.5l3.2 3.2L13 5" stroke={GREEN} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Mapping saved
      </span>
    );
  }
  if (state.status === "error") {
    return (
      <span className="text-[12px] font-medium" style={{ color: DANGER }} title={state.message}>
        Couldn&apos;t save — {state.message || "try again"}
      </span>
    );
  }
  return null;
}

// ─── Editable searchable column dropdown ──────────────────────────────────────
function ColumnCombobox({
  value,
  options,
  suggested,
  placeholder,
  onChange,
}: {
  value: string;
  options: string[];
  suggested?: boolean;
  placeholder?: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocPointer(e: PointerEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onDocPointer);
    return () => document.removeEventListener("pointerdown", onDocPointer);
  }, [open]);

  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (showAll || !q) return options;
    return options.filter((o) => o.toLowerCase().includes(q));
  }, [options, value, showAll]);

  function commit(v: string) {
    onChange(v);
    setOpen(false);
    setShowAll(false);
  }

  function onKeyDown(e: ReactKeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) { setOpen(true); setShowAll(true); return; }
      setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      if (open && filtered[active]) { e.preventDefault(); commit(filtered[active]); }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <div className="relative">
        <input
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          value={value}
          placeholder={placeholder}
          onChange={(e) => { onChange(e.target.value); setOpen(true); setShowAll(false); setActive(0); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className="w-full rounded-[5px] py-1.5 pl-2.5 pr-7 text-[12px]"
          style={{
            border: `1px solid ${suggested ? "#CBB8F2" : INPUT_BORDER}`,
            color: NAVY,
            background: suggested ? "#FBFAFE" : SURFACE,
          }}
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label="Toggle column list"
          onClick={() => { setOpen((o) => !o); setShowAll(true); setActive(0); }}
          className="absolute right-1 top-1/2 -translate-y-1/2 px-1"
          style={{ background: "none", border: "none", cursor: "pointer", color: FAINT }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
            <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {open && filtered.length > 0 && (
        <ul
          role="listbox"
          className="absolute z-20 mt-1 max-h-52 w-full overflow-auto rounded-[6px] py-1"
          style={{ background: SURFACE, border: `1px solid ${INPUT_BORDER}`, boxShadow: "0 6px 20px rgba(11,26,47,0.12)" }}
        >
          {filtered.map((opt, i) => (
            <li
              key={opt}
              role="option"
              aria-selected={opt === value}
              onMouseEnter={() => setActive(i)}
              onPointerDown={(e) => { e.preventDefault(); commit(opt); }}
              className="cursor-pointer px-2.5 py-1.5 text-[12px] font-mono"
              style={{
                background: i === active ? BLUE_SOFT : opt === value ? "#F4F7FD" : "transparent",
                color: NAVY,
              }}
            >
              {opt}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Small glyphs ──────────────────────────────────────────────────────────────
function ConnectGlyph({ color }: { color: string }) {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="3.5" cy="8" r="2.2" stroke={color} strokeWidth="1.5" />
      <circle cx="12.5" cy="8" r="2.2" stroke={color} strokeWidth="1.5" />
      <path d="M5.7 8h4.6" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function Dot() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="3.5" cy="8" r="2" fill={BLUE} />
      <circle cx="12.5" cy="8" r="2" fill={GREEN} />
      <path d="M5.5 8h5" stroke="#9AA7BC" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

// ─── Seed local state from a saved config ──────────────────────────────────────
function seedFromConfig(config: PoMappingConfig | null): {
  overrides: Record<string, FieldMappingEntry>;
  modes: Record<string, "column" | "fixed">;
} {
  const overrides: Record<string, FieldMappingEntry> = {};
  const modes: Record<string, "column" | "fixed"> = {};
  if (config) {
    for (const s of ["header", "lines"] as Section[]) {
      for (const [field, entry] of Object.entries(config[s] ?? {})) {
        if (entry && (entry.externalField || entry.fixedValue)) {
          overrides[`${s}.${field}`] = entry;
          if (entry.fixedValue && !entry.externalField) modes[`${s}.${field}`] = "fixed";
        }
      }
    }
  }
  return { overrides, modes };
}
