"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/bridge/DSPrimitives";
import { Card } from "@/components/bridge/layout/Card";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { DestinationForm, Field, INPUT } from "@/components/flows/DestinationForm";
import { createOutput, listDestinations, listLookups, previewOutput, updateOutput } from "@/lib/api/documents";
import type { Flow, FlowOutput, LookupSummary, SendWhen, SendWhenOp } from "@/lib/api/documents";
import { documentRefusalMessage } from "@/lib/documentRefusals";
import { fromSimple, OP_LABEL, toSimple } from "@/lib/flowOutputModel";
import type { SimpleOutput, SimpleRow } from "@/lib/flowOutputModel";
import { useTenantQueriesEnabled } from "@/hooks/useQueriesEnabled";

export const FORMATS = { csv: "CSV", xlsx: "Excel", json: "JSON", xml: "XML" };
const FIXED = "\u0000fixed";
const NEW_DESTINATION = "\u0000new";

function RowList({ rows, options, lookups, onChange }: {
  rows: SimpleRow[]; options: { key: string; label: string }[]; lookups: LookupSummary[]; onChange(rows: SimpleRow[]): void;
}) {
  const patch = (i: number, row: SimpleRow) => onChange(rows.map((r, j) => (j === i ? row : r)));
  const move = (i: number, by: number) => {
    const next = [...rows];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    onChange(next);
  };
  return (
    <div className="grid gap-2">
      {rows.map((row, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <input aria-label="Name in the file" className={`${INPUT} min-w-32 flex-1`} value={row.name}
            onChange={(e) => patch(i, { ...row, name: e.target.value })} />
          <select aria-label="Value" className={`${INPUT} min-w-32 flex-1`} value={"field" in row.source ? row.source.field : FIXED}
            onChange={(e) => patch(i, { ...row, source: e.target.value === FIXED ? { fixed: "" } : { field: e.target.value } })}>
            {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            <option value={FIXED}>Fixed value</option>
          </select>
          {"fixed" in row.source && (
            <input aria-label="Fixed value" className={`${INPUT} min-w-32 flex-1`} value={row.source.fixed}
              onChange={(e) => patch(i, { ...row, source: { fixed: e.target.value } })} />
          )}
          <select aria-label="Swap with lookup" className={`${INPUT} min-w-32 flex-1`} value={row.lookup?.id ?? ""}
            onChange={(e) => patch(i, { ...row, lookup: e.target.value ? { id: e.target.value, ifMissing: row.lookup?.ifMissing ?? "keep" } : undefined })}>
            <option value="">No lookup</option>
            {lookups.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          {row.lookup && (
            <select aria-label="If it's not in the lookup" className={`${INPUT} min-w-32 flex-1`} value={row.lookup.ifMissing}
              onChange={(e) => patch(i, { ...row, lookup: { id: row.lookup!.id, ifMissing: e.target.value as "keep" | "blank" } })}>
              <option value="keep">Keep the value</option>
              <option value="blank">Leave it blank</option>
            </select>
          )}
          <Button type="button" variant="ghost" size="sm" disabled={i === 0} aria-label="Move up" onClick={() => move(i, -1)}>Up</Button>
          <Button type="button" variant="ghost" size="sm" disabled={i === rows.length - 1} aria-label="Move down" onClick={() => move(i, 1)}>Down</Button>
          <Button type="button" variant="ghost" size="sm" aria-label="Remove" onClick={() => onChange(rows.filter((_, j) => j !== i))}>Remove</Button>
        </div>
      ))}
      <div>
        <Button type="button" variant="secondary" size="sm" disabled={!options.length}
          onClick={() => onChange([...rows, { name: options[0].label, source: { field: options[0].key } }])}>
          Add a row
        </Button>
      </div>
    </div>
  );
}

export function OutputEditor({ flow, output, previewDocumentId, hideDestination, onSaved, onCancel }: {
  flow: Flow; output?: FlowOutput; previewDocumentId?: string; hideDestination?: boolean; onSaved(): void; onCancel(): void;
}) {
  const qc = useQueryClient();
  const [current, setCurrent] = useState(output);
  const [name, setName] = useState(output?.name ?? "");
  const [format, setFormat] = useState(output?.format ?? "csv");
  const [tableKey, setTableKey] = useState<string | null>(output ? output.tableKey : (flow.fields.tables[0]?.key ?? null));
  const [destinationId, setDestinationId] = useState<string | null>(output?.destinationId ?? null);
  const [newDestination, setNewDestination] = useState(false);
  const [rows, setRows] = useState<SimpleOutput | null>(output ? toSimple(output.template) : null);
  const [sendWhen, setSendWhen] = useState<SendWhen | null>(output?.sendWhen ?? null);
  const [problem, setProblem] = useState<string | null>(null);

  const destinations = useQuery({ queryKey: ["destinations"], queryFn: listDestinations, enabled: useTenantQueriesEnabled() });
  const lookups = useQuery({ queryKey: ["lookups"], queryFn: listLookups, enabled: useTenantQueriesEnabled() });
  const external = !!current && !rows;

  const preview = useMutation({ mutationFn: () => previewOutput(previewDocumentId!, current!.id) });
  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), format, tableKey, destinationId, sendWhen };
      if (!current) return createOutput(flow.id, body);
      return updateOutput(flow.id, current.id, { ...body, template: rows ? fromSimple(rows, format) : current.template });
    },
    onSuccess: (saved) => {
      const created = !current;
      setProblem(null);
      preview.reset();
      setCurrent(saved);
      if (created) setRows(toSimple(saved.template));
      qc.invalidateQueries({ queryKey: ["outputs", flow.id] });
      if (!created) onSaved();
    },
    onError: (e) => setProblem(documentRefusalMessage(e)),
  });

  const table = flow.fields.tables.find((t) => t.key === rows?.table?.key);
  const fieldOptions = flow.fields.fields.map((f) => ({ key: f.key, label: f.label }));
  const columnOptions = (table?.columns ?? []).map((f) => ({ key: f.key, label: f.label }));

  function changeTable(key: string | null) {
    setTableKey(key);
    const t = flow.fields.tables.find((x) => x.key === key);
    if (rows) setRows({ ...rows, table: t ? { key: t.key, columns: t.columns.map((c) => ({ name: c.label, source: { field: c.key } })) } : null });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setProblem("Give this output a name.");
    if ([...(rows?.fields ?? []), ...(rows?.table?.columns ?? [])].some((r) => !r.name.trim()))
      return setProblem("Give every row a name.");
    save.mutate();
  }

  return (
    <Card edge="green" title={current ? "Edit output" : "New output"}>
      <form onSubmit={submit} className="grid gap-3">
        <Field label="Name">
          <input className={INPUT} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="File type">
          <select className={INPUT} value={format} disabled={external} onChange={(e) => setFormat(e.target.value)}>
            {!Object.hasOwn(FORMATS, format) && <option value={format}>{format}</option>}
            {Object.entries(FORMATS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </Field>
        {flow.fields.tables.length > 0 && (
          <Field label="Table">
            <select className={INPUT} value={tableKey ?? ""} disabled={external} onChange={(e) => changeTable(e.target.value || null)}>
              <option value="">No table</option>
              {flow.fields.tables.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </Field>
        )}
        {!hideDestination && <Field label="Send to">
          <select className={INPUT} value={newDestination ? NEW_DESTINATION : (destinationId ?? "")}
            onChange={(e) => {
              setNewDestination(e.target.value === NEW_DESTINATION);
              if (e.target.value !== NEW_DESTINATION) setDestinationId(e.target.value || null);
            }}>
            <option value="">Download only</option>
            {destinations.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            <option value={NEW_DESTINATION}>New destination…</option>
          </select>
        </Field>}
        {!hideDestination && destinations.isError && <StatusNotice tone="error">{documentRefusalMessage(destinations.error)}</StatusNotice>}
        {!hideDestination && newDestination && (
          <DestinationForm
            onCancel={() => setNewDestination(false)}
            onSaved={(d) => { setDestinationId(d.id); setNewDestination(false); qc.invalidateQueries({ queryKey: ["destinations"] }); }}
          />
        )}
        {!hideDestination && (
          <>
            <Field label="Send when">
              <select className={INPUT} value={sendWhen ? "only" : "always"}
                onChange={(e) => setSendWhen(e.target.value === "only" ? { field: flow.fields.fields[0]?.key ?? "", op: "is", value: "" } : null)}>
                <option value="always">Always</option>
                <option value="only">Only when</option>
              </select>
            </Field>
            {sendWhen && (
              <div className="flex flex-wrap items-center gap-2">
                <select aria-label="Field" className={`${INPUT} min-w-32 flex-1`} value={sendWhen.field}
                  onChange={(e) => setSendWhen({ ...sendWhen, field: e.target.value })}>
                  {fieldOptions.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                </select>
                <select aria-label="Condition" className={`${INPUT} min-w-24`} value={sendWhen.op}
                  onChange={(e) => setSendWhen({ ...sendWhen, op: e.target.value as SendWhenOp })}>
                  {Object.entries(OP_LABEL).map(([op, label]) => <option key={op} value={op}>{label}</option>)}
                </select>
                <input aria-label="Matches" className={`${INPUT} min-w-32 flex-1`} value={sendWhen.value}
                  onChange={(e) => setSendWhen({ ...sendWhen, value: e.target.value })} />
              </div>
            )}
            <p className="text-[12px] text-ink-muted">Send this output only for some documents, for example one output per recipient.</p>
          </>
        )}
        {external && (
          <p className="text-[12px] text-ink-muted">
            This output was set up outside this editor. You can change its name and destination here.
          </p>
        )}
        {rows && (
          <>
            <p className="text-[12px] font-medium text-ink-muted">Values</p>
            <RowList rows={rows.fields} options={fieldOptions} lookups={lookups.data ?? []} onChange={(fields) => setRows({ ...rows, fields })} />
            {rows.table && (
              <>
                <p className="text-[12px] font-medium text-ink-muted">{table?.label ?? "Table"} columns</p>
                <RowList rows={rows.table.columns} options={columnOptions} lookups={lookups.data ?? []}
                  onChange={(columns) => setRows({ ...rows, table: { key: rows.table!.key, columns } })} />
              </>
            )}
          </>
        )}
        {problem && <StatusNotice tone="error">{problem}</StatusNotice>}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="primary" loading={save.isPending}>{current ? "Save" : "Create"}</Button>
          <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
          {previewDocumentId && current && (
            <Button type="button" variant="secondary" loading={preview.isPending} onClick={() => preview.mutate()}>Preview</Button>
          )}
        </div>
        {previewDocumentId && current && <p className="text-[12px] text-ink-muted">Preview shows the last saved version.</p>}
        {preview.isError && <StatusNotice tone="error">{documentRefusalMessage(preview.error)}</StatusNotice>}
        {preview.data?.lookupMisses.length ? [...Map.groupBy(preview.data.lookupMisses, (m) => m.lookupId)].map(([id, misses]) => (
          <p key={id} className="m-0 text-[12px] text-ink-muted">
            Not in “{lookups.data?.find((l) => l.id === id)?.name ?? "this lookup"}”: {misses.map((m) => m.value).join(", ")}.
          </p>
        )) : null}
        {preview.data && (
          <pre className="max-h-72 overflow-auto rounded border border-border bg-surface2 p-2.5 font-mono text-[12px] text-ink">
            {preview.data.content}
          </pre>
        )}
      </form>
    </Card>
  );
}
