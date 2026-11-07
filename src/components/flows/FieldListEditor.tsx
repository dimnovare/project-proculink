"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/bridge/DSPrimitives";
import { Card } from "@/components/bridge/layout/Card";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { INPUT } from "@/components/flows/DestinationForm";
import { saveFlowFields } from "@/lib/api/documents";
import type { Flow, FlowField, FlowFieldList } from "@/lib/api/documents";
import { documentRefusalMessage } from "@/lib/documentRefusals";
import { FIELD_TYPES } from "@/lib/flowFieldModel";

function FieldRow({ field, on, onInclude, onChange }: {
  field: FlowField; on: boolean; onInclude(on: boolean): void; onChange(field: FlowField): void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input type="checkbox" aria-label={`Include ${field.label}`} className="size-4" checked={on} onChange={(e) => onInclude(e.target.checked)} />
      <input aria-label="Label" className={`${INPUT} min-w-32 flex-1`} value={field.label} disabled={!on}
        onChange={(e) => onChange({ ...field, label: e.target.value })} />
      <select aria-label="Type" className={`${INPUT} w-36`} value={field.type} disabled={!on}
        onChange={(e) => onChange({ ...field, type: e.target.value })}>
        {!(field.type in FIELD_TYPES) && <option value={field.type}>{field.type}</option>}
        {Object.entries(FIELD_TYPES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
      </select>
      <label className="flex items-center gap-1.5 text-[12px] text-ink-muted">
        <input type="checkbox" className="size-4" checked={field.required} disabled={!on}
          onChange={(e) => onChange({ ...field, required: e.target.checked })} />
        Required
      </label>
    </div>
  );
}

export function FieldListEditor({ flow, initial, onSaved }: {
  flow: Flow; initial: FlowFieldList; onSaved(flow: Flow): void;
}) {
  const qc = useQueryClient();
  const [list, setList] = useState(initial);
  // Unchecked rows, by "key" (field or table) or "table/column".
  const [off, setOff] = useState<Set<string>>(new Set());
  const [problem, setProblem] = useState<string | null>(null);
  const toggle = (id: string, on: boolean) => setOff((s) => { const n = new Set(s); if (on) n.delete(id); else n.add(id); return n; });

  const patchField = (i: number, f: FlowField) => setList({ ...list, fields: list.fields.map((x, j) => (j === i ? f : x)) });
  const patchColumn = (t: number, i: number, f: FlowField) =>
    setList({ ...list, tables: list.tables.map((x, j) => (j === t ? { ...x, columns: x.columns.map((c, k) => (k === i ? f : c)) } : x)) });

  /** Included rows only. A table with no included columns is left out: there is nothing to read into it. */
  const chosen = (): FlowFieldList => ({
    fields: list.fields.filter((f) => !off.has(f.key)),
    tables: list.tables
      .filter((t) => !off.has(t.key))
      .map((t) => ({ ...t, columns: t.columns.filter((c) => !off.has(`${t.key}/${c.key}`)) }))
      .filter((t) => t.columns.length > 0),
  });

  const save = useMutation({
    mutationFn: (body: FlowFieldList) => saveFlowFields(flow.id, body),
    onSuccess: (saved) => {
      setProblem(null);
      qc.invalidateQueries({ queryKey: ["flows"] });
      qc.invalidateQueries({ queryKey: ["flow", flow.id] });
      onSaved(saved);
    },
    onError: (e) => setProblem(documentRefusalMessage(e)),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const body = chosen();
    const named = [...body.fields, ...body.tables.flatMap((t) => [t, ...t.columns])];
    if (!named.length) return setProblem("Keep at least one field.");
    if (named.some((x) => !x.label.trim())) return setProblem("Give every field a label.");
    save.mutate(body);
  }

  return (
    <Card edge="none" title="Fields to read">
      <form onSubmit={submit} className="grid gap-3">
        <p className="text-[12px] text-ink-muted">Every document in this flow is read into these fields. Untick what you don&apos;t need.</p>
        <div className="grid gap-2">
          {list.fields.map((f, i) => (
            <FieldRow key={f.key} field={f} on={!off.has(f.key)} onInclude={(on) => toggle(f.key, on)} onChange={(x) => patchField(i, x)} />
          ))}
        </div>
        {list.tables.map((t, ti) => (
          <div key={t.key} className="grid gap-2 border-t border-border pt-3">
            <div className="flex items-center gap-2">
              <input type="checkbox" aria-label={`Include table ${t.label}`} className="size-4" checked={!off.has(t.key)}
                onChange={(e) => toggle(t.key, e.target.checked)} />
              <input aria-label="Table label" className={`${INPUT} min-w-32 flex-1`} value={t.label} disabled={off.has(t.key)}
                onChange={(e) => setList({ ...list, tables: list.tables.map((x, j) => (j === ti ? { ...x, label: e.target.value } : x)) })} />
            </div>
            <div className="grid gap-2 pl-6">
              {t.columns.map((c, ci) => (
                <FieldRow key={c.key} field={c} on={!off.has(t.key) && !off.has(`${t.key}/${c.key}`)}
                  onInclude={(on) => toggle(`${t.key}/${c.key}`, on)} onChange={(x) => patchColumn(ti, ci, x)} />
              ))}
            </div>
          </div>
        ))}
        {problem && <StatusNotice tone="error">{problem}</StatusNotice>}
        <div><Button type="submit" variant="primary" loading={save.isPending}>Save fields</Button></div>
      </form>
    </Card>
  );
}
