"use client";

// OutputMappingEditor — the power-user "map & manipulate" panel for one order.
// Pick how each delivered field is built: its source (a canonical field, a per-order
// custom field, or a fixed value) + an optional manipulator chain (the existing
// ManipulatorRegistry: Trim/Replace/DateFormat/Concat/Fallback/Split/Multiply/Divide),
// with a live dry-run preview. Persists via PUT /mapping-override; no override = unchanged.
//
// IMPORTANT (focus bug history): every sub-component here is declared at MODULE level and
// rendered with a stable key. Declaring them inside OutputMappingEditor remounts them on
// each keystroke (new function identity) → inputs lose focus. Do NOT inline them again.
//
// Visual drag-to-connect lives in the ORDER-VIEW wires (SpineReview), not here — this panel
// is the explicit, keyboard-friendly form. The saved draft must CARRY the existing
// sourceMap through (PUT replaces the whole override document — see buildOverrideDraft),
// and the dialog renders via createPortal to document.body because its inline mount sits
// inside a `position: sticky` column whose stacking context would trap it under the rails.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getMappingOverride, upsertMappingOverride, previewMappingOverride,
} from "@/lib/api-client";
import {
  MANIPULATOR_TYPES, CANONICAL_HEADER_FIELDS, CANONICAL_LINE_FIELDS,
  SCRIBAN_TEMPLATE_GROUPS, TEMPLATE_CONTENT_TYPES, PREVIEW_FORMATS, SCRIBAN_STARTER_TEMPLATE,
  type OrderMappingOverride, type OutputFieldRule, type ManipulatorEntry, type CustomField,
  type OutputFormatId, type SourceFieldRule,
} from "@/lib/api/types";

type Scope = "header" | "lines";
type Row = { id: string; rule: OutputFieldRule };
type CustomRow = { id: string; field: CustomField };

let _rid = 0;
const newId = () => `r${++_rid}`;

const FIXED = "__fixed__";

