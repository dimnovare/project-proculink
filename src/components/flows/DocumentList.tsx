"use client";

import Link from "next/link";
import { useId, useRef, useState, type ReactNode } from "react";
import { focusAfterRemove } from "@/components/pwa/HeldUploads";
import { StatusJourney } from "@/components/bridge/StatusJourney";
import { Pill } from "@/components/bridge/DSPrimitives";
import { relativeTime } from "@/lib/relativeTime";
import { DOCUMENT_STATUSES, documentStatus, WHOLE_DOCUMENT_CHECKS, type DocumentStatusRow } from "@/lib/documentStatusManifest";
import { kindSentence } from "@/lib/documentKind";
import { finishedLabel, flowWords } from "@/lib/flowWords";
import type { DocumentRow, DocumentSummary } from "@/lib/api/documents";
import { RowActions, rowSecondLine } from "./RowActions";

/** A document as a list knows it: a row of the paged list, or a bare summary (the flow page). */
export type ListedDocument = DocumentSummary & Partial<Omit<DocumentRow, keyof DocumentSummary>>;

/** Select mode: which rows on screen are ticked. */
export interface ListSelection {
  ids: ReadonlySet<string>;
  toggle: (id: string) => void;
  /** The header box: ticks every row on screen, or none. */
  all: (on: boolean) => void;
}

type Tone = "amber" | "green" | "blue" | "danger";
const STATUS_TONE: Record<DocumentStatusRow["tone"], Tone> = { working: "blue", warning: "amber", error: "danger", success: "green" };
const WHOLE: readonly string[] = WHOLE_DOCUMENT_CHECKS;

/** What a row asks of a person, in a few words, and its colour. */
export function rowNeed(d: ListedDocument): { text: string; tone: Tone } {
  if (d.statusReason === "duplicate_file") return { text: "Already added", tone: "amber" };
  const s = documentStatus(d.status, d.statusReason);
  if (s.label !== DOCUMENT_STATUSES[d.status]?.label) return { text: s.label, tone: STATUS_TONE[s.tone] };
  // Finished: what its own files did ("File ready", "Sent to …"), whatever the flow says now.
  if (d.status === "sent" && d.files?.length) return { text: finishedLabel(d.files), tone: "green" };
  if (d.status === "ready") return { text: d.isSample ? "Nothing to send" : flowWords(d.downloadOnly).ready, tone: "amber" };   // waits on a person: green is only for finished
  if (d.status === "needs_review" && d.checks) {
    if (d.checks.includes("duplicate")) return { text: "Same number as an earlier document", tone: "amber" };
    if (d.checks.includes("new_sender")) return { text: "Email address not confirmed", tone: "amber" };
    const values = d.failedChecks - d.checks.filter((c) => WHOLE.includes(c)).length;
    if (values >= 1) return { text: values === 1 ? "1 value to check" : `${values} values to check`, tone: "amber" };
  }
  return { text: s.label, tone: STATUS_TONE[s.tone] };
}

const href = (d: ListedDocument) => `/flows/${d.flowId}/documents/${d.id}`;
const received = (d: ListedDocument) => relativeTime(d.createdAt) ?? "—";

/** A row's tick: a real checkbox in a 44px label, above the row's overlay. On a phone the label is the whole row
 *  (`children`), so a tap anywhere on it ticks. Enter ticks too, as Space does. */
const Tick = ({ d, selection, className, id, children }: { d: ListedDocument; selection: ListSelection; className: string; id?: string; children?: ReactNode }) => (
  <label className={`relative z-[1] flex shrink-0 items-center ${children ? "" : "justify-center"} ${className}`}>
    <input type="checkbox" id={id} aria-label={`Select ${d.fileName}`} checked={selection.ids.has(d.id)} onChange={() => selection.toggle(d.id)}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); selection.toggle(d.id); } }} className="h-5 w-5 shrink-0" />
    {children}
  </label>
);

