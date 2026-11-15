"use client";

import { useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/bridge/DSPrimitives";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { useLgViewport } from "@/components/bridge/document/useSourceDocument";
import { saveFlowFields } from "@/lib/api/documents";
import type { DocumentDetail, Flow, SourceLocation } from "@/lib/api/documents";
import { documentRefusalMessage } from "@/lib/documentRefusals";
import { addReadExtra, withReadExtras } from "@/lib/flowFieldModel";
import { editKey, type EditTarget, type Look, type ReviewMarks } from "@/lib/reviewMarks";
import { parseAddress, spreadsheetColumnName } from "@/lib/sourceAddress";
import type { DocumentEdits } from "@/hooks/useDocumentEdits";
import { Field, INPUT } from "./DestinationForm";
import { Checks } from "./states";

/** "Page 2", "Paragraph 2", "Line 7", or the sheet cell as a spreadsheet writes it (`cell:r2c3` becomes "Cell C2"). */
export function locationText(l: SourceLocation | null): string | null {
  if (l?.page != null) return `Page ${l.page}`;
  const a = parseAddress(l?.address);
  if (!a) return l?.address ?? null;
  if (a.kind !== "cell") return `${a.kind === "para" ? "Paragraph" : "Line"} ${a.n}`;
  return `Cell ${spreadsheetColumnName(a.col - 1)}${a.row}`;
}

/** Where a value came from and what happened to it, in words. Never a percentage (R10). */
function Meta({ read }: { read: { edited: boolean; location: SourceLocation | null; notOnPage?: boolean } }) {
  const where = locationText(read.location);
  if (!read.notOnPage && !read.edited && !where) return null;
  return (
    <span className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-muted">
      {read.notOnPage && <span>Not found on the page</span>}
      {read.edited && <span>Edited</span>}
      {where && <span>{where}</span>}
    </span>
  );
}

/** Shows what is being typed over the server's value; saves on a pause, on Enter and on leaving the box. */
export function ValueInput({ target, value, edits, ...aria }: { target: EditTarget; value: string | null; edits: DocumentEdits; "aria-describedby"?: string }) {
  return (
    <input
      {...aria} className={INPUT} value={edits.drafts[editKey(target)] ?? value ?? ""}
      onChange={(e) => edits.type(target, e.target.value)}
      onBlur={edits.commit}
      onKeyDown={(e) => e.key === "Enter" && edits.commit()}
    />
  );
}

/** Hover or focus a value to point at its place on the original. */
function pointAt(onLocate: ((l: SourceLocation | null) => void) | undefined, l: SourceLocation | null) {
  if (!onLocate || !(l?.box || l?.address)) return {};
  return { onMouseEnter: () => onLocate(l), onFocus: () => onLocate(l), onMouseLeave: () => onLocate(null), onBlur: () => onLocate(null) };
}

export const ADDED_TO_CHANGES = "Added to your changes. Publish them to read this field on new documents.";

/** What the read found that a confirmed flow does not have yet, each one click from joining it. */
function NewFields({ flow, read, docId }: { flow: Flow; read: DocumentDetail["read"]; docId: string }) {
  const qc = useQueryClient();
  const add = useMutation({
    mutationFn: (id: string) => saveFlowFields(flow.id, addReadExtra(flow.fields, read, id)),
    // Saving the field list re-runs the checks on this document, so its checks are refetched too.
    onSuccess: (saved) => { qc.setQueryData(["flow", flow.id], saved); qc.invalidateQueries({ queryKey: ["flows"] }); qc.invalidateQueries({ queryKey: ["document", docId] }); },
  });
  const { list, off } = withReadExtras(flow.fields, read);
  const extras = [
    ...list.fields.map((f) => [f.key, f.label] as const),
    ...list.tables.flatMap((t) => [[t.key, t.label] as const, ...t.columns.map((c) => [`${t.key}/${c.key}`, c.label] as const)]),
  ].filter(([id]) => off.has(id));
  const unpublished = add.isSuccess && typeof flow.publishedVersion === "number";
  if (!extras.length && !unpublished) return null;
  return (
    <section className="grid gap-2">
      {extras.length > 0 && <h3 className="m-0 text-[12.5px] font-semibold text-ink">New fields we noticed</h3>}
      {unpublished && <StatusNotice tone="success">{ADDED_TO_CHANGES}</StatusNotice>}
      {add.isError && <StatusNotice tone="error">{documentRefusalMessage(add.error)}</StatusNotice>}
      <ul className="m-0 grid list-none gap-1 p-0">
        {extras.map(([id, label]) => (
          <li key={id} className="flex items-center justify-between gap-2 text-[12.5px] text-ink">
            {label}
            <Button size="sm" variant="secondary" disabled={add.isPending} aria-label={`Add to flow: ${label}`} onClick={() => add.mutate(id)}>Add to flow</Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export interface Teach { key?: string; newLabel?: string; label: string }

/** Choose which field to point at on the original, or name a new one. */
function TeachPicker({ flow, onTeach }: { flow: Flow; onTeach(t: Teach): void }) {
  const fields = flow.fields.fields;
  const [key, setKey] = useState(fields[0]?.key ?? "");
  const [name, setName] = useState("");
  // A teach that created a field adds it to the flow: select it and clear the name, so pointing
  // again corrects that field instead of creating a second one.
  const [count, setCount] = useState(fields.length);
  if (fields.length !== count) {
    setCount(fields.length);
    setName("");
    if (fields.length > count) setKey(fields[fields.length - 1].key);
  }
  const field = fields.find((f) => f.key === key);
  const newLabel = name.trim();
  return (
    <section className="grid gap-2">
      <h3 className="m-0 text-[12.5px] font-semibold text-ink">Point to a value</h3>
      <select aria-label="Field to point to" className={INPUT} value={key} onChange={(e) => setKey(e.target.value)}>
        {fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
        <option value="">A new field…</option>
      </select>
      {!field && (
        <label className="grid gap-1 text-[12.5px] font-medium text-ink">
          New field name
          <input className={INPUT} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
      )}
      <div>
        <Button size="sm" variant="secondary" disabled={!field && !newLabel} onClick={() => onTeach(field ? { key, label: field.label } : { newLabel, label: newLabel })}>
          Point to it
        </Button>
      </div>
    </section>
  );
}

/** The save state, drawn beside the "What we read" heading. */
export const SAVE_WORDS = { saved: "Saves as you type", saving: "Saving…", failed: "Not saved yet" } as const;
export const needsWords = (n: number) => `${n} value${n === 1 ? " needs" : "s need"} a look.`;
const toCheck = (n: number) => `${n} value${n === 1 ? "" : "s"} to check`;
const rowsText = (n: number) => `${n} row${n === 1 ? "" : "s"}`;

/** The amber sentence; a value not found ends with the way to point to it on the original. */
function lookText(look: Look | undefined, teach: (() => void) | undefined): ReactNode {
  if (!look || look.kind !== "missing" || !teach) return look?.text;
  return (
    <>
      {look.text.replace(/\.$/, ", or ")}
      <a href="#review-pane-original" className="text-brand-blue underline" onClick={(e) => { e.preventDefault(); teach(); }}>point to it on the original</a>.
    </>
  );
}

type Table = DocumentDetail["read"]["tables"][number];

/** From `lg` a heading; below it a button that opens the table, open at first when a cell needs a look. */
function TableValues({ table: t, marks, edits, onLocate }: { table: Table; marks: ReviewMarks; edits: DocumentEdits; onLocate?(l: SourceLocation | null): void }) {
  const isLg = useLgViewport();
  const marked = t.rows.reduce((n, row, r) => n + Object.keys(row.cells).filter((c) => marks.looks.has(editKey({ table: t.key, row: r, column: c }))).length, 0);
  const [open, setOpen] = useState(marked > 0);
  const id = `table-${t.key}`;
  return (
    <div className="grid min-w-0 gap-2">
      {isLg ? <h3 className="m-0 text-[13px] font-semibold text-ink">{t.label}, {rowsText(t.rows.length)}</h3> : (
        <div className="grid gap-0.5">
          <div><Button size="sm" variant="ghost" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>{t.label}</Button></div>
          <p className="m-0 text-[12.5px] text-ink-muted">{rowsText(t.rows.length)}{marked > 0 && `, ${toCheck(marked)}`}</p>
        </div>
      )}
      <div id={id} hidden={!isLg && !open} className="grid gap-2">
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-left text-[12.5px] text-ink-muted">
                {t.columns.map((c) => <th key={c.key} className="py-1.5 pr-2 font-semibold">{c.label}</th>)}
                <th className="sticky right-0 bg-surface py-1.5"><span className="sr-only">Row actions</span></th>
              </tr>
            </thead>
            <tbody>
              {t.rows.map((row, r) => (
                <tr key={r} className="align-top">
                  {t.columns.map((c) => {
                    const cell = row.cells[c.key];
                    const target = { table: t.key, row: r, column: c.key };
                    return (
                      <td key={c.key} className="min-w-[8rem] py-1 pr-2" {...pointAt(onLocate, cell?.location ?? null)}>
                        <Field hideLabel label={`${t.label} row ${r + 1} ${c.label}`} look={marks.looks.get(editKey(target))?.text}>
                          <ValueInput target={target} value={cell?.value ?? null} edits={edits} />
                        </Field>
                        {cell && <Meta read={cell} />}
                      </td>
                    );
                  })}
                  <td className="sticky right-0 bg-surface py-1">
                    <Button size="sm" variant="ghost" onClick={() => edits.rows({ removeRows: [{ table: t.key, row: r }] })}>
                      Remove row <span className="sr-only">{r + 1} of {t.label}</span>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div><Button size="sm" variant="secondary" onClick={() => edits.rows({ addRowToTables: [t.key] })}>Add row</Button></div>
      </div>
    </div>
  );
}

export function ReadValuesPanel({ detail, editable, edits, marks, onLocate, flow, onTeach, history }: {
  detail: DocumentDetail; editable: boolean; edits: DocumentEdits; marks: ReviewMarks;
  flow?: Flow; onLocate?(location: SourceLocation | null): void; onTeach?(t: Teach): void; history?: ReactNode;
}) {
  const [more, setMore] = useState(false);
  const { fields, tables } = detail.read;
  // Marked values first, each group in read order; the same order at every width.
  const marked = fields.filter((f) => marks.looks.has(editKey({ field: f.key })));
  const rest = fields.filter((f) => !marks.looks.has(editKey({ field: f.key })));
  const intro = !editable ? null
    : marks.count === 0 ? (marks.allClear ? "Everything was read clearly." : null)
    : `${needsWords(marks.count)}${marks.allClear ? " The rest were read clearly." : ""}`;
  const hasMore = !!flow && (flow.fieldsConfirmed || !!onTeach);

  const fieldRow = (f: (typeof fields)[number]) => {
    const look = marks.looks.get(editKey({ field: f.key }));
    return (
      <div key={f.key} className="grid gap-1" {...pointAt(onLocate, f.location)}>
        <Field label={f.label} look={lookText(look, onTeach && (() => onTeach({ key: f.key, label: f.label })))}>
          <ValueInput target={{ field: f.key }} value={f.value} edits={edits} />
        </Field>
        <Meta read={f} />
      </div>
    );
  };

  return (
    <div className="grid gap-4">
      {edits.state === "failed" && (
        <StatusNotice tone="error" action={<Button size="sm" variant="secondary" onClick={edits.commit}>Try again</Button>}>
          Not saved yet. {documentRefusalMessage(edits.error)}
        </StatusNotice>
      )}
      {edits.refusal && <StatusNotice tone="error">{edits.refusal}</StatusNotice>}
      {intro && <p className="m-0 text-[13px] text-ink">{intro}</p>}
      <fieldset className="m-0 grid min-w-0 gap-4 border-0 p-0" disabled={!editable || edits.busy}>
        <legend className="sr-only">Read values</legend>
        {marked.map(fieldRow)}
        {marked.length > 0 && (rest.length > 0 || tables.length > 0) && (
          <h3 className="m-0 text-[13px] font-semibold text-ink">{marks.allClear && ![...marks.looks.keys()].some((k) => k.startsWith("cell:")) ? "Read clearly" : "The rest"}</h3>
        )}
        {rest.map(fieldRow)}
        {tables.map((t) => <TableValues key={t.key} table={t} marks={marks} edits={edits} onLocate={onLocate} />)}
      </fieldset>
      <Checks checks={marks.unattached} />
      {(hasMore || history) && (
        <div className="flex flex-wrap items-start justify-between gap-2">
          {hasMore && (
            <Button size="sm" variant="ghost" aria-expanded={more} aria-controls="read-more" onClick={() => setMore((m) => !m)}>
              Something missing or in the wrong place?
            </Button>
          )}
          <div className="ml-auto">{history}</div>
        </div>
      )}
      {hasMore && flow && (
        <div id="read-more" hidden={!more} className="grid gap-4">
          {flow.fieldsConfirmed && <NewFields flow={flow} read={detail.read} docId={detail.summary.id} />}
          {onTeach && <TeachPicker flow={flow} onTeach={onTeach} />}
        </div>
      )}
    </div>
  );
}