function toRows(rec: Record<string, OutputFieldRule> | undefined): Row[] {
  return Object.entries(rec ?? {}).map(([, rule]) => ({ id: newId(), rule: { fieldManipulators: [], ...rule } }));
}
function toRecord(rows: Row[]): Record<string, OutputFieldRule> {
  const out: Record<string, OutputFieldRule> = {};
  rows.forEach((r, i) => { out[r.rule.outputPath?.trim() || `field_${i + 1}`] = r.rule; });
  return out;
}
function toCustomRows(fields: CustomField[] | undefined): CustomRow[] {
  return (fields ?? []).map((field) => ({ id: newId(), field }));
}
function sanitizeKey(raw: string): string {
  return raw.replace(/[^A-Za-z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
}
const CANONICAL_LOWER = new Set(
  [...CANONICAL_HEADER_FIELDS, ...CANONICAL_LINE_FIELDS].map((f) => f.toLowerCase()),
);

/**
 * Build the override draft this editor saves/previews. PURE — unit-tested.
 *
 * CRITICAL: `existingSourceMap` must be the sourceMap from the CURRENT server
 * override. The backend PUT replaces the WHOLE mappingOverride sub-document, so
 * omitting sourceMap here silently destroys every drag-wired source→canonical
 * mapping the user made in the order view (founder-reported data loss).
 */
export function buildOverrideDraft(opts: {
  customFields: CustomField[];
  header: Record<string, OutputFieldRule>;
  lines: Record<string, OutputFieldRule>;
  templateMode: boolean;
  template: string;
  templateContentType: string;
  existingSourceMap?: Record<string, SourceFieldRule> | null;
}): OrderMappingOverride {
  const base: OrderMappingOverride = {
    customFields: opts.customFields,
    output: { header: opts.header, lines: opts.lines },
    // Carry the drag-wired source mappings through unchanged — this editor
    // only edits the OUTPUT side.
    sourceMap: opts.existingSourceMap ?? null,
  };
  // Template mode takes precedence on the backend; only send the template when
  // the toggle is on AND it's non-blank, so flipping the toggle off clears it.
  if (opts.templateMode && opts.template.trim().length > 0) {
    base.outputTemplate = opts.template;
    base.outputTemplateContentType = opts.templateContentType;
  } else {
    base.outputTemplate = null;
    base.outputTemplateContentType = null;
  }
  return base;
}

const inputStyle: React.CSSProperties = {
  minHeight: 36, border: "1px solid #C6CDDA", borderRadius: 6, padding: "5px 8px", fontSize: 12.5,
};

// ── Module-level sub-components (stable identity → inputs keep focus) ──────────

function ManipChip({ entry, onChange, onRemove }: {
  entry: ManipulatorEntry; onChange: (e: ManipulatorEntry) => void; onRemove: () => void;
}) {
  const spec = MANIPULATOR_TYPES.find((t) => t.type === entry.type);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "#EEE7FB", border: "1px solid #DACEF3", borderRadius: 6, padding: "3px 6px" }}>
      <span title={spec?.hint} style={{ fontSize: 11, fontWeight: 700, color: "#5E3DB0" }}>{entry.type}</span>
      {(spec?.params ?? []).map((p, i) => (
        <input key={i} value={entry.params[i] ?? ""}
          onChange={(e) => { const params = [...entry.params]; params[i] = e.target.value; onChange({ ...entry, params }); }}
          placeholder={p} aria-label={`${entry.type} ${p}`}
          style={{ width: 60, minHeight: 24, border: "1px solid #C4ABE8", borderRadius: 4, padding: "1px 4px", fontSize: 10.5, fontFamily: "'JetBrains Mono',monospace" }} />
      ))}
      <button type="button" onClick={onRemove} aria-label={`Remove ${entry.type}`} style={{ border: "none", background: "transparent", color: "#8E7CB8", cursor: "pointer", fontSize: 12, lineHeight: 1 }}>✕</button>
    </span>
  );
}

