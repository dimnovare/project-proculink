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
// Visual drag-to-connect lives in the mapper wires (MapperWorkbench), not here — this panel
// is the explicit, keyboard-friendly form AND the only authoring surface for whole-document
// template mode (the Scriban escape hatch). It mounts from the order-variant MapperWorkbench
// ("Edit as template" toolbar button + the Command Palette's "Edit output as a template",
// via the plk:mapper bus). The saved draft must CARRY the existing
// sourceMap through (PUT replaces the whole override document — see buildOverrideDraft),
// and the dialog renders via createPortal to document.body because its inline mount sits
// inside a `position: sticky` column whose stacking context would trap it under the rails.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getMappingOverride, upsertMappingOverride, previewMappingOverride, getSourceTokens,
} from "@/lib/api-client";
import { OutputStructureDesigner } from "./OutputStructureDesigner";
import { OutputSourcePicker } from "./OutputSourcePicker";
import {
  MANIPULATOR_TYPES, BINDABLE_HEADER_FIELDS, BINDABLE_LINE_FIELDS,
  SCRIBAN_TEMPLATE_GROUPS, TEMPLATE_CONTENT_TYPES, PREVIEW_FORMATS, SCRIBAN_STARTER_TEMPLATE,
  type OrderMappingOverride, type OutputFieldRule, type ManipulatorEntry, type CustomField,
  type OutputFormatId, type SourceFieldRule, type OutputNodeTemplate, type SourceToken,
} from "@/lib/api/types";

type Scope = "header" | "lines";
type Row = { id: string; rule: OutputFieldRule };
type CustomRow = { id: string; field: CustomField };

