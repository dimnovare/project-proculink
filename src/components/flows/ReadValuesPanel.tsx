"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/bridge/DSPrimitives";
import { ConfidenceChip } from "@/components/bridge/ConfidenceChip";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { editDocumentValues } from "@/lib/api/documents";
import type { DocumentDetail, EditValuesRequest, SourceLocation } from "@/lib/api/documents";
import { documentRefusalMessage, refusalToken } from "@/lib/documentRefusals";
import { INPUT } from "./DestinationForm";
import { Checks } from "./states";

/** "Page 2", or the sheet cell as a spreadsheet writes it (`cell:r2c3` becomes "Cell C2"). */
export function locationText(l: SourceLocation | null): string | null {
  if (l?.page != null) return `Page ${l.page}`;
  const m = /^cell:r(\d+)c(\d+)$/.exec(l?.address ?? "");
  if (!m) return l?.address ?? null;
  let col = "";
  for (let n = Number(m[2]); n > 0; n = Math.floor((n - 1) / 26)) col = String.fromCharCode(65 + ((n - 1) % 26)) + col;
  return `Cell ${col}${m[1]}`;
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
  if (!onLocate || !l?.box) return {};
  return { onMouseEnter: () => onLocate(l), onFocus: () => onLocate(l), onMouseLeave: () => onLocate(null), onBlur: () => onLocate(null) };
}

export function ReadValuesPanel({ detail, editable, onLocate }: { detail: DocumentDetail; editable: boolean; onLocate?(location: SourceLocation | null): void }) {
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
      <Checks checks={detail.checks} />
    </div>
  );
}
