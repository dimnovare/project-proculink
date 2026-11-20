"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/bridge/DSPrimitives";
import { Card } from "@/components/bridge/layout/Card";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { DestinationForm, Field, INPUT, INPUT_BASE } from "@/components/flows/DestinationForm";
import { LookupMisses } from "@/components/flows/LookupMisses";
import { PdfDocumentView } from "@/components/bridge/document/PdfDocumentView";
import { checkOutput, createOutput, deleteOutputLogo, listDestinations, listLookups, previewOutput, testOutput, updateOutput, uploadOutputLogo } from "@/lib/api/documents";
import type { Flow, FlowOutput, LookupSummary, OutputCheck, OutputLayout, OutputRequest, SendWhen, SendWhenOp } from "@/lib/api/documents";
import { TestOutcome } from "@/components/destinations/TestOutcome";
import { destinationsAddress, destinationWhere } from "@/lib/destinations";
import { DraftState, FlowLink, useDraftPart, useOnFlowPage } from "./flowDraft";
import { ApiHttpError } from "@/lib/api/core";
import { COPY, documentRefusalMessage } from "@/lib/documentRefusals";
import { sendsByItself } from "@/lib/deliveryMode";
import { defaultWidth, fromSimple, OP_LABEL, toSimple } from "@/lib/flowOutputModel";
import type { SimpleOutput, SimpleRow } from "@/lib/flowOutputModel";
import { useTenantQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { FLAGGED, RULE_SETS, standardName } from "@/lib/standardOutputs";
import { StandardQuestions } from "@/components/flows/StandardQuestions";
import { PartnerIds } from "@/components/flows/PartnerIds";
import type { EnvelopeConfig } from "@/lib/api/types";
import { Pencil } from "lucide-react";
import { FirstDocumentDrop, useLatestRead } from "./FlowValues";

export const FORMATS = { csv: "CSV", xlsx: "Excel", json: "JSON", xml: "XML", pdf: "PDF", txt: "Text", fixed: "Fixed-width text" };
/** What an output makes: its standard's name, else its file type. Never decided from `template.format`. */
export const outputTypeLabel = (o: { format: string; standard?: string | null }) =>
  o.standard ? standardName(o.standard) : Object.hasOwn(FORMATS, o.format) ? FORMATS[o.format as keyof typeof FORMATS] : o.format;
const SEPARATORS = [[",", "Comma"], [";", "Semicolon"], ["\t", "Tab"]];
const LAYOUT_FIELDS = [["title", "Title", 120], ["header", "Text at the top", 500], ["footer", "Text at the bottom", 500]] as const;
const FIXED = "\u0000fixed";
const NEW_DESTINATION = "\u0000new";

type Lookups = LookupSummary[] | "loading" | "failed";
/** Whether the column editor was left open, one key for the person, not one per file. */
const COLUMNS_KEY = "plk:columns-open";

/** No document read yet: one is added to this flow right here, through the app's upload queue, as on We read. */
function AddDocument({ flow, sends }: { flow: Flow; sends: boolean }) {
  const { newest } = useLatestRead(flow.id);
  return <FirstDocumentDrop flow={flow} newest={newest} prompt="Add a document to this flow to see the file and send a test." reading="The file appears here in a moment." sends={sends} />;
}

/** A row's lookup swap. `of` names the row in the labels, for a list of them away from the row itself. */
function LookupControls({ row, lookups, of, onChange }: { row: SimpleRow; lookups: Lookups; of?: string; onChange(row: SimpleRow): void }) {
  const list = Array.isArray(lookups) ? lookups : [];
  return (
    <>
      <select aria-label={of ? `Swap ${of} with lookup` : "Swap with lookup"} className={`${INPUT} min-w-32 flex-1`} value={row.lookup?.id ?? ""}
        onChange={(e) => onChange({ ...row, lookup: e.target.value ? { id: e.target.value, ifMissing: row.lookup?.ifMissing ?? "keep" } : undefined })}>
        <option value="">No lookup</option>
        {row.lookup && !list.some((l) => l.id === row.lookup!.id) && <option value={row.lookup.id}>{Array.isArray(lookups) ? "A lookup that no longer exists" : lookups === "failed" ? "Couldn't load lookups" : "Loading lookups…"}</option>}
        {list.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
      </select>
      {row.lookup && (
        <select aria-label={of ? `If ${of} is not in the lookup` : "If it's not in the lookup"} className={`${INPUT} min-w-32 flex-1`} value={row.lookup.ifMissing}
          onChange={(e) => onChange({ ...row, lookup: { id: row.lookup!.id, ifMissing: e.target.value as "keep" | "blank" } })}>
          <option value="keep">Keep the value</option>
          <option value="blank">Leave it blank</option>
        </select>
      )}
    </>
  );
}

/** `columns`: the flow page's names ("Column name, {x}", "Move the column {x} up"…), with the lookups kept elsewhere. */
function RowList({ rows, fixed, options, lookups, columns, onChange }: {
  rows: SimpleRow[]; fixed: boolean; options: { key: string; label: string }[]; lookups: Lookups; columns?: boolean; onChange(rows: SimpleRow[]): void;
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
          <input aria-label={columns ? `Column name, ${row.name}` : "Name in the file"} className={`${INPUT} min-w-32 flex-1`} value={row.name}
            onChange={(e) => patch(i, { ...row, name: e.target.value })} />
          <select aria-label={columns ? `Where ${row.name} comes from` : "Value"} className={`${INPUT} min-w-32 flex-1`} value={"field" in row.source ? row.source.field : FIXED}
            onChange={(e) => patch(i, { ...row, source: e.target.value === FIXED ? { fixed: "" } : { field: e.target.value } })}>
            {"field" in row.source && ((f) => !options.some((o) => o.key === f))(row.source.field) && <option value={row.source.field}>A field that no longer exists</option>}
            {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            <option value={FIXED}>Fixed value</option>
          </select>
          {"fixed" in row.source && (
            <input aria-label="Fixed value" className={`${INPUT} min-w-32 flex-1`} value={row.source.fixed}
              onChange={(e) => patch(i, { ...row, source: { fixed: e.target.value } })} />
          )}
          {!columns && <LookupControls row={row} lookups={lookups} onChange={(r) => patch(i, r)} />}
          {fixed && (
            <input type="number" min={1} max={1000} aria-label={`Width of ${row.name}`} className={`${INPUT} w-24`}
              value={row.width ?? defaultWidth(row.name)} onChange={(e) => patch(i, { ...row, width: Number(e.target.value) || undefined })} />
          )}
          <Button type="button" variant="ghost" size="sm" disabled={i === 0} aria-label={columns ? `Move the column ${row.name} up` : "Move up"} onClick={() => move(i, -1)}>Up</Button>
          <Button type="button" variant="ghost" size="sm" disabled={i === rows.length - 1} aria-label={columns ? `Move the column ${row.name} down` : "Move down"} onClick={() => move(i, 1)}>Down</Button>
          <Button type="button" variant="ghost" size="sm" aria-label={columns ? `Remove the column ${row.name}` : "Remove"} onClick={() => onChange(rows.filter((_, j) => j !== i))}>Remove</Button>
        </div>
      ))}
      <div>
        <Button type="button" variant="secondary" size="sm" disabled={!options.length}
          onClick={() => onChange([...rows, { name: options[0].label, source: { field: options[0].key } }])}>
          {columns ? "Add a column" : "Add a row"}
        </Button>
      </div>
    </div>
  );
}