let _rid = 0;
const newId = () => `r${++_rid}`;

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
// Warns when a user's custom-field key collides with a built-in canonical name. WP-14 widened the
// built-in set, so a key like "ContractNumber" is now reserved and the warning is correct: the
// backend keeps the USER's value for such a key (a newly reserved name never overwrites one a
// customer already authored), but a collision is still worth telling them about.
const CANONICAL_LOWER = new Set(
  [...BINDABLE_HEADER_FIELDS, ...BINDABLE_LINE_FIELDS].map((f) => f.toLowerCase()),
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
  existingOutputTree?: OutputNodeTemplate | null;
}): OrderMappingOverride {
  const base: OrderMappingOverride = {
    customFields: opts.customFields,
    output: { header: opts.header, lines: opts.lines },
    // Carry the drag-wired source mappings through unchanged — this editor
    // only edits the OUTPUT side.
    sourceMap: opts.existingSourceMap ?? null,
    // Carry the structured output tree (the visual designer's output) through unchanged — dropping
    // it on a flat-editor save would destroy a designed structure (same data-loss class as sourceMap).
    outputTree: opts.existingOutputTree ?? null,
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

/**
 * Build the READ-ONLY draft the "try an expression" tester sends to the existing
 * preview endpoint (which never persists a supplied draft). PURE — unit-tested.
 *
 * It reuses the CURRENT editor draft so custom fields resolve exactly as they will
 * in the saved template, swaps in just the one expression as the whole-document
 * template (text/plain), and NULLS outputTree: the preview endpoint renders a
 * structured output tree at HIGHEST precedence, which would hijack the render and
 * never evaluate the expression.
 */
export function buildExpressionTestDraft(
  base: OrderMappingOverride,
  expression: string,
): OrderMappingOverride {
  return {
    ...base,
    outputTemplate: expression,
    outputTemplateContentType: "text/plain",
    outputTree: null,
  };
}

const inputStyle: React.CSSProperties = {
  minHeight: 36, border: "1px solid #CBD0DA", borderRadius: 6, padding: "5px 8px", fontSize: 12.5,
};

// ── Module-level sub-components (stable identity → inputs keep focus) ──────────

function ManipChip({ entry, onChange, onRemove }: {
  entry: ManipulatorEntry; onChange: (e: ManipulatorEntry) => void; onRemove: () => void;
}) {
  const spec = MANIPULATOR_TYPES.find((t) => t.type === entry.type);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "#F0EAFB", border: "1px solid #DACEF3", borderRadius: 6, padding: "3px 6px" }}>
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

function RuleRow({ row, sources, sourceTokens, onChange, onRemove }: {
  row: Row;
  sources: string[];
  sourceTokens: ReadonlyArray<SourceToken>;
  onChange: (patch: Partial<OutputFieldRule>) => void;
  onRemove: () => void;
}) {
  const rule = row.rule;
  const usingFixed =
    rule.fixedValue != null &&
    (rule.canonicalField == null || rule.canonicalField === "") &&
    (rule.sourceToken == null || rule.sourceToken === "");
  return (
    <div style={{ border: "1px solid #E5E8EE", borderRadius: 8, padding: 10, background: "#FFFFFF" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input
          value={rule.outputPath ?? ""}
          onChange={(e) => onChange({ outputPath: e.target.value })}
          placeholder="delivered field name"
          aria-label="Output field name"
          style={{ ...inputStyle, flex: "1 1 140px", minWidth: 120, fontFamily: "'JetBrains Mono',monospace" }}
        />
        <span style={{ color: "var(--ink-faint)", fontSize: 13 }} aria-hidden>=</span>
        <OutputSourcePicker
          outputPath={rule.outputPath || "this field"}
          binding={rule}
          canonicalFields={sources}
          sourceTokens={sourceTokens}
          // Picking a canonical field clears the source-token + fixed-value bindings (they are
          // alternative bindings; precedence is SourceToken over CanonicalField on the backend).
          onPickCanonical={(f) => onChange({ canonicalField: f, sourceToken: null, fixedValue: null })}
          // Picking a SOURCE token writes the BARE id and clears canonicalField + fixedValue.
          onPickSourceToken={(id) => onChange({ sourceToken: id, canonicalField: null, fixedValue: null })}
          onPickFixed={() => onChange({ fixedValue: rule.fixedValue ?? "", canonicalField: null, sourceToken: null })}
          onClear={() => onChange({ canonicalField: null, sourceToken: null, fixedValue: null })}
        />
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
          style={{ minHeight: 36, padding: "0 10px", border: "none", background: "transparent", color: "#B43838", cursor: "pointer", fontSize: 13 }}>✕</button>
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
          style={{ minHeight: 28, border: "1px dashed #CBD0DA", borderRadius: 6, padding: "2px 6px", fontSize: 11.5, color: "#5E6779", background: "#F6F7FA" }}>
          <option value="">+ transform</option>
          {MANIPULATOR_TYPES.map((t) => <option key={t.type} value={t.type} title={t.hint}>{t.type}</option>)}
        </select>
      </div>
    </div>
  );
}

function RuleSection({ title, scope, rows, sources, sourceTokens, setRows }: {
  title: string;
  scope: Scope;
  rows: Row[];
  sources: string[];
  sourceTokens: ReadonlyArray<SourceToken>;
  setRows: (r: Row[]) => void;
}) {
  return (
    <section>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#5E6779", marginBottom: 8 }}>{title}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.length === 0 && (
          <div style={{ fontSize: 12, color: "var(--ink-faint)", padding: "2px 0" }}>None — the default transform is used for {scope === "header" ? "header" : "line"} fields. Add one to override it.</div>
        )}
        {rows.map((r) => (
          <RuleRow key={r.id} row={r} sources={sources} sourceTokens={sourceTokens}
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
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#5E6779" }}>Custom fields</span>
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
                style={{ ...inputStyle, flex: "1 1 100px", minWidth: 80, fontFamily: "'JetBrains Mono',monospace", color: "#5E3DB0", borderColor: collides ? "#B43838" : "#CBD0DA" }} />
              <span style={{ color: "var(--ink-faint)", fontSize: 12 }}>=</span>
              <input value={c.field.value ?? ""} onChange={(e) => set({ value: e.target.value })}
                placeholder="value" aria-label="Custom field value"
                style={{ ...inputStyle, flex: "1 1 140px", minWidth: 110 }} />
              <button type="button" onClick={() => setRows(rows.filter((x) => x.id !== c.id))} aria-label="Remove custom field"
                style={{ minHeight: 36, padding: "0 10px", border: "none", background: "transparent", color: "#B43838", cursor: "pointer", fontSize: 13 }}>✕</button>
              {collides && <div style={{ flexBasis: "100%", fontSize: 10.5, color: "#B43838" }}>“{key}” clashes with a built-in field name — rename it.</div>}
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
      style={{ border: "1px solid #E5E8EE", borderRadius: 8, background: "#FFFFFF", padding: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#5E6779", marginBottom: 4 }}>
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
                  style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10.5, color: "#5E3DB0", background: "#F0EAFB", border: "1px solid #DACEF3", borderRadius: 6, padding: "3px 7px", cursor: "pointer", lineHeight: 1.3 }}>
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

// A few copyable Scriban expressions so a non-technical user can write a template
// without leaving the screen. Collapsed by default; does not change editor behavior.
// Names are CASE-SENSITIVE and must match the template model's PascalCase keys
// (identity member-renamer on the backend — snake_case like {{ po_number }} silently
// renders EMPTY). Each example below is verified against the real render sandbox.
const FORMULA_EXAMPLES: Array<{ code: string; label: string }> = [
  { code: "{{ OrderNr }}", label: "insert a field" },
  { code: '{{ OrderDate | date.parse | date.to_string "%d.%m.%Y" }}', label: "reformat the order date" },
  { code: "{{ BuyerName | string.upcase }}", label: "uppercase" },
];

function FormulaHelpRow({ code, label }: { code: string; label: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard?.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable — the code is still visible to select manually */
    }
  }
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <code style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: "#5E3DB0", background: "#F0EAFB", border: "1px solid #DACEF3", borderRadius: 5, padding: "2px 6px" }}>
        {code}
      </code>
      <span style={{ fontSize: 11, color: "var(--ink-faint)" }}>{label}</span>
      <button type="button" onClick={copy} aria-label={`Copy ${code}`}
        style={{ marginLeft: "auto", fontSize: 10.5, fontWeight: 600, color: "#1E66C9", background: "#FFFFFF", border: "1px solid #CBD0DA", borderRadius: 5, padding: "2px 8px", cursor: "pointer", minHeight: 24 }}>
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

// "Try an expression" — evaluates ONE Scriban expression against THIS order via the
// existing read-only preview endpoint (server-side render, real order data — never a
// client-side approximation). Explicit click / Enter only; nothing fires per keystroke.
// The whole-template live preview below already tests the FULL template as you type —
// this box exists so a single expression can be tried in isolation before it's woven in.
function ExpressionTester({ onTest }: {
  onTest: (expression: string) => Promise<{ content: string | null; error?: string | null }>;
}) {
  const [expr, setExpr] = useState("");
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ value: string | null; error: string | null } | null>(null);
  const trimmed = expr.trim();

  async function run() {
    if (!trimmed || testing) return;
    setTesting(true);
    try {
      const r = await onTest(trimmed);
      // The endpoint returns render errors as data (HTTP 200 { ok:false, error }) —
      // surface the backend's message verbatim, never swallow it.
      setResult(r.error ? { value: null, error: r.error } : { value: r.content ?? "", error: null });
    } catch (e) {
      setResult({ value: null, error: e instanceof Error ? e.message : "Test failed" });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div style={{ borderTop: "1px dashed #E5E8EE", paddingTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "#5E6779" }}>
        Try an expression
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input
          value={expr}
          onChange={(e) => setExpr(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void run(); } }}
          placeholder="{{ OrderNr }}"
          aria-label="Expression to test"
          spellCheck={false}
          style={{ ...inputStyle, flex: "1 1 220px", minWidth: 160, fontFamily: "'JetBrains Mono',monospace" }}
        />
        <button type="button" onClick={() => void run()} disabled={!trimmed || testing}
          style={{ minHeight: 36, padding: "0 12px", border: "1px solid #1E66C9", borderRadius: 6, background: "#FFFFFF", color: "#1E66C9", fontSize: 11.5, fontWeight: 600, cursor: !trimmed || testing ? "default" : "pointer", opacity: !trimmed || testing ? 0.6 : 1 }}>
          {testing ? "Testing…" : "Test with this order"}
        </button>
      </div>
      {result && (result.error != null ? (
        <div role="alert" style={{ fontSize: 11.5, color: "#B36D14", background: "#FBF3E4", border: "1px solid #F0DCAE", borderRadius: 6, padding: "7px 9px", whiteSpace: "pre-wrap" }}>
          {result.error}
        </div>
      ) : result.value === "" ? (
        // Honest empty: unknown field names render BLANK (not an error) on the backend,
        // so say so instead of showing a silent nothing.
        <div style={{ fontSize: 11.5, color: "#5E6779", background: "#F6F7FA", border: "1px solid #E5E8EE", borderRadius: 6, padding: "7px 9px", lineHeight: 1.5 }}>
          Rendered <strong>empty</strong> for this order — an unknown field name renders blank rather than
          failing. Names are case-sensitive; check the available fields below.
        </div>
      ) : (
        <div aria-label="Expression result" style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
          <span aria-hidden style={{ fontSize: 11.5, color: "var(--ink-faint)" }}>→</span>
          <code style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11.5, color: "#0B1A2F", background: "#F6F7FA", border: "1px solid #E5E8EE", borderRadius: 6, padding: "4px 8px", whiteSpace: "pre-wrap", wordBreak: "break-word", flex: 1 }}>
            {result.value}
          </code>
        </div>
      ))}
    </div>
  );
}

function FormulaHelp({ onTestExpression }: {
  onTestExpression: (expression: string) => Promise<{ content: string | null; error?: string | null }>;
}) {
  return (
    <details style={{ marginBottom: 8 }}>
      <summary style={{ cursor: "pointer", fontSize: 11.5, fontWeight: 600, color: "#5E6779" }}>
        Formula help
      </summary>
      <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8, border: "1px solid #E5E8EE", borderRadius: 8, background: "#FFFFFF", padding: 12 }}>
        {FORMULA_EXAMPLES.map((ex) => (
          <FormulaHelpRow key={ex.code} code={ex.code} label={ex.label} />
        ))}
        <div style={{ fontSize: 11, color: "var(--ink-faint)", lineHeight: 1.5 }}>
          Fields come from your order; <code style={{ fontFamily: "'JetBrains Mono',monospace" }}>|</code> applies a transform.{" "}
          <Link href="/help/mapping-basics" style={{ color: "#1E66C9", fontWeight: 600 }}>
            Mapping basics
          </Link>
        </div>
        <ExpressionTester onTest={onTestExpression} />
      </div>
    </details>
  );
}

