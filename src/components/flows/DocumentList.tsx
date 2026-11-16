"use client";

import Link from "next/link";
import { useState } from "react";
import { useIsMutating, useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { StatusJourney } from "@/components/bridge/StatusJourney";
import { Button, Pill, buttonClass } from "@/components/bridge/DSPrimitives";
import { relativeTime } from "@/lib/relativeTime";
import { DOCUMENT_STATUSES, documentStatus, WHOLE_DOCUMENT_CHECKS, type DocumentStatusRow } from "@/lib/documentStatusManifest";
import { documentRefusalMessage } from "@/lib/documentRefusals";
import { kindSentence } from "@/lib/documentKind";
import { sendDocument, type DocumentRow, type DocumentSummary } from "@/lib/api/documents";
import { BULK_SEND_KEY } from "./SelectionBar";

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
  // Where the earlier copy is: the workspace, this flow, or (place not known) said without a place.
  if (d.statusReason === "duplicate_file")
    return { text: d.inInbox ? "Already in your workspace" : d.inInbox === false ? "Already uploaded to this flow" : "Already uploaded", tone: "amber" };
  const s = documentStatus(d.status, d.statusReason);
  if (s.label !== DOCUMENT_STATUSES[d.status]?.label) return { text: s.label, tone: STATUS_TONE[s.tone] };
  if (d.status === "ready") return { text: "Ready to send", tone: "green" };
  if (d.status === "needs_review" && d.checks) {
    if (d.checks.includes("duplicate")) return { text: "Same number as an earlier document", tone: "amber" };
    const values = d.failedChecks - d.checks.filter((c) => WHOLE.includes(c)).length;
    if (values >= 1) return { text: values === 1 ? "1 value to check" : `${values} values to check`, tone: "amber" };
  }
  return { text: s.label, tone: STATUS_TONE[s.tone] };
}

const href = (d: ListedDocument) => `/flows/${d.flowId}/documents/${d.id}`;
const received = (d: ListedDocument) => relativeTime(d.createdAt) ?? "—";

/** Send a ready document from a list row. A second press while it is out does nothing (the button is busy);
 *  on success onSent runs, then every documents list and the document's own queries refresh (the button stays busy until they have). */
export function useRowSend(id: string, onSent: () => void): UseMutationResult<unknown, unknown, void> {
  const qc = useQueryClient();
  return useMutation({
    // Keyed by document, so the selection bar leaves out a row whose own send is still out.
    mutationKey: ["document-send", id],
    mutationFn: () => sendDocument(id),
    onSuccess: () => {
      onSent();
      return Promise.all([["documents"], ["document", id], ["deliveries", id], ["document-history", id]].map((queryKey) => qc.invalidateQueries({ queryKey })));
    },
  });
}

/** A row's tick: a real checkbox in a 44px label, above the row link's overlay. */
const Tick = ({ d, selection, className }: { d: ListedDocument; selection: ListSelection; className: string }) => (
  <label className={`relative z-[1] flex shrink-0 items-center justify-center ${className}`}>
    <input type="checkbox" aria-label={`Select ${d.fileName}`} checked={selection.ids.has(d.id)} onChange={() => selection.toggle(d.id)} className="h-5 w-5" />
  </label>
);