function Row({ d, showFlow, sendable, columns, onSent, onRemoved, selection }: {
  d: ListedDocument; showFlow: boolean; sendable: boolean; columns: string; onSent: (d: ListedDocument) => void; onRemoved(id: string): void; selection?: ListSelection;
}) {
  const need = rowNeed(d);
  const line = rowSecondLine(d, kindSentence(d.kind, d.sender));
  const ticked = !!selection?.ids.has(d.id);
  const tickId = useId();
  const name = "min-w-0 truncate text-[14.5px] font-semibold text-ink after:absolute after:inset-0";
  return (
    <div role="row" className={`relative grid min-h-[64px] items-center gap-3 border-t border-border px-3 py-2 ${ticked ? "bg-brand-blue-soft" : "hover:bg-surface-2"}`} style={{ gridTemplateColumns: columns }}>
      {selection && <div role="cell"><Tick d={d} selection={selection} id={tickId} className="h-11 w-11" /></div>}
      <div role="cell" className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          {/* Selecting, the name's overlay is the tick's label: a click anywhere on the row ticks it and opens nothing. */}
          {selection ? <label htmlFor={tickId} className={`${name} cursor-pointer`}>{d.fileName}</label>
            : <Link href={href(d)} className={name}>{d.fileName}</Link>}
          {d.isSample && <Pill>Sample</Pill>}
        </div>
        {line && <div title={line} className="truncate text-[12.5px] text-ink-muted">{line}</div>}
        {d.number && <div className="truncate font-mono text-[12.5px] text-ink-muted">{d.number}</div>}
      </div>
      {showFlow && <div role="cell" className="min-w-0 truncate text-[13px] text-ink-muted">{d.flowName}</div>}
      <div role="cell" aria-live="polite" className="flex min-w-0">
        <Pill tone={need.tone} title={need.text}>{need.text}</Pill>
      </div>
      <div role="cell"><StatusJourney stage={documentStatus(d.status, d.statusReason).stage} compact /></div>
      <div role="cell" className="text-[13px] text-ink-muted">{received(d)}</div>
      {/* Selecting, the bar acts on the ticked rows: a row offers nothing of its own, as on a phone. */}
      <div role="cell">
        {!selection && <RowActions d={d} sendable={sendable} onSent={() => onSent({ ...d, status: "sending", statusReason: null })} onRemoved={onRemoved} />}
      </div>
    </div>
  );
}