function IssueList({ issues }: { issues: OutputCheck["issues"] }) {
  return (
    <ul className="mt-1 list-disc pl-4">
      {[...issues].sort((a, b) => Number(b.severity === "error") - Number(a.severity === "error")).map((i, n) => (
        <li key={n}>{i.ruleId} — {i.message}{i.severity === "error" ? "" : ` (${i.severity})`}</li>
      ))}
    </ul>
  );
}

type EditorProps = {
  flow: Flow; output?: FlowOutput; previewDocumentId?: string; hideDestination?: boolean;
  /** "form" (the default): Save and Cancel. "draft": the flow page's We send, where every change is part of the draft. */
  mode?: "form" | "draft";
  /** The file the preview document came from, for the draft's "Made from {file}". */
  previewFile?: string;
  /** Called once a new output is made; without it the editor stays open on the new output. */
  onCreated?(output: FlowOutput): void;
  onSaved(): void; onCancel(): void;
  /** Draft only: handed the file's heading when it is drawn. */
  headingRef?: React.Ref<HTMLHeadingElement>;
  /** Draft only: buttons for the file, drawn on the row with its name. */
  actions?: React.ReactNode;
};
type Draft = { part: ReturnType<typeof useDraftPart<OutputRequest>>; saves: number };

export function OutputEditor(props: EditorProps) {
  return props.mode === "draft" && props.output ? <DraftOutputEditor {...props} output={props.output} /> : <Editor {...props} />;
}

