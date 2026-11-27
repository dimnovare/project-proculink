"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button, buttonClass } from "@/components/bridge/DSPrimitives";
import { Card } from "@/components/bridge/layout/Card";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { useTenantQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { getDocument, listDocuments, listOutputs, saveFlowFields } from "@/lib/api/documents";
import type { DocumentSummary, Flow, FlowField, FlowFieldList, ReadResult } from "@/lib/api/documents";
import { documentRefusalMessage } from "@/lib/documentRefusals";
import { sendsByItself } from "@/lib/deliveryMode";
import { DOCUMENT_STATUSES, STATUS, documentStatus } from "@/lib/documentStatusManifest";
import { FIELD_MEANINGS } from "@/lib/fieldMeanings";
import { addReadExtra, FIELD_CHECK_OPS, FIELD_TYPES, fieldCheckProblem, fieldListFromRead, replaceField, withReadExtras } from "@/lib/flowFieldModel";
import { acceptFor, MAX_UPLOAD_BYTES } from "@/lib/fileKinds";
import { flowAddress } from "@/lib/flowSteps";
import { Field, INPUT } from "./DestinationForm";
import { FieldCheckEditor } from "./FieldCheckEditor";
import { FileDrop } from "./FileDrop";
import { DraftState, useDraftPart } from "./flowDraft";
import { useFlowSaved } from "./PublishBar";
import { Failed, Loading } from "./states";
import { useUploadQueue } from "./UploadQueue";

/** The newest document of this flow the engine has finished reading, and what it read off it. */
export function useLatestRead(flowId: string) {
  const enabled = useTenantQueriesEnabled();
  const docs = useQuery({
    queryKey: ["documents", { flowId }], queryFn: () => listDocuments({ flowId }), enabled,
    refetchInterval: (q) => (q.state.data?.some((d) => documentStatus(d.status, d.statusReason).tone === "working") ? 2000 : false),
  });
  const sorted = [...(docs.data ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const latest = sorted.find((d) => {
    const s = documentStatus(d.status, d.statusReason).stage;
    return (typeof s === "number" ? s : s.failed) >= 2;
  });
  const doc = useQuery({ queryKey: ["document", latest?.id], queryFn: () => getDocument(latest!.id), enabled: enabled && !!latest });
  /** The newest document of any status: what the step says while a first one is read, or after it failed. */
  const newest: DocumentSummary | undefined = sorted[0];
  return { docs, latest, doc, newest };
}

/** Every row on screen; `off` holds the unticked ones by "key" (a value or table) or "table/column". */
type Rows = { list: FlowFieldList; off: Set<string> };

/** Ticked rows only. A table with no ticked columns is left out: there is nothing to read into it. */
const chosen = ({ list, off }: Rows): FlowFieldList => ({
  fields: list.fields.filter((f) => !off.has(f.key)),
  tables: list.tables
    .filter((t) => !off.has(t.key))
    .map((t) => ({ ...t, columns: t.columns.filter((c) => !off.has(`${t.key}/${c.key}`)) }))
    .filter((t) => t.columns.length > 0),
});
const problemWith = (body: FlowFieldList) => {
  const named = [...body.fields, ...body.tables.flatMap((t) => [t, ...t.columns])];
  if (!named.length) return "Keep at least one value.";
  if (named.some((x) => !x.label.trim())) return "Give every value a name.";
  return body.fields.map(fieldCheckProblem).find(Boolean) ?? null;
};
const toggled = (off: Set<string>, id: string, on: boolean) => { const n = new Set(off); if (on) n.delete(id); else n.add(id); return n; };

const NOT_FOUND = "Not found on this document";
const CELL = "px-2 py-1.5 align-middle";
// Below sm the table stacks (B-07): each row is tick, name and More on one line, its example on the next.
const ROW_SM = "max-sm:grid max-sm:grid-cols-[44px_minmax(0,1fr)_auto] max-sm:items-center";
const UNDER_SM = "max-sm:col-start-2 max-sm:col-end-4 max-sm:row-start-2 max-sm:pt-0 max-sm:text-ink-muted";

const Tick = ({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange(on: boolean): void }) => (
  <label className="inline-flex h-11 w-11 cursor-pointer items-center justify-center">
    <input type="checkbox" aria-label={label} className="size-[18px]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
  </label>
);

function ValueRow({ field, scope, on, example, columns, indent, failed, onInclude, onChange }: {
  field: FlowField; scope: "header" | "line"; on: boolean; example: string | null | undefined; columns: number; indent?: boolean;
  /** This row's last change in More did not save. */ failed?: boolean;
  /** `inMore`: the change was made inside More (Required, Type, Meaning), not to the name. */
  onInclude(on: boolean): void; onChange(field: FlowField, inMore?: boolean): void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const meaning = field.meaning ? FIELD_MEANINGS[field.meaning as keyof typeof FIELD_MEANINGS] : undefined;
  // A fold never hides a problem: a type, meaning or check we do not know for this row, or a change that did not save.
  const forced = !!failed || !(field.type in FIELD_TYPES) || (!!field.meaning && meaning?.scope !== scope)
    || (scope === "header" && !!field.check && !(field.check.op in FIELD_CHECK_OPS));
  // Forced open, it stays open (nothing remembers it): fixing the problem never closes it under the person's focus.
  if (forced && !open) setOpen(true);
  const shown = open || forced;
  // Opening moves focus to the first box inside; closing returns it to More.
  const more = useRef<HTMLButtonElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const moved = useRef(false);
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    (open ? body.current?.querySelector("input") : more.current)?.focus();
  }, [open]);
  const toggle = () => { moved.current = true; setOpen(!open); };
  return (
    <>
      <tr className={`border-t border-border-faint ${ROW_SM}`}>
        <td className={`${CELL} max-sm:p-0`}><Tick label={`Read ${field.label}`} checked={on} onChange={onInclude} /></td>
        <td className={`${CELL} ${indent ? "pl-6 max-sm:pl-2" : ""}`}>
          <input
            aria-label={`Name for ${field.label}`} className={`${INPUT} min-w-36 max-sm:min-w-0`} value={field.label} disabled={!on}
            onChange={(e) => onChange({ ...field, label: e.target.value })}
          />
        </td>
        {example !== undefined && (
          <td className={`${CELL} text-[13px] ${example ? "font-mono text-ink" : "text-ink-muted"} ${UNDER_SM}`}>{example ?? NOT_FOUND}</td>
        )}
        <td className={CELL}>
          {/* A problem holds the panel open, so More could not close it: it is not drawn until the problem is gone. */}
          {!forced && (
            <button
              ref={more} type="button" className={buttonClass("ghost", "sm")} aria-label={`More for ${field.label.trim() || "this value"}`} aria-expanded={shown} aria-controls={id}
              disabled={!on} onClick={toggle}
            >
              More
            </button>
          )}
        </td>
      </tr>
      {shown && (
        <tr id={id} className="max-sm:block">
          <td colSpan={columns} className="px-2 pb-3 max-sm:block">
            <div ref={body} className="grid gap-3 rounded-md bg-surface-2 p-3 min-[720px]:grid-cols-2">
              <div className="flex items-center gap-1 min-[720px]:col-span-2">
                <Tick label={`${field.label} is required`} checked={field.required} disabled={!on} onChange={(required) => onChange({ ...field, required }, true)} />
                <div className="grid">
                  <span aria-hidden className="text-[14px] font-semibold text-ink">Required</span>
                  <span className="text-[13px] text-ink-muted">We mark the value when it is missing from a document.</span>
                </div>
              </div>
              <Field label="Type">
                <select className={INPUT} value={field.type} onChange={(e) => onChange({ ...field, type: e.target.value }, true)}>
                  {!(field.type in FIELD_TYPES) && <option value={field.type}>{field.type}</option>}
                  {Object.entries(FIELD_TYPES).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                </select>
              </Field>
              <Field label="Meaning">
                <select className={INPUT} value={field.meaning ?? ""} onChange={(e) => onChange({ ...field, meaning: e.target.value || null }, true)}>
                  <option value="">None</option>
                  {field.meaning && meaning?.scope !== scope && <option value={field.meaning}>{meaning?.label ?? field.meaning}</option>}
                  {Object.entries(FIELD_MEANINGS).filter(([, m]) => m.scope === scope).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
                </select>
              </Field>
              <p className="m-0 text-[12.5px] text-ink-muted min-[720px]:col-span-2">
                Type lets us mark a value that is in the wrong shape. Meaning tells a standard file which value this is. Most flows never need to change either.
              </p>
              {scope === "header" && <FieldCheckEditor field={field} disabled={!on} onChange={(check) => onChange({ ...field, check }, true)} />}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/** The value table, the tables as groups under it, and what the latest document has that the list lacks. */
function ValueTable({ rows, edit, read, fileName, failed }: {
  rows: Rows; edit(next: Rows): void; read?: ReadResult; fileName?: string;
  /** The last save failed: the row changed last in More shows its boxes. */ failed?: boolean;
}) {
  const id = useId();
  const { list, off } = rows;
  // The row whose Required, Type or Meaning was changed last (inside More), by "key" or "table/column". Any other change,
  // a Read tick included, clears it: a failed save never forces open a More the person did not just change.
  const [last, setLast] = useState<string | null>(null);
  const showExample = !!read && !!fileName;
  const columns = showExample ? 4 : 3;
  const fieldExample = (key: string) => {
    if (!showExample) return undefined;
    const f = read!.fields.find((x) => x.key === key);
    return f && !f.notOnPage && f.value ? f.value : null;
  };
  const cellExample = (table: string, column: string) => {
    if (!showExample) return undefined;
    const c = read!.tables.find((t) => t.key === table)?.rows[0]?.cells[column];
    return c && !c.notOnPage && c.value ? c.value : null;
  };
  const noticed = read ? withReadExtras(list, read) : null;
  const extras = noticed
    ? [
        ...noticed.list.fields.filter((f) => noticed.off.has(f.key)).map((f) => ({ id: f.key, label: f.label, example: fieldExample(f.key) })),
        ...noticed.list.tables.flatMap((t) => noticed.off.has(t.key)
          ? [{ id: t.key, label: t.label, example: null }]
          : t.columns.filter((c) => noticed.off.has(`${t.key}/${c.key}`)).map((c) => ({ id: `${t.key}/${c.key}`, label: `${t.label}: ${c.label}`, example: cellExample(t.key, c.key) }))),
      ]
    : [];

  const include = (key: string, on: boolean) => { setLast(null); edit({ list, off: toggled(off, key, on) }); };
  const setFields = (fields: FlowField[], key: string | null) => { setLast(key); edit({ list: { ...list, fields }, off }); };
  const setTable = (ti: number, patch: (t: FlowFieldList["tables"][number]) => FlowFieldList["tables"][number], key: string | null = null) => {
    setLast(key);
    edit({ list: { ...list, tables: list.tables.map((t, j) => (j === ti ? patch(t) : t)) }, off });
  };

  return (
    <div className="grid gap-4">
      {showExample && <p className="m-0 text-[12.5px] font-semibold text-ink-muted sm:hidden">{`Example from ${fileName}`}</p>}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-[13px] max-sm:block">
          <thead className="max-sm:hidden">
            <tr className="text-[12.5px] font-semibold text-ink-muted">
              <th scope="col" className={CELL}>Read</th>
              <th scope="col" className={CELL}>Value</th>
              {showExample && <th scope="col" className={CELL}>{`Example from ${fileName}`}</th>}
              <th scope="col" className={CELL}><span className="sr-only">More</span></th>
            </tr>
          </thead>
          <tbody className="max-sm:block">
            {list.fields.map((f, i) => (
              <ValueRow
                key={f.key} field={f} scope="header" on={!off.has(f.key)} example={fieldExample(f.key)} columns={columns}
                failed={failed && last === f.key}
                onInclude={(on) => include(f.key, on)} onChange={(x, inMore) => setFields(replaceField(list.fields, i, x), inMore ? f.key : null)}
              />
            ))}
          </tbody>
          {list.tables.map((t, ti) => {
            const tableOn = !off.has(t.key);
            const readTable = read?.tables.find((x) => x.key === t.key);
            return (
              <tbody key={t.key} className="max-sm:block">
                <tr className={`border-t border-border ${ROW_SM}`}>
                  <td className={`${CELL} max-sm:p-0`}><Tick label={`Read the table ${t.label}`} checked={tableOn} onChange={(on) => include(t.key, on)} /></td>
                  <td className={CELL}>
                    <input
                      aria-label={`Name for ${t.label}`} className={`${INPUT} min-w-36 max-sm:min-w-0 font-semibold`} value={t.label} disabled={!tableOn}
                      onChange={(e) => setTable(ti, (x) => ({ ...x, label: e.target.value }))}
                    />
                  </td>
                  <td colSpan={columns - 2} className={`${CELL} text-[13px] text-ink-muted ${UNDER_SM}`}>
                    {readTable ? <>
                      <span className="sm:hidden">{`A table, ${readTable.rows.length} rows`}</span>
                      <span className="max-sm:hidden">{`A table. ${readTable.rows.length} rows in the latest document.`}</span>
                    </> : "A table."}
                  </td>
                </tr>
                {t.columns.map((c, ci) => (
                  <ValueRow
                    key={c.key} field={c} scope="line" indent on={tableOn && !off.has(`${t.key}/${c.key}`)} example={cellExample(t.key, c.key)} columns={columns}
                    failed={failed && last === `${t.key}/${c.key}`}
                    onInclude={(on) => include(`${t.key}/${c.key}`, on)}
                    onChange={(x, inMore) => setTable(ti, (tb) => ({ ...tb, columns: replaceField(tb.columns, ci, x) }), inMore ? `${t.key}/${c.key}` : null)}
                  />
                ))}
              </tbody>
            );
          })}
        </table>
      </div>
      {extras.length > 0 && (
        <section aria-labelledby={`${id}-noticed`} className="grid gap-2 border-t border-border pt-3">
          <h3 id={`${id}-noticed`} className="m-0 text-[14px] font-semibold text-ink">New values we noticed</h3>
          <p className="m-0 text-[13px] text-ink-muted">These were on the latest document. Add one to read it on every new document.</p>
          <ul className="m-0 grid list-none gap-1 p-0">
            {extras.map((x) => (
              <li key={x.id} className="flex min-h-11 flex-wrap items-center gap-3">
                <span className="text-[13.5px] font-medium text-ink">{x.label}</span>
                {x.example && <span className="font-mono text-[13px] text-ink-muted">{x.example}</span>}
                <Button size="sm" variant="secondary" aria-label={`Add ${x.label}`} onClick={() => edit({ list: addReadExtra(list, read!, x.id), off })}>Add</Button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Frame({ action, children }: { action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card>
      <div className="grid gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid gap-0.5">
            <h2 className="m-0 text-[16px] font-semibold text-ink">What we read from every document</h2>
            <p className="m-0 text-[13px] text-ink-muted">Every document in this flow is read into these values. Untick what you don&apos;t need, or click a name to change it.</p>
          </div>
          {action}
        </div>
        {children}
      </div>
    </Card>
  );
}

const Problem = ({ text }: { text: string | null }) => (text ? <p role="alert" className="m-0 text-[12.5px] text-danger">{text}</p> : null);

/** A confirmed flow: every change is part of the draft, saved on its own. A list that could not be read is not sent. */
function DraftValues({ flow, read, fileName }: { flow: Flow; read?: ReadResult; fileName?: string }) {
  const save = useCallback((list: FlowFieldList) => saveFlowFields(flow.id, list), [flow.id]);
  const part = useDraftPart("fields", "read", save);
  const [rows, setRows] = useState<Rows>(() => ({ list: flow.fields, off: new Set() }));
  const [problem, setProblem] = useState<string | null>(null);
  const edit = (next: Rows) => {
    setRows(next);
    const body = chosen(next);
    const p = problemWith(body);
    setProblem(p);
    part.block(p);
    if (!p) part.change(body);
  };
  return (
    <Frame action={<DraftState part={part} />}>
      <ValueTable rows={rows} edit={edit} read={read} fileName={fileName} failed={part.state === "failed"} />
      <Problem text={problem} />
    </Frame>
  );
}

/** A flow not yet confirmed (R16): the values come from the latest document and stay here until kept, because
 *  saving them confirms the flow and rechecks what is waiting. */
function FirstValues({ flow, read, fileName }: { flow: Flow; read: ReadResult; fileName: string }) {
  const saved = useFlowSaved(flow.id);
  const [rows, setRows] = useState<Rows>(() => ({ list: fieldListFromRead(read), off: new Set() }));
  const [problem, setProblem] = useState<string | null>(null);
  const keep = useMutation({ mutationFn: (body: FlowFieldList) => saveFlowFields(flow.id, body), onSuccess: saved });
  const press = () => {
    if (keep.isPending) return;
    const body = chosen(rows);
    const p = problemWith(body);
    setProblem(p);
    if (!p) keep.mutate(body);
  };
  return (
    <Frame>
      <p className="m-0 text-[13.5px] text-ink">{`These are the values we found on ${fileName}. Keep them to read every new document the same way.`}</p>
      <ValueTable rows={rows} edit={setRows} read={read} fileName={fileName} />
      <Problem text={problem ?? (keep.isError ? documentRefusalMessage(keep.error) : null)} />
      <div><Button variant="primary" loading={keep.isPending} onClick={press}>Keep these values</Button></div>
    </Frame>
  );
}

/** No document read yet: one is added to this flow right here, through the app's upload queue, as on Documents.
 *  While the newest one is still being read, that is said instead; a failed read links to it, where it is read again. */
function FirstDocument({ flow, newest }: { flow: Flow; newest?: DocumentSummary }) {
  const enabled = useTenantQueriesEnabled();
  const auto = sendsByItself(flow.automation);
  const files = useQuery({ queryKey: ["outputs", flow.id], queryFn: () => listOutputs(flow.id), enabled: enabled && auto });
  const prompt = (
    <>
      <span className="block text-[14px] font-semibold text-ink">Drop one document like the ones this flow will get.</span>
      <span className="block">We read it and list every value we find here. Then you untick what you don&apos;t need.</span>
    </>
  );
  return (
    <Frame>
      <FirstDocumentDrop flow={flow} newest={newest} prompt={prompt} reading="Its values appear here, usually within a minute." filled dropOnFail
        sends={auto && !!files.data?.some((o) => o.destinationId)} />
    </Frame>
  );
}

/** Before a flow's first document is read (We read and We send): what is happening to the newest one, else a drop
 *  zone that adds one. `sends`: the flow sends automatically to a destination, so a dropped document is sent too. */
export function FirstDocumentDrop({ flow, newest, prompt, reading, sends, filled, dropOnFail }: {
  flow: Flow; newest?: DocumentSummary; prompt: React.ReactNode; reading: string; sends: boolean; filled?: boolean;
  /** A failed read still offers the drop zone beside its notice. A line (We send) is said after the notice, in amber. */
  dropOnFail?: boolean | string;
}) {
  const queue = useUploadQueue();
  if (newest?.status === STATUS.received || newest?.status === STATUS.reading)
    return <Loading>{`We are reading ${newest.fileName}. ${reading}`}</Loading>;
  if (newest && !Object.hasOwn(DOCUMENT_STATUSES, newest.status))
    return (
      <p className="m-0 text-[13px] text-ink-muted">
        This flow&apos;s first document isn&apos;t ready yet.{" "}
        <Link href={flowAddress(flow.id, "documents")} className="font-semibold text-brand-blue">See its documents</Link>
      </p>
    );
  return (
    <div className="grid gap-3">
      {newest?.status === STATUS.read_failed && (
        <StatusNotice tone={typeof dropOnFail === "string" ? "warning" : "error"} action={<Link href={`/flows/${flow.id}/documents/${newest.id}`} className={buttonClass("secondary", "sm")}>Open it</Link>}>
          {`We couldn't read ${newest.fileName}.${typeof dropOnFail === "string" ? ` ${dropOnFail}` : ""}`}
        </StatusNotice>
      )}
      {(dropOnFail || newest?.status !== STATUS.read_failed) && <FileDrop accept={acceptFor(flow)} maxBytes={MAX_UPLOAD_BYTES} variant={filled ? "primary" : "secondary"} onFile={(f) => queue.add([f], flow)}
        prompt={<>{prompt}{sends && <span className="block">{flow.automation === "marked" ? "This flow sends automatically, so this document is also sent unless we mark a value." : "This flow sends automatically, so this document is also sent."}</span>}</>} />}
    </div>
  );
}

/** The We read step. */
export function FlowValues({ flow }: { flow: Flow }) {
  const { docs, latest, doc, newest } = useLatestRead(flow.id);
  const fileName = doc.data?.summary.fileName;
  if (flow.fieldsConfirmed) return <DraftValues flow={flow} read={doc.data?.read} fileName={fileName} />;
  if (docs.isError && !docs.data) return <Failed error={docs.error} retry={() => docs.refetch()} />;
  if (!docs.data || (latest && doc.isPending)) return <Loading>Loading…</Loading>;
  if (doc.isError && !doc.data) return <Failed error={doc.error} retry={() => doc.refetch()} />;
  if (!doc.data) return <FirstDocument flow={flow} newest={newest} />;
  return <FirstValues flow={flow} read={doc.data.read} fileName={doc.data.summary.fileName} />;
}
