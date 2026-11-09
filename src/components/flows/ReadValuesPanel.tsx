"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/bridge/DSPrimitives";
import { ConfidenceChip } from "@/components/bridge/ConfidenceChip";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { editDocumentValues, saveFlowFields } from "@/lib/api/documents";
import type { DocumentDetail, EditValuesRequest, Flow, SourceLocation } from "@/lib/api/documents";
import { documentRefusalMessage, refusalToken } from "@/lib/documentRefusals";
import { addReadExtra, withReadExtras } from "@/lib/flowFieldModel";
import { parseAddress, spreadsheetColumnName } from "@/lib/sourceAddress";
import { INPUT } from "./DestinationForm";
import { Checks } from "./states";

/** "Page 2", "Paragraph 2", "Line 7", or the sheet cell as a spreadsheet writes it (`cell:r2c3` becomes "Cell C2"). */
export function locationText(l: SourceLocation | null): string | null {
  if (l?.page != null) return `Page ${l.page}`;
  const a = parseAddress(l?.address);
  if (!a) return l?.address ?? null;
  if (a.kind !== "cell") return `${a.kind === "para" ? "Paragraph" : "Line"} ${a.n}`;
  return `Cell ${spreadsheetColumnName(a.col - 1)}${a.row}`;
}

function Meta({ read }: { read: { confidence: number; location: SourceLocation | null; notOnPage: boolean } }) {
  const where = locationText(read.location);
  return (
    <span className="flex flex-wrap items-center gap-2 text-[11.5px] text-ink-muted">
      {read.notOnPage ? "Not found on the page" : <ConfidenceChip value={read.confidence} sm />}
      {where && <span>{where}</span>}
    </span>
  );
}

/** Uncontrolled, re-keyed by the saved value: saves on blur or Enter, and shows the server's value after a reload. */
function ValueInput({ label, value, onSave }: { label?: string; value: string | null; onSave(v: string): void }) {
  return (
    <input
      key={value ?? ""} aria-label={label} className={INPUT} defaultValue={value ?? ""}
      onBlur={(e) => e.target.value !== (value ?? "") && onSave(e.target.value)}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
    />
  );
}

/** Hover or focus a value to point at its place on the original. */
function pointAt(onLocate: ((l: SourceLocation | null) => void) | undefined, l: SourceLocation | null) {
  if (!onLocate || !(l?.box || l?.address)) return {};
  return { onMouseEnter: () => onLocate(l), onFocus: () => onLocate(l), onMouseLeave: () => onLocate(null), onBlur: () => onLocate(null) };
}

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
  if (!extras.length) return null;
  return (
    <section className="grid gap-2">
      <h3 className="m-0 text-[12px] font-semibold text-ink">New fields we noticed</h3>
      {add.isError && <StatusNotice tone="error">{documentRefusalMessage(add.error)}</StatusNotice>}
      <ul className="m-0 grid list-none gap-1 p-0">
        {extras.map(([id, label]) => (
          <li key={id} className="flex items-center justify-between gap-2 text-[12px] text-ink">
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
  const field = fields.find((f) => f.key === key);
  const newLabel = name.trim();
  return (
    <section className="grid gap-2">
      <h3 className="m-0 text-[12px] font-semibold text-ink">Point to a value</h3>
      <select aria-label="Field to point to" className={INPUT} value={key} onChange={(e) => setKey(e.target.value)}>
        {fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
        <option value="">A new field…</option>
      </select>
      {!field && (
        <label className="grid gap-1 text-[12px] font-medium text-ink">
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

export function ReadValuesPanel({ detail, editable, onLocate, flow, onTeach }: { detail: DocumentDetail; editable: boolean; onLocate?(location: SourceLocation | null): void; flow?: Flow; onTeach?(t: Teach): void }) {
  const qc = useQueryClient();
  const id = detail.summary.id;
  // Bumped after a refusal so every input drops what was typed and shows the server's value again.
  const [reset, setReset] = useState(0);
  const edit = useMutation({
    mutationKey: ["edit-values", id],
    mutationFn: (req: EditValuesRequest) => editDocumentValues(id, req),
    onSuccess: (d) => { qc.setQueryData(["document", id], d); qc.invalidateQueries({ queryKey: ["document-history", id] }); },
    onError: (e) => {
      setReset((n) => n + 1);
      if (refusalToken(e) !== null) qc.invalidateQueries({ queryKey: ["document", id] });
    },
  });
  const { fields, tables } = detail.read;

  return (
    <div key={reset} className="grid gap-4">
      {edit.isError && <StatusNotice tone="error">{documentRefusalMessage(edit.error)}</StatusNotice>}
      <fieldset className="m-0 grid min-w-0 gap-4 border-0 p-0" disabled={!editable || edit.isPending}>
        <legend className="sr-only">Read values</legend>
        {fields.map((f) => (
          <div key={f.key} className="grid gap-1" {...pointAt(onLocate, f.location)}>
            <label className="grid gap-1 text-[12px] font-medium text-ink">
              {f.label}
              <ValueInput value={f.value} onSave={(value) => edit.mutate({ fields: [{ key: f.key, value }] })} />
            </label>
            <Meta read={f} />
          </div>
        ))}
        {tables.map((t) => (
          <div key={t.key} className="grid min-w-0 gap-2">
            <h3 className="m-0 text-[12px] font-semibold text-ink">{t.label}</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-left text-[10.5px] uppercase tracking-wide text-ink-muted">
                    {t.columns.map((c) => <th key={c.key} className="py-1.5 pr-2 font-semibold">{c.label}</th>)}
                    <th className="sticky right-0 bg-surface py-1.5"><span className="sr-only">Row actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {t.rows.map((row, r) => (
                    <tr key={r} className="align-top">
                      {t.columns.map((c) => {
                        const cell = row.cells[c.key];
                        return (
                          <td key={c.key} className="min-w-[8rem] py-1 pr-2" {...pointAt(onLocate, cell?.location ?? null)}>
                            <ValueInput
                              label={`${t.label} row ${r + 1} ${c.label}`} value={cell?.value ?? null}
                              onSave={(value) => edit.mutate({ cells: [{ table: t.key, row: r, column: c.key, value }] })}
                            />
                            {cell && <Meta read={cell} />}
                          </td>
                        );
                      })}
                      <td className="sticky right-0 bg-surface py-1">
                        <Button size="sm" variant="ghost" onClick={() => edit.mutate({ removeRows: [{ table: t.key, row: r }] })}>
                          Remove row <span className="sr-only">{r + 1} of {t.label}</span>
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div><Button size="sm" variant="secondary" onClick={() => edit.mutate({ addRowToTables: [t.key] })}>Add row</Button></div>
          </div>
        ))}
      </fieldset>
      {flow?.fieldsConfirmed && <NewFields flow={flow} read={detail.read} docId={id} />}
      {flow && onTeach && <TeachPicker flow={flow} onTeach={onTeach} />}
      <Checks checks={detail.checks} />
    </div>
  );
}