function TemplateEditor({
  template, contentType, onTemplateChange, onContentTypeChange, onInsertStarter, onTestExpression, textareaRef,
}: {
  template: string;
  contentType: string;
  onTemplateChange: (v: string) => void;
  onContentTypeChange: (v: string) => void;
  onInsertStarter: () => void;
  onTestExpression: (expression: string) => Promise<{ content: string | null; error?: string | null }>;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  return (
    <section>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#5E6779" }}>
          Document template
        </span>
        <div style={{ flex: 1 }} />
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "#5E6779" }}>
          Content type
          <select value={contentType} onChange={(e) => onContentTypeChange(e.target.value)} aria-label="Template content type"
            style={{ minHeight: 30, border: "1px solid #CBD0DA", borderRadius: 6, padding: "3px 8px", fontSize: 12, background: "#FFFFFF" }}>
            {TEMPLATE_CONTENT_TYPES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </label>
        <button type="button" onClick={onInsertStarter}
          style={{ fontSize: 11.5, fontWeight: 600, color: "#1E66C9", background: "#FFFFFF", border: "1px solid #1E66C9", borderRadius: 6, padding: "5px 10px", cursor: "pointer", minHeight: 30 }}>
          Insert starter template
        </button>
      </div>
      <FormulaHelp onTestExpression={onTestExpression} />
      <textarea
        ref={textareaRef}
        value={template}
        onChange={(e) => onTemplateChange(e.target.value)}
        spellCheck={false}
        aria-label="Custom output template"
        placeholder={'Write a custom template that renders the whole document, e.g.\n{ "po": "{{ OrderNr }}", "lines": [{{ for Line in Lines }}…{{ end }}] }'}
        style={{
          width: "100%", minHeight: 280, resize: "vertical",
          border: "1px solid #CBD0DA", borderRadius: 8, padding: 12,
          fontSize: 12, lineHeight: 1.5, fontFamily: "'JetBrains Mono',monospace",
          color: "#0B1A2F", background: "#FFFFFF", boxSizing: "border-box", whiteSpace: "pre", overflowWrap: "normal", overflowX: "auto",
        }}
      />
    </section>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function OutputMappingEditor({
  orderId, open, onClose, initialTemplateMode = false, onSaved,
}: {
  orderId: string;
  open: boolean;
  onClose: () => void;
  /** Open straight into template mode — the "Edit as template" entries pass true so the
      user lands in the template editor even before any template is saved. The in-panel
      toggle still switches back to the field-by-field view. */
  initialTemplateMode?: boolean;
  /** Fires after a successful Save or Reset, before onClose. The embedding mapper reads
      the override under its OWN query key ("mapper-override", not "mapping-override"),
      which the invalidations below cannot reach — the host must bust its own cache here
      or its outgoing column + live preview keep rendering the pre-save mapping. */
  onSaved?: () => void;
}) {
  const qc = useQueryClient();
  const { data: existing, isSuccess: existingLoaded, isError: existingError } = useQuery({
    queryKey: ["mapping-override", orderId],
    queryFn: () => getMappingOverride(orderId),
    enabled: open,
    staleTime: 10_000,
  });

  // F-1: the FULL source-field universe for this order (CSV cells / XML leaves+attrs / EDI / JSON
  // leaves / PDF-email raw_fields), each with a sample value. Feeds the binding picker so an output
  // node can bind to ANY incoming field, not just the ~13 canonical names. Returns [] for formats
  // with no token capture, in which case the picker shows only the canonical/custom fields.
  const { data: sourceTokens } = useQuery({
    queryKey: ["source-tokens", orderId],
    queryFn: () => getSourceTokens(orderId),
    enabled: open,
    staleTime: 30_000,
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
  const [showDesigner, setShowDesigner]   = useState(false);
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
    // A saved template always opens in template mode; initialTemplateMode additionally
    // forces it for the "Edit as template" entries so they land in the template editor
    // even when nothing is saved yet (blank template on save still clears cleanly).
    setTemplateMode(tmpl.trim().length > 0 || initialTemplateMode);
    setSeeded(true);
  }, [open, seeded, existing, existingLoaded, existingError, initialTemplateMode]);

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
  // WP-14: offer every name the backend row bag exposes, not the narrow default spine. A line rule
  // may also bind header fields (the line bag carries them), which is why lineSources concatenates
  // both — the picker groups them by scope so the mixed list stays readable.
  const headerSources = useMemo(() => [...BINDABLE_HEADER_FIELDS, ...customKeys], [customKeys]);
  const lineSources   = useMemo(() => [...BINDABLE_LINE_FIELDS, ...BINDABLE_HEADER_FIELDS, ...customKeys], [customKeys]);

  const trimmedTemplate = template.trim();
  const draft: OrderMappingOverride = useMemo(
    () => buildOverrideDraft({
      customFields,
      header: toRecord(headerRows),
      lines: toRecord(lineRows),
      templateMode,
      template,
      templateContentType,
      // Preserve the drag-wired source mappings AND the visual output tree (PUT replaces the
      // whole override document — see buildOverrideDraft). Dropping outputTree here would wipe a
      // structure designed in the visual editor the moment the flat editor saves.
      existingSourceMap: existing?.sourceMap ?? null,
      existingOutputTree: existing?.outputTree ?? null,
    }),
    [customFields, headerRows, lineRows, templateMode, template, templateContentType, existing],
  );

  // "Try an expression" — server-side render of ONE expression against THIS order via
  // the existing read-only preview endpoint (a supplied draft is never persisted). Built
  // from the CURRENT draft so custom fields resolve exactly as a saved template would;
  // buildExpressionTestDraft nulls outputTree so a designed structure can't hijack the
  // render. Explicit-click only — the tester component never calls this per keystroke.
  // (A changed callback identity only re-renders the module-level children; it cannot
  // remount them or steal focus.)
  const testExpression = useCallback(
    (expression: string) =>
      previewMappingOverride(orderId, buildExpressionTestDraft(draft, expression), "json"),
    [orderId, draft],
  );

  const [preview, setPreview] = useState<{ content: string | null; warning?: string; error?: string; format?: string } | null>(null);
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
        // Capture the format the server ACTUALLY rendered. For a revision-pinned order the
        // backend deliberately renders the connection's published output format (so
        // "preview == delivered bytes"), which can differ from the toggle the user picked —
        // label from r.format, not the requested one, so the header never lies.
        setPreview({ content: r.content, warning: r.warning, error: r.error ?? undefined, format: r.format });
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
      onSaved?.();
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
      onSaved?.();
    },
  });

  // Render through a portal to document.body: the editor is mounted inside the
  // review triptych's `position: sticky` column, whose stacking context traps
  // this fixed-position dialog UNDER the EdgeRails / StatusJourney layers (the
  // green SUPPLIER·OUT rail painted over the slideover). No z-index can fix
  // that from inside the trapped context — only moving the mount point can.
  if (!open || !mounted) return null;

  const isEmpty = headerRows.length === 0 && lineRows.length === 0 && customRows.length === 0;

  // A structured OUTPUT TREE (built in the visual designer) governs this order's
  // output. When one exists, the backend emitter renders the tree as the
  // highest-precedence output mode — the field-by-field rules AND template-mode
  // edits in THIS panel are silently ignored (see OutputStructureDesigner header
  // + buildOverrideDraft, which carries `outputTree` through unchanged). Surface
  // that honestly so a user can't edit, save, and see nothing change.
  const treeGovernsOutput = existing?.outputTree != null;

  return createPortal(
    <div role="dialog" aria-label="Edit output mapping" style={{ position: "fixed", inset: 0, zIndex: 60, display: "flex", justifyContent: "flex-end" }}>
      {showDesigner && (
        <OutputStructureDesigner
          orderId={orderId}
          baseOverride={draft}
          initialTree={draft.outputTree ?? null}
          onClose={() => setShowDesigner(false)}
          onSaved={() => {
            setShowDesigner(false);
            void qc.invalidateQueries({ queryKey: ["mapping-override", orderId] });
            void qc.invalidateQueries({ queryKey: ["order", orderId] });
          }}
        />
      )}
      {/* Opaque + blurred enough that the triptych wires behind don't bleed through. */}
      <div onClick={onClose} aria-hidden style={{ position: "absolute", inset: 0, background: "rgba(11,26,47,0.62)", backdropFilter: "blur(2px)" }} />
      <aside style={{ position: "relative", width: "min(720px, 96vw)", height: "100%", background: "#F6F7FA", boxShadow: "-8px 0 24px rgba(0,0,0,0.18)", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", borderBottom: "1px solid #E5E8EE", background: "#FFFFFF" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#0B1A2F" }}>Edit output mapping</div>
            <div style={{ fontSize: 11.5, color: "var(--ink-faint)" }}>
              {templateMode
                ? "Render the whole document from one custom template."
                : "Choose how each delivered field is built. Empty = the default transform."}
            </div>
          </div>
          {!templateMode && (
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "#5E6779" }}>
              <span className="sr-only" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Preview format</span>
              <select value={format} onChange={(e) => setFormat(e.target.value as OutputFormatId)} aria-label="Preview format"
                style={{ minHeight: 34, border: "1px solid #CBD0DA", borderRadius: 6, padding: "4px 8px", fontSize: 12, background: "#FFFFFF" }}>
                {PREVIEW_FORMATS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </label>
          )}
          <button type="button" onClick={() => setShowDesigner(true)}
            title="Design the output structure visually (nesting, lists, attributes)"
            style={{ minHeight: 34, padding: "0 12px", border: "1px solid #0B1A2F", borderRadius: 7, background: "#FFFFFF", color: "#0B1A2F", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
            ⚄ Design structure
          </button>
          <button type="button" onClick={onClose} aria-label="Close" style={{ minHeight: 34, minWidth: 34, border: "none", background: "transparent", fontSize: 18, color: "#5E6779", cursor: "pointer" }}>✕</button>
        </div>

        {/* Template-mode toggle — off (default) keeps the field-by-field UI. */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 18px", borderBottom: "1px solid #E5E8EE", background: "#FFFFFF" }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: templateMode ? "#5E3DB0" : "#5E6779" }}>Template mode</span>
          <button
            type="button"
            role="switch"
            aria-checked={templateMode}
            aria-label="Template mode"
            onClick={() => setTemplateMode((v) => !v)}
            style={{
              position: "relative", width: 42, height: 24, borderRadius: 12, cursor: "pointer",
              border: "none", padding: 0,
              background: templateMode ? "#6F4FCE" : "#CBD0DA", transition: "background 120ms ease",
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
              ? "One custom template renders the entire output document (overrides field rules)."
              : "Map each delivered field one-by-one. Turn on to write a whole-document template instead."}
          </span>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 18, display: "flex", flexDirection: "column", gap: 18 }}>
          {seeded && treeGovernsOutput && (
            <div
              role="alert"
              style={{
                display: "flex", gap: 12, alignItems: "flex-start",
                fontSize: 12.5, lineHeight: 1.5, color: "#5E3DB0",
                background: "#F0EAFB", border: "1px solid #DACEF3", borderRadius: 8,
                padding: "11px 13px",
              }}
            >
              <span aria-hidden style={{ fontSize: 15, lineHeight: 1.1 }}>⚄</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, marginBottom: 2 }}>This output&apos;s structure is built in the visual designer.</div>
                <div>
                  Changes you make here are <strong>not applied</strong> while a designed structure governs this order&apos;s
                  output — open the designer to edit it.
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowDesigner(true)}
                style={{
                  flexShrink: 0, minHeight: 32, padding: "0 12px",
                  border: "1px solid #6F4FCE", borderRadius: 7,
                  background: "#6F4FCE", color: "#FFFFFF",
                  fontSize: 12, fontWeight: 600, cursor: "pointer",
                }}
              >
                Open designer
              </button>
            </div>
          )}
          {!seeded && (
            <div style={{ fontSize: 12.5, color: "#5E6779", padding: "10px 12px", background: "#EEF3FB", border: "1px solid #D5E3F6", borderRadius: 8 }}>
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
                onTestExpression={testExpression}
                textareaRef={templateRef}
              />
              <TemplateReferencePanel onInsert={insertToken} />
            </>
          ) : (
            <>
              {isEmpty && (
                <div style={{ fontSize: 12.5, color: "#5E6779", background: "#EEF3FB", border: "1px solid #D5E3F6", borderRadius: 8, padding: "10px 12px", lineHeight: 1.5 }}>
                  This order delivers with the supplier&apos;s <strong>default</strong> mapping. Add a field below to override one or
                  more columns just for this order — e.g. rename <code>po_number</code>, inject a fixed value, or reformat a date.
                </div>
              )}
              <CustomFieldsSection rows={customRows} setRows={setCustomRows} />
              <RuleSection title="Header fields" scope="header" rows={headerRows} sources={headerSources} sourceTokens={sourceTokens ?? []} setRows={setHeaderRows} />
              <RuleSection title="Line fields" scope="lines" rows={lineRows} sources={lineSources} sourceTokens={sourceTokens ?? []} setRows={setLineRows} />
            </>
          ))}
          <section>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#5E6779" }}>
                Live preview{(() => {
                  // Label from the format the server actually rendered (preview?.format) when known,
                  // so a JSON connection never shows a "CSV" header over JSON bytes.
                  const shown = preview?.format ?? previewFormat;
                  return templateMode ? ` · ${previewFormat}` : ` · ${String(shown).toUpperCase()}`;
                })()}
              </span>
              {previewing && <span style={{ fontSize: 10.5, color: "var(--ink-faint)" }}>updating…</span>}
            </div>
            {!templateMode && preview?.format && preview.format.toLowerCase() !== previewFormat.toLowerCase() && (
              <div style={{ fontSize: 11, color: "#5E6779", marginBottom: 6 }}>
                This connection delivers <strong>{preview.format.toUpperCase()}</strong> — the output format is set by the published revision, so the preview shows {preview.format.toUpperCase()} regardless of the toggle.
              </div>
            )}
            {preview?.warning && <div style={{ fontSize: 11.5, color: "#B36D14", marginBottom: 6 }}>⚠ {preview.warning}</div>}
            {preview?.error && <div role="alert" style={{ fontSize: 11.5, color: "#B36D14", background: "#FBF3E4", border: "1px solid #F0DCAE", borderRadius: 6, padding: "7px 9px", marginBottom: 6, whiteSpace: "pre-wrap" }}>{preview.error}</div>}
            <pre style={{ margin: 0, background: "#0B1A2F", color: "#C8D1E0", borderRadius: 8, padding: 12, fontSize: 11.5, fontFamily: "'JetBrains Mono',monospace", overflowX: "auto", maxHeight: 240, whiteSpace: "pre-wrap" }}>
{preview?.content ?? (blankTemplate ? "(write a template to preview)" : previewing ? "…" : "(no preview)")}
            </pre>
          </section>
        </div>

        <div style={{ display: "flex", gap: 10, padding: "12px 18px", borderTop: "1px solid #E5E8EE", background: "#FFFFFF" }}>
          <button type="button" onClick={() => reset.mutate()} disabled={reset.isPending || !seeded}
            style={{ minHeight: 38, padding: "0 14px", border: "1px solid #CBD0DA", background: "#FFFFFF", color: "#5E6779", borderRadius: 6, cursor: "pointer", fontSize: 12.5, opacity: !seeded ? 0.6 : 1 }}>
            {reset.isPending ? "Resetting…" : "Reset to default"}
          </button>
          <div style={{ flex: 1 }} />
          {save.isError && <span style={{ alignSelf: "center", fontSize: 11.5, color: "#B43838" }}>{(save.error as Error)?.message}</span>}
          <button type="button" onClick={onClose} style={{ minHeight: 38, padding: "0 14px", border: "1px solid #CBD0DA", background: "#FFFFFF", color: "#5E6779", borderRadius: 6, cursor: "pointer", fontSize: 12.5 }}>Cancel</button>
          <button type="button" onClick={() => save.mutate()} disabled={save.isPending || !seeded}
            title={!seeded ? "Wait for the saved mapping to load first" : undefined}
            style={{ minHeight: 38, padding: "0 18px", border: "none", background: "#297F34", color: "#FFFFFF", borderRadius: 6, cursor: "pointer", fontSize: 12.5, fontWeight: 700, opacity: save.isPending || !seeded ? 0.6 : 1 }}>
            {save.isPending ? "Saving…" : "Save mapping"}
          </button>
        </div>
      </aside>
    </div>,
    document.body,
  );
}