function Row({ d, showFlow, sendable, columns, onSent, selection }: {
  d: ListedDocument; showFlow: boolean; sendable: boolean; columns: string; onSent: (d: ListedDocument) => void; selection?: ListSelection;
}) {
  const send = useRowSend(d.id, () => onSent({ ...d, status: "sending", statusReason: null }));
  // While the selection bar is sending or downloading, a row's own Send waits.
  const bulk = useIsMutating({ mutationKey: BULK_SEND_KEY }) > 0;
  const need = rowNeed(d);
  const line = kindSentence(d.kind, d.sender);
  const ticked = !!selection?.ids.has(d.id);
  return (
    <div role="row" className={`relative grid min-h-[64px] items-center gap-3 border-t border-border px-3 py-2 ${ticked ? "bg-brand-blue-soft" : "hover:bg-surface-2"}`} style={{ gridTemplateColumns: columns }}>
      {selection && <div role="cell">{!d.inInbox && <Tick d={d} selection={selection} className="h-11 w-11" />}</div>}
      <div role="cell" className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <Link href={href(d)} className="min-w-0 truncate text-[14.5px] font-semibold text-ink after:absolute after:inset-0">{d.fileName}</Link>
          {d.isSample && <Pill>Sample</Pill>}
        </div>
        {line && <div title={line} className="truncate text-[12.5px] text-ink-muted">{line}</div>}
        {d.number && <div className="truncate font-mono text-[12.5px] text-ink-muted">{d.number}</div>}
      </div>
      {showFlow && <div role="cell" className="min-w-0 truncate text-[13px] text-ink-muted">{d.flowName}</div>}
      <div role="cell" aria-live="polite" className="min-w-0">
        <Pill tone={need.tone}>{need.text}</Pill>
        {send.isError && d.status === "ready" && <p role="alert" className="m-0 mt-1 text-[12.5px] text-danger-text">{documentRefusalMessage(send.error)}</p>}
      </div>
      <div role="cell"><StatusJourney stage={documentStatus(d.status, d.statusReason).stage} compact /></div>
      <div role="cell" className="text-[13px] text-ink-muted">{received(d)}</div>
      <div role="cell" className="text-right">
        {d.status === "ready" && sendable && !selection && d.inInbox === false && d.statusReason !== "check_sort" ? (
          <Button variant="secondary" size="sm" aria-label={`Send ${d.fileName}`} loading={send.isPending || bulk} onClick={() => send.mutate()}
            className="relative z-[1] !border-brand-green-deep !text-brand-green-deep">Send</Button>
        ) : d.inInbox !== false && (d.status === "ready" || (d.inInbox && d.status === "needs_review")) ? (
          // An inbox document is answered on its own screen, never sent from a row; one not known to be sorted is not sent either.
          <span aria-hidden className={buttonClass("secondary", "sm")}>Open</span>
        ) : d.status === "needs_review" || d.statusReason === "check_sort" ? (
          // A sort we were not sure of is reviewed, never sent from a row: its notice is on the review screen.
          <span aria-hidden className={buttonClass("secondary", "sm")}>Review</span>
        ) : null}
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
  const drawn = documents.map((d) => (sent[d.id] && d.status === "ready" ? sent[d.id] : d)).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  // An inbox document is answered on its own screen: it has no tick (its row's "Open" is the way on).
  const tickable = drawn.filter((d) => !d.inInbox);
  const columns = `${selection ? "44px " : ""}minmax(0,2fr) ${showFlow ? "minmax(0,1fr) " : ""}minmax(0,1.4fr) 104px 96px 88px`;

  return (
    <>
      <div role="table" aria-label={label} className="hidden lg:block">
        <div role="row" className="grid gap-3 px-3 py-2 text-[12.5px] font-medium text-ink-muted" style={{ gridTemplateColumns: columns }}>
          {selection && (
            <div role="columnheader">
              {tickable.length > 1 && (
                <label className="flex h-11 w-11 items-center justify-center">
                  <input type="checkbox" aria-label={`Select all ${tickable.length} documents`} className="h-5 w-5"
                    checked={tickable.every((d) => selection.ids.has(d.id))} onChange={(e) => selection.all(e.target.checked)}
                    ref={(el) => { if (el) el.indeterminate = tickable.some((d) => selection.ids.has(d.id)) && !tickable.every((d) => selection.ids.has(d.id)); }} />
                </label>
              )}
            </div>
          )}
          <div role="columnheader">Document</div>
          {showFlow && <div role="columnheader">Flow</div>}
          <div role="columnheader">{needHeading}</div>
          <div role="columnheader">Progress</div>
          <div role="columnheader">Received</div>
          <div role="columnheader"><span className="sr-only">Action</span></div>
        </div>
        {drawn.map((d) => (
          <Row key={d.id} d={d} showFlow={showFlow} sendable={sendable} columns={columns} selection={selection} onSent={(s) => setSent((m) => ({ ...m, [s.id]: s }))} />
        ))}
      </div>
      <ul data-testid="documents-phone-list" aria-label={label} className="m-0 list-none p-0 lg:hidden">
        {drawn.map((d) => {
          const need = rowNeed(d);
          // R17: one second line, what it is when known, otherwise where it is.
          const line = kindSentence(d.kind, d.sender) ?? (showFlow ? d.flowName : null);
          return (
            <li key={d.id} className={`border-t border-border first:border-t-0 ${selection ? "flex items-stretch" : ""} ${selection?.ids.has(d.id) ? "bg-brand-blue-soft" : ""}`}>
              {selection && (d.inInbox ? <span className="w-11 shrink-0" /> : <Tick d={d} selection={selection} className="w-11 pl-2" />)}
              {/* `!` beats the global phone rule, whose `min-height: 44px !important` would otherwise win. */}
              <Link href={href(d)} className="flex !min-h-[92px] min-w-0 flex-1 items-center gap-3 px-4 py-3 text-ink">
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
                <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0 text-ink-muted">
                  <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}