export function DocumentList({ documents, showFlow, label, needHeading = "Status", sendable = false, selection }: {
  documents: ListedDocument[];
  showFlow: boolean;
  /** The list's accessible name. */
  label: string;
  /** Heading of the tag column. Default "Status". */
  needHeading?: string;
  /** Ready rows carry Send (table only). */
  sendable?: boolean;
  /** Select mode: a checkbox before each row; the row's own Send is not drawn (the bar sends). */
  selection?: ListSelection;
}) {
  // What this list sent, drawn only while the incoming list still calls it ready; when the server stops listing it,
  // the row goes (R5). The caller resets it with a `key`.
  const [sent, setSent] = useState<Record<string, ListedDocument>>({});
  // A removed row is hidden here until the refetch stops listing it.
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set());
  const [removedNote, setRemovedNote] = useState("");
  const table = useRef<HTMLDivElement>(null);
  const phoneList = useRef<HTMLUListElement>(null);
  const onRemoved = (id: string) => {
    setRemoved((r) => new Set(r).add(id));
    const name = documents.find((d) => d.id === id)?.fileName;
    if (name) setRemovedNote(`${name} removed.`);
    // The row went with the focused button: focus goes to the list on screen, never to the page.
    focusAfterRemove([table.current, phoneList.current].find((el) => el?.offsetParent) ?? table.current);
  };
  const drawn = documents.filter((d) => !removed.has(d.id)).map((d) => (sent[d.id] && d.status === "ready" ? sent[d.id] : d)).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  // Every row ticks: the bar sends only what a row would send (an inbox one is answered on its own screen), removes
  // only what the server allows, and downloads the original, which every document has.
  const columns = `${selection ? "44px " : ""}minmax(0,2fr) ${showFlow ? "minmax(0,1fr) " : ""}minmax(0,1.4fr) 104px 96px 232px`; // one fixed last column, so every row lines up

  return (
    // The table from 1000px of the list's own width (the help panel narrows it), cards below: `.docs-list` in globals.css.
    <div className="docs-list">
      <p role="status" className="m-0 px-3 py-2 text-[13px] text-ink-muted empty:hidden">{removedNote}</p>
      <div ref={table} tabIndex={-1} role="table" aria-label={label} className="docs-table outline-none">
        <div role="row" className="grid gap-3 px-3 py-2 text-[12.5px] font-medium text-ink-muted" style={{ gridTemplateColumns: columns }}>
          {selection && (
            <div role="columnheader">
              {drawn.length > 1 && (
                <label className="flex h-11 w-11 items-center justify-center">
                  <input type="checkbox" aria-label={`Select all ${drawn.length} documents`} className="h-5 w-5"
                    checked={drawn.every((d) => selection.ids.has(d.id))} onChange={(e) => selection.all(e.target.checked)}
                    ref={(el) => { if (el) el.indeterminate = drawn.some((d) => selection.ids.has(d.id)) && !drawn.every((d) => selection.ids.has(d.id)); }} />
                </label>
              )}
            </div>
          )}
          <div role="columnheader">Document</div>
          {showFlow && <div role="columnheader">Flow</div>}
          <div role="columnheader">{needHeading}</div>
          <div role="columnheader">Progress</div>
          <div role="columnheader">Received</div>
          <div role="columnheader" className="text-right">Next step</div>
        </div>
        {drawn.map((d) => (
          <Row key={d.id} d={d} showFlow={showFlow} sendable={sendable} columns={columns} selection={selection} onRemoved={onRemoved} onSent={(s) => setSent((m) => ({ ...m, [s.id]: s }))} />
        ))}
      </div>
      <ul ref={phoneList} tabIndex={-1} data-testid="documents-phone-list" aria-label={label} className="docs-cards m-0 list-none p-0 outline-none">
        {drawn.map((d) => {
          const need = rowNeed(d);
          // R17: one second line, what it is when known, otherwise where it is.
          const line = rowSecondLine(d, kindSentence(d.kind, d.sender)) ?? (showFlow ? d.flowName : null);
          // Selecting, a tap on a row ticks it, so it carries no "opens" arrow.
          const picks = !!selection;
          const body = (
            <>
              <div className="grid min-w-0 flex-1 gap-1">
                <div className="flex min-w-0 items-baseline justify-between gap-3">
                  <span data-testid="document-name" className="min-w-0 truncate text-[16px] font-semibold">{d.fileName}</span>
                  <span className="shrink-0 text-[13px] text-ink-muted">{received(d)}</span>
                </div>
                {line && <span title={line} className="truncate text-[14px] text-ink-muted">{line}</span>}
                <div className="flex flex-wrap gap-2">
                  <Pill tone={need.tone}>{need.text}</Pill>
                  {d.isSample && <Pill>Sample</Pill>}
                </div>
              </div>
              {!picks && (
                <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0 text-ink-muted">
                  <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </>
          );
          // `!` beats the global phone rule, whose `min-height: 44px !important` would otherwise win.
          const card = "flex !min-h-[92px] min-w-0 flex-1 items-center gap-3 px-4 py-3 text-ink";
          return (
            <li key={d.id} className={`border-t border-border first:border-t-0 ${selection ? "flex items-stretch" : ""} ${selection?.ids.has(d.id) ? "bg-brand-blue-soft" : ""}`}>
              {selection && picks ? <Tick d={d} selection={selection} className={`${card} cursor-pointer !pl-3`}>{body}</Tick> : (
                <>
                  {selection && <span className="w-11 shrink-0" />}
                  <Link href={href(d)} className={card}>{body}</Link>
                </>
              )}
              {/* Outside the card's link, so a tap on a button never opens the document. */}
              {!selection && (
                <RowActions d={d} sendable={sendable} phone onRemoved={onRemoved} className="flex flex-wrap gap-2 px-4 pb-3"
                  onSent={() => setSent((m) => ({ ...m, [d.id]: { ...d, status: "sending", statusReason: null } }))} />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