function RuleRow({ row, sources, onChange, onRemove }: {
  row: Row;
  sources: string[];
  onChange: (patch: Partial<OutputFieldRule>) => void;
  onRemove: () => void;
}) {
  const rule = row.rule;
  const usingFixed = rule.fixedValue != null && (rule.canonicalField == null || rule.canonicalField === "");
  return (
    <div style={{ border: "1px solid #E2E6EE", borderRadius: 8, padding: 10, background: "#FFFFFF" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input
          value={rule.outputPath ?? ""}
          onChange={(e) => onChange({ outputPath: e.target.value })}
          placeholder="delivered field name"
          aria-label="Output field name"
          style={{ ...inputStyle, flex: "1 1 140px", minWidth: 120, fontFamily: "'JetBrains Mono',monospace" }}
        />
        <span style={{ color: "var(--ink-faint)", fontSize: 13 }} aria-hidden>=</span>
        <select
          value={usingFixed ? FIXED : (rule.canonicalField ?? "")}
          onChange={(e) => {
            const v = e.target.value;
            if (v === FIXED) onChange({ canonicalField: null, fixedValue: rule.fixedValue ?? "" });
            else onChange({ canonicalField: v || null, fixedValue: null });
          }}
          aria-label="Source field"
          style={{ ...inputStyle, flex: "1 1 150px", minWidth: 140, background: "#FFFFFF" }}
        >
          <option value="">— pick a source —</option>
          <optgroup label="Order/line fields">
            {sources.map((s) => <option key={s} value={s}>{s}</option>)}
          </optgroup>
          <option value={FIXED}>Fixed value…</option>
        </select>
        {usingFixed && (
          <input
            value={rule.fixedValue ?? ""}
            onChange={(e) => onChange({ fixedValue: e.target.value })}
            placeholder="fixed value"
            aria-label="Fixed value"
            style={{ ...inputStyle, flex: "1 1 110px", minWidth: 90 }}
          />
        )}
        <button type="button" onClick={onRemove} aria-label="Remove field"
          style={{ minHeight: 36, padding: "0 10px", border: "none", background: "transparent", color: "#C53A3A", cursor: "pointer", fontSize: 13 }}>✕</button>
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
        <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--ink-faint)" }}>then</span>
        {(rule.fieldManipulators ?? []).map((m, mi) => (
          <ManipChip key={mi} entry={m}
            onChange={(next) => onChange({ fieldManipulators: rule.fieldManipulators.map((x, i) => i === mi ? next : x) })}
            onRemove={() => onChange({ fieldManipulators: rule.fieldManipulators.filter((_, i) => i !== mi) })}
          />
        ))}
        <select value="" aria-label="Add a transform"
          onChange={(e) => {
            const t = MANIPULATOR_TYPES.find((x) => x.type === e.target.value);
            if (!t) return;
            onChange({ fieldManipulators: [...(rule.fieldManipulators ?? []), { type: t.type, params: t.params.map(() => "") }] });
          }}
          style={{ minHeight: 28, border: "1px dashed #C6CDDA", borderRadius: 6, padding: "2px 6px", fontSize: 11.5, color: "#56627A", background: "#F6F7FA" }}>
          <option value="">+ transform</option>
          {MANIPULATOR_TYPES.map((t) => <option key={t.type} value={t.type} title={t.hint}>{t.type}</option>)}
        </select>
      </div>
    </div>
  );
}

function RuleSection({ title, scope, rows, sources, setRows }: {
  title: string;
  scope: Scope;
  rows: Row[];
  sources: string[];
  setRows: (r: Row[]) => void;
}) {
  return (
    <section>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#56627A", marginBottom: 8 }}>{title}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.length === 0 && (
          <div style={{ fontSize: 12, color: "var(--ink-faint)", padding: "2px 0" }}>None — the default transform is used for {scope === "header" ? "header" : "line"} fields. Add one to override it.</div>
        )}
        {rows.map((r) => (
          <RuleRow key={r.id} row={r} sources={sources}
            onChange={(patch) => setRows(rows.map((x) => x.id === r.id ? { ...x, rule: { ...x.rule, ...patch } } : x))}
            onRemove={() => setRows(rows.filter((x) => x.id !== r.id))}
          />
        ))}
        <button type="button"
          onClick={() => setRows([...rows, { id: newId(), rule: { outputPath: "", fieldManipulators: [] } }])}
          style={{ alignSelf: "flex-start", fontSize: 12, fontWeight: 600, color: "#1E66C9", background: "#FFFFFF", border: "1px solid #1E66C9", borderRadius: 6, padding: "6px 12px", cursor: "pointer", minHeight: 34 }}>
          + Add {scope === "header" ? "header" : "line"} field
        </button>
      </div>
    </section>
  );
}

