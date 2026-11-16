"use client";

import { useEffect, useId, useRef, useState, type ClipboardEvent, type InputHTMLAttributes, type KeyboardEvent, type ReactNode } from "react";
import { Crosshair, X } from "lucide-react";
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
import { pasteGrid, rowsSum, type RowsSum } from "@/lib/reviewSheet";
import type { DocumentEdits } from "@/hooks/useDocumentEdits";
import { Field, ICON_BUTTON, INPUT } from "./DestinationForm";
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
function Meta({ read, inTable, className = "" }: { read: { edited: boolean; location: SourceLocation | null; notOnPage?: boolean }; inTable?: boolean; className?: string }) {
  // In a table the place is shown on the original when the cell is pointed at; a line under every cell only makes rows tall.
  const where = inTable ? null : locationText(read.location);
  if (!read.notOnPage && !read.edited && !where) return null;
  return (
    <span className={`flex flex-wrap items-center gap-2 text-[12.5px] text-ink-muted ${className}`}>
      {read.notOnPage && <span>Not found on the page</span>}
      {read.edited && <span>Edited</span>}
      {where && <span>{where}</span>}
    </span>
  );
}

/** Shows what is being typed over the server's value; saves on a pause, on Enter and on leaving the box. */
export function ValueInput({ target, value, edits, className = "", base = INPUT, ...rest }: {
  target: EditTarget; value: string | null; edits: DocumentEdits; /** The box's own look; a table cell passes its own. */ base?: string;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "onBlur" | "onKeyDown"> & { "data-look"?: string; "data-table"?: string; "data-cell"?: string }) {
  return (
    <input
      {...rest} data-value={editKey(target)} className={`${base} ${className}`} value={edits.drafts[editKey(target)] ?? value ?? ""}
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

/** Values side by side, as many as fit the pane; one column on a phone. */
const VALUE_GRID = "grid items-start gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(220px,100%),1fr))]";
const NUMBER = /^[-+]?[\d\s.,]+$/;
const KBD = "inline-flex h-[22px] items-center rounded border border-border bg-surface-2 px-1.5 font-sans text-[12.5px] font-semibold text-ink-muted";
/** A paste never makes a table longer than this. */
const PASTE_ROWS = 200;

/** A column is as wide as the longest thing in it (4 to 28 characters), and right-aligned when every value is a number. */
export function columnShape(t: Pick<Table, "rows">, key: string, label: string): { size: number; numeric: boolean } {
  const values = t.rows.map((r) => r.cells[key]?.value ?? "").filter(Boolean);
  const longest = Math.max(label.length, ...values.map((v) => v.length));
  return { size: Math.min(28, Math.max(4, longest)), numeric: values.length > 0 && values.every((v) => NUMBER.test(v)) };
}

/** A cell of the sheet: no box of its own, the grid lines are the box. */
const CELL = "h-10 w-full rounded-none border-0 bg-transparent px-2.5 text-[13px] font-medium text-ink focus-visible:bg-brand-blue-soft focus-visible:[outline-offset:-2px]";

/** From `lg` a heading; below it a button that opens the table, open at first when a cell needs a look. */
function TableValues({ table: t, marks, edits, onLocate, sum, editable }: { table: Table; marks: ReviewMarks; edits: DocumentEdits; onLocate?(l: SourceLocation | null): void; sum?: RowsSum | null; editable: boolean }) {
  const isLg = useLgViewport();
  const marked = t.rows.reduce((n, row, r) => n + Object.keys(row.cells).filter((c) => marks.looks.has(editKey({ table: t.key, row: r, column: c }))).length, 0);
  const [open, setOpen] = useState(marked > 0);
  const id = `table-${t.key}`;
  const shapes = new Map(t.columns.map((c) => [c.key, columnShape(t, c.key, c.label)]));
  const adds = sum && (
    <p data-testid="rows-sum" className={`m-0 text-[12.5px] ${sum.same ? "font-medium text-brand-green-deep" : "text-ink-muted"}`}>
      {sum.same ? `The rows add up to ${sum.sum}, the same as ${sum.label}.` : `The rows add up to ${sum.sum}. ${sum.label} says ${sum.value}.`}
    </p>
  );
  return (
    <div className="grid min-w-0 gap-2">
      {isLg ? (
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h3 className="m-0 text-[13px] font-semibold text-ink">{t.label}, {rowsText(t.rows.length)}</h3>
          {adds}
        </div>
      ) : (
        <div className="grid gap-0.5">
          <div><Button size="sm" variant="ghost" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>{t.label}</Button></div>
          <p className="m-0 text-[12.5px] text-ink-muted">{rowsText(t.rows.length)}{marked > 0 && `, ${toCheck(marked)}`}</p>
          {adds}
        </div>
      )}
      <div id={id} hidden={!isLg && !open} className="grid gap-2">
        <div className="overflow-x-auto rounded-md border border-border-strong">
          <table className="w-full border-collapse text-[13px] [&_tbody_tr:last-child_td]:border-b-0">
            <thead>
              <tr className="bg-surface-2 text-left text-[12.5px] text-ink-muted">
                {t.columns.map((c) => <th key={c.key} className={`border-b border-r border-border px-2.5 py-2 font-semibold ${shapes.get(c.key)!.numeric ? "text-right" : ""}`}>{c.label}</th>)}
                <th className="sticky right-0 w-10 border-b border-border bg-surface-2"><span className="sr-only">Row actions</span></th>
              </tr>
            </thead>
            <tbody>
              {t.rows.map((row, r) => (
                <tr key={r} className="align-top">
                  {t.columns.map((c, col) => {
                    const cell = row.cells[c.key];
                    const target = { table: t.key, row: r, column: c.key };
                    const shape = shapes.get(c.key)!;
                    return (
                      <td key={c.key} className="border-b border-r border-border p-0 [&_p]:px-2.5 [&_p]:pb-1.5" style={{ minWidth: `calc(${shape.size}ch + 1.75rem)` }} {...pointAt(onLocate, cell?.location ?? null)}>
                        <Field hideLabel label={`${t.label} row ${r + 1} ${c.label}`} look={marks.looks.get(editKey(target))?.text}>
                          <ValueInput target={target} value={cell?.value ?? null} edits={edits} size={shape.size} base={CELL} data-table={t.key} data-cell={`${r}:${col}`} className={shape.numeric ? "text-right tabular-nums" : ""} {...(marks.looks.has(editKey(target)) && { "data-look": "" })} />
                        </Field>
                        {cell && <Meta read={cell} inTable className="px-2.5 pb-1.5" />}
                      </td>
                    );
                  })}
                  <td className="sticky right-0 w-10 border-b border-border bg-surface p-0">
                    <button type="button" className={ICON_BUTTON} aria-label={`Remove row ${r + 1} of ${t.label}`} onClick={() => edits.rows({ removeRows: [{ table: t.key, row: r }] })}>
                      <X size={16} aria-hidden />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Button size="sm" variant="secondary" onClick={() => edits.rows({ addRowToTables: [t.key] })}>Add row</Button>
          {editable && <p className="m-0 hidden text-[12.5px] text-ink-muted lg:block">Arrow keys move between cells. You can paste rows from a spreadsheet.</p>}
        </div>
      </div>
    </div>
  );
}

const emptyWords = (labels: string[]) =>
  `${labels.length} value${labels.length === 1 ? " is" : "s are"} empty: ${labels.slice(0, 4).join(", ")}${labels.length > 4 ? ` and ${labels.length - 4} more` : ""}.`;

export function ReadValuesPanel({ detail, editable, edits, marks, onLocate, flow, onTeach, history, walk, onChecked }: {
  detail: DocumentDetail; editable: boolean; edits: DocumentEdits; marks: ReviewMarks;
  flow?: Flow; onLocate?(location: SourceLocation | null): void; onTeach?(t: Teach): void; history?: ReactNode;
  /** The review screen on a wide window: the cursor starts in the first value to check, and Enter goes to the next one. */
  walk?: boolean;
  /** Enter was pressed in the last value to check. */
  onChecked?(from: HTMLInputElement): void;
}) {
  const [more, setMore] = useState(false);
  const [showEmpty, setShowEmpty] = useState(false);
  const uid = useId();
  const { fields, tables } = detail.read;
  const isMarked = (f: (typeof fields)[number]) => marks.looks.has(editKey({ field: f.key }));
  // Decided once, when the document opens: a value typed into an empty box must not move the box while it is typed in.
  // A value to check is never one of them: once it is filled in it joins the values with text, in the same grid.
  const [emptyKeys] = useState(() => new Set(fields.filter((f) => !f.value?.trim() && !f.edited && !f.notOnPage && !isMarked(f)).map((f) => f.key)));
  // Marked values first, then the ones with text, then the empty ones behind one line; each group in read order.
  const marked = fields.filter(isMarked);
  const rest = fields.filter((f) => !isMarked(f) && !emptyKeys.has(f.key));
  const empty = fields.filter((f) => !isMarked(f) && emptyKeys.has(f.key));
  const stillEmpty = empty.filter((f) => !(edits.drafts[editKey({ field: f.key })] ?? f.value)?.trim());
  // A folded value that has been given text is never hidden again.
  const emptyOpen = showEmpty || stillEmpty.length < empty.length;
  const cellLooks = [...marks.looks.keys()].filter((k) => k.startsWith("cell:")).length;
  const [pasteNote, setPasteNote] = useState<string | null>(null);
  const values = useRef<HTMLFieldSetElement>(null);
  const started = useRef(false);
  // The cursor starts in the first value to check ONCE per opened document. A value that is marked after a save
  // must never take the cursor from the box a person is typing in, so this is not autoFocus (which runs on every mount).
  useEffect(() => {
    if (!walk || started.current) return;
    started.current = true;
    if (!values.current?.contains(document.activeElement)) values.current?.querySelector<HTMLInputElement>("input[data-look]")?.focus();
  }, [walk]);
  const intro = !editable ? null
    : marks.count === 0 ? (marks.allClear ? "Everything was read clearly." : null)
    : `${needsWords(marks.count)}${marks.allClear ? " The rest were read clearly." : ""}`;
  const hasMore = !!flow && (flow.fieldsConfirmed || !!onTeach);
  const sum = rowsSum(detail.read, flow, edits.drafts);

  const fieldRow = (f: (typeof fields)[number]) => {
    const look = marks.looks.get(editKey({ field: f.key }));
    const id = `${uid}-${f.key}`;
    const teach = onTeach && (() => onTeach({ key: f.key, label: f.label }));
    return (
      <div key={f.key} className={look ? "plk-look" : undefined} {...pointAt(onLocate, f.location)}>
        <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3">
          <label htmlFor={id} className="text-[13px] font-semibold text-ink-muted">{f.label}</label>
          <Meta read={f} />
        </div>
        <div className="group/value relative">
          <ValueInput
            id={id} target={{ field: f.key }} value={f.value} edits={edits} aria-describedby={look ? `${id}-look` : undefined}
            className={teach ? "lg:pr-10" : ""} {...(look && { "data-look": "" })}
          />
          {teach && (
            // Named by its own text, not aria-label: a label lookup for the value must find the box alone.
            <button type="button" tabIndex={-1} onClick={teach}
              className={`absolute right-1 top-1 hidden h-8 w-8 items-center justify-center rounded-md text-ink-muted hover:bg-surface-2 hover:text-ink lg:inline-flex ${look ? "" : "opacity-0 group-focus-within/value:opacity-100 group-hover/value:opacity-100"}`}>
              <Crosshair size={15} aria-hidden />
              <span className="sr-only">Point to {f.label} on the original</span>
            </button>
          )}
        </div>
        {look && <p id={`${id}-look`} className="m-0 mt-1.5 text-[12.5px] font-medium text-amber-text">{lookText(look, teach)}</p>}
      </div>
    );
  };

  /** Enter in a value to check goes to the next one, then to Send. In a table the arrow keys and Enter move between cells. */
  const onKeys = (e: KeyboardEvent<HTMLFieldSetElement>) => {
    const el = e.target;
    if (!(el instanceof HTMLInputElement) || e.nativeEvent.isComposing || e.keyCode === 229 || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const to = (next: HTMLInputElement | null | undefined) => { if (next) { e.preventDefault(); next.focus(); next.select(); } };
    if (el.dataset.cell) {
      const [r, c] = el.dataset.cell.split(":").map(Number);
      const cell = (dr: number, dc: number) => e.currentTarget.querySelector<HTMLInputElement>(`input[data-table="${CSS.escape(el.dataset.table!)}"][data-cell="${r + dr}:${c + dc}"]`);
      const [start, end, length] = [el.selectionStart, el.selectionEnd, el.value.length];
      if (e.key === "ArrowDown" || (e.key === "Enter" && !e.shiftKey)) to(cell(1, 0));
      else if (e.key === "ArrowUp" || (e.key === "Enter" && e.shiftKey)) to(cell(-1, 0));
      else if (e.key === "ArrowLeft" && start === 0 && end === 0) to(cell(0, -1));
      else if (e.key === "ArrowRight" && start === length && end === length) to(cell(0, 1));
    } else if (walk && e.key === "Enter" && !e.shiftKey && el.dataset.look !== undefined) {
      const looks = [...e.currentTarget.querySelectorAll<HTMLInputElement>("input[data-look]")];
      const next = looks[looks.indexOf(el) + 1];
      if (next) to(next); else { e.preventDefault(); onChecked?.(el); }
    }
  };

  /** Cells copied from a spreadsheet fill the table from the cell they are pasted into, adding rows when they run past the end. */
  const onPaste = (e: ClipboardEvent<HTMLFieldSetElement>) => {
    const el = e.target;
    if (!(el instanceof HTMLInputElement) || !el.dataset.cell) return;
    const grid = pasteGrid(e.clipboardData.getData("text/plain"));
    const t = tables.find((x) => x.key === el.dataset.table);
    if (!grid || !t) return;
    e.preventDefault();
    const [r0, c0] = el.dataset.cell.split(":").map(Number);
    // Rows that exist are always written; new ones are added only up to the cap.
    const last = Math.max(t.rows.length, Math.min(PASTE_ROWS, r0 + grid.length));
    const lines = grid.slice(0, Math.max(0, last - r0));
    const extra = last - t.rows.length;
    void (async () => {
      if (extra > 0 && !(await edits.rows({ addRowToTables: Array<string>(extra).fill(t.key) }))) return;
      lines.forEach((cells, i) => cells.forEach((v, j) => {
        const column = t.columns[c0 + j];
        if (column) edits.type({ table: t.key, row: r0 + i, column: column.key }, v.trim());
      }));
      setPasteNote(lines.length < grid.length ? `Pasted the first ${lines.length} of ${grid.length} rows. A table can be made ${PASTE_ROWS} rows long by pasting.` : null);
      // Adding rows locks the boxes for a moment, which drops the cursor: back to the cell the paste started in.
      requestAnimationFrame(() => values.current?.querySelector<HTMLInputElement>(`input[data-table="${CSS.escape(t.key)}"][data-cell="${r0}:${c0}"]`)?.focus());
    })();
  };

  return (
    <div className="grid gap-4">
      {edits.state === "failed" && (
        <StatusNotice tone="error" action={<Button size="sm" variant="secondary" onClick={edits.commit}>Try again</Button>}>
          Not saved yet. {documentRefusalMessage(edits.error)}
        </StatusNotice>
      )}
      {edits.refusal && <StatusNotice tone="error">{edits.refusal}</StatusNotice>}
      {intro && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <p className="m-0 text-[13px] text-ink">{intro}</p>
          {walk && marked.length > 0 && (
            <p className="m-0 hidden items-center gap-1.5 text-[12.5px] text-ink-muted lg:flex">
              <kbd className={KBD}>Enter</kbd> {marked.length + cellLooks > 1 ? "goes to the next one" : "goes to Send"}
            </p>
          )}
        </div>
      )}
      <fieldset ref={values} className="m-0 grid min-w-0 gap-4 border-0 p-0" disabled={!editable || edits.busy} onKeyDown={onKeys} onPaste={onPaste}>
        <legend className="sr-only">Read values</legend>
        {/* ONE keyed list in one grid: a value that changes group after a save is moved, not made again, so it keeps the cursor. */}
        {marked.length + rest.length > 0 && (
          <div className={VALUE_GRID}>
            {[
              ...marked.map(fieldRow),
              marked.length > 0 && (rest.length > 0 || tables.length > 0) && (
                <h3 key=" rest" className="col-span-full m-0 text-[13px] font-semibold text-ink">{marks.allClear && cellLooks === 0 ? "Read clearly" : "The rest"}</h3>
              ),
              ...rest.map(fieldRow),
            ]}
          </div>
        )}
        {empty.length > 0 && (
          <div className="grid gap-3">
            {stillEmpty.length > 0 && (
              <p className="m-0 flex flex-wrap items-center gap-x-2 text-[13px] text-ink-muted">
                {emptyWords(stillEmpty.map((f) => f.label))}
                {stillEmpty.length === empty.length && (
                  <Button size="sm" variant="ghost" className="!text-brand-blue" aria-expanded={showEmpty} aria-controls={`${uid}-empty`} onClick={() => setShowEmpty((s) => !s)}>
                    {showEmpty ? "Hide them" : "Show them"}
                  </Button>
                )}
              </p>
            )}
            <div id={`${uid}-empty`} hidden={!emptyOpen} className={VALUE_GRID}>{empty.map(fieldRow)}</div>
          </div>
        )}
        {tables.map((t) => <TableValues key={t.key} table={t} marks={marks} edits={edits} onLocate={onLocate} editable={editable} sum={sum?.table === t.key ? sum : null} />)}
      </fieldset>
      {pasteNote && <StatusNotice tone="warning">{pasteNote}</StatusNotice>}
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
