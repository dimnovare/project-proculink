"use client";

import { useEffect, useRef } from "react";
import { useIsMutating, useMutation, useMutationState, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/bridge/DSPrimitives";
import { useConfirm } from "@/components/ui/confirm";
import { noticeAria } from "@/components/bridge/layout/StatusNotice";
import { documentRefusalMessage } from "@/lib/documentRefusals";
import { eachDocument, fetchOriginal, removeOne, saveOriginals, sendOne, type Each } from "@/lib/eachDocument";
import type { ListedDocument } from "./DocumentList";
import { forgetRemoved, removable, removalDialog, rowSends } from "./RowActions";
import { useUploadQueueIfMounted } from "./UploadQueue";

/** The key every run of the bar (send or download) goes under; a row's own Send is busy while one is out. */
export const BULK_SEND_KEY = ["document-send", "bulk"] as const;

/** "Send", "Send both", "Send all 4", "Send the ready one", "Send the 3 ready"; null when no ticked row is ready. */
export function sendLabel(selected: number, ready: number): string | null {
  if (ready === 0) return null;
  if (ready < selected) return ready === 1 ? "Send the ready one" : `Send the ${ready} ready`;
  return selected === 1 ? "Send" : selected === 2 ? "Send both" : `Send all ${selected}`;
}

type Words = { verb: "sent" | "downloaded" | "removed"; unit: "document" | "file" };
/** What the last run did. Held by the screen, so it outlives the bar (Done, Clear or a tab change during a run). */
export type BarReport = { lines: React.ReactNode; ok: boolean };

/** What a run did, in the words the bar prints. `went` is the success sentence for what was done. */
function summary<R>(r: Each<ListedDocument, R>, w: Words, went: string): BarReport {
  const ok = r.refused.length === 0 && !r.stopped;
  if (ok) return { ok, lines: went };
  const refusedOne = r.refused.length === 1 && r.refused[0];
  const left = r.stopped?.left ?? 0;
  return {
    ok,
    lines: (
      <>
        {r.done.length > 0 && `${went} `}
        {refusedOne && `${refusedOne.item.fileName} couldn't be ${w.verb}: ${documentRefusalMessage(refusedOne.error)} `}
        {r.refused.length > 1 && (
          <>
            {`${r.refused.length} couldn't be ${w.verb}:`}
            <ul className="m-0 mt-1 list-disc pl-5">
              {r.refused.map((x) => <li key={x.item.id}>{`${x.item.fileName}: ${documentRefusalMessage(x.error)}`}</li>)}
            </ul>
          </>
        )}
        {r.stopped && `${documentRefusalMessage(r.stopped.error)} ${left === 1 ? `1 ${w.unit} wasn't` : `${left} ${w.unit}s weren't`} ${w.verb}.`}
      </>
    ),
  };
}

/** One document sent: the bar's sentence, also said by the review screen after Send and open next. */
export const onItsWay = (fileName: string) => `${fileName} is on its way.`;
const sentWords = (r: Each<ListedDocument, unknown>) =>
  r.refused.length || r.stopped ? `${r.done.length} sent.`
  : r.done.length === 1 ? onItsWay(r.done[0].item.fileName) : `${r.done.length} documents are on their way.`;
const downloadedWords = (n: number, first?: string) => (n === 1 ? `${first} downloaded.` : `${n} files downloaded in documents.zip.`);

export function SelectionBar({ selected, sent, report, onReport, onSent, onClear }: {
  /** The ticked rows on screen, in list order. */
  selected: ListedDocument[];
  /** Documents the screen has already sent: never sent again, even before the list refreshes. */
  sent: ReadonlySet<string>;
  /** The last run's result, or null; the screen clears it on the person's next action. */
  report: BarReport | null;
  onReport: (r: BarReport) => void;
  /** A document went: untick it at once. A download unticks nothing. */
  onSent: (id: string) => void;
  onClear: () => void;
}) {
  const qc = useQueryClient();
  const queue = useUploadQueueIfMounted();
  const confirm = useConfirm();
  // Held from the press itself, so a second press before the next render starts nothing.
  const busy = useRef(false);
  const live = useRef<HTMLDivElement>(null);
  // A run belongs to the screen, not to this bar: any run still out (from a bar since closed) holds every bar.
  const running = useIsMutating({ mutationKey: BULK_SEND_KEY }) > 0;
  // A row whose own Send is still out is not sent again from here.
  const rowSending = useMutationState({
    filters: { mutationKey: ["document-send"], status: "pending" },
    select: (m) => String(m.options.mutationKey?.[1]),
  });
  const run = useMutation({
    mutationKey: BULK_SEND_KEY,
    // Everything after the run is done inside it, so it still happens when the bar was closed meanwhile.
    mutationFn: async (job: () => Promise<BarReport>) => {
      try {
        onReport(await job());
      } finally {
        busy.current = false;
        for (const key of ["documents", "activity"]) qc.invalidateQueries({ queryKey: [key] });
      }
    },
  });
  const start = (job: () => Promise<BarReport>) => {
    if (busy.current || qc.isMutating({ mutationKey: BULK_SEND_KEY }) > 0) return;
    busy.current = true;
    run.mutate(job);
  };
  // When the run took away the button that had focus (everything went), focus goes to the result, not the page.
  useEffect(() => {
    if (report && (!document.activeElement || document.activeElement === document.body)) live.current?.focus();
  }, [report]);
  // As the row: only a document known to be with a flow is sent from here (an inbox one is answered on its own screen).
  const ready = selected.filter((d) => rowSends(d) && !sent.has(d.id) && !rowSending.includes(d.id));
  const label = sendLabel(selected.length, ready.length);
  // Only what the server says this person may remove, and nothing being read or sent.
  const removing = selected.filter((d) => d.canRemove === true && removable(d.status));
  const n = selected.length;
  if (n === 0 && !report && !running) return null;

  const pressSend = () => start(async () => {
    const r = await eachDocument(ready, sendOne, (d) => onSent(d.id));
    return summary(r, { verb: "sent", unit: "document" }, sentWords(r));
  });
  const pressDownload = () => start(async () => {
    const r = await eachDocument(selected, fetchOriginal);
    try {
      await saveOriginals(r.done.map((x) => x.value));
    } catch (e) {
      return { ok: false, lines: documentRefusalMessage(e) };
    }
    return summary(r, { verb: "downloaded", unit: "file" }, downloadedWords(r.done.length, r.done[0]?.item.fileName));
  });

  const pressRemove = async () => {
    if (busy.current || running || !(await confirm(removalDialog(removing, selected.filter((d) => d.canRemove === false).length)))) return;
    const items = removing;
    start(async () => {
      const r = await eachDocument(items, removeOne);
      onClear();
      forgetRemoved(qc, queue, r.done.map((x) => x.item));
      return summary(r, { verb: "removed", unit: "document" }, r.done.length === 1 ? "1 document removed." : `${r.done.length} documents removed.`);
    });
  };

  const outlined = "!border-navy-muted !text-white hover:!bg-navy-surface";
  return (
    <div role="region" aria-label={n === 1 ? "1 document selected" : `${n} documents selected`}
      className="sticky bottom-6 z-sticky mx-auto flex w-full max-w-[640px] flex-wrap items-center gap-3 rounded-card-lg bg-navy px-4 py-3 text-[14px] text-white max-sm:gap-2.5 max-sm:p-3">
      {/* Both live elements are there from the first draw, empty, so the result is spoken when it arrives. */}
      <div ref={live} tabIndex={-1} className={`min-w-0 flex-1 outline-none ${report ? "basis-full sm:basis-auto" : "max-sm:basis-1/2"}`}>
        {!report && n > 0 && <p className="m-0 font-semibold">{`${n} selected`}</p>}
        <div {...noticeAria("success")}>{report?.ok && report.lines}</div>
        <div {...noticeAria("error")}>{report && !report.ok && report.lines}</div>
      </div>
      {n > 0 && (
        <>
          {label && (
            <Button type="button" variant="send" loading={running} onClick={pressSend} className="max-sm:order-2 max-sm:flex-1 max-sm:basis-[40%]">
              {label}
            </Button>
          )}
          <Button type="button" variant="ghost" loading={running} onClick={pressDownload} className={`${outlined} max-sm:order-3 max-sm:flex-1 max-sm:basis-[40%]`}>
            {n === 1 ? "Download file" : "Download files"}
          </Button>
          {removing.length > 0 && (
            <Button type="button" variant="ghost" loading={running} onClick={() => void pressRemove()} className={`${outlined} max-sm:order-4 max-sm:flex-1 max-sm:basis-[40%]`}>
              Remove
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={onClear} className={`${outlined} max-sm:order-1`}>Clear</Button>
        </>
      )}
    </div>
  );
}
