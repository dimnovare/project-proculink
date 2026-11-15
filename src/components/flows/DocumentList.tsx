"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { StatusJourney } from "@/components/bridge/StatusJourney";
import { Button, Pill, buttonClass } from "@/components/bridge/DSPrimitives";
import { relativeTime } from "@/lib/relativeTime";
import { documentStatus, WHOLE_DOCUMENT_CHECKS, type DocumentStatusRow } from "@/lib/documentStatusManifest";
import { documentRefusalMessage } from "@/lib/documentRefusals";
import { sendDocument, type DocumentRow, type DocumentSummary } from "@/lib/api/documents";

/** A document as a list knows it: a row of the paged list, or a bare summary (the flow page). */
export type ListedDocument = DocumentSummary & Partial<Omit<DocumentRow, keyof DocumentSummary>>;

type Tone = "amber" | "green" | "blue" | "danger";
const STATUS_TONE: Record<DocumentStatusRow["tone"], Tone> = { working: "blue", warning: "amber", error: "danger", success: "green" };
const WHOLE: readonly string[] = WHOLE_DOCUMENT_CHECKS;

/** What a row asks of a person, in a few words, and its colour. */
export function rowNeed(d: ListedDocument): { text: string; tone: Tone } {
  if (d.statusReason === "duplicate_file") return { text: "Already uploaded to this flow", tone: "amber" };
  if (d.status === "ready") return { text: "Ready to send", tone: "green" };
  if (d.status === "needs_review" && d.checks) {
    if (d.checks.includes("duplicate")) return { text: "Same number as an earlier document", tone: "amber" };
    const values = d.failedChecks - d.checks.filter((c) => WHOLE.includes(c)).length;
    if (values >= 1) return { text: values === 1 ? "1 value to check" : `${values} values to check`, tone: "amber" };
  }
  const s = documentStatus(d.status, d.statusReason);
  return { text: s.label, tone: STATUS_TONE[s.tone] };
}

const href = (d: ListedDocument) => `/flows/${d.flowId}/documents/${d.id}`;
const received = (d: ListedDocument) => relativeTime(d.createdAt) ?? "—";

/** Send a ready document from a list row. A second press while it is out does nothing (the button is busy);
 *  on success onSent runs, then every documents list and the document's own queries refresh (the button stays busy until they have). */
export function useRowSend(id: string, onSent: () => void): UseMutationResult<unknown, unknown, void> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => sendDocument(id),
    onSuccess: () => {
      onSent();
      return Promise.all([["documents"], ["document", id], ["deliveries", id], ["document-history", id]].map((queryKey) => qc.invalidateQueries({ queryKey })));
    },
  });
}

function Row({ d, showFlow, sendable, columns, onSent }: {
  d: ListedDocument; showFlow: boolean; sendable: boolean; columns: string; onSent: (d: ListedDocument) => void;
}) {
  const send = useRowSend(d.id, () => onSent({ ...d, status: "sending", statusReason: null }));
  const need = rowNeed(d);
  return (
    <div role="row" className="relative grid min-h-[64px] items-center gap-3 border-t border-border px-3 py-2 hover:bg-surface-2" style={{ gridTemplateColumns: columns }}>
      <div role="cell" className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <Link href={href(d)} className="min-w-0 truncate text-[14.5px] font-semibold text-ink after:absolute after:inset-0">{d.fileName}</Link>
          {d.isSample && <Pill>Sample</Pill>}
        </div>
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
        {d.status === "ready" && sendable ? (
          <Button variant="secondary" size="sm" aria-label={`Send ${d.fileName}`} loading={send.isPending} onClick={() => send.mutate()}
            className="relative z-[1] !border-brand-green-deep !text-brand-green-deep">Send</Button>
        ) : d.status === "needs_review" ? (
          <span aria-hidden className={buttonClass("secondary", "sm")}>Review</span>
        ) : null}
      </div>
    </div>
  );
}

export function DocumentList({ documents, showFlow, label, needHeading = "Status", sendable = false }: {
  documents: ListedDocument[];
  showFlow: boolean;
  /** The list's accessible name. */
  label: string;
  /** Heading of the tag column. Default "Status". */
  needHeading?: string;
  /** Ready rows carry Send (table only). */
  sendable?: boolean;
}) {
  // What this list sent, kept until the incoming list stops calling it ready. The caller resets it with a `key`.
  const [sent, setSent] = useState<Record<string, ListedDocument>>({});
  const incoming = new Set(documents.map((d) => d.id));
  const drawn = [
    ...documents.map((d) => (sent[d.id] && d.status === "ready" ? sent[d.id] : d)),
    ...Object.values(sent).filter((s) => !incoming.has(s.id)),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  const columns = `minmax(0,2fr) ${showFlow ? "minmax(0,1fr) " : ""}minmax(0,1.4fr) 104px 96px 88px`;

  return (
    <>
      <div role="table" aria-label={label} className="hidden lg:block">
        <div role="row" className="grid gap-3 px-3 py-2 text-[12.5px] font-medium text-ink-muted" style={{ gridTemplateColumns: columns }}>
          <div role="columnheader">Document</div>
          {showFlow && <div role="columnheader">Flow</div>}
          <div role="columnheader">{needHeading}</div>
          <div role="columnheader">Progress</div>
          <div role="columnheader">Received</div>
          <div role="columnheader"><span className="sr-only">Action</span></div>
        </div>
        {drawn.map((d) => (
          <Row key={d.id} d={d} showFlow={showFlow} sendable={sendable} columns={columns} onSent={(s) => setSent((m) => ({ ...m, [s.id]: s }))} />
        ))}
      </div>
      <ul data-testid="documents-phone-list" aria-label={label} className="m-0 list-none p-0 lg:hidden">
        {drawn.map((d) => {
          const need = rowNeed(d);
          return (
            <li key={d.id} className="border-t border-border first:border-t-0">
              {/* `!` beats the global phone rule, whose `min-height: 44px !important` would otherwise win. */}
              <Link href={href(d)} className="flex !min-h-[92px] items-center gap-3 px-4 py-3 text-ink">
                <div className="grid min-w-0 flex-1 gap-1">
                  <div className="flex min-w-0 items-baseline justify-between gap-3">
                    <span data-testid="document-name" className="min-w-0 truncate text-[16px] font-semibold">{d.fileName}</span>
                    <span className="shrink-0 text-[13px] text-ink-muted">{received(d)}</span>
                  </div>
                  {showFlow && <span className="truncate text-[14px] text-ink-muted">{d.flowName}</span>}
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
