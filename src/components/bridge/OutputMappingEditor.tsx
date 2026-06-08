"use client";

// OutputMappingEditor — the power-user "map & manipulate manually" panel (heart-piece-flex
// Phase 3). Lets a user override, per order, how each output field is built: pick its source
// (a canonical field, a custom field, or a fixed value) and chain manipulators (the existing
// ManipulatorRegistry: Trim/Replace/DateFormat/Concat/Fallback/Split/Multiply/Divide), with a
// live dry-run preview. Persists via PUT /mapping-override; default (no override) is unchanged.
//
// This is a disclosure surface (opened from the order-review screen) — NOT a global mode.

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getMappingOverride, upsertMappingOverride, previewMappingOverride,
} from "@/lib/api-client";
import {
  MANIPULATOR_TYPES, CANONICAL_HEADER_FIELDS, CANONICAL_LINE_FIELDS,
  type OrderMappingOverride, type OutputFieldRule, type ManipulatorEntry,
} from "@/lib/api/types";

type Scope = "header" | "lines";
type Row = { id: string; rule: OutputFieldRule };

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

export function OutputMappingEditor({
  orderId, open, onClose, customFieldKeys = [],
}: {
  orderId: string;
  open: boolean;
  onClose: () => void;
  /** keys of any per-order custom fields, offered as sources. */
  customFieldKeys?: string[];
}) {
  const qc = useQueryClient();
  const { data: existing } = useQuery({
    queryKey: ["mapping-override", orderId],
    queryFn: () => getMappingOverride(orderId),
    enabled: open,
    staleTime: 10_000,
  });

  const [headerRows, setHeaderRows] = useState<Row[]>([]);
  const [lineRows, setLineRows]     = useState<Row[]>([]);
  const [format, setFormat]         = useState<"csv" | "json">("csv");
  const [seeded, setSeeded]         = useState(false);

  // Seed the editable draft from the loaded override once per open.
  useEffect(() => {
    if (!open) { setSeeded(false); return; }
    if (seeded) return;
    setHeaderRows(toRows(existing?.output?.header));
    setLineRows(toRows(existing?.output?.lines));
    setSeeded(true);
  }, [open, seeded, existing]);

  const draft: OrderMappingOverride = useMemo(() => ({
    customFields: existing?.customFields ?? [],
    output: { header: toRecord(headerRows), lines: toRecord(lineRows) },
  }), [existing, headerRows, lineRows]);

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
    mutationFn: () => upsertMappingOverride(orderId, { customFields: existing?.customFields ?? [], output: { header: {}, lines: {} } }),
    onSuccess: async () => {
      setHeaderRows([]); setLineRows([]);
      await qc.invalidateQueries({ queryKey: ["mapping-override", orderId] });
      await qc.invalidateQueries({ queryKey: ["order", orderId] });
    },
  });

  if (!open) return null;

  const canonicalFor = (scope: Scope) => (scope === "header" ? CANONICAL_HEADER_FIELDS : CANONICAL_LINE_FIELDS);

  function RuleRows({ scope, rows, setRows }: { scope: Scope; rows: Row[]; setRows: (r: Row[]) => void }) {
    const update = (id: string, patch: Partial<OutputFieldRule>) =>
      setRows(rows.map(r => r.id === id ? { ...r, rule: { ...r.rule, ...patch } } : r));
    const sources = [...canonicalFor(scope), ...customFieldKeys.map(k => `custom:${k}`)];
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.length === 0 && (
          <div style={{ fontSize: 12, color: "#8A93A5", padding: "6px 0" }}>No {scope} fields mapped — the default transform is used. Add a field to override it.</div>
        )}
        {rows.map((r) => {
          const usingFixed = r.rule.fixedValue != null && (r.rule.canonicalField == null || r.rule.canonicalField === "");
          return (
            <div key={r.id} style={{ border: "1px solid #E2E6EE", borderRadius: 8, padding: 10, background: "#FFFFFF" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <input
                  value={r.rule.outputPath ?? ""}
                  onChange={(e) => update(r.id, { outputPath: e.target.value })}
                  placeholder="Output field name"
                  aria-label="Output field name"
                  style={{ flex: "1 1 150px", minWidth: 120, minHeight: 36, border: "1px solid #C6CDDA", borderRadius: 6, padding: "5px 8px", fontSize: 12.5, fontFamily: "'JetBrains Mono',monospace" }}
                />
                <span style={{ color: "#8A93A5", fontSize: 12 }}>←</span>
                <select
                  value={usingFixed ? "__fixed__" : (r.rule.canonicalField ?? "")}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "__fixed__") update(r.id, { canonicalField: null, fixedValue: r.rule.fixedValue ?? "" });
                    else update(r.id, { canonicalField: v, fixedValue: null });
                  }}
                  aria-label="Source field"
                  style={{ flex: "1 1 150px", minWidth: 130, minHeight: 36, border: "1px solid #C6CDDA", borderRadius: 6, padding: "5px 8px", fontSize: 12.5, background: "#FFFFFF" }}
                >
                  <option value="">— source —</option>
                  {sources.map(s => <option key={s} value={s}>{s}</option>)}
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
                <button type="button" onClick={() => setRows(rows.filter(x => x.id !== r.id))} aria-label="Remove field"
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
                    const t = MANIPULATOR_TYPES.find(x => x.type === e.target.value);
                    if (!t) return;
                    update(r.id, { fieldManipulators: [...(r.rule.fieldManipulators ?? []), { type: t.type, params: t.params.map(() => "") }] });
                  }}
                  style={{ minHeight: 30, border: "1px dashed #C6CDDA", borderRadius: 6, padding: "3px 6px", fontSize: 11.5, color: "#56627A", background: "#F6F7FA" }}>
                  <option value="">+ add</option>
                  {MANIPULATOR_TYPES.map(t => <option key={t.type} value={t.type} title={t.hint}>{t.type}</option>)}
                </select>
              </div>
            </div>
          );
        })}
        <button type="button"
          onClick={() => setRows([...rows, { id: newId(), rule: { outputPath: "", fieldManipulators: [] } }])}
          style={{ alignSelf: "flex-start", fontSize: 12, fontWeight: 600, color: "#1E66C9", background: "#FFFFFF", border: "1px solid #1E66C9", borderRadius: 6, padding: "6px 12px", cursor: "pointer", minHeight: 34 }}>
          + Add {scope === "header" ? "header" : "line"} field
        </button>
      </div>
    );
  }

  return (
    <div role="dialog" aria-label="Edit output mapping" style={{ position: "fixed", inset: 0, zIndex: 60, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={onClose} aria-hidden style={{ position: "absolute", inset: 0, background: "rgba(11,26,47,0.35)" }} />
      <aside style={{ position: "relative", width: "min(720px, 96vw)", height: "100%", background: "#F6F7FA", boxShadow: "-8px 0 24px rgba(0,0,0,0.18)", display: "flex", flexDirection: "column" }}>
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
  const spec = MANIPULATOR_TYPES.find(t => t.type === entry.type);
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
