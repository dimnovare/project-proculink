"use client";

// OutputMappingEditor — the power-user "map & manipulate manually" panel (heart-piece-flex).
// Lets a user override, per order, how each output field is built: pick its source (a canonical
// field, a per-order custom field, or a fixed value) and chain manipulators (the existing
// ManipulatorRegistry: Trim/Replace/DateFormat/Concat/Fallback/Split/Multiply/Divide), with a
// live dry-run preview. Persists via PUT /mapping-override; default (no override) is unchanged.
//
//   Phase 3 — output rules + manipulators + live preview.
//   Phase 4 — add/remove per-order CUSTOM fields (for values the parser never captured),
//             offered as sources alongside the canonical fields.
//   Phase 5 — DRAG-TO-CONNECT: drag a field from the source palette onto an output row (or the
//             add-field zone) to wire it. The <select> stays as the keyboard/a11y fallback.
//
// This is a disclosure surface (opened from the order-review screen) — NOT a global mode.

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getMappingOverride, upsertMappingOverride, previewMappingOverride,
} from "@/lib/api-client";
import {
  MANIPULATOR_TYPES, CANONICAL_HEADER_FIELDS, CANONICAL_LINE_FIELDS,
  type OrderMappingOverride, type OutputFieldRule, type ManipulatorEntry, type CustomField,
} from "@/lib/api/types";

type Scope = "header" | "lines";
type Row = { id: string; rule: OutputFieldRule };
type CustomRow = { id: string; field: CustomField };

// Scope of a selectable source, used only for color-coding the palette + connected chips.
type SourceKind = "header" | "line" | "custom";
type SourceDescriptor = { key: string; label: string; kind: SourceKind };

// MIME-ish key for the native drag payload (the source's canonicalField key).
const DRAG_TYPE = "application/x-procu-source";

const KIND_COLOR: Record<SourceKind, { fg: string; bg: string; border: string }> = {
  header: { fg: "#1E66C9", bg: "#E7F0FB", border: "#BcD6F4" },
  line:   { fg: "#0E7C6B", bg: "#E2F4F0", border: "#B6E0D7" },
  custom: { fg: "#5E3DB0", bg: "#EEE7FB", border: "#DACEF3" },
};

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