function CustomFieldsSection({ rows, setRows }: { rows: CustomRow[]; setRows: (r: CustomRow[]) => void }) {
  return (
    <section>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#56627A" }}>Custom fields</span>
        <span style={{ fontSize: 11, color: "var(--ink-faint)" }}>a value the file didn&apos;t carry — usable as a source below</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.length === 0 && <div style={{ fontSize: 12, color: "var(--ink-faint)" }}>None yet.</div>}
        {rows.map((c) => {
          const key = sanitizeKey(c.field.key || c.field.label);
          const collides = key.length > 0 && CANONICAL_LOWER.has(key.toLowerCase());
          const set = (patch: Partial<CustomField>) =>
            setRows(rows.map((x) => x.id === c.id ? { ...x, field: { ...x.field, ...patch } } : x));
          return (
            <div key={c.id} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input value={c.field.label} onChange={(e) => set({ label: e.target.value })}
                placeholder="Label (e.g. Contract no.)" aria-label="Custom field label"
                style={{ ...inputStyle, flex: "1 1 140px", minWidth: 110 }} />
              <input value={c.field.key} onChange={(e) => set({ key: e.target.value })}
                placeholder="key" aria-label="Custom field key"
                style={{ ...inputStyle, flex: "1 1 100px", minWidth: 80, fontFamily: "'JetBrains Mono',monospace", color: "#5E3DB0", borderColor: collides ? "#C53A3A" : "#C6CDDA" }} />
              <span style={{ color: "var(--ink-faint)", fontSize: 12 }}>=</span>
              <input value={c.field.value ?? ""} onChange={(e) => set({ value: e.target.value })}
                placeholder="value" aria-label="Custom field value"
                style={{ ...inputStyle, flex: "1 1 140px", minWidth: 110 }} />
              <button type="button" onClick={() => setRows(rows.filter((x) => x.id !== c.id))} aria-label="Remove custom field"
                style={{ minHeight: 36, padding: "0 10px", border: "none", background: "transparent", color: "#C53A3A", cursor: "pointer", fontSize: 13 }}>✕</button>
              {collides && <div style={{ flexBasis: "100%", fontSize: 10.5, color: "#C53A3A" }}>“{key}” clashes with a built-in field name — rename it.</div>}
            </div>
          );
        })}
        <button type="button"
          onClick={() => setRows([...rows, { id: newId(), field: { key: "", label: "", scope: "header", value: "" } }])}
          style={{ alignSelf: "flex-start", fontSize: 12, fontWeight: 600, color: "#5E3DB0", background: "#FFFFFF", border: "1px solid #C4ABE8", borderRadius: 6, padding: "6px 12px", cursor: "pointer", minHeight: 34 }}>
          + Add custom field
        </button>
      </div>
    </section>
  );
}

// ── Template-mode sub-components (module-level → stable identity) ──────────────

const DEFAULT_TEMPLATE_CONTENT_TYPE = "application/json";