/** One draft part per output. Each save it makes refreshes the output's row and, through `saves`, the preview. */
function DraftOutputEditor(props: EditorProps & { output: FlowOutput }) {
  const qc = useQueryClient();
  const { flow, output } = props;
  const [saves, setSaves] = useState(0);
  const save = useCallback(async (body: OutputRequest) => {
    const saved = await updateOutput(flow.id, output.id, body);
    qc.setQueryData<FlowOutput[]>(["outputs", flow.id], (list) => list?.map((o) => (o.id === saved.id ? saved : o)));
    setSaves((n) => n + 1);
    return saved;
  }, [qc, flow.id, output.id]);
  const part = useDraftPart(`output:${output.id}`, "send", save);
  return <Editor {...props} draft={{ part, saves }} />;
}

function Editor({ flow, output, previewDocumentId, previewFile, hideDestination, onCreated, onSaved, onCancel, headingRef, actions, draft }: EditorProps & { draft?: Draft }) {
  const qc = useQueryClient();
  const enabled = useTenantQueriesEnabled();
  const onFlowPage = useOnFlowPage();
  const [current, setCurrent] = useState(output);
  const [name, setName] = useState(output?.name ?? "");
  const [format, setFormat] = useState(output?.format ?? "csv");
  const [tableKey, setTableKey] = useState<string | null>(output ? output.tableKey : (flow.fields.tables[0]?.key ?? null));
  const [destinationId, setDestinationId] = useState<string | null>(output?.destinationId ?? null);
  const [newDestination, setNewDestination] = useState(false);
  const [rows, setRows] = useState<SimpleOutput | null>(output && !output.standard ? toSimple(output.template) : null);
  const [sendWhen, setSendWhen] = useState<SendWhen | null>(output?.sendWhen ?? null);
  const [layout, setLayout] = useState<OutputLayout>(output?.layout ?? {});
  const [envelope, setEnvelope] = useState<EnvelopeConfig | null>(output?.template?.envelope ?? null);
  const [problem, setProblem] = useState<string | null>(null);
  const [testAt, setTestAt] = useState(0);
  // Draft only: the rename box, the "Send to" select and the column editor, each folded behind one press.
  const [renaming, setRenaming] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(() => { try { return localStorage.getItem(COLUMNS_KEY) === "1"; } catch { return false; } });
  const renameShown = renaming || !name.trim();
  const reasonId = useId();
  const uid = useId();
  /** The element (by id) a fold hands focus to after this render, so a press that unmounts its button keeps the place. */
  const focusNext = useRef<string | null>(null);
  const newSaved = useRef(false);
  const selectHadFocus = useRef(false);

  const destinations = useQuery({ queryKey: ["destinations"], queryFn: listDestinations, enabled });
  const lookups = useQuery({ queryKey: ["lookups"], queryFn: listLookups, enabled });
  const lookupList = lookups.data ?? (lookups.isError ? "failed" : "loading");
  const standard = current?.standard;
  const external = !!current && !rows && !standard;
  const formatted = !standard && (format === "pdf" || format === "txt");

  const preview = useMutation({ mutationFn: () => previewOutput(previewDocumentId!, current!.id) });
  // The draft's preview follows its saves: the key moves on with each one, so it always shows what was saved last.
  const draftPreview = useQuery({
    queryKey: ["output-preview", previewDocumentId, current?.id, draft?.saves],
    queryFn: () => previewOutput(previewDocumentId!, current!.id, {}),
    enabled: enabled && !!draft && !!previewDocumentId && !!current,
  });
  const shown = draft ? draftPreview.data : preview.data;
  const check = useMutation({ mutationFn: (documentId: string) => checkOutput(flow.id, current!.id, documentId) });
  const test = useMutation({
    mutationFn: (body: OutputRequest) => testOutput(previewDocumentId!, {
      format: body.format, tableKey: body.tableKey ?? null, destinationId: body.destinationId!, template: body.template!, standard: standard ?? null,
    }),
  });
  const warnings = check.data?.issues.filter((i) => i.severity === "warning") ?? [];
  const checkedHere = check.variables === previewDocumentId; // a result belongs to the document it was asked about
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
  const pdf = shown?.contentType === "application/pdf" && shown.base64 ? shown.base64 : null;
  const pdfBlob = useMemo(() => pdf && new Blob([Uint8Array.from(atob(pdf), (c) => c.charCodeAt(0))], { type: "application/pdf" }), [pdf]);

  /** What a save sends. A new output has no template yet: the server makes the default one. */
  const bodyOf = (): OutputRequest => {
    const body = { name: name.trim(), format, tableKey, destinationId, sendWhen, layout: formatted ? layout : null };
    if (!current) return body;
    const withWidth = (r: SimpleRow) => ({ ...r, width: r.width ?? defaultWidth(r.name) });
    const sent = rows && format === "fixed"
      ? { ...rows, fields: rows.fields.map(withWidth), table: rows.table && { ...rows.table, columns: rows.table.columns.map(withWidth) } }
      : rows;
    return { ...body, template: standard ? { ...current.template, envelope } : sent ? fromSimple(sent, format) : current.template };
  };
  const unnamed = [...(rows?.fields ?? []), ...(rows?.table?.columns ?? [])].some((r) => !r.name.trim());
  const problemNow = !name.trim() ? "Give this file a name."
    : sendWhen && !sendWhen.value.trim() ? COPY.send_when
    : unnamed ? (draft ? "Give every column a name." : "Give every row a name.")
    : null;

  const save = useMutation({
    mutationFn: () => (current ? updateOutput(flow.id, current.id, bodyOf()) : createOutput(flow.id, bodyOf())),
    onSuccess: (saved) => {
      const created = !current;
      setProblem(null);
      preview.reset();
      check.reset();
      setCurrent(saved);
      if (created) setRows(toSimple(saved.template));
      qc.invalidateQueries({ queryKey: ["outputs", flow.id] });
      qc.invalidateQueries({ queryKey: ["flow", flow.id] });
      if (created) onCreated?.(saved);
      else onSaved();
    },
    onError: (e) => setProblem(documentRefusalMessage(e)),
  });

  // Draft: every change that can be saved goes to the part; one that cannot says why and is not sent.
  const payload = draft && current ? JSON.stringify(bodyOf()) : null;
  const sentPayload = useRef(payload);
  const change = draft?.part.change;
  const block = draft?.part.block;
  useEffect(() => {
    if (!change || !block || payload === null) return;
    setProblem(problemNow);
    block(problemNow);
    if (problemNow || payload === sentPayload.current) return;
    sentPayload.current = payload;
    change(JSON.parse(payload) as OutputRequest);
  }, [change, block, payload, problemNow]);

  const table = flow.fields.tables.find((t) => t.key === rows?.table?.key);
  const fieldOptions = flow.fields.fields.map((f) => ({ key: f.key, label: f.label }));
  const columnOptions = (table?.columns ?? []).map((f) => ({ key: f.key, label: f.label }));
  const gone = (opts: { key: string }[]) => (r: SimpleRow) => "field" in r.source && !opts.some((o) => o.key === (r.source as { field: string }).field);
  // A column that takes its value from something we no longer read.
  const stale = !!rows && (rows.fields.some(gone(fieldOptions)) || !!rows.table?.columns.some(gone(columnOptions)));
  const columnProblem = unnamed || stale;
  // Latched open by a problem, without writing what the person chose: only their own "Done" closes it again.
  if (draft && columnProblem && !columnsOpen) setColumnsOpen(true);
  const destination = destinations.data?.find((d) => d.id === destinationId);
  // A destination the list does not name (loading, failed, deleted) is never drawn as chosen: the select stays open.
  const sendForced = newDestination || (!!destinationId && !destination);
  const sendShown = sendOpen || sendForced;
  useEffect(() => {
    // The select closed by itself (its destination loaded) while focus was in it: focus goes to the button that reopens it.
    if (!sendShown && selectHadFocus.current) { selectHadFocus.current = false; focusNext.current ??= `${uid}-change`; }
    const id = focusNext.current;
    focusNext.current = null;
    const el = id ? document.getElementById(id) : null;
    (el?.querySelector("input") ?? el)?.focus();
  });

  function changeTable(key: string | null) {
    setTableKey(key);
    const t = flow.fields.tables.find((x) => x.key === key);
    if (rows) setRows({ ...rows, table: t ? { key: t.key, columns: t.columns.map((c) => ({ name: c.label, source: { field: c.key } })) } : null });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (problemNow) return setProblem(problemNow);
    save.mutate();
  }

  const nameField = (
    <Field label="Name">
      <input className={INPUT} maxLength={120} value={name} onChange={(e) => { setName(e.target.value); setRenaming(true); }} />
    </Field>
  );
  const typeField = standard ? (
    <Field label="Standard"><input className={INPUT} readOnly value={standardName(standard)} /></Field>
  ) : (
    <Field label="File type">
      <select className={INPUT} value={format} disabled={external} onChange={(e) => setFormat(e.target.value)}>
        {!Object.hasOwn(FORMATS, format) && <option value={format}>{format}</option>}
        {Object.entries(FORMATS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
      </select>
    </Field>
  );
  const separatorField = rows && format === "csv" && (
    <Field label="Separator">
      <select className={INPUT} value={rows.delimiter ?? ","} onChange={(e) => setRows({ ...rows, delimiter: e.target.value })}>
        {rows.delimiter && !SEPARATORS.some(([v]) => v === rows.delimiter) && <option value={rows.delimiter}>{rows.delimiter}</option>}
        {SEPARATORS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
      </select>
    </Field>
  );
  const layoutFields = formatted && LAYOUT_FIELDS.map(([key, label, max]) => (
    <Field key={key} label={label}>
      {key === "title"
        ? <input className={INPUT} maxLength={max} value={layout.title ?? ""} onChange={(e) => setLayout({ ...layout, title: e.target.value })} />
        : <textarea className={`${INPUT_BASE} py-2`} rows={2} maxLength={max} value={layout[key] ?? ""} onChange={(e) => setLayout({ ...layout, [key]: e.target.value })} />}
    </Field>
  ));
  const logoField = format === "pdf" && (
    <Field label="Logo">
      {!current ? <p className="text-[12.5px] text-ink-muted">Save the file first, then add a logo.</p>
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
            <p className="text-[12.5px] text-ink-muted">PNG or JPG, up to 256 KB.</p>
          </>
        )}
    </Field>
  );
  const tableField = flow.fields.tables.length > 0 && (
    <Field label="Table">
      <select className={INPUT} value={tableKey ?? ""} disabled={external} onChange={(e) => changeTable(e.target.value || null)}>
        <option value="">No table</option>
        {flow.fields.tables.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
      </select>
    </Field>
  );
  const sendToField = (
    <Field label="Send to">
      <select id={`${uid}-send`} className={INPUT} value={newDestination ? NEW_DESTINATION : (destinationId ?? "")}
        onFocus={() => { selectHadFocus.current = true; }} onBlur={() => { selectHadFocus.current = false; }}
        onChange={(e) => {
          setSendOpen(true); // a choice made here stays open until Done, so a keyboard walk through the list is not cut short
          setNewDestination(e.target.value === NEW_DESTINATION); newSaved.current = false;
          if (e.target.value !== NEW_DESTINATION) setDestinationId(e.target.value || null);
        }}>
        <option value="">Download only</option>
        {destinationId && !destination && (
          <option value={destinationId}>{destinations.data ? "A destination that no longer exists" : destinations.isError ? "Couldn't load destinations" : "Loading destinations…"}</option>
        )}
        {destinations.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        <option value={NEW_DESTINATION}>New destination…</option>
      </select>
    </Field>
  );
  const destinationsFailed = destinations.isError && <StatusNotice tone="error">{documentRefusalMessage(destinations.error)}</StatusNotice>;
  // A saved new destination closes to "Change where it goes", focused: straight after the save, or on Close after its test.
  const closeSaved = () => { newSaved.current = false; setNewDestination(false); setSendOpen(false); focusNext.current = `${uid}-change`; };
  const newDestinationForm = newDestination && (
    <DestinationForm
      inline={!!draft} testAfterSave={!!draft}
      onCancel={() => (newSaved.current ? closeSaved() : setNewDestination(false))}
      onSaved={(d) => {
        setDestinationId(d.id); qc.invalidateQueries({ queryKey: ["destinations"] });
        // With a test after the save the form stays open, its result in view and a Close, as in Settings.
        if (draft) newSaved.current = true; else closeSaved();
      }}
    />
  );
  const sendWhenFields = (
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
      <p className="text-[12.5px] text-ink-muted">Send this file only for some documents, for example one file per recipient.</p>
    </>
  );
  const externalNote = external && (
    <p className="text-[12.5px] text-ink-muted">
      This file was set up outside this editor. You can change its name and destination here.
    </p>
  );
  const standardQuestions = standard && <StandardQuestions flow={flow} needs={current.needs ?? []} tableKey={tableKey} name={standardName(standard)} />;
  const partnerIds = standard && <PartnerIds standard={standard} envelope={envelope} onChange={setEnvelope} />;
  const problemNotice = problem && <StatusNotice tone="error">{problem}</StatusNotice>;
  const checkButton = previewDocumentId && current && standard && FLAGGED.has(standard) && flow.peppolOn && (
    <Button type="button" variant="secondary" loading={check.isPending} onClick={() => check.mutate(previewDocumentId)}>Check against {RULE_SETS[standard]?.short} rules</Button>
  );
  const checkResult = (
    <>
      {checkedHere && check.isError && <StatusNotice tone="error">{documentRefusalMessage(check.error)}</StatusNotice>}
      {checkedHere && check.data?.status === "passed" && (warnings.length ? (
        <StatusNotice tone="warning">
          Passes the {RULE_SETS[standard ?? ""]?.long} rules, with {warnings.length} warning(s):
          <IssueList issues={warnings} />
        </StatusNotice>
      ) : <StatusNotice tone="success">Passes the {RULE_SETS[standard ?? ""]?.long} rules.</StatusNotice>)}
      {checkedHere && check.data?.status === "unavailable" && <StatusNotice tone="warning">We couldn&apos;t reach the rule checker. Try again in a minute.</StatusNotice>}
      {checkedHere && check.data?.status === "failed" && (
        <StatusNotice tone="warning">
          Doesn&apos;t meet {check.data.issues.filter((i) => i.severity === "error").length} {RULE_SETS[standard ?? ""]?.short} rule(s):
          <IssueList issues={check.data.issues} />
        </StatusNotice>
      )}
    </>
  );
  const previewBody = (
    <>
      {previewDocumentId && current && shown?.lookupMisses?.length ? (
        <LookupMisses documentId={previewDocumentId} outputId={current.id} misses={shown.lookupMisses}
          onChanged={() => (draft ? draftPreview.refetch() : preview.mutate())} />
      ) : null}
      {pdfBlob && current ? <PdfDocumentView cacheKey={`output-preview-${current.id}-${draft ? draft.saves : preview.submittedAt}`} blob={pdfBlob} bounded regionLabel="Preview" />
      : shown && (
        <pre className="max-h-72 overflow-auto rounded border border-border bg-surface-2 p-2.5 font-mono text-[12.5px] text-ink">
          {shown.content}
        </pre>
      )}
    </>
  );

  if (draft && current) {
    const tested = destinations.data?.find((d) => d.id === test.variables?.destinationId);
    const reason = !destination ? (destinationId && destinations.isPending ? "Waiting for the destination list…" : "Choose where to send it first.") : test.isPending ? "Sending a test…" : problemNow;
    // "Send it now" resends with the live version, not this draft: it is not offered while the two differ.
    const unpublished = flow.publishedVersion != null && !!flow.hasChanges;
    const sectionTitle = "m-0 text-[14px] font-semibold text-ink";
    const columnCount = rows ? rows.fields.length + (rows.table?.columns.length ?? 0) : 0;
    // A press by the person is the only thing that writes the remembered state; a problem only latches it open.
    const toggleColumns = () => {
      setColumnsOpen(!columnsOpen);
      focusNext.current = columnsOpen ? `${uid}-columns-toggle` : `${uid}-columns`;
      try { localStorage.setItem(COLUMNS_KEY, columnsOpen ? "0" : "1"); } catch { /* open for this visit only */ }
    };
    const closeSend = () => { setSendOpen(false); focusNext.current = `${uid}-change`; };
    return (
      <div className="grid gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1">
            <h2 ref={headingRef} tabIndex={-1} className="m-0 min-w-0 break-words text-[16px] font-semibold text-ink">{name.trim() || current.name}</h2>
            <button
              type="button" aria-label="Rename this file" aria-expanded={renameShown} onClick={() => setRenaming(!renameShown)}
              className="inline-flex h-11 w-11 flex-none items-center justify-center rounded-md text-ink-muted hover:bg-surface-2 hover:text-ink"
            >
              <Pencil size={18} aria-hidden />
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <DraftState part={draft.part} />
            {actions}
          </div>
        </div>
        {renameShown && nameField}
        {externalNote}
        <section className="grid gap-2">
          {sendShown ? (
            <>
              {sendToField}
              {destinationsFailed}
              {destination && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-[13px] text-ink">
                  <span className="min-w-0 break-words">{destinationWhere(destination)}</span>
                  <FlowLink href={destinationsAddress(destination.id)} push className="inline-flex items-center font-semibold text-brand-blue">Edit</FlowLink>
                </div>
              )}
              {newDestinationForm}
              {!sendForced && (
                <div><Button type="button" variant="secondary" size="sm" aria-label="Done choosing where it goes" aria-expanded={sendShown} onClick={closeSend}>Done</Button></div>
              )}
            </>
          ) : (
            <>
              <h3 className={sectionTitle}>Send to</h3>
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
                <div className="grid min-w-0 gap-0.5">
                  <span className="break-words text-[14px] font-semibold text-ink">{destination ? destination.name : "Download only"}</span>
                  <span className="break-words text-[13px] text-ink-muted">{destination ? destinationWhere(destination) : "Each file waits in Documents, ready to download."}</span>
                </div>
                <Button
                  type="button" variant="secondary" size="sm" id={`${uid}-change`} aria-label="Change where it goes" aria-expanded={sendShown}
                  onClick={() => { setSendOpen(true); focusNext.current = `${uid}-send`; }}
                >
                  Change
                </Button>
              </div>
            </>
          )}
          {previewDocumentId && (
            <div className="grid gap-2">
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button" variant="secondary" className="border-brand-green text-brand-green-deep" loading={test.isPending}
                  disabled={!!reason} aria-describedby={reason ? reasonId : undefined}
                  onClick={() => { if (reason) return; setTestAt(Date.now()); test.mutate(bodyOf()); }}
                >
                  Send a test
                </Button>
                {reason && <span id={reasonId} className="text-[12.5px] text-ink-muted">{reason}</span>}
              </div>
              {(test.data || test.isError) && test.variables?.destinationId && (
                <TestOutcome
                  destinationId={test.variables.destinationId} protocol={tested?.protocol ?? ""} result={test.data ?? null}
                  error={test.isError ? test.error : null} at={testAt} place="form" offerResend={!unpublished}
                />
              )}
            </div>
          )}
        </section>
        <section className="grid gap-2">
          <h3 className={sectionTitle}>What the file looks like</h3>
          {previewDocumentId ? (
            <>
              <p className="m-0 text-[13px] text-ink-muted">
                {previewFile ? `Made from ${previewFile}, with your changes.` : "Made from the latest document, with your changes."}
              </p>
              {draftPreview.isError && !draftPreview.data && <StatusNotice tone="error">{documentRefusalMessage(draftPreview.error)}</StatusNotice>}
              {previewBody}
              {checkButton && <div>{checkButton}</div>}
              {checkResult}
            </>
          ) : <AddDocument flow={flow} sends={sendsByItself(flow.automation) && !!destinationId} />}
        </section>
        {problemNotice}
        {stale && <StatusNotice tone="warning">A column takes its value from something we no longer read. Choose another value for it.</StatusNotice>}
        {rows && (
          <section className="grid gap-2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h3 className={sectionTitle}>Columns ({columnCount})</h3>
              <p className="m-0 min-w-0 flex-1 text-[13px] text-ink-muted">Each column takes its value from one thing we read.</p>
              {/* While a column has a problem the editor stays open, so there is no Done to press. */}
              {!(columnsOpen && columnProblem) && (
                <Button type="button" variant="secondary" size="sm" id={`${uid}-columns-toggle`} aria-label={columnsOpen ? "Done with the columns" : undefined} aria-expanded={columnsOpen} onClick={toggleColumns}>
                  {columnsOpen ? "Done" : "Change the columns"}
                </Button>
              )}
            </div>
            {columnsOpen && (
              <div id={`${uid}-columns`} className="grid gap-2">
                {tableField}
                <RowList columns fixed={format === "fixed"} rows={rows.fields} options={fieldOptions} lookups={lookupList} onChange={(fields) => setRows({ ...rows, fields })} />
                {rows.table && (
                  <>
                    <p className="m-0 text-[12.5px] font-medium text-ink-muted">{table?.label ?? "Table"} columns</p>
                    <RowList columns fixed={format === "fixed"} rows={rows.table.columns} options={columnOptions} lookups={lookupList}
                      onChange={(columns) => setRows({ ...rows, table: { key: rows.table!.key, columns } })} />
                  </>
                )}
              </div>
            )}
          </section>
        )}
        <details className="rounded-md border border-border px-3 py-2">
          <summary className="flex min-h-11 cursor-pointer items-center text-[14px] font-semibold text-ink">More options: file type, when to send, separator, lookups</summary>
          <div className="grid gap-3 pb-2 pt-2">
            {typeField}
            {!rows && tableField}
            {sendWhenFields}
            {separatorField}
            {layoutFields}
            {logoField}
            {standardQuestions}
            {partnerIds}
            {rows && [...rows.fields, ...(rows.table?.columns ?? [])].length > 0 && (
              <div className="grid gap-2">
                <p className="m-0 text-[12.5px] font-medium text-ink-muted">Lookups</p>
                {rows.fields.map((r, i) => (
                  <div key={`f${i}`} className="flex flex-wrap items-center gap-2">
                    <span className="min-w-32 text-[13px] text-ink">{r.name}</span>
                    <LookupControls row={r} of={r.name} lookups={lookupList} onChange={(x) => setRows({ ...rows, fields: rows.fields.map((y, j) => (j === i ? x : y)) })} />
                  </div>
                ))}
                {rows.table?.columns.map((r, i) => (
                  <div key={`c${i}`} className="flex flex-wrap items-center gap-2">
                    <span className="min-w-32 text-[13px] text-ink">{r.name}</span>
                    <LookupControls row={r} of={r.name} lookups={lookupList}
                      onChange={(x) => setRows({ ...rows, table: { key: rows.table!.key, columns: rows.table!.columns.map((y, j) => (j === i ? x : y)) } })} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </details>
      </div>
    );
  }

  return (
    <Card edge="green" title={current ? "Edit file" : "New file"}>
      <form onSubmit={submit} className="grid gap-3">
        {nameField}
        {typeField}
        {separatorField}
        {layoutFields}
        {logoField}
        {tableField}
        {!hideDestination && sendToField}
        {!hideDestination && destinationsFailed}
        {!hideDestination && newDestinationForm}
        {!hideDestination && sendWhenFields}
        {externalNote}
        {rows && (
          <>
            <p className="text-[12.5px] font-medium text-ink-muted">Values</p>
            <RowList fixed={format === "fixed"} rows={rows.fields} options={fieldOptions} lookups={lookupList} onChange={(fields) => setRows({ ...rows, fields })} />
            {rows.table && (
              <>
                <p className="text-[12.5px] font-medium text-ink-muted">{table?.label ?? "Table"} columns</p>
                <RowList fixed={format === "fixed"} rows={rows.table.columns} options={columnOptions} lookups={lookupList}
                  onChange={(columns) => setRows({ ...rows, table: { key: rows.table!.key, columns } })} />
              </>
            )}
          </>
        )}
        {standardQuestions}
        {partnerIds}
        {problemNotice}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant={onFlowPage ? "secondary" : "primary"} loading={save.isPending}>{current ? "Save" : "Create"}</Button>
          <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
          {previewDocumentId && current && (
            <Button type="button" variant="secondary" loading={preview.isPending} onClick={() => preview.mutate()}>Preview</Button>
          )}
          {checkButton}
        </div>
        {checkResult}
        {previewDocumentId && current && <p className="text-[12.5px] text-ink-muted">Preview shows the last saved version.</p>}
        {preview.isError && <StatusNotice tone="error">{documentRefusalMessage(preview.error)}</StatusNotice>}
        {previewBody}
      </form>
    </Card>
  );
}
