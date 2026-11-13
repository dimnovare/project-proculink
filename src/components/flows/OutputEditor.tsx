"use client";

import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/bridge/DSPrimitives";
import { Card } from "@/components/bridge/layout/Card";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { DestinationForm, Field, INPUT } from "@/components/flows/DestinationForm";
import { LookupMisses } from "@/components/flows/LookupMisses";
import { PdfDocumentView } from "@/components/bridge/document/PdfDocumentView";
import { checkOutput, createOutput, deleteOutputLogo, listDestinations, listLookups, previewOutput, updateOutput, uploadOutputLogo } from "@/lib/api/documents";
import type { Flow, FlowOutput, LookupSummary, OutputLayout, SendWhen, SendWhenOp } from "@/lib/api/documents";
import { ApiHttpError } from "@/lib/api/core";
import { COPY, documentRefusalMessage } from "@/lib/documentRefusals";
import { defaultWidth, fromSimple, OP_LABEL, toSimple } from "@/lib/flowOutputModel";
import type { SimpleOutput, SimpleRow } from "@/lib/flowOutputModel";
import { useTenantQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { FLAGGED, standardName } from "@/lib/standardOutputs";
import { StandardQuestions } from "@/components/flows/StandardQuestions";

export const FORMATS = { csv: "CSV", xlsx: "Excel", json: "JSON", xml: "XML", pdf: "PDF", txt: "Text", fixed: "Fixed-width text" };
/** What an output makes: its standard's name, else its file type. Never decided from `template.format`. */
export const outputTypeLabel = (o: { format: string; standard?: string | null }) =>
  o.standard ? standardName(o.standard) : Object.hasOwn(FORMATS, o.format) ? FORMATS[o.format as keyof typeof FORMATS] : o.format;
const SEPARATORS = [[",", "Comma"], [";", "Semicolon"], ["\t", "Tab"]];
const LAYOUT_FIELDS = [["title", "Title", 120], ["header", "Text at the top", 500], ["footer", "Text at the bottom", 500]] as const;
const FIXED = "\u0000fixed";
const NEW_DESTINATION = "\u0000new";

function RowList({ rows, fixed, options, lookups, onChange }: {
  rows: SimpleRow[]; fixed: boolean; options: { key: string; label: string }[]; lookups: LookupSummary[] | "loading" | "failed"; onChange(rows: SimpleRow[]): void;
}) {
  const list = Array.isArray(lookups) ? lookups : [];
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
            {"field" in row.source && ((f) => !options.some((o) => o.key === f))(row.source.field) && <option value={row.source.field}>A field that no longer exists</option>}
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
            {row.lookup && !list.some((l) => l.id === row.lookup!.id) && <option value={row.lookup.id}>{Array.isArray(lookups) ? "A lookup that no longer exists" : lookups === "failed" ? "Couldn't load lookups" : "Loading lookups…"}</option>}
            {list.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          {row.lookup && (
            <select aria-label="If it's not in the lookup" className={`${INPUT} min-w-32 flex-1`} value={row.lookup.ifMissing}
              onChange={(e) => patch(i, { ...row, lookup: { id: row.lookup!.id, ifMissing: e.target.value as "keep" | "blank" } })}>
              <option value="keep">Keep the value</option>
              <option value="blank">Leave it blank</option>
            </select>
          )}
          {fixed && (
            <input type="number" min={1} max={1000} aria-label={`Width of ${row.name}`} className={`${INPUT} w-24`}
              value={row.width ?? defaultWidth(row.name)} onChange={(e) => patch(i, { ...row, width: Number(e.target.value) || undefined })} />
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
  const [rows, setRows] = useState<SimpleOutput | null>(output && !output.standard ? toSimple(output.template) : null);
  const [sendWhen, setSendWhen] = useState<SendWhen | null>(output?.sendWhen ?? null);
  const [layout, setLayout] = useState<OutputLayout>(output?.layout ?? {});
  const [problem, setProblem] = useState<string | null>(null);

  const destinations = useQuery({ queryKey: ["destinations"], queryFn: listDestinations, enabled: useTenantQueriesEnabled() });
  const lookups = useQuery({ queryKey: ["lookups"], queryFn: listLookups, enabled: useTenantQueriesEnabled() });
  const lookupList = lookups.data ?? (lookups.isError ? "failed" : "loading");
  const standard = current?.standard;
  const external = !!current && !rows && !standard;
  const formatted = !standard && (format === "pdf" || format === "txt");

  const preview = useMutation({ mutationFn: () => previewOutput(previewDocumentId!, current!.id) });
  const check = useMutation({ mutationFn: () => checkOutput(flow.id, current!.id, previewDocumentId!) });
  const logoInput = useRef<HTMLInputElement>(null);
  const logo = useMutation({
    mutationFn: (file: File | null) => (file ? uploadOutputLogo(flow.id, current!.id, file) : deleteOutputLogo(flow.id, current!.id)),
    onSuccess: (_, file) => {
      setProblem(null);
      setCurrent((c) => c && { ...c, hasLogo: !!file });
      qc.invalidateQueries({ queryKey: ["outputs", flow.id] });
      qc.invalidateQueries({ queryKey: ["flow", flow.id] });
    },
    onError: (e) => setProblem(e instanceof ApiHttpError && e.status === 413 ? COPY.invalid_logo : documentRefusalMessage(e)),
  });
  const pdf = preview.data?.contentType === "application/pdf" && preview.data.base64 ? preview.data.base64 : null;
  const pdfBlob = useMemo(() => pdf && new Blob([Uint8Array.from(atob(pdf), (c) => c.charCodeAt(0))], { type: "application/pdf" }), [pdf]);
  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), format, tableKey, destinationId, sendWhen, layout: formatted ? layout : null };
      if (!current) return createOutput(flow.id, body);
      const withWidth = (r: SimpleRow) => ({ ...r, width: r.width ?? defaultWidth(r.name) });
      const sent = rows && format === "fixed"
        ? { ...rows, fields: rows.fields.map(withWidth), table: rows.table && { ...rows.table, columns: rows.table.columns.map(withWidth) } }
        : rows;
      return updateOutput(flow.id, current.id, { ...body, template: sent ? fromSimple(sent, format) : current.template });
    },
    onSuccess: (saved) => {
      const created = !current;
      setProblem(null);
      preview.reset();
      check.reset();
      setCurrent(saved);
      if (created) setRows(toSimple(saved.template));
      qc.invalidateQueries({ queryKey: ["outputs", flow.id] });
      qc.invalidateQueries({ queryKey: ["flow", flow.id] });
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
    if (sendWhen && !sendWhen.value.trim()) return setProblem(COPY.send_when);
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
        {standard ? (
          <Field label="Standard"><input className={INPUT} readOnly value={standardName(standard)} /></Field>
        ) : (
          <Field label="File type">
            <select className={INPUT} value={format} disabled={external} onChange={(e) => setFormat(e.target.value)}>
              {!Object.hasOwn(FORMATS, format) && <option value={format}>{format}</option>}
              {Object.entries(FORMATS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </Field>
        )}
        {rows && format === "csv" && (
          <Field label="Separator">
            <select className={INPUT} value={rows.delimiter ?? ","} onChange={(e) => setRows({ ...rows, delimiter: e.target.value })}>
              {rows.delimiter && !SEPARATORS.some(([v]) => v === rows.delimiter) && <option value={rows.delimiter}>{rows.delimiter}</option>}
              {SEPARATORS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
            </select>
          </Field>
        )}
        {formatted && LAYOUT_FIELDS.map(([key, label, max]) => (
          <Field key={key} label={label}>
            {key === "title"
              ? <input className={INPUT} maxLength={max} value={layout.title ?? ""} onChange={(e) => setLayout({ ...layout, title: e.target.value })} />
              : <textarea className={INPUT} rows={2} maxLength={max} value={layout[key] ?? ""} onChange={(e) => setLayout({ ...layout, [key]: e.target.value })} />}
          </Field>
        ))}
        {format === "pdf" && (
          <Field label="Logo">
            {!current ? <p className="text-[12px] text-ink-muted">Save the output first, then add a logo.</p>
              : current.hasLogo ? <Button type="button" variant="secondary" loading={logo.isPending} onClick={() => logo.mutate(null)}>Remove logo</Button>
              : (
                <>
                  <Button type="button" variant="secondary" loading={logo.isPending} onClick={() => logoInput.current?.click()}>Add a logo</Button>
                  <input ref={logoInput} type="file" aria-label="Add a logo" accept="image/png,image/jpeg" className="hidden" tabIndex={-1} disabled={logo.isPending}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (!file) return;
                      if (file.size > 262_144) setProblem(COPY.invalid_logo);
                      else logo.mutate(file);
                    }} />
                  <p className="text-[12px] text-ink-muted">PNG or JPG, up to 256 KB.</p>
                </>
              )}
          </Field>
        )}
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
            <RowList fixed={format === "fixed"} rows={rows.fields} options={fieldOptions} lookups={lookupList} onChange={(fields) => setRows({ ...rows, fields })} />
            {rows.table && (
              <>
                <p className="text-[12px] font-medium text-ink-muted">{table?.label ?? "Table"} columns</p>
                <RowList fixed={format === "fixed"} rows={rows.table.columns} options={columnOptions} lookups={lookupList}
                  onChange={(columns) => setRows({ ...rows, table: { key: rows.table!.key, columns } })} />
              </>
            )}
          </>
        )}
        {standard && <StandardQuestions flow={flow} needs={current.needs ?? []} tableKey={tableKey} name={standardName(standard)} />}
        {problem && <StatusNotice tone="error">{problem}</StatusNotice>}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="primary" loading={save.isPending}>{current ? "Save" : "Create"}</Button>
          <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
          {previewDocumentId && current && (
            <Button type="button" variant="secondary" loading={preview.isPending} onClick={() => preview.mutate()}>Preview</Button>
          )}
          {previewDocumentId && current && standard && FLAGGED.has(standard) && flow.peppolOn && (
            <Button type="button" variant="secondary" loading={check.isPending} onClick={() => check.mutate()}>Check against Peppol rules</Button>
          )}
        </div>
        {check.isError && <StatusNotice tone="error">{documentRefusalMessage(check.error)}</StatusNotice>}
        {check.data?.status === "passed" && <StatusNotice tone="success">Passes the Peppol BIS Billing 3.0 rules.</StatusNotice>}
        {check.data?.status === "unavailable" && <StatusNotice tone="warning">We couldn&apos;t reach the rule checker. Try again in a minute.</StatusNotice>}
        {check.data?.status === "failed" && (
          <StatusNotice tone="warning">
            Doesn&apos;t meet {check.data.issues.filter((i) => i.severity === "error").length} Peppol rule(s):
            <ul className="mt-1 list-disc pl-4">
              {[...check.data.issues].sort((a, b) => Number(b.severity === "error") - Number(a.severity === "error")).map((i, n) => (
                <li key={n}>{i.ruleId} — {i.message}{i.severity === "error" ? "" : ` (${i.severity})`}</li>
              ))}
            </ul>
          </StatusNotice>
        )}
        {previewDocumentId && current && <p className="text-[12px] text-ink-muted">Preview shows the last saved version.</p>}
        {preview.isError && <StatusNotice tone="error">{documentRefusalMessage(preview.error)}</StatusNotice>}
        {previewDocumentId && current && preview.data?.lookupMisses?.length ? (
          <LookupMisses documentId={previewDocumentId} outputId={current.id} misses={preview.data.lookupMisses} onChanged={() => preview.mutate()} />
        ) : null}
        {pdfBlob && current ? <PdfDocumentView cacheKey={`output-preview-${current.id}-${preview.submittedAt}`} blob={pdfBlob} bounded regionLabel="Preview" />
        : preview.data && (
          <pre className="max-h-72 overflow-auto rounded border border-border bg-surface2 p-2.5 font-mono text-[12px] text-ink">
            {preview.data.content}
          </pre>
        )}
      </form>
    </Card>
  );
}