function TemplateReferencePanel({ onInsert }: { onInsert: (token: string) => void }) {
  return (
    <section aria-label="Available template fields"
      style={{ border: "1px solid #E2E6EE", borderRadius: 8, background: "#FFFFFF", padding: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#56627A", marginBottom: 4 }}>
        Proposed structure / available fields
      </div>
      <div style={{ fontSize: 11, color: "var(--ink-faint)", marginBottom: 10 }}>
        Click a field to insert its token at the cursor. Numbers (Qty, UnitPrice…) emit unquoted.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {SCRIBAN_TEMPLATE_GROUPS.map((group) => (
          <div key={group.label}>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: "#5E3DB0", marginBottom: 6 }}>{group.label}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {group.fields.map((f) => (
                <button key={f.token} type="button" onClick={() => onInsert(f.token)}
                  title={f.hint || f.token}
                  style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10.5, color: "#5E3DB0", background: "#EEE7FB", border: "1px solid #DACEF3", borderRadius: 6, padding: "3px 7px", cursor: "pointer", lineHeight: 1.3 }}>
                  {f.token}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function TemplateEditor({
  template, contentType, onTemplateChange, onContentTypeChange, onInsertStarter, textareaRef,
}: {
  template: string;
  contentType: string;
  onTemplateChange: (v: string) => void;
  onContentTypeChange: (v: string) => void;
  onInsertStarter: () => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  return (
    <section>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#56627A" }}>
          Document template
        </span>
        <div style={{ flex: 1 }} />
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "#56627A" }}>
          Content type
          <select value={contentType} onChange={(e) => onContentTypeChange(e.target.value)} aria-label="Template content type"
            style={{ minHeight: 30, border: "1px solid #C6CDDA", borderRadius: 6, padding: "3px 8px", fontSize: 12, background: "#FFFFFF" }}>
            {TEMPLATE_CONTENT_TYPES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </label>
        <button type="button" onClick={onInsertStarter}
          style={{ fontSize: 11.5, fontWeight: 600, color: "#1E66C9", background: "#FFFFFF", border: "1px solid #1E66C9", borderRadius: 6, padding: "5px 10px", cursor: "pointer", minHeight: 30 }}>
          Insert starter template
        </button>
      </div>
      <textarea
        ref={textareaRef}
        value={template}
        onChange={(e) => onTemplateChange(e.target.value)}
        spellCheck={false}
        aria-label="Scriban output template"
        placeholder={'Write a Scriban template that renders the whole document, e.g.\n{ "po": "{{ OrderNr }}", "lines": [{{ for Line in Lines }}…{{ end }}] }'}
        style={{
          width: "100%", minHeight: 280, resize: "vertical",
          border: "1px solid #C6CDDA", borderRadius: 8, padding: 12,
          fontSize: 12, lineHeight: 1.5, fontFamily: "'JetBrains Mono',monospace",
          color: "#0B1A2F", background: "#FFFFFF", boxSizing: "border-box", whiteSpace: "pre", overflowWrap: "normal", overflowX: "auto",
        }}
      />
    </section>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function OutputMappingEditor({
  orderId, open, onClose,
}: {
  orderId: string;
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { data: existing, isSuccess: existingLoaded, isError: existingError } = useQuery({
    queryKey: ["mapping-override", orderId],
    queryFn: () => getMappingOverride(orderId),
    enabled: open,
    staleTime: 10_000,
  });

  // Portal mount guard — document.body only exists client-side after mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const [headerRows, setHeaderRows] = useState<Row[]>([]);
  const [lineRows, setLineRows]     = useState<Row[]>([]);
  const [customRows, setCustomRows] = useState<CustomRow[]>([]);
  const [format, setFormat]         = useState<OutputFormatId>("csv");
  const [seeded, setSeeded]         = useState(false);

  // Template mode (whole-document Scriban). Off = the field-by-field UI (default).
  const [templateMode, setTemplateMode]   = useState(false);
  const [template, setTemplate]           = useState("");
  const [templateContentType, setTemplateContentType] = useState(DEFAULT_TEMPLATE_CONTENT_TYPE);
  const templateRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!open) { setSeeded(false); return; }
    if (seeded) return;
    // Seed ONLY once the override query has SETTLED. Seeding while the fetch
    // was still in flight latched an EMPTY editor over a saved override on a
    // cold cache — and a Save then persisted the empty draft (data loss).
    if (!existingLoaded && !existingError) return;
    setHeaderRows(toRows(existing?.output?.header));
    setLineRows(toRows(existing?.output?.lines));
    setCustomRows(toCustomRows(existing?.customFields));
    const tmpl = existing?.outputTemplate ?? "";
    setTemplate(tmpl);
    setTemplateContentType(existing?.outputTemplateContentType ?? DEFAULT_TEMPLATE_CONTENT_TYPE);
    setTemplateMode(tmpl.trim().length > 0);
    setSeeded(true);
  }, [open, seeded, existing, existingLoaded, existingError]);

  // Insert a token at the textarea caret (or append). Keeps focus + selection sane.
  const insertToken = useCallback((token: string) => {
    const el = templateRef.current;
    setTemplate((prev) => {
      if (!el) return prev + token;
      const start = el.selectionStart ?? prev.length;
      const end = el.selectionEnd ?? prev.length;
      const next = prev.slice(0, start) + token + prev.slice(end);
      // Restore caret just after the inserted token on the next tick.
      requestAnimationFrame(() => {
        el.focus();
        const pos = start + token.length;
        el.setSelectionRange(pos, pos);
      });
      return next;
    });
  }, []);

  const insertStarter = useCallback(() => {
    setTemplate(SCRIBAN_STARTER_TEMPLATE);
    setTemplateContentType("application/json");
  }, []);

  // Header-scoped custom fields (one value each), available as a source to both scopes.
  const customFields: CustomField[] = useMemo(
    () => customRows
      .map((c) => ({ ...c.field, key: sanitizeKey(c.field.key || c.field.label), scope: "header" as const }))
      .filter((c) => c.key.length > 0),
    [customRows],
  );
  const customKeys = useMemo(() => customFields.map((c) => c.key), [customFields]);
  const headerSources = useMemo(() => [...CANONICAL_HEADER_FIELDS, ...customKeys], [customKeys]);
  const lineSources   = useMemo(() => [...CANONICAL_LINE_FIELDS, ...CANONICAL_HEADER_FIELDS, ...customKeys], [customKeys]);

  const trimmedTemplate = template.trim();
  const draft: OrderMappingOverride = useMemo(
    () => buildOverrideDraft({
      customFields,
      header: toRecord(headerRows),
      lines: toRecord(lineRows),
      templateMode,
      template,
      templateContentType,
      // Preserve the drag-wired source mappings (PUT replaces the whole
      // override document — see buildOverrideDraft).
      existingSourceMap: existing?.sourceMap ?? null,
    }),
    [customFields, headerRows, lineRows, templateMode, template, templateContentType, existing],
  );

  const [preview, setPreview] = useState<{ content: string | null; warning?: string; error?: string } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  // In template mode preview renders the chosen content type, not a CSV/JSON/… format.
  const previewFormat = templateMode ? templateContentType.replace(/^.*\//, "") : format;
  const blankTemplate = templateMode && trimmedTemplate.length === 0;
  const debRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!open || !seeded) return;
    if (blankTemplate) { setPreview(null); return; }
    if (debRef.current) clearTimeout(debRef.current);
    // Slightly faster debounce (≈400ms) so the template editor feels live.
    debRef.current = setTimeout(async () => {
      setPreviewing(true);
      try {
        const r = await previewMappingOverride(orderId, draft, templateMode ? "json" : format);
        setPreview({ content: r.content, warning: r.warning, error: r.error ?? undefined });
      } catch (e) {
        setPreview({ content: null, error: e instanceof Error ? e.message : "Preview failed" });
      } finally { setPreviewing(false); }
    }, 400);
    return () => { if (debRef.current) clearTimeout(debRef.current); };
  }, [orderId, draft, format, open, seeded, templateMode, blankTemplate]);

  const save = useMutation({
    mutationFn: () => upsertMappingOverride(orderId, draft),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["mapping-override", orderId] });
      await qc.invalidateQueries({ queryKey: ["order", orderId] });
      onClose();
    },
  });
  const reset = useMutation({
    mutationFn: () => upsertMappingOverride(orderId, {
      customFields: [], output: { header: {}, lines: {} }, outputTemplate: null, outputTemplateContentType: null,
      // "Reset to default" resets only what THIS editor edits (the output
      // side). The drag-wired source mappings from the order view stay.
      sourceMap: existing?.sourceMap ?? null,
    }),
    onSuccess: async () => {
      setHeaderRows([]); setLineRows([]); setCustomRows([]);
      setTemplate(""); setTemplateContentType(DEFAULT_TEMPLATE_CONTENT_TYPE); setTemplateMode(false);
      await qc.invalidateQueries({ queryKey: ["mapping-override", orderId] });
      await qc.invalidateQueries({ queryKey: ["order", orderId] });
    },
  });

  // Render through a portal to document.body: the editor is mounted inside the
  // review triptych's `position: sticky` column, whose stacking context traps
  // this fixed-position dialog UNDER the EdgeRails / StatusJourney layers (the
  // green SUPPLIER·OUT rail painted over the slideover). No z-index can fix
  // that from inside the trapped context — only moving the mount point can.
  if (!open || !mounted) return null;

  const isEmpty = headerRows.length === 0 && lineRows.length === 0 && customRows.length === 0;

  return createPortal(
    <div role="dialog" aria-label="Edit output mapping" style={{ position: "fixed", inset: 0, zIndex: 60, display: "flex", justifyContent: "flex-end" }}>
      {/* Opaque + blurred enough that the triptych wires behind don't bleed through. */}
      <div onClick={onClose} aria-hidden style={{ position: "absolute", inset: 0, background: "rgba(11,26,47,0.62)", backdropFilter: "blur(2px)" }} />
      <aside style={{ position: "relative", width: "min(720px, 96vw)", height: "100%", background: "#F6F7FA", boxShadow: "-8px 0 24px rgba(0,0,0,0.18)", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", borderBottom: "1px solid #E2E6EE", background: "#FFFFFF" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#0B1A2F" }}>Edit output mapping</div>
            <div style={{ fontSize: 11.5, color: "var(--ink-faint)" }}>
              {templateMode
                ? "Render the whole document from one Scriban template."
                : "Choose how each delivered field is built. Empty = the default transform."}
            </div>
          </div>
          {!templateMode && (
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "#56627A" }}>
              <span className="sr-only" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Preview format</span>
              <select value={format} onChange={(e) => setFormat(e.target.value as OutputFormatId)} aria-label="Preview format"
                style={{ minHeight: 34, border: "1px solid #C6CDDA", borderRadius: 6, padding: "4px 8px", fontSize: 12, background: "#FFFFFF" }}>
                {PREVIEW_FORMATS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </label>
          )}
          <button type="button" onClick={onClose} aria-label="Close" style={{ minHeight: 34, minWidth: 34, border: "none", background: "transparent", fontSize: 18, color: "#56627A", cursor: "pointer" }}>✕</button>
        </div>

        {/* Template-mode toggle — off (default) keeps the field-by-field UI. */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 18px", borderBottom: "1px solid #E2E6EE", background: "#FFFFFF" }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: templateMode ? "#5E3DB0" : "#56627A" }}>Template mode</span>
          <button
            type="button"
            role="switch"
            aria-checked={templateMode}
            aria-label="Template mode"
            onClick={() => setTemplateMode((v) => !v)}
            style={{
              position: "relative", width: 42, height: 24, borderRadius: 12, cursor: "pointer",
              border: "none", padding: 0,
              background: templateMode ? "#6F4FCE" : "#C6CDDA", transition: "background 120ms ease",
            }}
          >
            <span aria-hidden style={{
              position: "absolute", top: 2, left: templateMode ? 20 : 2, width: 20, height: 20,
              borderRadius: "50%", background: "#FFFFFF", boxShadow: "0 1px 2px rgba(0,0,0,0.25)",
              transition: "left 120ms ease",
            }} />
          </button>
          <span style={{ fontSize: 11, color: "var(--ink-faint)" }}>
            {templateMode
              ? "One Scriban template renders the entire output document (overrides field rules)."
              : "Map each delivered field one-by-one. Turn on to write a whole-document template instead."}
          </span>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 18, display: "flex", flexDirection: "column", gap: 18 }}>
          {!seeded && (
            <div style={{ fontSize: 12.5, color: "#56627A", padding: "10px 12px", background: "#EEF3FB", border: "1px solid #D5E3F6", borderRadius: 8 }}>
              Loading the saved mapping…
            </div>
          )}
          {seeded && existingError && (
            <div role="alert" style={{ fontSize: 12, color: "#7A4D0A", background: "#FFF8EA", border: "1px solid #F0D39A", borderRadius: 8, padding: "9px 11px", lineHeight: 1.5 }}>
              Couldn&apos;t load the saved mapping for this order — saving now may overwrite it. Close and reopen to retry.
            </div>
          )}
          {seeded && (templateMode ? (
            <>
              <TemplateEditor
                template={template}
                contentType={templateContentType}
                onTemplateChange={setTemplate}
                onContentTypeChange={setTemplateContentType}
                onInsertStarter={insertStarter}
                textareaRef={templateRef}
              />
              <TemplateReferencePanel onInsert={insertToken} />
            </>
          ) : (
            <>
              {isEmpty && (
                <div style={{ fontSize: 12.5, color: "#56627A", background: "#EEF3FB", border: "1px solid #D5E3F6", borderRadius: 8, padding: "10px 12px", lineHeight: 1.5 }}>
                  This order delivers with the supplier&apos;s <strong>default</strong> mapping. Add a field below to override one or
                  more columns just for this order — e.g. rename <code>po_number</code>, inject a fixed value, or reformat a date.
                </div>
              )}
              <CustomFieldsSection rows={customRows} setRows={setCustomRows} />
              <RuleSection title="Header fields" scope="header" rows={headerRows} sources={headerSources} setRows={setHeaderRows} />
              <RuleSection title="Line fields" scope="lines" rows={lineRows} sources={lineSources} setRows={setLineRows} />
            </>
          ))}
          <section>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#56627A" }}>
                Live preview{templateMode ? ` · ${previewFormat}` : ` · ${previewFormat.toUpperCase()}`}
              </span>
              {previewing && <span style={{ fontSize: 10.5, color: "var(--ink-faint)" }}>updating…</span>}
            </div>
            {preview?.warning && <div style={{ fontSize: 11.5, color: "#C97A14", marginBottom: 6 }}>⚠ {preview.warning}</div>}
            {preview?.error && <div role="alert" style={{ fontSize: 11.5, color: "#C97A14", background: "#FBF3E4", border: "1px solid #F0DCAE", borderRadius: 6, padding: "7px 9px", marginBottom: 6, whiteSpace: "pre-wrap" }}>{preview.error}</div>}
            <pre style={{ margin: 0, background: "#0B1A2F", color: "#C5D2E4", borderRadius: 8, padding: 12, fontSize: 11.5, fontFamily: "'JetBrains Mono',monospace", overflowX: "auto", maxHeight: 240, whiteSpace: "pre-wrap" }}>
{preview?.content ?? (blankTemplate ? "(write a template to preview)" : previewing ? "…" : "(no preview)")}
            </pre>
          </section>
        </div>

        <div style={{ display: "flex", gap: 10, padding: "12px 18px", borderTop: "1px solid #E2E6EE", background: "#FFFFFF" }}>
          <button type="button" onClick={() => reset.mutate()} disabled={reset.isPending || !seeded}
            style={{ minHeight: 38, padding: "0 14px", border: "1px solid #C6CDDA", background: "#FFFFFF", color: "#56627A", borderRadius: 6, cursor: "pointer", fontSize: 12.5, opacity: !seeded ? 0.6 : 1 }}>
            {reset.isPending ? "Resetting…" : "Reset to default"}
          </button>
          <div style={{ flex: 1 }} />
          {save.isError && <span style={{ alignSelf: "center", fontSize: 11.5, color: "#C53A3A" }}>{(save.error as Error)?.message}</span>}
          <button type="button" onClick={onClose} style={{ minHeight: 38, padding: "0 14px", border: "1px solid #C6CDDA", background: "#FFFFFF", color: "#56627A", borderRadius: 6, cursor: "pointer", fontSize: 12.5 }}>Cancel</button>
          <button type="button" onClick={() => save.mutate()} disabled={save.isPending || !seeded}
            title={!seeded ? "Wait for the saved mapping to load first" : undefined}
            style={{ minHeight: 38, padding: "0 18px", border: "none", background: "#2E8E3A", color: "#FFFFFF", borderRadius: 6, cursor: "pointer", fontSize: 12.5, fontWeight: 700, opacity: save.isPending || !seeded ? 0.6 : 1 }}>
            {save.isPending ? "Saving…" : "Save mapping"}
          </button>
        </div>
      </aside>
    </div>,
    document.body,
  );
}
