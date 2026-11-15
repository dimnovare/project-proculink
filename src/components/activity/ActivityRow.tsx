"use client";

import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button, Pill, buttonClass } from "@/components/bridge/DSPrimitives";
import { StatusJourney } from "@/components/bridge/StatusJourney";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { sendDocument, type ActivityEvent } from "@/lib/api/documents";
import { activityTime, fixDestinationHref, type ActivityView } from "@/lib/activityRows";
import { documentRefusalMessage } from "@/lib/documentRefusals";

/** The row's columns, shared with the page's column header: time · what · flow · who · result · chevron, and on a phone time · what · chevron. */
export const ACTIVITY_GRID =
  "grid grid-cols-[42px_minmax(0,1fr)_44px] gap-x-2 gap-y-0.5 lg:grid-cols-[52px_minmax(0,3.2fr)_minmax(0,1.1fr)_minmax(0,1fr)_124px_44px] lg:items-center lg:gap-3.5";
/** Placed in the phone's three columns; at lg each cell takes the next column. */
const AT_LG = "lg:col-auto lg:row-auto";

export function ActivityRow({ event: e, view, who, open, onToggle }: {
  event: ActivityEvent; view: ActivityView; who: string; open: boolean; onToggle: () => void;
}) {
  const qc = useQueryClient();
  // A second press lands before the button re-renders disabled; the cache knows at once. Shared by every row of the document.
  const sending = ["send-again", e.documentId];
  const send = useMutation({
    mutationKey: sending,
    mutationFn: () => sendDocument(e.documentId!),
    onSuccess: () => Promise.all(
      [["activity"], ["documents"], ["document", e.documentId], ["deliveries", e.documentId], ["document-history", e.documentId]]
        .map((queryKey) => qc.invalidateQueries({ queryKey })),
    ),
  });
  const sentence = `activity-s-${e.id}`;
  const { before, strong, after } = view.sentence;
  const Chevron = open ? ChevronUp : ChevronDown;
  return (
    <li data-testid="activity-row" className={`border-t border-border-faint ${open ? "bg-bg" : ""}`}>
      <div className={`${ACTIVITY_GRID} items-start py-3 pl-4 pr-1 lg:min-h-14 lg:py-1.5 lg:pl-5 lg:pr-2`}>
        <span className={`col-start-1 row-start-1 pt-px font-mono text-[12.5px] text-ink-muted ${AT_LG}`}>{activityTime(e.ts)}</span>
        <div className={`col-start-2 row-start-1 min-w-0 ${AT_LG}`}>
          <p id={sentence} className="m-0 text-[14px] text-ink [overflow-wrap:anywhere]">
            {before}{strong && <strong className="font-semibold">{strong}</strong>}{after}
          </p>
          {view.why && <p className="m-0 mt-0.5 text-[13px] text-ink-muted [overflow-wrap:anywhere]">{view.why}</p>}
        </div>
        <span className="col-start-2 row-start-2 flex min-w-0 flex-wrap gap-x-1 text-[13px] lg:contents">
          <span className={`min-w-0 truncate text-ink-muted ${e.flowName ? "after:content-[','] lg:after:content-none" : ""}`}>{e.flowName}</span>
          <span className="min-w-0 truncate text-ink">{who}</span>
        </span>
        <span className={`col-start-2 row-start-3 mt-1.5 lg:mt-0 ${AT_LG}`}><Pill tone={view.tag.tone}>{view.tag.label}</Pill></span>
        <button
          type="button" aria-expanded={open} aria-label={open ? "Hide details" : "Show details"} aria-describedby={sentence} onClick={onToggle}
          className={`col-start-3 row-span-3 row-start-1 inline-flex h-11 w-11 items-center justify-center self-center rounded-lg text-ink-muted hover:bg-surface-2 ${AT_LG}`}
        >
          <Chevron size={18} aria-hidden />
        </button>
      </div>
      {open && (
        <div data-testid="activity-detail" className="flex flex-col gap-3.5 px-4 pb-4 lg:pb-[18px] lg:pl-[86px] lg:pr-5">
          {view.facts.length > 0 && (
            <dl className="m-0 grid grid-cols-[repeat(auto-fit,minmax(min(230px,100%),1fr))] gap-x-7 gap-y-3.5">
              {view.facts.map((f) => (
                <div key={f.term} className="min-w-0">
                  <dt className="text-[12.5px] text-ink-muted">{f.term}</dt>
                  <dd className={`m-0 mt-0.5 font-medium text-ink [overflow-wrap:anywhere] ${f.mono ? "font-mono text-[13px]" : "text-[14px]"} ${f.stopped ? "flex items-center gap-2.5" : ""}`}>
                    {f.stopped && <span aria-hidden><StatusJourney stage={{ failed: f.stopped }} compact /></span>}
                    {f.value}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {send.isSuccess && <StatusNotice tone="success">Sending again. A new row shows the result.</StatusNotice>}
          {send.isError && <StatusNotice tone="error">{documentRefusalMessage(send.error)}</StatusNotice>}
          <div className="flex flex-wrap gap-2.5 empty:hidden">
            {view.canFix && e.flowId && <Link href={fixDestinationHref(e.flowId)} className={buttonClass("primary")}>Fix the destination</Link>}
            {view.canSendAgain && (
              <Button disabled={send.isPending} onClick={() => qc.isMutating({ mutationKey: sending }) || send.mutate()} className="!border-brand-green-deep !text-brand-green-deep">Send again</Button>
            )}
            {e.documentId && e.flowId && <Link href={`/flows/${e.flowId}/documents/${e.documentId}`} className={buttonClass()}>Open document</Link>}
            {e.action === "flow.published" && e.flowId && <Link href={`/flows/${e.flowId}`} className={buttonClass()}>Open the flow</Link>}
          </div>
        </div>
      )}
    </li>
  );
}