// Sanitise a free-typed custom key to a safe machine key: letters/digits/underscore only.
function sanitizeKey(raw: string): string {
  return raw.replace(/[^A-Za-z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
}

const CANONICAL_LOWER = new Set(
  [...CANONICAL_HEADER_FIELDS, ...CANONICAL_LINE_FIELDS].map((f) => f.toLowerCase()),
);

export function OutputMappingEditor({
  orderId, open, onClose,
}: {
  orderId: string;
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { data: existing } = useQuery({
    queryKey: ["mapping-override", orderId],
    queryFn: () => getMappingOverride(orderId),
    enabled: open,
    staleTime: 10_000,
  });

  const [headerRows, setHeaderRows]   = useState<Row[]>([]);
  const [lineRows, setLineRows]       = useState<Row[]>([]);
  const [customRows, setCustomRows]   = useState<CustomRow[]>([]);
  const [format, setFormat]           = useState<"csv" | "json">("csv");
  const [seeded, setSeeded]           = useState(false);
  // The source key currently being dragged (for drop-target highlighting).
  const [dragging, setDragging]       = useState<string | null>(null);

  // Seed the editable draft from the loaded override once per open.
  useEffect(() => {
    if (!open) { setSeeded(false); return; }
    if (seeded) return;
    setHeaderRows(toRows(existing?.output?.header));
    setLineRows(toRows(existing?.output?.lines));
    setCustomRows(toCustomRows(existing?.customFields));
    setSeeded(true);
  }, [open, seeded, existing]);

  // Header-scoped custom fields only in this UI iteration (one value each); they are available
  // as sources to BOTH header and line rules (the backend line row bag includes header fields).
  const customFields: CustomField[] = useMemo(
    () => customRows
      .map((c) => ({ ...c.field, key: sanitizeKey(c.field.key || c.field.label), scope: "header" as const }))
      .filter((c) => c.key.length > 0),
    [customRows],
  );

  const draft: OrderMappingOverride = useMemo(() => ({
    customFields,
    output: { header: toRecord(headerRows), lines: toRecord(lineRows) },
  }), [customFields, headerRows, lineRows]);

  // Debounced live preview.
  const [preview, setPreview] = useState<{ content: string | null; warning?: string; error?: string } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const debRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!open || !seeded) return;
    if (debRef.current) clearTimeout(debRef.current);
    debRef.current = setTimeout(async () => {
      setPreviewing(true);
      try {
        const r = await previewMappingOverride(orderId, draft, format);
        setPreview({ content: r.content, warning: r.warning });
      } catch (e) {
        setPreview({ content: null, error: e instanceof Error ? e.message : "Preview failed" });
      } finally { setPreviewing(false); }
    }, 600);
    return () => { if (debRef.current) clearTimeout(debRef.current); };
  }, [orderId, draft, format, open, seeded]);

  const save = useMutation({
    mutationFn: () => upsertMappingOverride(orderId, draft),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["mapping-override", orderId] });
      await qc.invalidateQueries({ queryKey: ["order", orderId] });
      onClose();
    },
  });
  const reset = useMutation({
    mutationFn: () => upsertMappingOverride(orderId, { customFields: [], output: { header: {}, lines: {} } }),
    onSuccess: async () => {
      setHeaderRows([]); setLineRows([]); setCustomRows([]);
      await qc.invalidateQueries({ queryKey: ["mapping-override", orderId] });
      await qc.invalidateQueries({ queryKey: ["order", orderId] });
    },
  });

  // The full palette of selectable sources, grouped by kind.
  const sources: SourceDescriptor[] = useMemo(() => [
    ...CANONICAL_HEADER_FIELDS.map((k) => ({ key: k, label: k, kind: "header" as const })),
    ...CANONICAL_LINE_FIELDS.map((k) => ({ key: k, label: k, kind: "line" as const })),
    ...customFields.map((c) => ({ key: c.key, label: c.label || c.key, kind: "custom" as const })),
  ], [customFields]);
  const sourceByKey = useMemo(() => new Map(sources.map((s) => [s.key, s])), [sources]);

  if (!open) return null;

  // ── Custom fields editor ─────────────────────────────────────────────────────
  function CustomFieldsSection() {
    const update = (id: string, patch: Partial<CustomField>) =>
      setCustomRows(customRows.map((c) => c.id === id ? { ...c, field: { ...c.field, ...patch } } : c));
    return (
      <section>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#56627A" }}>Custom fields</span>
          <span style={{ fontSize: 11, color: "#8A93A5" }}>add a value the file didn&apos;t carry — usable as a source below</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {customRows.length === 0 && (
            <div style={{ fontSize: 12, color: "#8A93A5", padding: "2px 0" }}>None yet.</div>
          )}
          {customRows.map((c) => {
            const key = sanitizeKey(c.field.key || c.field.label);
            const collides = key.length > 0 && CANONICAL_LOWER.has(key.toLowerCase());
            return (
              <div key={c.id} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <input
                  value={c.field.label}
                  onChange={(e) => update(c.id, { label: e.target.value })}
                  placeholder="Label (e.g. Contract no.)"
                  aria-label="Custom field label"
                  style={{ flex: "1 1 150px", minWidth: 120, minHeight: 36, border: "1px solid #C6CDDA", borderRadius: 6, padding: "5px 8px", fontSize: 12.5 }}
                />
                <input
                  value={c.field.key}
                  onChange={(e) => update(c.id, { key: e.target.value })}
                  placeholder="key"
                  aria-label="Custom field key"
                  style={{ flex: "1 1 110px", minWidth: 90, minHeight: 36, border: `1px solid ${collides ? "#C53A3A" : "#C6CDDA"}`, borderRadius: 6, padding: "5px 8px", fontSize: 12.5, fontFamily: "'JetBrains Mono',monospace", color: "#5E3DB0" }}
                />
                <span style={{ color: "#8A93A5", fontSize: 12 }}>=</span>
                <input
                  value={c.field.value ?? ""}
                  onChange={(e) => update(c.id, { value: e.target.value })}
                  placeholder="value"
                  aria-label="Custom field value"
                  style={{ flex: "1 1 150px", minWidth: 120, minHeight: 36, border: "1px solid #C6CDDA", borderRadius: 6, padding: "5px 8px", fontSize: 12.5 }}
                />
                <button type="button" onClick={() => setCustomRows(customRows.filter((x) => x.id !== c.id))} aria-label="Remove custom field"
                  style={{ minHeight: 36, padding: "0 10px", border: "none", background: "transparent", color: "#C53A3A", cursor: "pointer", fontSize: 13 }}>✕</button>
                {collides && <div style={{ flexBasis: "100%", fontSize: 10.5, color: "#C53A3A" }}>“{key}” clashes with a built-in field name — rename it.</div>}
              </div>
            );
          })}
          <button type="button"
            onClick={() => setCustomRows([...customRows, { id: newId(), field: { key: "", label: "", scope: "header", value: "" } }])}
            style={{ alignSelf: "flex-start", fontSize: 12, fontWeight: 600, color: "#5E3DB0", background: "#FFFFFF", border: "1px solid #C4ABE8", borderRadius: 6, padding: "6px 12px", cursor: "pointer", minHeight: 34 }}>
            + Add custom field
          </button>
        </div>
      </section>
    );
  }

  // ── Draggable source palette ─────────────────────────────────────────────────
  function SourcePalette() {
    const groups: Array<{ kind: SourceKind; title: string; items: SourceDescriptor[] }> = [
      { kind: "header", title: "Order fields", items: sources.filter((s) => s.kind === "header") },
      { kind: "line",   title: "Line fields",  items: sources.filter((s) => s.kind === "line") },
      { kind: "custom", title: "Custom",       items: sources.filter((s) => s.kind === "custom") },
    ];
    return (
      <section style={{ position: "sticky", top: 0, zIndex: 1, background: "#F6F7FA", paddingBottom: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#56627A", marginBottom: 6 }}>
          Sources <span style={{ fontWeight: 500, textTransform: "none", letterSpacing: 0, color: "#8A93A5" }}>— drag a field onto an output row to connect it</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {groups.map((g) => g.items.length === 0 ? null : (
            <div key={g.kind} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: "#8A93A5", minWidth: 64 }}>{g.title}</span>
              {g.items.map((s) => {
                const col = KIND_COLOR[s.kind];
                return (
                  <span key={s.key} draggable
                    onDragStart={(e) => { e.dataTransfer.setData(DRAG_TYPE, s.key); e.dataTransfer.effectAllowed = "copy"; setDragging(s.key); }}
                    onDragEnd={() => setDragging(null)}
                    title={`Drag onto an output field to use ${s.label}`}
                    style={{ display: "inline-flex", alignItems: "center", gap: 4, cursor: "grab", background: col.bg, border: `1px solid ${col.border}`, color: col.fg, borderRadius: 6, padding: "3px 8px", fontSize: 11.5, fontWeight: 600, fontFamily: "'JetBrains Mono',monospace", opacity: dragging === s.key ? 0.5 : 1 }}>
                    <span aria-hidden style={{ width: 6, height: 6, borderRadius: 999, background: col.fg }} />
                    {s.label}
                  </span>
                );
              })}
            </div>
          ))}
        </div>
      </section>
    );
  }

  function canonicalFor(scope: Scope) { return scope === "header" ? CANONICAL_HEADER_FIELDS : CANONICAL_LINE_FIELDS; }

  function RuleRows({ scope, rows, setRows }: { scope: Scope; rows: Row[]; setRows: (r: Row[]) => void }) {
    const update = (id: string, patch: Partial<OutputFieldRule>) =>
      setRows(rows.map((r) => r.id === id ? { ...r, rule: { ...r.rule, ...patch } } : r));
    const [overRow, setOverRow] = useState<string | null>(null);
    const [overAdd, setOverAdd] = useState(false);

    // Select options: this scope's canonical fields + custom keys (raw key — matches the
    // backend resolver, which looks custom fields up by Key with no prefix).
    const selectOptions = [...canonicalFor(scope), ...customFields.map((c) => c.key)];

    const readDrag = (e: React.DragEvent) => e.dataTransfer.getData(DRAG_TYPE);

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.length === 0 && (
          <div style={{ fontSize: 12, color: "#8A93A5", padding: "6px 0" }}>No {scope === "header" ? "header" : "line"} fields mapped — the default transform is used. Add a field, or drag a source onto the zone below.</div>
        )}
        {rows.map((r) => {
          const usingFixed = r.rule.fixedValue != null && (r.rule.canonicalField == null || r.rule.canonicalField === "");
          const src = r.rule.canonicalField ? sourceByKey.get(r.rule.canonicalField) : undefined;
          const srcCol = src ? KIND_COLOR[src.kind] : null;
          const isOver = overRow === r.id;
          return (
            <div key={r.id}
              onDragOver={(e) => { if (e.dataTransfer.types.includes(DRAG_TYPE)) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setOverRow(r.id); } }}
              onDragLeave={() => setOverRow((cur) => cur === r.id ? null : cur)}
              onDrop={(e) => { const k = readDrag(e); if (k) { e.preventDefault(); update(r.id, { canonicalField: k, fixedValue: null }); } setOverRow(null); setDragging(null); }}
              style={{ border: `1px solid ${isOver ? "#1E66C9" : "#E2E6EE"}`, boxShadow: isOver ? "0 0 0 3px rgba(30,102,201,0.15)" : "none", borderRadius: 8, padding: 10, background: "#FFFFFF", transition: "box-shadow 120ms,border-color 120ms" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <input
                  value={r.rule.outputPath ?? ""}
                  onChange={(e) => update(r.id, { outputPath: e.target.value })}
                  placeholder="Output field name"
                  aria-label="Output field name"
                  style={{ flex: "1 1 150px", minWidth: 120, minHeight: 36, border: "1px solid #C6CDDA", borderRadius: 6, padding: "5px 8px", fontSize: 12.5, fontFamily: "'JetBrains Mono',monospace" }}
                />
                <span style={{ color: "#8A93A5", fontSize: 13 }} aria-hidden>←</span>
                {/* Connected-source chip (drag target visualisation) */}
                {src && !usingFixed ? (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, background: srcCol!.bg, border: `1px solid ${srcCol!.border}`, color: srcCol!.fg, borderRadius: 6, padding: "4px 8px", fontSize: 12, fontWeight: 600, fontFamily: "'JetBrains Mono',monospace" }}>
                    <span aria-hidden style={{ width: 6, height: 6, borderRadius: 999, background: srcCol!.fg }} />
                    {src.label}
                    <button type="button" onClick={() => update(r.id, { canonicalField: null })} aria-label="Disconnect source" style={{ border: "none", background: "transparent", color: srcCol!.fg, cursor: "pointer", fontSize: 12, lineHeight: 1 }}>✕</button>
                  </span>
                ) : null}
                <select
                  value={usingFixed ? "__fixed__" : (r.rule.canonicalField ?? "")}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "__fixed__") update(r.id, { canonicalField: null, fixedValue: r.rule.fixedValue ?? "" });
                    else update(r.id, { canonicalField: v || null, fixedValue: null });
                  }}
                  aria-label="Source field"
                  style={{ flex: src && !usingFixed ? "0 1 130px" : "1 1 150px", minWidth: 120, minHeight: 36, border: "1px solid #C6CDDA", borderRadius: 6, padding: "5px 8px", fontSize: 12.5, background: "#FFFFFF" }}
                >
                  <option value="">{src && !usingFixed ? "change…" : "— source —"}</option>
                  {selectOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                  <option value="__fixed__">Fixed value…</option>
                </select>
                {usingFixed && (
                  <input
                    value={r.rule.fixedValue ?? ""}
                    onChange={(e) => update(r.id, { fixedValue: e.target.value })}
                    placeholder="Fixed value"
                    aria-label="Fixed value"
                    style={{ flex: "1 1 120px", minWidth: 100, minHeight: 36, border: "1px solid #C6CDDA", borderRadius: 6, padding: "5px 8px", fontSize: 12.5 }}
                  />
                )}
                <button type="button" onClick={() => setRows(rows.filter((x) => x.id !== r.id))} aria-label="Remove field"
                  style={{ minHeight: 36, padding: "0 10px", border: "none", background: "transparent", color: "#C53A3A", cursor: "pointer", fontSize: 13 }}>✕</button>
              </div>
              {/* Manipulators */}
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
                <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "#8A93A5" }}>Manipulate</span>
                {(r.rule.fieldManipulators ?? []).map((m, mi) => (
                  <ManipChip key={mi} entry={m}
                    onChange={(next) => update(r.id, { fieldManipulators: r.rule.fieldManipulators.map((x, i) => i === mi ? next : x) })}
                    onRemove={() => update(r.id, { fieldManipulators: r.rule.fieldManipulators.filter((_, i) => i !== mi) })}
                  />
                ))}
                <select value="" aria-label="Add manipulator"
                  onChange={(e) => {
                    const t = MANIPULATOR_TYPES.find((x) => x.type === e.target.value);
                    if (!t) return;
                    update(r.id, { fieldManipulators: [...(r.rule.fieldManipulators ?? []), { type: t.type, params: t.params.map(() => "") }] });
                  }}
                  style={{ minHeight: 30, border: "1px dashed #C6CDDA", borderRadius: 6, padding: "3px 6px", fontSize: 11.5, color: "#56627A", background: "#F6F7FA" }}>
                  <option value="">+ add</option>
                  {MANIPULATOR_TYPES.map((t) => <option key={t.type} value={t.type} title={t.hint}>{t.type}</option>)}
                </select>
              </div>
            </div>
          );
        })}
        {/* Add-field zone — also a drop target that creates a row pre-wired to the dropped source. */}
        <div
          onDragOver={(e) => { if (e.dataTransfer.types.includes(DRAG_TYPE)) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setOverAdd(true); } }}
          onDragLeave={() => setOverAdd(false)}
          onDrop={(e) => {
            const k = readDrag(e);
            if (k) { e.preventDefault(); const lbl = sourceByKey.get(k)?.label ?? k; setRows([...rows, { id: newId(), rule: { outputPath: lbl, canonicalField: k, fieldManipulators: [] } }]); }
            setOverAdd(false); setDragging(null);
          }}
          style={{ display: "flex", alignItems: "center", gap: 8, border: `1px dashed ${overAdd ? "#1E66C9" : "#C6CDDA"}`, background: overAdd ? "rgba(30,102,201,0.06)" : "transparent", borderRadius: 8, padding: "8px 10px", transition: "all 120ms" }}>
          <button type="button"
            onClick={() => setRows([...rows, { id: newId(), rule: { outputPath: "", fieldManipulators: [] } }])}
            style={{ fontSize: 12, fontWeight: 600, color: "#1E66C9", background: "#FFFFFF", border: "1px solid #1E66C9", borderRadius: 6, padding: "6px 12px", cursor: "pointer", minHeight: 34 }}>
            + Add {scope === "header" ? "header" : "line"} field
          </button>
          <span style={{ fontSize: 11, color: "#8A93A5" }}>or drop a source here</span>
        </div>
      </div>
    );
  }

  return (
    <div role="dialog" aria-label="Edit output mapping" style={{ position: "fixed", inset: 0, zIndex: 60, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={onClose} aria-hidden style={{ position: "absolute", inset: 0, background: "rgba(11,26,47,0.35)" }} />
      <aside style={{ position: "relative", width: "min(760px, 96vw)", height: "100%", background: "#F6F7FA", boxShadow: "-8px 0 24px rgba(0,0,0,0.18)", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", borderBottom: "1px solid #E2E6EE", background: "#FFFFFF" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#0B1A2F" }}>Edit output mapping</div>
            <div style={{ fontSize: 11.5, color: "#8A93A5" }}>Map &amp; manipulate each output field, per order. Default is used when empty.</div>
          </div>
          <select value={format} onChange={(e) => setFormat(e.target.value as "csv" | "json")} aria-label="Preview format"
            style={{ minHeight: 34, border: "1px solid #C6CDDA", borderRadius: 6, padding: "4px 8px", fontSize: 12 }}>
            <option value="csv">CSV</option>
            <option value="json">JSON</option>
          </select>
          <button type="button" onClick={onClose} aria-label="Close" style={{ minHeight: 34, minWidth: 34, border: "none", background: "transparent", fontSize: 18, color: "#56627A", cursor: "pointer" }}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 18, display: "flex", flexDirection: "column", gap: 18 }}>
          <CustomFieldsSection />
          <SourcePalette />
          <section>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#56627A", marginBottom: 8 }}>Header fields</div>
            <RuleRows scope="header" rows={headerRows} setRows={setHeaderRows} />
          </section>
          <section>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#56627A", marginBottom: 8 }}>Line fields</div>
            <RuleRows scope="lines" rows={lineRows} setRows={setLineRows} />
          </section>
          <section>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#56627A" }}>Live preview</span>
              {previewing && <span style={{ fontSize: 10.5, color: "#8A93A5" }}>updating…</span>}
            </div>
            {preview?.warning && <div style={{ fontSize: 11.5, color: "#C97A14", marginBottom: 6 }}>⚠ {preview.warning}</div>}
            {preview?.error && <div style={{ fontSize: 11.5, color: "#C53A3A", marginBottom: 6 }}>{preview.error}</div>}
            <pre style={{ margin: 0, background: "#0B1A2F", color: "#C5D2E4", borderRadius: 8, padding: 12, fontSize: 11.5, fontFamily: "'JetBrains Mono',monospace", overflowX: "auto", maxHeight: 240, whiteSpace: "pre-wrap" }}>
{preview?.content ?? (previewing ? "…" : "(no preview)")}
            </pre>
          </section>
        </div>

        <div style={{ display: "flex", gap: 10, padding: "12px 18px", borderTop: "1px solid #E2E6EE", background: "#FFFFFF" }}>
          <button type="button" onClick={() => reset.mutate()} disabled={reset.isPending}
            style={{ minHeight: 38, padding: "0 14px", border: "1px solid #C6CDDA", background: "#FFFFFF", color: "#56627A", borderRadius: 6, cursor: "pointer", fontSize: 12.5 }}>
            {reset.isPending ? "Resetting…" : "Reset to default"}
          </button>
          <div style={{ flex: 1 }} />
          {save.isError && <span style={{ alignSelf: "center", fontSize: 11.5, color: "#C53A3A" }}>{(save.error as Error)?.message}</span>}
          <button type="button" onClick={onClose} style={{ minHeight: 38, padding: "0 14px", border: "1px solid #C6CDDA", background: "#FFFFFF", color: "#56627A", borderRadius: 6, cursor: "pointer", fontSize: 12.5 }}>Cancel</button>
          <button type="button" onClick={() => save.mutate()} disabled={save.isPending}
            style={{ minHeight: 38, padding: "0 18px", border: "none", background: "#2E8E3A", color: "#FFFFFF", borderRadius: 6, cursor: "pointer", fontSize: 12.5, fontWeight: 700, opacity: save.isPending ? 0.6 : 1 }}>
            {save.isPending ? "Saving…" : "Save mapping"}
          </button>
        </div>
      </aside>
    </div>
  );
}

// ── Manipulator chip ──────────────────────────────────────────────────────────
function ManipChip({ entry, onChange, onRemove }: { entry: ManipulatorEntry; onChange: (e: ManipulatorEntry) => void; onRemove: () => void }) {
  const spec = MANIPULATOR_TYPES.find((t) => t.type === entry.type);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "#EEE7FB", border: "1px solid #DACEF3", borderRadius: 6, padding: "3px 6px" }}>
      <span title={spec?.hint} style={{ fontSize: 11, fontWeight: 700, color: "#5E3DB0" }}>{entry.type}</span>
      {(spec?.params ?? []).map((p, i) => (
        <input key={i} value={entry.params[i] ?? ""}
          onChange={(e) => { const params = [...entry.params]; params[i] = e.target.value; onChange({ ...entry, params }); }}
          placeholder={p} aria-label={`${entry.type} ${p}`}
          style={{ width: 64, minHeight: 24, border: "1px solid #C4ABE8", borderRadius: 4, padding: "1px 4px", fontSize: 10.5, fontFamily: "'JetBrains Mono',monospace" }} />
      ))}
      <button type="button" onClick={onRemove} aria-label={`Remove ${entry.type}`} style={{ border: "none", background: "transparent", color: "#8E7CB8", cursor: "pointer", fontSize: 12, lineHeight: 1 }}>✕</button>
    </span>
  );
}
